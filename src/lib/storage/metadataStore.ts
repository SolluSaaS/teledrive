import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { TeleFile } from "../types";
import { useFileStore } from "../../stores/fileStore";
import { enqueueSave } from "./indexQueue";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

class Mutex {
  private promise: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentPromise = this.promise;
    this.promise = currentPromise.then(() => nextPromise);
    await currentPromise;
    return release!;
  }

  /**
   * Tries to acquire the mutex within `timeoutMs` milliseconds.
   * Throws an error if the lock cannot be acquired in time.
   */
  async acquireWithTimeout(timeoutMs: number): Promise<() => void> {
    let timeoutId: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Mutex acquisition timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const releasePromise = this.acquire();
    try {
      const release = await Promise.race([releasePromise, timeoutPromise]);
      clearTimeout(timeoutId);
      return release;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}

const metadataMutex = new Mutex();

/**
 * Runs a task exclusively (under the metadata mutex lock) to serialize index updates.
 */
export async function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const release = await metadataMutex.acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Runs a task exclusively but gives up if the lock isn't acquired within 15 seconds.
 * Prevents indefinite deadlocks when two operations compete for the mutex.
 */
export async function runExclusiveWithTimeout<T>(task: () => Promise<T>): Promise<T> {
  const release = await metadataMutex.acquireWithTimeout(15_000);
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Helper to wrap any promise in a timeout to prevent indefinite hangs.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout of ${timeoutMs}ms exceeded for ${label}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveChannelInputPeer(channelId: string) {
  const client = getClient();
  try {
    // Try local session cache first (fast, non-blocking)
    return await client.getInputEntity(channelId);
  } catch (err) {
    console.warn("[metadataStore] getInputEntity failed, falling back to getEntity with timeout:", err);
    return withTimeout(client.getEntity(channelId), 5000, "client.getEntity");
  }
}

// ---------------------------------------------------------------------------
// Virtual Folder Reconstruction & Auto-Healing
// ---------------------------------------------------------------------------

/**
 * Reconstructs missing virtual folders from a file list.
 */
export function reconstructMissingFolders(
  files: TeleFile[],
  channelId: string
): { healedFiles: TeleFile[]; changed: boolean } {
  const existingFolderPaths = new Set<string>();
  for (const f of files) {
    if (f.mime === "inode/directory" || f.mime === "application/x-directory") {
      const fullPath = f.folderPath === "/" ? `/${f.name}` : `${f.folderPath}/${f.name}`;
      existingFolderPaths.add(fullPath);
    }
  }

  const reconstructedFolders: TeleFile[] = [];
  let changed = false;

  for (const f of files) {
    if (f.trashed || f.archived) continue;
    const path = f.folderPath;
    if (!path || path === "/") continue;

    const segments = path.split("/").filter(Boolean);
    let currentParent = "/";

    for (let i = 0; i < segments.length; i++) {
      const name = segments[i];
      const folderFullPath = currentParent === "/" ? `/${name}` : `${currentParent}/${name}`;

      if (!existingFolderPaths.has(folderFullPath)) {
        const newFolder: TeleFile = {
          id: `healed_${Math.random().toString(36).substring(2, 11)}`,
          name,
          size: 0,
          mime: "inode/directory",
          folderPath: currentParent,
          messageId: 0,
          channelId,
          uploadedAt: Date.now(),
          starred: false,
          trashed: false,
          archived: false,
        };
        reconstructedFolders.push(newFolder);
        existingFolderPaths.add(folderFullPath);
        changed = true;
      }

      currentParent = folderFullPath;
    }
  }

  return {
    healedFiles: [...files, ...reconstructedFolders],
    changed,
  };
}

async function healAndSave(channelId: string, files: TeleFile[]): Promise<TeleFile[]> {
  const { healedFiles, changed } = reconstructMissingFolders(files, channelId);
  if (changed) {
    console.log(`[metadataStore] Healed missing virtual folders. Saving updated index to Telegram...`);
    // Use the queue directly — fire and forget, since this is a one-shot
    // background fixup. Failures are recoverable on next bootstrap.
    enqueueSave(channelId, healedFiles).catch((err) => {
      console.error("[metadataStore] Failed to save healed index to Telegram:", err);
    });
  }
  return healedFiles;
}

// ---------------------------------------------------------------------------
// loadIndex
// ---------------------------------------------------------------------------

/**
 * Loads the virtual file metadata index from the Telegram channel.
 *
 * Reads ALL pinned messages that look like teledrive_index entries,
 * merges their file arrays, then deduplicates by `id` (keeping the latest
 * entry per id) so that duplicate/stale pinned messages never show ghost files.
 *
 * Falls back to scanning the last 200 messages if no pinned index is found
 * (handles the case where the pin was blocked by Telegram's new-channel lock).
 */
export interface ParsedIndexChunk {
  msgId: number;
  chunkIndex: number;
  totalChunks: number;
  files: TeleFile[];
}

/**
 * Parses a list of Telegram messages into ParsedIndexChunk records.
 * Filters out non-index messages and malformed chunks.
 */
function parseIndexMessages(messages: any[]): ParsedIndexChunk[] {
  const indexMsgs = messages
    .filter((m: any) => m?.text?.includes("teledrive_index"))
    .sort((a: any, b: any) => a.id - b.id);
  const parsed: ParsedIndexChunk[] = [];
  for (const msg of indexMsgs) {
    try {
      const data = JSON.parse(msg.text || "");
      if (
        data &&
        Array.isArray(data.files) &&
        typeof data.chunkIndex === "number" &&
        typeof data.totalChunks === "number" &&
        data.totalChunks > 0 &&
        data.chunkIndex >= 0 &&
        data.chunkIndex < data.totalChunks
      ) {
        const files = (data.files as TeleFile[]).filter((f) => f?.id);
        parsed.push({
          msgId: Number(msg.id),
          chunkIndex: data.chunkIndex,
          totalChunks: data.totalChunks,
          files,
        });
      }
    } catch (e) {
      // Skip malformed chunks; they're a normal consequence of partial saves.
    }
  }
  return parsed;
}

/**
 * For a single totalChunks group, finds the most-recent COMPLETE save epoch.
 *
 * Telegram message ids within a channel are STRICTLY INCREASING, so epoch
 * boundaries must be detected by chunkIndex repetition: each save emits
 * chunks 0..N-1, so seeing chunkIndex=K where K <= previously-seen max
 * means a new save window started.
 *
 * Returns the chosen epoch (in chunkIndex-sorted order) or null if no
 * epoch in this group is complete.
 */
export function findMostRecentCoherentEpoch(
  chunks: ParsedIndexChunk[]
): ParsedIndexChunk[] | null {
  if (chunks.length === 0) return null;
  const sorted = [...chunks].sort((a, b) => a.msgId - b.msgId);

  const epochs: ParsedIndexChunk[][] = [];
  let current: ParsedIndexChunk[] = [sorted[0]];
  let maxChunkIdx = sorted[0].chunkIndex;
  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.chunkIndex <= maxChunkIdx) {
      epochs.push(current);
      current = [c];
      maxChunkIdx = c.chunkIndex;
    } else {
      current.push(c);
      maxChunkIdx = c.chunkIndex;
    }
  }
  epochs.push(current);

  for (let i = epochs.length - 1; i >= 0; i--) {
    const epoch = epochs[i];
    const total = epoch[0]?.totalChunks;
    if (!total) continue;
    const present = new Set(epoch.map((c) => c.chunkIndex));
    let complete = true;
    for (let k = 0; k < total; k++) {
      if (!present.has(k)) {
        complete = false;
        break;
      }
    }
    if (complete) return [...epoch].sort((a, b) => a.chunkIndex - b.chunkIndex);
  }
  return null;
}

/**
 * Picks the most-recent fully-coherent set of index chunks from a list of
 * Telegram messages. Groups by totalChunks, finds the latest complete
 * epoch in each group, then picks the set with the highest minimum
 * message id (tie-break by totalChunks for granularity).
 *
 * Returns the chosen set's ParsedIndexChunks (sorted by chunkIndex),
 * or null if no coherent set exists.
 *
 * Exported so the IndexQueue's commitOnce can reuse the same selection
 * logic to identify the current "live" index for edit/delete targets.
 */
export function pickCoherentIndexSet(
  messages: any[]
): ParsedIndexChunk[] | null {
  const parsed = parseIndexMessages(messages);
  if (parsed.length === 0) return null;

  const byTotal = new Map<number, ParsedIndexChunk[]>();
  for (const p of parsed) {
    const list = byTotal.get(p.totalChunks);
    if (list) list.push(p);
    else byTotal.set(p.totalChunks, [p]);
  }

  let best: ParsedIndexChunk[] | null = null;
  let bestMinId = -Infinity;
  let bestTotal = 0;
  for (const [, chunks] of byTotal) {
    const coherent = findMostRecentCoherentEpoch(chunks);
    if (!coherent) continue;
    const minId = coherent.reduce(
      (m, c) => Math.min(m, c.msgId),
      Infinity
    );
    const total = coherent[0]?.totalChunks ?? 0;
    if (minId > bestMinId || (minId === bestMinId && total > bestTotal)) {
      best = coherent;
      bestMinId = minId;
      bestTotal = total;
    }
  }
  return best;
}

/**
 * Loads the virtual file metadata index from the Telegram channel.
 *
 * Reads ALL pinned messages that look like teledrive_index entries AND
 * the last 200 recent messages, then picks the most-recent coherent
 * chunk-set across both sources. This is robust against:
 *   - pin failures (FLOOD_WAIT): unpinned-but-sent chunks are still found
 *     via the recent scan, and their higher message ids make them win
 *     over any older pinned set.
 *   - partial saves: an epoch with a missing chunk (e.g. chunk=3 dropped)
 *     is skipped in favor of the latest COMPLETE epoch.
 *   - mixed-version channels: Frankenstein-merging across epochs is
 *     avoided — only fully-coherent sets are considered.
 */
export async function loadIndex(channelId: string): Promise<TeleFile[]> {
  const client = getClient();
  let peer: any;

  try {
    peer = await resolveChannelInputPeer(channelId);
  } catch (err) {
    console.error("[metadataStore] Failed to resolve channel entity:", err);
    throw err;
  }

  // Load from BOTH pinned and recent, then let pickCoherentIndexSet pick
  // the most-recent coherent set across all sources.
  let allMsgs: any[] = [];
  try {
    const pinned = await withTimeout(
      client.getMessages(peer, {
        filter: new Api.InputMessagesFilterPinned(),
        limit: 100,
      }),
      5000,
      "client.getMessages(pinned)"
    );
    allMsgs = allMsgs.concat(pinned);
  } catch (pinnedErr) {
    console.warn("[metadataStore] Failed to load pinned messages, falling back to scan:", pinnedErr);
  }

  try {
    const recent = await withTimeout(
      client.getMessages(peer, { limit: 200 }),
      5000,
      "client.getMessages(recent)"
    );
    allMsgs = allMsgs.concat(recent);
  } catch (scanErr) {
    console.warn("[metadataStore] Failed to scan channel messages:", scanErr);
  }

  if (allMsgs.length === 0) {
    console.error("[metadataStore] No messages loaded from channel");
    return [];
  }

  const chosenSet = pickCoherentIndexSet(allMsgs);
  if (!chosenSet) {
    console.warn(
      `[metadataStore] No coherent index set found across ${allMsgs.length} message(s); falling back to best-effort merge.`
    );
    // Best-effort: dedup by file id across ALL parsed chunks.
    const allParsed = parseIndexMessages(allMsgs);
    const byId = new Map<string, TeleFile>();
    for (const c of allParsed) {
      for (const f of c.files) byId.set(f.id, f);
    }
    return healAndSave(channelId, Array.from(byId.values()));
  }

  // Merge chosen set into a single TeleFile list, deduping by id.
  const byId = new Map<string, TeleFile>();
  for (const c of chosenSet) {
    for (const f of c.files) {
      byId.set(f.id, f);
    }
  }
  return healAndSave(channelId, Array.from(byId.values()));
}

// ---------------------------------------------------------------------------
// saveIndex — thin wrapper that delegates to the per-channel IndexQueue.
// ---------------------------------------------------------------------------
//
// All Telegram persistence of the index goes through `enqueueSave` which:
//   - coalesces many enqueues into one Telegram edit (no FLOOD_WAIT cascade)
//   - serializes per-channel writes (single writer rule)
//   - waits on FLOOD_WAIT_X and retries automatically
//   - surfaces queue state to the fileStore for the topbar pill
//
// This function is kept as a public API for callers that don't care about
// the queue mechanics (mostly legacy callers). It simply routes through the
// queue.
//
// Note: the old implementation used a Mutex + `activeSavePromise` chain which
// double-serialized every save and frequently timed out at 15 s, producing
// cascading FLOOD_WAIT errors (see src-tauri/vault_state.log). That whole
// serialization layer has been removed; the queue is the serializer now.

export function saveIndex(channelId: string, files: TeleFile[]): Promise<void> {
  return enqueueSave(channelId, files);
}

/**
 * Saves the index directly — same as `saveIndex`, kept as a named export
 * for upload-manager compat. The queue is already the single writer for
 * the channel, so there's no need to bypass anything.
 */
export const saveIndexDirect = saveIndex;

// ---------------------------------------------------------------------------
// Public CRUD helpers — all deduplicate by id before writing
// ---------------------------------------------------------------------------

/** Adds a file entry to the index (replaces if same id already exists). */
export async function addFile(channelId: string, file: TeleFile): Promise<TeleFile[]> {
  return runExclusive(async () => {
    const files = useFileStore.getState().files;
    // Replace existing entry with same id, or append
    const updatedFiles = [...files.filter((f) => f.id !== file.id), file];
    await saveIndex(channelId, updatedFiles);
    return updatedFiles;
  });
}

/** Removes a file entry from the index by id. */
export async function removeFile(channelId: string, fileId: string): Promise<TeleFile[]> {
  return runExclusive(async () => {
    const files = useFileStore.getState().files;
    const file = files.find((f) => f.id === fileId);
    const updatedFiles = files.filter((f) => f.id !== fileId);
    await saveIndex(channelId, updatedFiles);

    // Also delete the actual Telegram message if this was a real uploaded file
    // (folders have messageId=0 and live only in the index)
    if (file && file.messageId && file.messageId !== 0) {
      await deleteTelegramMessage(channelId, file.messageId).catch((err) => {
        console.warn(
          `[metadataStore] Could not delete Telegram message ${file.messageId} (non-fatal):`,
          err?.message || err
        );
      });
    }

    return updatedFiles;
  });
}

/**
 * Deletes a specific message from the Telegram storage channel.
 * Used when permanently deleting uploaded files — removes the file data from Telegram.
 * Non-fatal if the message was already deleted.
 */
export async function deleteTelegramMessage(
  channelId: string,
  messageId: number
): Promise<void> {
  if (!messageId || messageId === 0) return;
  const client = getClient();
  const peer = await resolveChannelInputPeer(channelId);
  await withTimeout(
    client.deleteMessages(peer, [messageId], { revoke: true }),
    5000,
    "deleteMessages"
  );
}

/**
 * Updates a file entry in the index.
 * Returns the updated file list but does NOT write to Telegram —
 * call saveIndex explicitly if you need to persist the update remotely.
 *
 * For non-critical updates (e.g. lastOpenedAt), use updateFileLocal to
 * avoid triggering a full Telegram round-trip on every preview open.
 */
export async function updateFile(
  channelId: string,
  fileId: string,
  patch: Partial<TeleFile>
): Promise<TeleFile[]> {
  return runExclusive(async () => {
    const files = useFileStore.getState().files;
    const updatedFiles = files.map((f) =>
      f.id === fileId ? { ...f, ...patch } : f
    );
    await saveIndex(channelId, updatedFiles);
    return updatedFiles;
  });
}

/**
 * Updates a file entry IN MEMORY ONLY — no Telegram write.
 * Use for non-critical metadata (e.g. lastOpenedAt) that should not
 * trigger a full index round-trip.
 * Returns the new file list so the caller can update the local store.
 */
export function updateFileLocal(
  files: TeleFile[],
  fileId: string,
  patch: Partial<TeleFile>
): TeleFile[] {
  return files.map((f) => (f.id === fileId ? { ...f, ...patch } : f));
}

/** Adds multiple file entries to the index in a single save round-trip. */
export async function addFilesBatch(channelId: string, newFiles: TeleFile[]): Promise<TeleFile[]> {
  return runExclusive(async () => {
    const files = useFileStore.getState().files;
    const byId = new Map<string, TeleFile>();
    for (const f of files) {
      byId.set(f.id, f);
    }
    for (const f of newFiles) {
      byId.set(f.id, f);
    }
    const updatedFiles = Array.from(byId.values());
    await saveIndex(channelId, updatedFiles);
    return updatedFiles;
  });
}
