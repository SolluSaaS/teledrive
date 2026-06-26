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
    // Get the message from the channel using the string channelId directly
    const messages = await client.getMessages(channelId, {
      ids: [messageId],
    });
    
    const message = messages[0];
    if (!message || !message.media) {
      throw new Error("Target file message or media not found on Telegram.");
    }
    
    // Open Tauri save dialog to let user choose target path
    const targetPath = await tauriSaveDialog({
      defaultPath: fileName,
    });
    
    if (!targetPath) {
      toast.info("Download cancelled.");
      return;
    }
    
    toast.info(`Downloading "${fileName}"...`);
    
    // Download the media buffer from Telegram
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
      throw new Error("Failed to download media buffer from Telegram.");
    }
    
    // Save the file to disk
    await writeFile(targetPath, buffer);
    toast.success(`"${fileName}" downloaded successfully!`);
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
    const messages = await client.getMessages(channelId, {
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
