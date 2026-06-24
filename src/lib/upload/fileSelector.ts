import { addFilesToUploadQueue } from "./uploadManager";

/**
 * Triggers the standard HTML browser file picker and enqueues selected files for upload.
 * This completely bypasses Tauri's fs permissions and scope constraints.
 */
export async function triggerFilePicker(): Promise<void> {
  return new Promise<void>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;

    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        addFilesToUploadQueue(Array.from(files));
      }
      resolve();
    };

    input.oncancel = () => {
      resolve();
    };

    input.click();
  });
}

/**
 * Triggers the standard HTML browser directory picker and enqueues selected files for upload.
 * This selects folders and enqueues all files inside recursively.
 */
export async function triggerFolderPicker(): Promise<void> {
  return new Promise<void>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    
    // Set folder select attributes for WebKit/Blink browsers
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");

    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        addFilesToUploadQueue(Array.from(files));
      }
      resolve();
    };

    input.oncancel = () => {
      resolve();
    };

    input.click();
  });
}
