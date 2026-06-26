import { getClient } from "./client";
import { ensureStorageChannel } from "./channelManager";
import { loadIndex, saveIndex, withTimeout } from "../storage/metadataStore";
import { useFileStore } from "../../stores/fileStore";
import { TeleFile } from "../types";
import { invoke } from "@tauri-apps/api/core";

/**
 * Bootstraps TeleDrive storage channel and loads the metadata.
 * Reports status changes to the caller.
 *
 * Orphan recovery: scans the last 1000 channel messages for uploaded documents
 * that are NOT in the metadata index (e.g. because a previous index-save failed)
 * and re-indexes them under their correct folders so they become visible.
 */
export async function bootstrapTeleDrive(
  onStatusChange?: (status: string) => void,
  phone: string = ""
): Promise<string> {
  onStatusChange?.("Connecting to Telegram...");
  const client = getClient();

  onStatusChange?.("Verifying secure storage channel...");
  const channelId = await ensureStorageChannel(phone);

  onStatusChange?.("Loading file metadata index...");
  let files = await loadIndex(channelId);

  // -----------------------------------------------------------------------
  // Orphan recovery: find document messages not in the current index.
  // Uses Number() coercion to handle both plain-number and BigInt msg.id.
  // -----------------------------------------------------------------------
  onStatusChange?.("Scanning for orphaned files...");
  try {
    await invoke("log_vault_state", { state: `BOOTSTRAP: Starting orphan scan for channelId=${channelId}` }).catch(() => {});
    await invoke("log_vault_state", { state: `BOOTSTRAP: Resolving recent messages...` }).catch(() => {});
    
    // Pass channelId directly and scan up to 1000 messages with 10s timeout
    const recentMessages = await withTimeout(
      client.getMessages(channelId, { limit: 1000 }),
      10000,
      "client.getMessages(orphan scan)"
    );
    await invoke("log_vault_state", { state: `BOOTSTRAP: Fetched recent messages count=${recentMessages.length}` }).catch(() => {});

    // Build a Set of already-indexed message IDs (normalised to number)
    const indexedMsgIds = new Set(files.map((f) => Number(f.messageId)));
    await invoke("log_vault_state", { state: `BOOTSTRAP: Indexed message IDs: ${Array.from(indexedMsgIds).join(", ")}` }).catch(() => {});

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
      let mimeType: string = doc.mimeType || "application/octet-stream";
      let size: number = Number(doc.size) || 0;

      // Resolve name from document attribute first, then message caption
      let name = "Untitled";
      const filenameAttr = (doc.attributes || []).find(
        (a: any) => a.className === "DocumentAttributeFilename"
      );
      if (filenameAttr?.fileName) {
        name = filenameAttr.fileName;
      } else if (msg.message && !msg.message.startsWith("teledrive_file:")) {
        name = msg.message.trim();
      } else if (msg.text && !msg.text.startsWith("teledrive_file:")) {
        name = msg.text.trim();
      }

      // Parse folder path from JSON metadata caption if present
      let folderPath = "/";
      const captionText = msg.message || msg.text || "";
      if (captionText.startsWith("teledrive_file:")) {
        try {
          const jsonStr = captionText.substring("teledrive_file:".length);
          const meta = JSON.parse(jsonStr);
          if (meta && typeof meta.folder === "string") {
            folderPath = meta.folder;
          }
        } catch (_) { /* ignore */ }
      }

      await invoke("log_vault_state", { state: `BOOTSTRAP: Found orphan file: name=${name} folder=${folderPath} size=${size} msgId=${msgId}` }).catch(() => {});

      orphans.push({
        id: `recovered_${msgId}`,
        name,
        size,
        mime: mimeType,
        folderPath,
        messageId: msgId,
        channelId,
        uploadedAt: (msg.date || 0) * 1000,
        starred: false,
        trashed: false,
        archived: false,
      });
    }

    if (orphans.length > 0) {
      // Deduplicate orphans against existing files by messageId
      const existingMsgIds = new Set(files.map((f) => Number(f.messageId)));
      const newOrphans = orphans.filter((o) => !existingMsgIds.has(Number(o.messageId)));

      await invoke("log_vault_state", { state: `BOOTSTRAP: Total new orphans to recover: ${newOrphans.length}` }).catch(() => {});

      if (newOrphans.length > 0) {
        console.log(`[bootstrap] Recovering ${newOrphans.length} orphaned file(s)…`);
        files = [...files, ...newOrphans];
        // Persist the recovered entries (saveIndex will clean up duplicates first)
        await saveIndex(channelId, files);
      }
    }
  } catch (scanErr: any) {
    // Non-fatal — if scan fails, still show whatever was in the index
    await invoke("log_vault_state", { state: `BOOTSTRAP_SCAN_ERR: ${scanErr?.message || JSON.stringify(scanErr)}` }).catch(() => {});
    console.warn("[bootstrap] Orphan scan failed (non-fatal):", scanErr);
  }



  onStatusChange?.("Initializing local storage view...");
  useFileStore.getState().setFiles(files);

  return channelId;
}

