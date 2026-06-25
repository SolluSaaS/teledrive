import { Api } from "telegram";
import { getClient } from "../telegram/client";
import { TeleFile } from "../types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a channel-ID string to a GramJS entity that can be passed to APIs.
 * Handles both "-100XXXX" (Bot-API format) and plain XXXX formats.
 */
async function resolveChannelPeer(channelId: string) {
  const client = getClient();
  return client.getEntity(channelId);
}

/**
 * Sends a text message and attempts to pin it.
 * Pinning is treated as best-effort — if Telegram rejects it, we keep the
 * message unread and `loadIndex` will still find it via full-message scan.
 */
async function sendAndPin(
  channelId: string,
  peer: any,
  text: string
): Promise<number> {
  const client = getClient();
  const result = await client.sendMessage(peer, { message: text });

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
    // Non-fatal: message still exists and loadIndex can find it via scan
    console.warn(
      `[metadataStore] Could not pin index message (id=${result.id}):`,
      pinErr?.message || pinErr
    );
  }

  return result.id;
}

// ---------------------------------------------------------------------------
// loadIndex — primary + fallback scan
// ---------------------------------------------------------------------------

/**
 * Loads the virtual file metadata index.
 *
 * Strategy:
 * 1. Try pinned messages (fast path for the normal case).
 * 2. If none found, scan the last 200 channel messages (handles the case
 *    where pin was blocked by Telegram's new-channel restriction).
 *
 * This makes the index resilient to pinning failures.
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

  const parseIndexMessages = (messages: any[]): TeleFile[] => {
    const indexMsgs = messages
      .filter((m) => m.text && m.text.includes("teledrive_index"))
      .sort((a: any, b: any) => a.id - b.id);

    let allFiles: TeleFile[] = [];
    for (const msg of indexMsgs) {
      try {
        const data = JSON.parse(msg.text || "");
        if (data && Array.isArray(data.files)) {
          allFiles = allFiles.concat(data.files);
        }
      } catch (e) {
        console.warn(`[metadataStore] Failed to parse index msg ${msg.id}:`, e);
      }
    }
    return allFiles;
  };

  // --- Step 1: pinned messages ---
  try {
    const pinned = await client.getMessages(peer, {
      filter: new Api.InputMessagesFilterPinned(),
      limit: 100,
    });
    const files = parseIndexMessages(pinned);
    if (files.length > 0 || pinned.some((m: any) => m.text?.includes("teledrive_index"))) {
      return files;
    }
  } catch (pinnedErr) {
    console.warn("[metadataStore] Failed to load pinned messages, falling back to scan:", pinnedErr);
  }

  // --- Step 2: full scan of recent messages ---
  try {
    const recent = await client.getMessages(peer, { limit: 200 });
    return parseIndexMessages(recent);
  } catch (scanErr) {
    console.error("[metadataStore] Failed to scan channel messages:", scanErr);
    return [];
  }
}

// ---------------------------------------------------------------------------
// saveIndex — with EDIT_MESSAGE_TEMP_RESTRICTED fallback
// ---------------------------------------------------------------------------

/**
 * Saves the virtual file metadata index to the Telegram channel.
 *
 * Handles:
 * - EDIT_MESSAGE_TEMP_RESTRICTED: unpin + delete old msg → send fresh one + pin
 * - MESSAGE_NOT_MODIFIED: skip (identical content)
 * - Pin failures: non-fatal, loadIndex will fall back to full scan
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

  // 1. Fetch current pinned index messages
  let currentIndexMessages: any[] = [];
  try {
    const pinned = await client.getMessages(peer, {
      filter: new Api.InputMessagesFilterPinned(),
      limit: 100,
    });
    currentIndexMessages = pinned
      .filter((m: any) => m.text && m.text.includes("teledrive_index"))
      .sort((a: any, b: any) => a.id - b.id);
  } catch (err) {
    // If we can't load pinned messages, we'll just send new ones
    console.warn("[metadataStore] Could not load pinned index messages:", err);
  }

  // 2. Chunk files into ≤15 per chunk to stay well under 4096-char message limit
  const CHUNK_SIZE = 15;
  const chunks: TeleFile[][] = [];
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    chunks.push(files.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push([]);

  // 3. Write / edit / fallback-resend each chunk
  for (let i = 0; i < chunks.length; i++) {
    const payload = {
      teledrive_index: true,
      version: 1,
      chunkIndex: i,
      totalChunks: chunks.length,
      files: chunks[i],
    };
    const text = JSON.stringify(payload);

    if (i < currentIndexMessages.length) {
      const msg = currentIndexMessages[i];

      try {
        await client.editMessage(peer, { message: msg.id, text });
      } catch (editErr: any) {
        const errMsg: string = editErr?.message || "";

        if (errMsg.includes("MESSAGE_NOT_MODIFIED")) {
          // Identical content — nothing to do
          continue;
        }

        if (errMsg.includes("EDIT_MESSAGE_TEMP_RESTRICTED")) {
          // Telegram restricts editing in newly-created channels.
          // Fallback: remove old msg, send a fresh one, try to pin it.
          console.warn(
            `[metadataStore] EDIT_MESSAGE_TEMP_RESTRICTED for msg ${msg.id}. Falling back to delete+resend.`
          );
          try {
            await client.invoke(
              new Api.messages.UpdatePinnedMessage({
                peer,
                id: msg.id,
                unpin: true,
                silent: true,
              })
            );
          } catch (_) { /* ignore */ }

          try {
            await client.deleteMessages(peer, [msg.id], { revoke: true });
          } catch (_) { /* ignore */ }

          await sendAndPin(channelId, peer, text);
        } else {
          throw editErr; // Re-throw unexpected errors
        }
      }
    } else {
      // Send a new index message and try to pin it
      await sendAndPin(channelId, peer, text);
    }
  }

  // 4. Clean up extra old index messages (if file count dropped below previous chunk count)
  if (currentIndexMessages.length > chunks.length) {
    const extras = currentIndexMessages.slice(chunks.length);
    for (const msg of extras) {
      try {
        await client.invoke(
          new Api.messages.UpdatePinnedMessage({
            peer,
            id: msg.id,
            unpin: true,
            silent: true,
          })
        );
        await client.deleteMessages(peer, [msg.id], { revoke: true });
      } catch (e) {
        console.warn(`[metadataStore] Failed to clean up extra index msg ${msg.id}:`, e);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public CRUD helpers
// ---------------------------------------------------------------------------

/** Adds a file virtual entry to the index. */
export async function addFile(channelId: string, file: TeleFile): Promise<TeleFile[]> {
  const files = await loadIndex(channelId);
  const updatedFiles = [...files.filter((f) => f.id !== file.id), file];
  await saveIndex(channelId, updatedFiles);
  return updatedFiles;
}

/** Removes a file virtual entry from the index by ID. */
export async function removeFile(channelId: string, fileId: string): Promise<TeleFile[]> {
  const files = await loadIndex(channelId);
  const updatedFiles = files.filter((f) => f.id !== fileId);
  await saveIndex(channelId, updatedFiles);
  return updatedFiles;
}

/** Updates a file virtual entry in the index. */
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
