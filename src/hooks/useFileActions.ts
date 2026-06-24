import { useState } from "react";
import { getSecret, VAULT_KEY_CHANNEL_ID } from "../lib/secure/vault";
import { addFile, removeFile, updateFile } from "../lib/storage/metadataStore";
import { useFileStore } from "../stores/fileStore";
import { TeleFile } from "../lib/types";
import { toast } from "sonner";

export function useFileActions() {
  const [isOperating, setIsOperating] = useState(false);
  const setFiles = useFileStore((state) => state.setFiles);
  const currentFolder = useFileStore((state) => state.currentFolder);

  const getChannelId = async () => {
    const cid = await getSecret(VAULT_KEY_CHANNEL_ID);
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

  return {
    isOperating,
    createFolder,
    renameFile,
    toggleStar,
    moveToTrash,
    restoreFromTrash,
    deletePermanently,
  };
}
