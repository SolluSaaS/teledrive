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
  try {
    const { syncOfflineStatusWithDisk } = await import("../storage/offlineStorage");
    files = await syncOfflineStatusWithDisk(files);
  } catch (err) {
    console.warn("[bootstrap] Failed to sync offline status with disk:", err);
  }

  // Debug dump to inspect files array
  try {
    const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
    const dataDir = await appLocalDataDir();
    const debugPath = await join(dataDir, "files_debug.json");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(debugPath, new TextEncoder().encode(JSON.stringify(files, null, 2)));
  } catch (dumpErr) {
    console.warn("[bootstrap] Failed to write files_debug.json:", dumpErr);
  }

  // Initialize the local view immediately so the user can enter their drive instantly.
  onStatusChange?.("Initializing local storage view...");
  useFileStore.getState().setFiles(files);

  // Run the orphan recovery scan asynchronously in the background.
  (async () => {
    try {
      await invoke("log_vault_state", {
        state: `BACKGROUND_BOOTSTRAP: Starting background orphan scan for channelId=${channelId}`
      }).catch(() => {});

      // Scan up to 1000 messages with 10s timeout in the background
      const recentMessages = await withTimeout(
        client.getMessages(channelId, { limit: 1000 }),
        10000,
        "client.getMessages(orphan scan)"
      );

      // Read current files from store inside the task execution block to avoid race conditions.
      const currentFiles = useFileStore.getState().files;
      const indexedMsgIds = new Set(currentFiles.map((f) => Number(f.messageId)));
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
        // Read latest store state in case files were updated/uploaded by user since start
        const latestFiles = useFileStore.getState().files;
        const existingMsgIds = new Set(latestFiles.map((f) => Number(f.messageId)));
        const newOrphans = orphans.filter((o) => !existingMsgIds.has(Number(o.messageId)));

        if (newOrphans.length > 0) {
          console.log(`[bootstrap] Background orphan scan: Recovering ${newOrphans.length} orphaned file(s)…`);
          const mergedFiles = [...latestFiles, ...newOrphans];
          useFileStore.getState().setFiles(mergedFiles);
          
          // Persist the recovered entries (saveIndex will clean up duplicates first)
          await saveIndex(channelId, mergedFiles);
        }
      }
    } catch (scanErr: any) {
      await invoke("log_vault_state", {
        state: `BACKGROUND_BOOTSTRAP_SCAN_ERR: ${scanErr?.message || JSON.stringify(scanErr)}`
      }).catch(() => {});
      console.warn("[bootstrap] Background orphan scan failed:", scanErr);
    }
  })();

  return channelId;
}

