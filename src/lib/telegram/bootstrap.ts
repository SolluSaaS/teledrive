import { ensureStorageChannel } from "./channelManager";
import { loadIndex } from "../storage/metadataStore";
import { useFileStore } from "../../stores/fileStore";

/**
 * Bootstraps TeleDrive storage channel and loads the metadata.
 * Reports status changes to the caller.
 */
export async function bootstrapTeleDrive(
  onStatusChange?: (status: string) => void
): Promise<string> {
  onStatusChange?.("Connecting to Telegram...");
  // GramJS client is assumed to be connected at this point.
  
  onStatusChange?.("Verifying secure storage channel...");
  const channelId = await ensureStorageChannel();
  
  onStatusChange?.("Loading file metadata index...");
  const files = await loadIndex(channelId);
  
  onStatusChange?.("Initializing local storage view...");
  useFileStore.getState().setFiles(files);
  
  return channelId;
}
