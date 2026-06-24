import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
import { stat } from "@tauri-apps/plugin-fs";
import { addFilesToUploadQueue } from "./uploadManager";

/**
 * Maps common file extensions to standard MIME types.
 */
function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const mimes: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    zip: "application/zip",
    rar: "application/vnd.rar",
    tar: "application/x-tar",
    gz: "application/gzip",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    ts: "application/typescript",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  
  return ext && mimes[ext] ? mimes[ext] : "application/octet-stream";
}

/**
 * Triggers the native Tauri file picker and enqueues chosen files for upload.
 */
export async function triggerFilePicker(): Promise<void> {
  try {
    const selected = await tauriOpenDialog({
      multiple: true,
      directory: false,
    });

    if (!selected) return;

    // Convert result to array of paths
    const filePaths = Array.isArray(selected) ? selected : [selected];
    const filesToEnqueue = [];

    for (const path of filePaths) {
      try {
        const fileMetadata = await stat(path);
        const name = path.split(/[/\\]/).pop() || "unknown_file";
        const size = fileMetadata.size;
        const type = getMimeType(name);

        filesToEnqueue.push({
          name,
          size,
          path,
          type,
        });
      } catch (err) {
        console.error(`Failed to get metadata for selected file: ${path}`, err);
      }
    }

    if (filesToEnqueue.length > 0) {
      addFilesToUploadQueue(filesToEnqueue);
    }
  } catch (error) {
    console.error("Error choosing files in dialog:", error);
  }
}
