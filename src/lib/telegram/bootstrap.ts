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
 * Orphan recovery: scans the last 200 channel messages for uploaded documents
 * that are NOT in the metadata index (e.g. because a previous index-save failed)
 * and re-indexes them under "/" so they become visible.
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
  // Orphan recovery: find document messages not in the current index.
  // Uses Number() coercion to handle both plain-number and BigInt msg.id.
  // -----------------------------------------------------------------------
  onStatusChange?.("Scanning for orphaned files...");
  try {
    const peer = await client.getEntity(channelId);
    const recentMessages = await client.getMessages(peer, { limit: 200 });

    // Build a Set of already-indexed message IDs (normalised to number)
    const indexedMsgIds = new Set(files.map((f) => Number(f.messageId)));

    const orphans: TeleFile[] = [];

    for (const msg of recentMessages) {
      if (!msg?.id) continue;
      // Skip text-only index messages
      if (msg.text?.includes("teledrive_index")) continue;

      const msgId = Number(msg.id);

      // Skip if already in the index
      if (indexedMsgIds.has(msgId)) continue;

      // Only care about document media (uploaded files)
      const media = (msg as any).media;
      if (!media?.document) continue;

      const doc = media.document;
      let name = msg.text?.trim() || "Untitled";
      let mimeType: string = doc.mimeType || "application/octet-stream";
      let size: number = Number(doc.size) || 0;

      const filenameAttr = (doc.attributes || []).find(
        (a: any) => a.className === "DocumentAttributeFilename"
      );
      if (filenameAttr?.fileName) name = filenameAttr.fileName;

      orphans.push({
        id: `recovered_${msgId}`,
        name,
        size,
        mime: mimeType,
        folderPath: "/",
        messageId: msgId,
        channelId,
        uploadedAt: (msg.date || 0) * 1000,
        starred: false,
        trashed: false,
      });
    }

    if (orphans.length > 0) {
      // Deduplicate orphans against existing files by messageId
      const existingMsgIds = new Set(files.map((f) => Number(f.messageId)));
      const newOrphans = orphans.filter((o) => !existingMsgIds.has(Number(o.messageId)));

      if (newOrphans.length > 0) {
        console.log(`[bootstrap] Recovering ${newOrphans.length} orphaned file(s)…`);
        files = [...files, ...newOrphans];
        // Persist the recovered entries (saveIndex will clean up duplicates first)
        await saveIndex(channelId, files);
      }
    }
  } catch (scanErr) {
    // Non-fatal — if scan fails, still show whatever was in the index
    console.warn("[bootstrap] Orphan scan failed (non-fatal):", scanErr);
  }

  // Always re-save the index on boot to:
  // 1. Clean up any duplicate/stale pinned messages that accumulated from previous failures
  // 2. Ensure the current file list is authoritative in Telegram
  // saveIndex deletes ALL old index messages first, then writes exactly one clean set.
  try {
    onStatusChange?.("Cleaning up index...");
    await saveIndex(channelId, files);
  } catch (cleanupErr) {
    console.warn("[bootstrap] Could not rewrite index during cleanup:", cleanupErr);
  }

  onStatusChange?.("Initializing local storage view...");
  useFileStore.getState().setFiles(files);

  return channelId;
}

