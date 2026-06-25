import { Api } from "telegram";
import { getClient } from "./client";
import { ensureStorageChannel } from "./channelManager";
import { loadIndex, saveIndex } from "../storage/metadataStore";
import { useFileStore } from "../../stores/fileStore";
import { TeleFile } from "../types";

/**
 * Bootstraps TeleDrive storage channel and loads the metadata.
 * Reports status changes to the caller.
 *
 * Also performs an orphan-recovery scan:
 * If file documents exist in the storage channel that are NOT in the
 * metadata index (e.g. because a previous index-save failed), they are
 * re-indexed in the root "/" folder so they become visible.
 */
export async function bootstrapTeleDrive(
  onStatusChange?: (status: string) => void
): Promise<string> {
  onStatusChange?.("Connecting to Telegram...");
  const client = getClient();

  onStatusChange?.("Verifying secure storage channel...");
  const channelId = await ensureStorageChannel();

  onStatusChange?.("Loading file metadata index...");
  let files = await loadIndex(channelId);

  // -----------------------------------------------------------------------
  // Orphan recovery: scan the last 200 channel messages for uploaded
  // documents that are NOT in the index and add them back.
  // -----------------------------------------------------------------------
  onStatusChange?.("Scanning for any orphaned files...");
  try {
    const peer = await client.getEntity(channelId);
    const recentMessages = await client.getMessages(peer, { limit: 200 });

    // The set of messageIDs already indexed
    const indexedMsgIds = new Set(files.map((f) => f.messageId));

    const orphans: TeleFile[] = [];

    for (const msg of recentMessages) {
      // Skip index messages and system messages
      if (!msg || !msg.id) continue;
      if (msg.text && msg.text.includes("teledrive_index")) continue;

      // Only care about document / media messages
      const media = (msg as any).media;
      if (!media) continue;

      const doc =
        media.document ||          // MessageMediaDocument
        media.photo ||             // MessageMediaPhoto (rare in a broadcast channel)
        null;

      if (!doc) continue;
      if (indexedMsgIds.has(msg.id)) continue; // Already indexed

      // Try to read the file name from the caption or document attributes
      let name = msg.text || "Untitled";
      let mimeType = "application/octet-stream";
      let size = 0;

      if (media.document) {
        size = media.document.size || 0;
        mimeType = media.document.mimeType || "application/octet-stream";
        const filenameAttr = (media.document.attributes || []).find(
          (a: any) => a.className === "DocumentAttributeFilename"
        );
        if (filenameAttr?.fileName) {
          name = filenameAttr.fileName;
        } else if (msg.text && msg.text.trim()) {
          name = msg.text.trim();
        }
      }

      orphans.push({
        id: `recovered_${msg.id}`,
        name,
        size,
        mime: mimeType,
        folderPath: "/",          // Place in root; user can organise later
        messageId: msg.id,
        channelId,
        uploadedAt: (msg.date || 0) * 1000,
        starred: false,
        trashed: false,
      });
    }

    if (orphans.length > 0) {
      console.log(`[bootstrap] Recovering ${orphans.length} orphaned file(s)…`);
      // Merge orphans with existing index (avoid duplicates by messageId)
      const existingMsgIds = new Set(files.map((f) => f.messageId));
      const newOrphans = orphans.filter((o) => !existingMsgIds.has(o.messageId));
      if (newOrphans.length > 0) {
        files = [...files, ...newOrphans];
        // Persist the recovered entries
        await saveIndex(channelId, files);
      }
    }
  } catch (scanErr) {
    // Non-fatal — if scan fails, still show whatever was in the index
    console.warn("[bootstrap] Orphan scan failed (non-fatal):", scanErr);
  }

  onStatusChange?.("Initializing local storage view...");
  useFileStore.getState().setFiles(files);

  return channelId;
}
