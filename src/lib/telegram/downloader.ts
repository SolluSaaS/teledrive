import { getClient } from "./client";
import { save as tauriSaveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";

/**
 * Safely converts any value (number, bigint, or bigInt.BigInteger object) to a standard JS number.
 */
function toNumber(val: any): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "object" && typeof val.toJSNumber === "function") {
    return val.toJSNumber();
  }
  const n = Number(val);
  return isFinite(n) ? n : 0;
}

/**
 * Safely resolves a channel ID string to a peer entity for GramJS client queries.
 */
async function resolvePeer(channelId: string): Promise<any> {
  const client = getClient();
  try {
    return await client.getInputEntity(channelId);
  } catch (err) {
    console.warn(`[downloader] getInputEntity failed for ${channelId}, trying getEntity:`, err);
    return await client.getEntity(channelId);
  }
}

/**
 * Downloads a file from the Telegram channel and saves it to disk using Tauri file dialog.
 */
export async function downloadFileFromTelegram(
  channelId: string,
  messageId: number,
  fileName: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const client = getClient();
  
  try {
    if (!client.connected) {
      console.log("[downloader] Client disconnected, reconnecting...");
      await client.connect();
    }
    
    const peer = await resolvePeer(channelId);
    const messages = await client.getMessages(peer, {
      ids: [messageId],
    });
    
    const message = messages[0];
    if (!message || !message.media) {
      throw new Error("Target file message or media not found on Telegram.");
    }
    
    // Open Tauri save dialog to let user choose target path
    const safeFileName = fileName.replace(/[/\\?%*:|"<>]/g, "_").trim() || "download";
    const targetPath = await tauriSaveDialog({
      defaultPath: safeFileName,
    });
    
    if (!targetPath) {
      toast.info("Download cancelled.");
      return;
    }
    
    const toastId = `download-${messageId}-${Date.now()}`;
    toast.loading(`Downloading "${fileName}"... 0%`, { id: toastId });
    
    // Download the media buffer from Telegram
    let lastReportedPct = -1;
    const buffer = (await client.downloadMedia(message.media, {
      progressCallback: (downloadedBytes: any, totalBytes: any) => {
        const downloaded = toNumber(downloadedBytes);
        const total = toNumber(totalBytes);
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          if (pct !== lastReportedPct && (pct % 5 === 0 || pct === 100)) {
            lastReportedPct = pct;
            toast.loading(`Downloading "${fileName}"... ${pct}%`, { id: toastId });
          }
          onProgress?.(pct);
        }
      },
    })) as any;
    
    if (!buffer) {
      throw new Error("Failed to download media buffer from Telegram.");
    }
    
    // Save the file to disk
    await writeFile(targetPath, buffer);
    toast.success(`"${fileName}" downloaded successfully!`, { id: toastId });
  } catch (error: any) {
    console.error("Failed to download file:", error);
    toast.error(error.message || "Failed to download file.");
    throw error;
  }
}

/**
 * Downloads a file's media from Telegram into a memory buffer (Uint8Array).
 * Primarily used for in-app file previews.
 */
export async function downloadFileToBuffer(
  channelId: string,
  messageId: number,
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const client = getClient();
  
  try {
    if (!client.connected) {
      console.log("[downloader] Client disconnected, reconnecting...");
      await client.connect();
    }
    
    const peer = await resolvePeer(channelId);
    const messages = await client.getMessages(peer, {
      ids: [messageId],
    });
    
    const message = messages[0];
    if (!message || !message.media) {
      throw new Error("Target file message or media not found on Telegram.");
    }
    
    const buffer = (await client.downloadMedia(message.media, {
      progressCallback: (downloadedBytes: any, totalBytes: any) => {
        const downloaded = toNumber(downloadedBytes);
        const total = toNumber(totalBytes);
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          onProgress?.(pct);
        }
      },
    })) as any;
    
    if (!buffer) {
      throw new Error("Failed to download media.");
    }
    
    return buffer;
  } catch (error: any) {
    console.error("Failed to download file to buffer:", error);
    throw error;
  }
}
