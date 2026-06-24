import { getClient } from "./client";
import { save as tauriSaveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import bigInt from "big-integer";

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
    // 1. Get the message from the channel
    const messages = await client.getMessages(channelId, {
      ids: [messageId],
    });
    
    const message = messages[0];
    if (!message || !message.media) {
      throw new Error("Target file message or media not found on Telegram.");
    }
    
    // 2. Open Tauri save dialog to let user choose target path
    const targetPath = await tauriSaveDialog({
      defaultPath: fileName,
    });
    
    if (!targetPath) {
      toast.info("Download cancelled.");
      return;
    }
    
    toast.info(`Downloading "${fileName}"...`);
    
    // 3. Download the media buffer from Telegram
    const buffer = (await client.downloadMedia(message.media, {
      progressCallback: (downloadedBytes: bigInt.BigInteger, totalBytes: bigInt.BigInteger) => {
        if (totalBytes.gt(0)) {
          const downloaded = downloadedBytes.toJSNumber();
          const total = totalBytes.toJSNumber();
          const pct = Math.round((downloaded / total) * 100);
          onProgress?.(pct);
        }
      },
    })) as any;
    
    if (!buffer) {
      throw new Error("Failed to download media buffer from Telegram.");
    }
    
    // 4. Save the file to disk
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
      progressCallback: (downloadedBytes: bigInt.BigInteger, totalBytes: bigInt.BigInteger) => {
        if (totalBytes.gt(0)) {
          const downloaded = downloadedBytes.toJSNumber();
          const total = totalBytes.toJSNumber();
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
