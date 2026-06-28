import { getClient } from "./client";
import { ensureStorageChannel } from "./channelManager";
import {
  loadIndex,
  saveIndex,
  withTimeout,
  reconstructMissingFolders,
  collapseDuplicateFolders,
  dedupeByMessageId,
} from "../storage/metadataStore";
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
 *
 * Ordering matters here. The orphan scan MUST complete before we flip
 * `bootstrapComplete=true`. Otherwise, a user action (upload, drag, etc.)
 * could race the recovery and write an incomplete state to Telegram,
 * silently overwriting the previous full index with the partial set —
 * causing data loss on the next cold start. The scan is awaited here
 * (with a 12s cap so the splash doesn't linger forever on flaky networks).
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

  // Initialize the local view immediately so the splash can clear, but keep
  // bootstrapComplete=false until the orphan scan below completes.
  useFileStore.getState().setFiles(files);

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

  // ── Orphan recovery (SYNCHRONOUS — must finish before bootstrap completes) ──
  // The previous "background" version was the root cause of a data-loss bug:
  // the user could upload/move a file BEFORE recovery finished, the queue
  // would write the partial state (new file only) to Telegram, and the next
  // cold start would lose every file the orphan scan hadn't recovered yet.
  // We now await the scan (12s cap) and write recovered files BEFORE we
  // mark bootstrap complete. User actions that arrive during the scan are
  // rejected with a retryable toast by the useFileActions bootstrap gate.
  onStatusChange?.("Verifying your files (recovery scan)...");
  await invoke("log_vault_state", {
    state: `BOOTSTRAP: Starting orphan scan for channelId=${channelId}`,
  }).catch(() => {});

  try {
    const recentMessages = await withTimeout(
      client.getMessages(channelId, { limit: 1000 }),
      12000,
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
      const mimeType: string = doc.mimeType || "application/octet-stream";
      const size: number = Number(doc.size) || 0;

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
        console.log(`[bootstrap] Orphan scan: Recovering ${newOrphans.length} orphaned file(s)…`);
        const mergedFiles = [...latestFiles, ...newOrphans];
        const { healedFiles } = reconstructMissingFolders(mergedFiles, channelId);

        // One-shot recovery: drop duplicate file/folder entries from the
        // pre-fix bug before persisting. After this single cold start,
        // future cold starts will load a clean index and the duplicate
        // creation loop is broken for good.
        const beforeCount = healedFiles.length;
        const cleaned = collapseDuplicateFolders(dedupeByMessageId(healedFiles));
        const removedCount = beforeCount - cleaned.length;
        if (removedCount > 0) {
          await invoke("log_vault_state", {
            state: `BOOTSTRAP_DEDUP_REMOVED count=${removedCount} before=${beforeCount} after=${cleaned.length}`,
          }).catch(() => {});
          console.log(`[bootstrap] One-shot dedup removed ${removedCount} duplicate entries`);
        }

        useFileStore.getState().setFiles(cleaned);

        // Persist the recovered entries to Telegram BEFORE marking bootstrap
        // complete — otherwise the queue could still write a partial state
        // (e.g. an upload that started during the scan) and we'd lose the
        // recovery on the next save.
        await invoke("log_vault_state", {
          state: `BOOTSTRAP_ORPHAN_RECOVER count=${newOrphans.length} total=${cleaned.length}`,
        }).catch(() => {});
        await saveIndex(channelId, cleaned);
      }
    }

    await invoke("log_vault_state", {
      state: `BOOTSTRAP_ORPHAN_SCAN_DONE files=${useFileStore.getState().files.length}`,
    }).catch(() => {});

    // Record the highest Telegram message id observed during the scan so the
    // multi-device sync poller has a cursor to start from on its first tick.
    // The scan pulled up to 1000 recent messages — the max id among them is
    // a safe starting point for the next `client.getMessages({ minId })`.
    // We compute this only after the scan completes (not after the initial
    // loadIndex), because the orphan scan pulls the freshest slice and any
    // newer messages sent during bootstrap would be missed otherwise.
    try {
      const observedIds = (recentMessages || [])
        .map((m: any) => Number(m?.id))
        .filter((id: number) => Number.isFinite(id) && id > 0);
      if (observedIds.length > 0) {
        const maxId = observedIds.reduce((a: number, b: number) => Math.max(a, b), 0);
        useFileStore.getState().setLastIndexMsgId(maxId);
        await invoke("log_vault_state", {
          state: `BOOTSTRAP_LAST_INDEX_MSG_ID set=${maxId}`,
        }).catch(() => {});
      }
    } catch (cursorErr) {
      // Non-fatal — sync will just start from 0 (cold reload equivalent).
      console.warn("[bootstrap] Failed to record lastIndexMsgId:", cursorErr);
    }
  } catch (scanErr: any) {
    await invoke("log_vault_state", {
      state: `BOOTSTRAP_ORPHAN_SCAN_ERR: ${scanErr?.message || JSON.stringify(scanErr)}`,
    }).catch(() => {});
    console.warn("[bootstrap] Orphan scan failed (continuing):", scanErr);
    // Don't block the user indefinitely on a flaky network — proceed to
    // bootstrap-complete so they can at least see whatever loadIndex found.
  }

  // Initial load + recovery done — user actions can now persist to Telegram.
  onStatusChange?.("Initializing local storage view...");
  useFileStore.getState().setBootstrapComplete(true);

  return channelId;
}

