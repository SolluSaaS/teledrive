import { getSecret, VAULT_KEY_CHANNEL_ID } from "../secure/vault";
import { uploadFileToTelegram } from "../telegram/uploader";
import { addFile } from "../storage/metadataStore";
import { useFileStore } from "../../stores/fileStore";
import { TeleFile, UploadItem } from "../types";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

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
    });

    // Concurrency limit is 3. If full or nothing is pending, exit.
    if (uploadingItems.length >= 3 || pendingItems.length === 0) {
      isProcessing = false;
      return;
    }

    await invoke("log_vault_state", { state: "PROCESS_QUEUE: Fetching channelId from vault..." });
    let channelId: string | null = null;
    try {
      channelId = await getSecret(VAULT_KEY_CHANNEL_ID);
      await invoke("log_vault_state", { state: `PROCESS_QUEUE: Fetched channelId = ${channelId}` });
    } catch (err: any) {
      await invoke("log_vault_state", {
        state: `PROCESS_QUEUE_VAULT_ERR: ${err?.message || JSON.stringify(err)}`
      });
      isProcessing = false;
      return;
    }

    if (!channelId) {
      toast.error("Telegram storage channel is not configured. Please check settings.");
      await invoke("log_vault_state", { state: "PROCESS_QUEUE: channelId is empty/null" });
      isProcessing = false;
      return;
    }

    // Determine how many parallel uploads we can start
    const openSlots = 3 - uploadingItems.length;
    const itemsToStart = pendingItems.slice(0, openSlots);

    await invoke("log_vault_state", {
      state: `PROCESS_QUEUE: Starting ${itemsToStart.length} uploads`
    });

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
            fileSource = new File([item.file.data], item.name, { type: item.file.type });
          } else {
            throw new Error("No valid file reference or path found.");
          }

          const currentFolder = useFileStore.getState().currentFolder;

          // Call chunked uploader
          const message = await uploadFileToTelegram(
            channelId,
            item.name,
            item.size,
            fileSource,
            (uploaded, total) => {
              const pct = Math.round((uploaded / total) * 100);
              updateQueueItem(item.id, { progress: pct });
            }
          );

          // Success: create a virtual metadata file entry
          const newFile: TeleFile = {
            id: item.id,
            name: item.name,
            size: item.size,
            mime: item.file instanceof File ? item.file.type : (item.file?.type || "application/octet-stream"),
            folderPath: currentFolder,
            messageId: message.id,
            channelId,
            uploadedAt: Date.now(),
            starred: false,
            trashed: false,
          };

          // Save virtual file metadata to Telegram pinned index and update store
          const updatedFiles = await addFile(channelId, newFile);
          setFiles(updatedFiles);

          updateQueueItem(item.id, { status: "done", progress: 100 });
          toast.success(`"${item.name}" uploaded successfully!`);
        } catch (err: any) {
          console.error(`Upload error for ${item.name}:`, err);
          await invoke("log_vault_state", {
            state: `UPLOAD_ERR: ${item.name} size=${item.size} err=${err?.message || JSON.stringify(err)}\nStack: ${err?.stack || "no_stack"}`
          }).catch(() => {});
          updateQueueItem(item.id, {
            status: "error",
            error: err.message || "Upload failed",
          });
          toast.error(`Failed to upload "${item.name}"`);
        } finally {
          // Re-trigger processQueue to pull the next pending items
          processQueue();
        }
      })();
    }
  } catch (error) {
    console.error("Failed inside processQueue:", error);
    isProcessing = false;
  }
}

/**
 * Enqueues a list of files and starts the upload processing queue.
 */
export function addFilesToUploadQueue(
  files: (File | { name: string; size: number; path: string; type: string })[]
) {
  const { addToQueue } = useFileStore.getState();

  files.forEach((file) => {
    const uploadItem: UploadItem = {
      id: Math.random().toString(36).substring(2, 11),
      name: file.name,
      size: file.size,
      progress: 0,
      status: "pending",
      file: file,
    };
    addToQueue(uploadItem);
  });

  // Trigger processor shortly after
  setTimeout(() => processQueue(), 50);
}
