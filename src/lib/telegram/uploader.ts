import { Api } from "telegram";
import { getClient } from "./client";
import { open as tauriOpen, SeekMode } from "@tauri-apps/plugin-fs";
import bigInt from "big-integer";

const CHUNK_SIZE = 512 * 1024; // 512KB recommended chunk size for Telegram

interface UploadProgressCallback {
  (uploadedBytes: number, totalBytes: number): void;
}

/**
 * Uploads a file (either from local native path or browser File object) to Telegram storage channel.
 * Returns the message object representing the uploaded file document.
 */
export async function uploadFileToTelegram(
  channelId: string,
  fileName: string,
  fileSize: number,
  filePathOrFile: string | File,
  onProgress?: UploadProgressCallback
): Promise<any> {
  const client = getClient();
  
  // Setup file ID using bigInt which is required by GramJS API
  const fileId = bigInt(Math.floor(Math.random() * 1e15));
  
  const isBig = fileSize > 10 * 1024 * 1024; // > 10MB is considered big in MTProto
  const totalParts = Math.ceil(fileSize / CHUNK_SIZE);
  
  let tauriFileHandle: any = null;
  
  try {
    if (typeof filePathOrFile === "string") {
      // Initialize Tauri file handle for streaming
      tauriFileHandle = await tauriOpen(filePathOrFile, { read: true });
    }
    
    // Upload chunks sequentially
    for (let partIndex = 0; partIndex < totalParts; partIndex++) {
      const start = partIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const currentChunkSize = end - start;
      
      let chunkBytes: Uint8Array;
      
      if (tauriFileHandle) {
        // Read chunk using Tauri native file handle
        await tauriFileHandle.seek(start, SeekMode.Start);
        const buffer = new Uint8Array(currentChunkSize);
        await tauriFileHandle.read(buffer);
        chunkBytes = buffer;
      } else {
        // Read chunk from HTML File object
        const blobSlice = (filePathOrFile as File).slice(start, end);
        const arrayBuffer = await blobSlice.arrayBuffer();
        chunkBytes = new Uint8Array(arrayBuffer);
      }
      
      // Upload part with retry mechanism
      let success = false;
      let retries = 0;
      
      while (!success && retries < 5) {
        try {
          if (isBig) {
            await client.invoke(
              new Api.upload.SaveBigFilePart({
                fileId,
                filePart: partIndex,
                fileTotalParts: totalParts,
                bytes: Buffer.from(chunkBytes),
              })
            );
          } else {
            await client.invoke(
              new Api.upload.SaveFilePart({
                fileId,
                filePart: partIndex,
                bytes: Buffer.from(chunkBytes),
              })
            );
          }
          success = true;
        } catch (err: any) {
          retries++;
          if (err.message && err.message.includes("FLOOD_WAIT")) {
            const waitSecs = parseInt(err.message.match(/\d+/)?.[0] || "5", 10);
            console.warn(`Flood wait encountered. Waiting ${waitSecs} seconds...`);
            await new Promise((r) => setTimeout(r, waitSecs * 1000));
          } else {
            console.error(`Error uploading part ${partIndex} (attempt ${retries}):`, err);
            if (retries >= 5) throw err;
            await new Promise((r) => setTimeout(r, 1000 * retries)); // Exponential backoff
          }
        }
      }
      
      // Update progress
      onProgress?.(end, fileSize);
    }
    
    // Finalize upload inside Telegram
    let inputFile: Api.TypeInputFile;
    if (isBig) {
      inputFile = new Api.InputFileBig({
        id: fileId,
        parts: totalParts,
        name: fileName,
      });
    } else {
      inputFile = new Api.InputFile({
        id: fileId,
        parts: totalParts,
        name: fileName,
        md5Checksum: "",
      });
    }
    
    // Send document to storage channel
    const result = await client.sendFile(channelId, {
      file: inputFile,
      forceDocument: true,
      caption: fileName,
    });
    
    return result;
  } finally {
    if (tauriFileHandle) {
      try {
        await tauriFileHandle.close();
      } catch (e) {
        console.warn("Failed to close Tauri file handle:", e);
      }
    }
  }
}
