import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { TeleFile } from "../types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveChannelPeer(channelId: string) {
  const client = getClient();
  return client.getEntity(channelId);
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
    peer = await resolveChannelPeer(channelId);
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
    const pinned = await client.getMessages(peer, {
      filter: new Api.InputMessagesFilterPinned(),
      limit: 100,
    });
    const hasPinnedIndex = pinned.some((m: any) => m?.text?.includes("teledrive_index"));
    if (hasPinnedIndex) {
      return parseAndDedup(pinned);
    }
  } catch (pinnedErr) {
    console.warn("[metadataStore] Failed to load pinned messages, falling back to scan:", pinnedErr);
  }

  // --- Step 2: full scan of recent messages ---
  try {
    const recent = await client.getMessages(peer, { limit: 200 });
    return parseAndDedup(recent);
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
    peer = await resolveChannelPeer(channelId);
  } catch (err) {
    console.error("[metadataStore] Failed to resolve channel entity for save:", err);
    throw err;
  }

  // 1. Find ALL existing index messages (pinned or not) and delete them.
  //    This prevents duplicates from accumulating.
  let oldIndexMsgIds: number[] = [];
  try {
    // Check pinned messages
    const pinned = await client.getMessages(peer, {
      filter: new Api.InputMessagesFilterPinned(),
      limit: 100,
    });
    const fromPinned = pinned
      .filter((m: any) => m?.text?.includes("teledrive_index"))
      .map((m: any) => m.id);

    // Also check recent messages in case some aren't pinned
    const recent = await client.getMessages(peer, { limit: 200 });
    const fromRecent = recent
      .filter((m: any) => m?.text?.includes("teledrive_index"))
      .map((m: any) => m.id);

    // Union of both sets
    oldIndexMsgIds = [...new Set([...fromPinned, ...fromRecent])];
  } catch (err) {
    console.warn("[metadataStore] Could not enumerate old index messages:", err);
  }

  // Unpin and delete all old index messages
  for (const msgId of oldIndexMsgIds) {
    try {
      await client.invoke(
        new Api.messages.UpdatePinnedMessage({
          peer,
          id: msgId,
          unpin: true,
          silent: true,
        })
      );
    } catch (_) { /* ignore */ }
    try {
      await client.deleteMessages(peer, [msgId], { revoke: true });
    } catch (_) { /* ignore */ }
  }

  // 2. Chunk files (≤15 files per chunk to stay under 4096 chars)
  const CHUNK_SIZE = 15;
  const chunks: TeleFile[][] = [];
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    chunks.push(files.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push([]);

  // 3. Send fresh index messages and try to pin each
  for (let i = 0; i < chunks.length; i++) {
    const payload = {
      teledrive_index: true,
      version: 1,
      chunkIndex: i,
      totalChunks: chunks.length,
      files: chunks[i],
    };
    const text = JSON.stringify(payload);

    try {
      const result = await client.sendMessage(peer, { message: text });

      // Pin best-effort
      try {
        await client.invoke(
          new Api.messages.UpdatePinnedMessage({
            peer,
            id: result.id,
            unpin: false,
            silent: true,
          })
        );
      } catch (pinErr: any) {
        console.warn(
          `[metadataStore] Could not pin index chunk ${i} (id=${result.id}):`,
          pinErr?.message || pinErr
        );
        // Non-fatal: loadIndex will find it via full scan
      }
    } catch (sendErr) {
      console.error(`[metadataStore] Failed to send index chunk ${i}:`, sendErr);
      throw sendErr;
    }
  }
}

// ---------------------------------------------------------------------------
// Public CRUD helpers — all deduplicate by id before writing
// ---------------------------------------------------------------------------

/** Adds a file entry to the index (replaces if same id already exists). */
export async function addFile(channelId: string, file: TeleFile): Promise<TeleFile[]> {
  const files = await loadIndex(channelId);
  // Replace existing entry with same id, or append
  const updatedFiles = [...files.filter((f) => f.id !== file.id), file];
  await saveIndex(channelId, updatedFiles);
  return updatedFiles;
}

/** Removes a file entry from the index by id. */
export async function removeFile(channelId: string, fileId: string): Promise<TeleFile[]> {
  const files = await loadIndex(channelId);
  const updatedFiles = files.filter((f) => f.id !== fileId);
  await saveIndex(channelId, updatedFiles);
  return updatedFiles;
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
  const files = await loadIndex(channelId);
  const updatedFiles = files.map((f) =>
    f.id === fileId ? { ...f, ...patch } : f
  );
  await saveIndex(channelId, updatedFiles);
  return updatedFiles;
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
