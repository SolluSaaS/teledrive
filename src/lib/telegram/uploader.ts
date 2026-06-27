import { Api } from "telegram";
import { getClient } from "./client";
import { open as tauriOpen, SeekMode } from "@tauri-apps/plugin-fs";
import bigInt from "big-integer";
import { Buffer } from "buffer";
import { withTimeout } from "../storage/metadataStore";
import { withTelegramRetry } from "./rateLimit";

const CHUNK_SIZE = 512 * 1024; // 512KB recommended chunk size for Telegram
const CHUNK_TIMEOUT_MS = 20_000;
const SENDFILE_TIMEOUT_MS = 30_000;

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
  folderPath: string = "/",
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
      
      // Upload part through the shared retry helper. The chunk is re-read
      // from disk on each attempt via the closure — important because the
      // seek/read may have advanced the handle position mid-failure.
      await withTelegramRetry(
        () =>
          withTimeout(
            isBig
              ? client.invoke(
                  new Api.upload.SaveBigFilePart({
                    fileId,
                    filePart: partIndex,
                    fileTotalParts: totalParts,
                    bytes: Buffer.from(chunkBytes),
                  })
                )
              : client.invoke(
                  new Api.upload.SaveFilePart({
                    fileId,
                    filePart: partIndex,
                    bytes: Buffer.from(chunkBytes),
                  })
                ),
            CHUNK_TIMEOUT_MS,
            `${isBig ? "SaveBigFilePart" : "SaveFilePart"}(${partIndex}/${totalParts})`
          ),
        `${isBig ? "SaveBigFilePart" : "SaveFilePart"}(${partIndex}/${totalParts})`,
        // Cap at 8 attempts per chunk — 8 × 60s worst case before failing.
        8
      );
      
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
    
    // Send document to storage channel with folder path JSON metadata caption.
    // Finalize also goes through the retry helper — the file is already fully
    // uploaded to Telegram at this point, so the only failure modes here are
    // transient network/rate-limit issues.
    const caption = `teledrive_file:${JSON.stringify({ folder: folderPath })}`;
    const result = await withTelegramRetry(
      () =>
        withTimeout(
          client.sendFile(channelId, {
            file: inputFile,
            forceDocument: true,
            caption,
          }),
          SENDFILE_TIMEOUT_MS,
          "client.sendFile"
        ),
      "client.sendFile",
      5
    );
    
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
