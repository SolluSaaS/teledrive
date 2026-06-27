import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../secure/vault";

// ---------------------------------------------------------------------------
// MIME type inference from file extension
// Used when the OS/browser does not provide a MIME type (e.g. Tauri native pick)
// ---------------------------------------------------------------------------
const EXTENSION_MIME_MAP: Record<string, string> = {
  // Images
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", tiff: "image/tiff",
  tif: "image/tiff", heic: "image/heic", heif: "image/heif", ico: "image/x-icon",
  psd: "image/vnd.adobe.photoshop", ai: "application/postscript",

  // Videos
  mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo",
  mov: "video/quicktime", wmv: "video/x-ms-wmv", flv: "video/x-flv",
  webm: "video/webm", m4v: "video/x-m4v", "3gp": "video/3gpp",
  mpeg: "video/mpeg", mpg: "video/mpeg",

  // Audio
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  flac: "audio/flac", aac: "audio/aac", wma: "audio/x-ms-wma", opus: "audio/opus",
  amr: "audio/amr",

  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  key: "application/vnd.apple.keynote",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  rtf: "application/rtf",

  // Code / Text
  html: "text/html", htm: "text/html", css: "text/css",
  js: "text/javascript", ts: "text/typescript", jsx: "text/javascript",
  tsx: "text/typescript", json: "application/json", xml: "application/xml",
  yaml: "text/yaml", yml: "text/yaml",
  py: "text/x-python", go: "text/x-go", rs: "text/x-rust",
  c: "text/x-c", cpp: "text/x-c++", h: "text/x-c", cs: "text/x-csharp",
  java: "text/x-java-source", rb: "text/x-ruby", sh: "application/x-sh",
  bat: "application/x-bat", ps1: "application/x-powershell",
  sql: "application/sql", ini: "text/plain", conf: "text/plain",

  // Archives
  zip: "application/zip", rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed", tar: "application/x-tar",
  gz: "application/gzip", bz2: "application/x-bzip2",
  xz: "application/x-xz", iso: "application/x-iso9660-image",
  dmg: "application/x-apple-diskimage",
};

function getMimeFromExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_MAP[ext] ?? "application/octet-stream";
}
import { uploadFileToTelegram } from "../telegram/uploader";
import { useFileStore } from "../../stores/fileStore";
import { useAuthStore } from "../../stores/authStore";
import { TeleFile, UploadItem } from "../types";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { saveIndexDirect } from "../storage/metadataStore";

let isProcessing = false;

/**
 * Triggers the upload queue processor.
 * Starts up to 3 concurrent uploads from 'pending' status.
 */
export async function processQueue(): Promise<void> {
  // If already executing this function, do not overlap
  if (isProcessing) return;
  isProcessing = true;

  try {
    const { uploadQueue, updateQueueItem, setFiles } = useFileStore.getState();

    const pendingItems = uploadQueue.filter((item) => item.status === "pending");
    const uploadingItems = uploadQueue.filter((item) => item.status === "uploading");

    await invoke("log_vault_state", {
      state: `PROCESS_QUEUE: pending=${pendingItems.length} uploading=${uploadingItems.length} total=${uploadQueue.length}`
    }).catch(() => {});

    // Concurrency limit is 3. If full or nothing is pending, exit.
    if (uploadingItems.length >= 3 || pendingItems.length === 0) {
      isProcessing = false;
      return;
    }

    await invoke("log_vault_state", { state: "PROCESS_QUEUE: Fetching channelId from vault..." }).catch(() => {});
    let channelId: string | null = null;
    try {
      const { phoneNumber } = useAuthStore.getState();
      if (phoneNumber) {
        channelId = await getSecret(channelIdKey(phoneNumber));
      }
      if (!channelId) {
        channelId = await getSecret(VAULT_KEY_CHANNEL_ID);
      }
      await invoke("log_vault_state", { state: `PROCESS_QUEUE: Fetched channelId = ${channelId}` }).catch(() => {});
    } catch (err: any) {
      await invoke("log_vault_state", {
        state: `PROCESS_QUEUE_VAULT_ERR: ${err?.message || JSON.stringify(err)}`
      }).catch(() => {});
      isProcessing = false;
      return;
    }

    if (!channelId) {
      toast.error("Telegram storage channel is not configured. Please check settings.");
      await invoke("log_vault_state", { state: "PROCESS_QUEUE: channelId is empty/null" }).catch(() => {});
      isProcessing = false;
      return;
    }

    // Determine how many parallel uploads we can start
    const openSlots = 3 - uploadingItems.length;
    const itemsToStart = pendingItems.slice(0, openSlots);

    await invoke("log_vault_state", {
      state: `PROCESS_QUEUE: Starting ${itemsToStart.length} uploads`
    }).catch(() => {});

    isProcessing = false; // Allow other calls to trigger if needed

    // Start each upload process asynchronously
    for (const item of itemsToStart) {
      // Immediately set status to uploading to prevent double processing
      updateQueueItem(item.id, { status: "uploading", progress: 0 });

      // Run the upload task
      (async () => {
        try {
          let fileSource: string | File;

          if (item.file instanceof File) {
            fileSource = item.file;
          } else if (item.file && "path" in item.file && item.file.path) {
            fileSource = item.file.path;
          } else if (item.file && "data" in item.file && item.file.data) {
            // Convert byte array to HTML File object
            fileSource = new File([item.file.data], item.name, { type: (item.file as any).type });
          } else {
            throw new Error("No valid file reference or path found.");
          }

          const destinationFolder = item.folderPath || "/";

          // --- Phase 1: Upload file bytes to Telegram ---
          const message = await uploadFileToTelegram(
            channelId,
            item.name,
            item.size,
            fileSource,
            destinationFolder,
            (uploaded, total) => {
              const pct = Math.round((uploaded / total) * 100);
              // Cap at 95% until indexing succeeds
              updateQueueItem(item.id, { progress: Math.min(pct, 95) });
            }
          );

          // Build the metadata entry.
          // Priority: file.type (browser/OS) → getMimeFromExtension (extension lookup) → fallback
          const rawMime =
            item.file instanceof File
              ? item.file.type
              : (item.file as any)?.type ?? "";
          const mimeType = rawMime && rawMime !== "application/octet-stream"
            ? rawMime
            : getMimeFromExtension(item.name);

          const newFile: TeleFile = {
            id: item.id,
            name: item.name,
            size: item.size,
            mime: mimeType,
            folderPath: destinationFolder,
            messageId: message.id,
            channelId,
            uploadedAt: Date.now(),
            starred: false,
            trashed: false,
          };

          // --- Phase 2: Save metadata index to Telegram (Debounced & Batched) ---
          const existingFiles = useFileStore.getState().files;
          setFiles([...existingFiles.filter((f) => f.id !== newFile.id), newFile]);
          
          updateQueueItem(item.id, { status: "done", progress: 100 });
          toast.success(`"${item.name}" uploaded successfully!`);

          pendingIndexFiles.push(newFile);
          scheduleIndexFlush(channelId);
        } catch (err: any) {
          console.error(`Upload error for ${item.name}:`, err);
          await invoke("log_vault_state", {
            state: `UPLOAD_ERR: ${item.name} size=${item.size} err=${err?.message || JSON.stringify(err)}\nStack: ${err?.stack || "no_stack"}`
          }).catch(() => {});
          updateQueueItem(item.id, {
            status: "error",
            error: err.message || "Upload failed",
          });
          toast.error(`Failed to upload "${item.name}": ${err.message || "Unknown error"}`);
        } finally {
          // Re-trigger processQueue to pull the next pending items
          processQueue();
        }
      })();
    }
  } catch (error) {
    console.error("Failed inside processQueue:", error);
    isProcessing = false;
  } finally {
    // Safety net: always release the lock even if we missed a path
    isProcessing = false;
  }
}

// ─── Debounced Batch Index Saving ───────────────────────────────────────────
let pendingIndexFiles: TeleFile[] = [];
let flushTimeoutId: any = null;

async function flushIndexQueue(channelId: string) {
  if (pendingIndexFiles.length === 0) return;

  const toSave = [...pendingIndexFiles];
  pendingIndexFiles = []; // Clear immediately so new completions don't get lost

  await invoke("log_vault_state", {
    state: `BATCH_INDEX_FLUSH: Flushing ${toSave.length} file(s) directly (no mutex)`
  }).catch(() => {});

  // Merge new files into current store state by id (last-write-wins)
  const mergeIntoStore = () => {
    const existing = useFileStore.getState().files;
    const byId = new Map<string, TeleFile>();
    for (const f of existing) byId.set(f.id, f);
    for (const f of toSave) byId.set(f.id, f);
    return Array.from(byId.values());
  };

  let success = false;
  let lastIndexErr: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Merge with the freshest store state on every retry
      const merged = mergeIntoStore();
      // Save directly — no mutex, upload-manager owns its own sequencing
      await saveIndexDirect(channelId, merged);
      useFileStore.getState().setFiles(merged);
      success = true;
      break;
    } catch (indexErr: any) {
      lastIndexErr = indexErr;
      await invoke("log_vault_state", {
        state: `BATCH_INDEX_SAVE_ATTEMPT_${attempt}_ERR: ${indexErr?.message || JSON.stringify(indexErr)}`
      }).catch(() => {});
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  if (!success) {
    await invoke("log_vault_state", {
      state: `BATCH_INDEX_SAVE_FAIL: ${toSave.map((f) => f.name).join(", ")} - err=${lastIndexErr?.message || JSON.stringify(lastIndexErr)}`
    }).catch(() => {});
    toast.warning("Failed to save file list to the cloud. Try refreshing your drive.");
  }
}

function scheduleIndexFlush(channelId: string) {
  if (flushTimeoutId) {
    clearTimeout(flushTimeoutId);
  }

  const { uploadQueue } = useFileStore.getState();
  const activeUploads = uploadQueue.filter((item) => item.status === "uploading");

  // Flush immediately (300ms) if all uploads finished, else wait 2000ms to batch concurrent uploads
  const delay = activeUploads.length === 0 ? 300 : 2000;

  flushTimeoutId = setTimeout(() => {
    flushIndexQueue(channelId);
  }, delay);
}

/**
 * Enqueues a list of files and starts the upload processing queue.
 */
export function addFilesToUploadQueue(
  files: (File | { name: string; size: number; path: string; type: string })[]
) {
  const { addToQueue, currentFolder } = useFileStore.getState();
  let addedCount = 0;

  files.forEach((file) => {
    if (file.size === 0) {
      toast.error(`"${file.name}" is empty. Empty files (0 bytes) are not supported by Telegram.`, {
        duration: 4000,
      });
      return;
    }

    const uploadItem: UploadItem = {
      id: Math.random().toString(36).substring(2, 11),
      name: file.name,
      size: file.size,
      progress: 0,
      status: "pending",
      file: file,
      folderPath: currentFolder,
    };
    addToQueue(uploadItem);
    addedCount++;
  });

  // Trigger processor shortly after if we actually added items
  if (addedCount > 0) {
    setTimeout(() => processQueue(), 50);
  }
}
