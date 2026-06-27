import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { TeleFile } from "../types";
import { useFileStore } from "../../stores/fileStore";

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
    runExclusive(async () => {
      await saveIndex(channelId, healedFiles);
    }).catch((err) => {
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
export async function loadIndex(channelId: string): Promise<TeleFile[]> {
  const client = getClient();
  let peer: any;

  try {
    peer = await resolveChannelInputPeer(channelId);
  } catch (err) {
    console.error("[metadataStore] Failed to resolve channel entity:", err);
    throw err;
  }

  const parseAndDedup = (messages: any[]): TeleFile[] => {
    const indexMsgs = messages
      .filter((m) => m?.text?.includes("teledrive_index"))
      .sort((a: any, b: any) => a.id - b.id);

    // Merge all chunks into one map, keyed by file.id — last write wins.
    const byId = new Map<string, TeleFile>();
    for (const msg of indexMsgs) {
      try {
        const data = JSON.parse(msg.text || "");
        if (data && Array.isArray(data.files)) {
          for (const f of data.files) {
            if (f?.id) byId.set(f.id, f);
          }
        }
      } catch (e) {
        console.warn(`[metadataStore] Failed to parse index msg ${msg.id}:`, e);
      }
    }
    return Array.from(byId.values());
  };

  // --- Step 1: pinned messages ---
  try {
    const pinned = await withTimeout(
      client.getMessages(peer, {
        filter: new Api.InputMessagesFilterPinned(),
        limit: 100,
      }),
      5000,
      "client.getMessages(pinned)"
    );
    const hasPinnedIndex = pinned.some((m: any) => m?.text?.includes("teledrive_index"));
    if (hasPinnedIndex) {
      return healAndSave(channelId, parseAndDedup(pinned));
    }
  } catch (pinnedErr) {
    console.warn("[metadataStore] Failed to load pinned messages, falling back to scan:", pinnedErr);
  }

  // --- Step 2: full scan of recent messages ---
  try {
    const recent = await withTimeout(
      client.getMessages(peer, { limit: 200 }),
      5000,
      "client.getMessages(recent)"
    );
    return healAndSave(channelId, parseAndDedup(recent));
  } catch (scanErr) {
    console.error("[metadataStore] Failed to scan channel messages:", scanErr);
    return [];
  }
}

// ---------------------------------------------------------------------------
// saveIndex — nuclear rewrite strategy: delete all old index msgs, send fresh
// ---------------------------------------------------------------------------

/**
 * Saves the virtual file metadata index.
 *
 * Strategy: DELETE all existing index messages first, then send fresh ones.
 * This is the only reliable approach when:
 *   - EDIT_MESSAGE_TEMP_RESTRICTED blocks edits
 *   - Previous failed saves left duplicate pinned messages
 *
 * Pinning is best-effort (non-fatal). loadIndex falls back to a scan if
 * the pinned messages aren't available.
 */
export async function saveIndex(channelId: string, files: TeleFile[]): Promise<void> {
  const client = getClient();
  let peer: any;

  try {
    peer = await resolveChannelInputPeer(channelId);
  } catch (err) {
    console.error("[metadataStore] Failed to resolve channel entity for save:", err);
    throw err;
  }

  // 1. Find ALL existing index messages (pinned or not) and delete them.
  //    This prevents duplicates from accumulating.
  let oldIndexMsgIds: number[] = [];
  try {
    // Check pinned messages
    const pinned = await withTimeout(
      client.getMessages(peer, {
        filter: new Api.InputMessagesFilterPinned(),
        limit: 100,
      }),
      5000,
      "client.getMessages(pinned_save)"
    );
    const fromPinned = pinned
      .filter((m: any) => m?.text?.includes("teledrive_index"))
      .map((m: any) => m.id);

    // Also check recent messages in case some aren't pinned
    const recent = await withTimeout(
      client.getMessages(peer, { limit: 200 }),
      5000,
      "client.getMessages(recent_save)"
    );
    const fromRecent = recent
      .filter((m: any) => m?.text?.includes("teledrive_index"))
      .map((m: any) => m.id);

    // Union of both sets
    oldIndexMsgIds = [...new Set([...fromPinned, ...fromRecent])];
  } catch (err) {
    console.warn("[metadataStore] Could not enumerate old index messages:", err);
  }

  // Unpin and delete all old index messages in a single batch operation.
  // Deleting the message automatically removes it from the pinned list.
  if (oldIndexMsgIds.length > 0) {
    try {
      await withTimeout(
        client.deleteMessages(peer, oldIndexMsgIds, { revoke: true }),
        5000,
        "deleteMessages(batch)"
      );
    } catch (err: any) {
      console.warn(
        `[metadataStore] Batch delete of old index messages failed (non-fatal):`,
        err?.message || err
      );
    }
  }

  // 2. Chunk files (≤15 files per chunk to stay under 4096 chars)
  const CHUNK_SIZE = 15;
  const chunks: TeleFile[][] = [];
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    chunks.push(files.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push([]);

  // 3. Send fresh index messages and try to pin each in parallel
  const sendPromises = chunks.map(async (chunk, i) => {
    const payload = {
      teledrive_index: true,
      version: 1,
      chunkIndex: i,
      totalChunks: chunks.length,
      files: chunk,
    };
    const text = JSON.stringify(payload);

    try {
      const result = await withTimeout(
        client.sendMessage(peer, { message: text }),
        8000,
        `sendMessage(chunk ${i})`
      );

      // Pin best-effort
      try {
        await withTimeout(
          client.invoke(
            new Api.messages.UpdatePinnedMessage({
              peer,
              id: result.id,
              unpin: false,
              silent: true,
            })
          ),
          4000,
          `UpdatePinnedMessage(pin chunk ${i})`
        );
      } catch (pinErr: any) {
        console.warn(
          `[metadataStore] Could not pin index chunk ${i} (id=${result.id}):`,
          pinErr?.message || pinErr
        );
      }
    } catch (sendErr) {
      console.error(`[metadataStore] Failed to send index chunk ${i}:`, sendErr);
      throw sendErr;
    }
  });

  await Promise.all(sendPromises);
}

/**
 * Saves the index directly WITHOUT acquiring the shared mutex.
 *
 * Use ONLY from `uploadManager` which already controls its own concurrency.
 * Calling this instead of `runExclusive(saveIndex)` prevents upload-manager
 * from blocking (and being blocked by) user-action debounced saves.
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
