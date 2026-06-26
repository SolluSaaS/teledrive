import { useState } from "react";
import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../lib/secure/vault";
import { addFile, removeFile, updateFile, deleteTelegramMessage } from "../lib/storage/metadataStore";
import { loadIndex, saveIndex } from "../lib/storage/metadataStore";
import { useFileStore } from "../stores/fileStore";
import { useAuthStore } from "../stores/authStore";
import { TeleFile } from "../lib/types";
import { toast } from "sonner";

export function useFileActions() {
  const [isOperating, setIsOperating] = useState(false);
  const setFiles = useFileStore((state) => state.setFiles);
  const currentFolder = useFileStore((state) => state.currentFolder);
  const phoneNumber = useAuthStore((state) => state.phoneNumber);

  const getChannelId = async () => {
    let cid: string | null = null;
    if (phoneNumber) {
      cid = await getSecret(channelIdKey(phoneNumber));
    }
    if (!cid) {
      cid = await getSecret(VAULT_KEY_CHANNEL_ID);
    }
    if (!cid) {
      toast.error("Telegram storage channel is not initialized");
      throw new Error("Channel ID missing");
    }
    return cid;
  };

  const createFolder = async (name: string) => {
    if (!name.trim()) return;
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      const newFolder: TeleFile = {
        id: Math.random().toString(36).substring(2, 11),
        name: name.trim(),
        size: 0,
        mime: "inode/directory",
        folderPath: currentFolder,
        messageId: 0,
        channelId,
        uploadedAt: Date.now(),
        starred: false,
        trashed: false,
      };

      const updated = await addFile(channelId, newFolder);
      setFiles(updated);
      toast.success(`Folder "${name}" created successfully`);
    } catch (err: any) {
      console.error("Failed to create folder:", err);
      toast.error(err.message || "Failed to create folder");
    } finally {
      setIsOperating(false);
    }
  };

  const renameFile = async (fileId: string, newName: string) => {
    if (!newName.trim()) return;
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      const updated = await updateFile(channelId, fileId, { name: newName.trim() });
      setFiles(updated);
      toast.success("Renamed successfully");
    } catch (err: any) {
      console.error("Failed to rename:", err);
      toast.error(err.message || "Failed to rename");
    } finally {
      setIsOperating(false);
    }
  };

  const toggleStar = async (file: TeleFile) => {
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      const updated = await updateFile(channelId, file.id, { starred: !file.starred });
      setFiles(updated);
      toast.success(file.starred ? "Removed from Starred" : "Added to Starred");
    } catch (err: any) {
      console.error("Failed to toggle star:", err);
      toast.error(err.message || "Failed to update star");
    } finally {
      setIsOperating(false);
    }
  };

  const moveToTrash = async (file: TeleFile) => {
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      const updated = await updateFile(channelId, file.id, { trashed: true });
      setFiles(updated);
      toast.success(`Moved "${file.name}" to Trash`);
    } catch (err: any) {
      console.error("Failed to move to trash:", err);
      toast.error(err.message || "Failed to move to trash");
    } finally {
      setIsOperating(false);
    }
  };

  const restoreFromTrash = async (file: TeleFile) => {
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      const updated = await updateFile(channelId, file.id, { trashed: false });
      setFiles(updated);
      toast.success(`Restored "${file.name}"`);
    } catch (err: any) {
      console.error("Failed to restore:", err);
      toast.error(err.message || "Failed to restore");
    } finally {
      setIsOperating(false);
    }
  };

  const archiveFile = async (file: TeleFile) => {
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      // Archiving clears starred so the file leaves the Starred view too
      const updated = await updateFile(channelId, file.id, { archived: true, starred: false });
      setFiles(updated);
      toast.success(`"${file.name}" archived`);
    } catch (err: any) {
      console.error("Failed to archive:", err);
      toast.error(err.message || "Failed to archive");
    } finally {
      setIsOperating(false);
    }
  };

  const unarchiveFile = async (file: TeleFile) => {
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      const updated = await updateFile(channelId, file.id, { archived: false });
      setFiles(updated);
      toast.success(`"${file.name}" moved back to My Drive`);
    } catch (err: any) {
      console.error("Failed to unarchive:", err);
      toast.error(err.message || "Failed to unarchive");
    } finally {
      setIsOperating(false);
    }
  };

  /**
   * Permanently deletes a single file:
   * 1. Removes it from the metadata index
   * 2. Deletes the actual Telegram message (the file data) — handled inside removeFile
   */
  const deletePermanently = async (fileId: string) => {
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      const updated = await removeFile(channelId, fileId);
      setFiles(updated);
      toast.success("Deleted permanently");
    } catch (err: any) {
      console.error("Failed to delete permanently:", err);
      toast.error(err.message || "Failed to delete");
    } finally {
      setIsOperating(false);
    }
  };

  /**
   * Empties the trash: permanently deletes ALL trashed items.
   *
   * Strategy:
   * 1. Load the current index from Telegram
   * 2. Separate trashed vs. active files
   * 3. Delete all trashed Telegram messages in parallel (best-effort)
   * 4. Save the cleaned-up index (active files only)
   * 5. Update the local store
   *
   * This is more efficient than calling removeFile() N times (which would
   * each trigger a full loadIndex+saveIndex round-trip).
   */
  const emptyTrash = async () => {
    setIsOperating(true);
    try {
      const channelId = await getChannelId();
      const allFiles = await loadIndex(channelId);

      const trashed = allFiles.filter((f) => f.trashed);
      const active = allFiles.filter((f) => !f.trashed);

      if (trashed.length === 0) {
        toast.info("Trash is already empty");
        return;
      }

      // Delete Telegram messages in parallel (folders have messageId=0 — skip)
      const deletionPromises = trashed
        .filter((f) => f.messageId && f.messageId !== 0)
        .map((f) =>
          deleteTelegramMessage(channelId, f.messageId).catch((err) => {
            console.warn(
              `[emptyTrash] Could not delete message ${f.messageId} for "${f.name}":`,
              err?.message || err
            );
          })
        );

      await Promise.allSettled(deletionPromises);

      // Save the index without the trashed files
      await saveIndex(channelId, active);
      setFiles(active);

      toast.success(
        trashed.length === 1
          ? "1 item deleted permanently"
          : `${trashed.length} items deleted permanently`
      );
    } catch (err: any) {
      console.error("Failed to empty trash:", err);
      toast.error(err.message || "Failed to empty trash");
    } finally {
      setIsOperating(false);
    }
  };

  return {
    isOperating,
    createFolder,
    renameFile,
    toggleStar,
    moveToTrash,
    restoreFromTrash,
    archiveFile,
    unarchiveFile,
    deletePermanently,
    emptyTrash,
  };
}
