import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../lib/secure/vault";
import { updateFile, deleteTelegramMessage, runExclusive } from "../lib/storage/metadataStore";
import { saveIndex } from "../lib/storage/metadataStore";
import { useFileStore } from "../stores/fileStore";
import { useAuthStore } from "../stores/authStore";
import { TeleFile } from "../lib/types";
import { toast } from "sonner";
import { cacheFileOffline, removeOfflineCache } from "../lib/storage/offlineStorage";

class ActionQueue {
  private queue: (() => Promise<any>)[] = [];
  private running = false;

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const res = await task();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.running) return;
    this.running = true;
    useFileStore.getState().setIsOperating(true);

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        try {
          await task();
        } catch (err) {
          console.error("Error executing queued task:", err);
        }
      }
    }

    this.running = false;
    useFileStore.getState().setIsOperating(false);
  }
}

const fileActionQueue = new ActionQueue();

const DIRECTORY_MIMES = new Set(["inode/directory", "application/x-directory"]);

function isFolder(file: TeleFile): boolean {
  return DIRECTORY_MIMES.has(file.mime);
}

function normalizeFolderPath(path: string): string {
  if (!path || path === "/") return "/";
  return `/${path.split("/").filter(Boolean).join("/")}`;
}

function getFolderFullPath(folder: TeleFile): string {
  const parentPath = normalizeFolderPath(folder.folderPath);
  return parentPath === "/" ? `/${folder.name}` : `${parentPath}/${folder.name}`;
}

function isSameOrDescendantPath(path: string, parentPath: string): boolean {
  const normalizedPath = normalizeFolderPath(path);
  const normalizedParentPath = normalizeFolderPath(parentPath);
  return normalizedPath === normalizedParentPath || normalizedPath.startsWith(`${normalizedParentPath}/`);
}

let saveIndexTimeout: any = null;
let saveIndexPromise: Promise<void> | null = null;
let pendingChannelId: string | null = null;
let originalFilesBeforeOptimistic: TeleFile[] | null = null;

function backupFilesForRollback() {
  if (!originalFilesBeforeOptimistic) {
    originalFilesBeforeOptimistic = useFileStore.getState().files;
  }
}

async function flushIndexSave() {
  if (saveIndexTimeout) {
    clearTimeout(saveIndexTimeout);
    saveIndexTimeout = null;
  }
  if (pendingChannelId) {
    const cid = pendingChannelId;
    useFileStore.getState().setSyncing(true);
    try {
      await runExclusive(async () => {
        await saveIndex(cid, useFileStore.getState().files);
      });
      originalFilesBeforeOptimistic = null;
    } catch (err) {
      console.error("[useFileActions] Immediate index flush failed:", err);
      if (originalFilesBeforeOptimistic) {
        useFileStore.getState().setFiles(originalFilesBeforeOptimistic);
        originalFilesBeforeOptimistic = null;
      }
      toast.error("Failed to save changes to Telegram");
    } finally {
      useFileStore.getState().setSyncing(false);
    }
  }
  if (saveIndexPromise) {
    try {
      await saveIndexPromise;
    } catch {
      // ignore
    }
  }
}

function queueIndexSave(channelId: string) {
  pendingChannelId = channelId;
  if (saveIndexTimeout) {
    clearTimeout(saveIndexTimeout);
  }
  
  useFileStore.getState().setSyncing(true);

  saveIndexTimeout = setTimeout(() => {
    saveIndexTimeout = null;
    const cid = pendingChannelId!;
    
    saveIndexPromise = runExclusive(async () => {
      try {
        const filesToSave = useFileStore.getState().files;
        await saveIndex(cid, filesToSave);
        originalFilesBeforeOptimistic = null;
      } catch (err) {
        console.error("[useFileActions] Debounced index save failed:", err);
        if (originalFilesBeforeOptimistic) {
          useFileStore.getState().setFiles(originalFilesBeforeOptimistic);
          originalFilesBeforeOptimistic = null;
        }
        toast.error("Failed to save changes to Telegram");
      } finally {
        useFileStore.getState().setSyncing(false);
      }
    });
  }, 1000);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (pendingChannelId) {
      void flushIndexSave();
    }
  });
}

export function useFileActions() {
  const isOperating = useFileStore((state) => state.isOperating);
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

      backupFilesForRollback();
      const files = useFileStore.getState().files;
      setFiles([...files, newFolder]);
      toast.success(`Folder "${name}" created successfully`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to create folder:", err);
      toast.error(err.message || "Failed to create folder");
    }
  };

  const renameFile = async (fileId: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const fileToRename = allFiles.find((f) => f.id === fileId);
      if (!fileToRename) throw new Error("File not found");

      const isFolder = fileToRename.mime === "inode/directory" || fileToRename.mime === "application/x-directory";
      backupFilesForRollback();

      let oldPath = "";
      let newPath = "";
      if (isFolder) {
        oldPath = fileToRename.folderPath === "/" 
          ? `/${fileToRename.name}` 
          : `${fileToRename.folderPath}/${fileToRename.name}`;
        
        newPath = fileToRename.folderPath === "/" 
          ? `/${newName.trim()}` 
          : `${fileToRename.folderPath}/${newName.trim()}`;
      }

      const updatedFiles = allFiles.map((f) => {
        if (f.id === fileId) {
          return { ...f, name: newName.trim() };
        }
        if (isFolder) {
          if (f.folderPath === oldPath) {
            return { ...f, folderPath: newPath };
          }
          if (f.folderPath.startsWith(oldPath + "/")) {
            return { ...f, folderPath: newPath + f.folderPath.substring(oldPath.length) };
          }
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success("Renamed successfully");
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to rename:", err);
      toast.error(err.message || "Failed to rename");
    }
  };

  const toggleStar = async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const currentFile = allFiles.find((f) => f.id === file.id);
      const nextStarred = currentFile ? !currentFile.starred : !file.starred;

      backupFilesForRollback();
      const updatedFiles = allFiles.map((f) =>
        f.id === file.id ? { ...f, starred: nextStarred } : f
      );

      setFiles(updatedFiles);
      toast.success(nextStarred ? "Added to Starred" : "Removed from Starred");
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to toggle star:", err);
      toast.error(err.message || "Failed to update star");
    }
  };

  const moveToTrash = async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;
      backupFilesForRollback();

      const folderPathPrefix = file.folderPath === "/" 
        ? `/${file.name}` 
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, trashed: true };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`Moved "${file.name}" to Trash`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to move to trash:", err);
      toast.error(err.message || "Failed to move to trash");
    }
  };

  const restoreFromTrash = async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;
      backupFilesForRollback();

      const folderPathPrefix = file.folderPath === "/" 
        ? `/${file.name}` 
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, trashed: false };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`Restored "${file.name}"`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to restore from trash:", err);
      toast.error(err.message || "Failed to restore");
    }
  };

  const archiveFile = async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;
      backupFilesForRollback();

      const folderPathPrefix = file.folderPath === "/" 
        ? `/${file.name}` 
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, archived: true, starred: false };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`"${file.name}" archived`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to archive:", err);
      toast.error(err.message || "Failed to archive");
    }
  };

  const unarchiveFile = async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;
      backupFilesForRollback();

      const folderPathPrefix = file.folderPath === "/" 
        ? `/${file.name}` 
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, archived: false };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`"${file.name}" moved back to My Drive`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to unarchive:", err);
      toast.error(err.message || "Failed to unarchive");
    }
  };

  const deletePermanently = async (fileId: string) => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const fileToDelete = allFiles.find((f) => f.id === fileId);
      if (!fileToDelete) throw new Error("File not found");

      const isFolder = fileToDelete.mime === "inode/directory" || fileToDelete.mime === "application/x-directory";
      
      backupFilesForRollback();

      let targets: TeleFile[] = [];
      let active: TeleFile[] = [];

      if (isFolder) {
        const folderPathPrefix = fileToDelete.folderPath === "/" 
          ? `/${fileToDelete.name}` 
          : `${fileToDelete.folderPath}/${fileToDelete.name}`;
        
        targets = allFiles.filter((f) => f.id === fileId || f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/"));
        active = allFiles.filter((f) => f.id !== fileId && f.folderPath !== folderPathPrefix && !f.folderPath.startsWith(folderPathPrefix + "/"));
      } else {
        targets = [fileToDelete];
        active = allFiles.filter((f) => f.id !== fileId);
      }

      setFiles(active);
      toast.success("Deleted permanently");
      queueIndexSave(channelId);

      // Asynchronously delete offline caches and Telegram messages in the background
      void (async () => {
        try {
          await Promise.allSettled(targets.map((f) => removeOfflineCache(f.id)));
          const deletionPromises = targets
            .filter((f) => f.messageId && f.messageId !== 0)
            .map((f) =>
              deleteTelegramMessage(channelId, f.messageId).catch((err) => {
                console.warn(
                  `[deletePermanently] Could not delete message ${f.messageId} for "${f.name}":`,
                  err?.message || err
                );
              })
            );
          await Promise.allSettled(deletionPromises);
        } catch (err) {
          console.error("[deletePermanently] Background deletion error:", err);
        }
      })();
    } catch (err: any) {
      console.error("Failed to delete permanently:", err);
      toast.error(err.message || "Failed to delete");
    }
  };

  const emptyTrash = async () => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const trashed = allFiles.filter((f) => f.trashed);
      const active = allFiles.filter((f) => !f.trashed);

      if (trashed.length === 0) {
        toast.info("Trash is already empty");
        return;
      }

      backupFilesForRollback();
      setFiles(active);
      
      toast.success(
        trashed.length === 1
          ? "1 item deleted permanently"
          : `${trashed.length} items deleted permanently`
      );
      queueIndexSave(channelId);

      // Asynchronously clear cache & delete telegram messages in background
      void (async () => {
        try {
          await Promise.allSettled(trashed.map((f) => removeOfflineCache(f.id)));
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
        } catch (err) {
          console.error("[emptyTrash] Background deletion error:", err);
        }
      })();
    } catch (err: any) {
      console.error("Failed to empty trash:", err);
      toast.error(err.message || "Failed to empty trash");
    }
  };

  const moveMultipleToTrash = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));
      
      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      backupFilesForRollback();

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInTrashedFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if (isInTarget || isInTrashedFolder) {
          return { ...f, trashed: true };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`Moved ${fileIds.length} item(s) to Trash`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to move multiple to trash:", err);
      toast.error(err.message || "Failed to move items to trash");
    }
  };

  const restoreMultipleFromTrash = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));
      
      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      backupFilesForRollback();

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInRestoredFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if (isInTarget || isInRestoredFolder) {
          return { ...f, trashed: false };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`Restored ${fileIds.length} item(s)`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to restore multiple from trash:", err);
      toast.error(err.message || "Failed to restore items");
    }
  };

  const deleteMultiplePermanently = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));
      
      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      const isTargetOrInFolder = (f: TeleFile) => {
        return fileIdSet.has(f.id) || folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
      };

      const targets = files.filter(isTargetOrInFolder);
      const active = files.filter((f) => !isTargetOrInFolder(f));

      backupFilesForRollback();
      setFiles(active);
      toast.success(`Deleted ${fileIds.length} item(s) permanently`);
      queueIndexSave(channelId);

      // Asynchronously clear cache & delete telegram messages in background
      void (async () => {
        try {
          await Promise.allSettled(targets.map((f) => removeOfflineCache(f.id)));
          const deletionPromises = targets
            .filter((f) => f.messageId && f.messageId !== 0)
            .map((f) =>
              deleteTelegramMessage(channelId, f.messageId).catch((err) => {
                console.warn(
                  `[deleteMultiplePermanently] Could not delete message ${f.messageId} for "${f.name}":`,
                  err?.message || err
                );
              })
            );
          await Promise.allSettled(deletionPromises);
        } catch (err) {
          console.error("[deleteMultiplePermanently] Background deletion error:", err);
        }
      })();
    } catch (err: any) {
      console.error("Failed to delete multiple permanently:", err);
      toast.error(err.message || "Failed to delete items");
    }
  };

  const archiveMultiple = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));
      
      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      backupFilesForRollback();

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInArchivedFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if (isInTarget || isInArchivedFolder) {
          return { ...f, archived: true, starred: false };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`Archived ${fileIds.length} item(s)`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to archive multiple:", err);
      toast.error(err.message || "Failed to archive items");
    }
  };

  const starMultiple = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));

      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      backupFilesForRollback();

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInTargetFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if ((isInTarget || isInTargetFolder) && !f.trashed && !f.archived) {
          return { ...f, starred: true };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`Starred ${fileIds.length} item(s)`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to star multiple:", err);
      toast.error(err.message || "Failed to star items");
    }
  };

  const unarchiveMultiple = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));
      
      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

      backupFilesForRollback();

      const updatedFiles = files.map((f) => {
        const isInTarget = fileIdSet.has(f.id);
        const isInArchivedFolder = folderPrefixes.some(
          (prefix) => f.folderPath === prefix || f.folderPath.startsWith(prefix + "/")
        );
        if (isInTarget || isInArchivedFolder) {
          return { ...f, archived: false };
        }
        return f;
      });

      setFiles(updatedFiles);
      toast.success(`Moved ${fileIds.length} item(s) back to My Drive`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to unarchive multiple:", err);
      toast.error(err.message || "Failed to unarchive items");
    }
  };

  const toggleOffline = async (file: TeleFile) => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const allFiles = useFileStore.getState().files;
        const currentFile = allFiles.find((f) => f.id === file.id);
        const nextOffline = currentFile ? !currentFile.offline : !file.offline;

        if (nextOffline) {
          toast.info(`Downloading "${file.name}" for offline access...`);
          await cacheFileOffline(channelId, file.messageId, file.id);
          toast.success(`"${file.name}" is now available offline`);
        } else {
          await removeOfflineCache(file.id);
          toast.success(`"${file.name}" is no longer available offline`);
        }

        const updated = await updateFile(channelId, file.id, { offline: nextOffline });
        setFiles(updated);
      } catch (err: any) {
        console.error("Failed to toggle offline availability:", err);
        toast.error(err.message || "Failed to update offline status");
      }
    });
  };

  const moveMultipleFilesOrFolders = async (fileIds: string[], targetFolderPath: string) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const normalizedTargetPath = normalizeFolderPath(targetFolderPath);
      
      const files = useFileStore.getState().files;
      const selectedIdSet = new Set(fileIds);
      const selectedFiles = files.filter((f) => selectedIdSet.has(f.id));

      if (selectedFiles.length === 0) {
        toast.info("Nothing to move");
        return;
      }

      if (normalizedTargetPath !== "/") {
        const targetFolderExists = files.some(
          (f) => isFolder(f) && getFolderFullPath(f) === normalizedTargetPath
        );
        if (!targetFolderExists) {
          throw new Error("Destination folder no longer exists.");
        }
      }

      const selectedFolders = selectedFiles.filter(isFolder);
      const selectedFolderPaths = selectedFolders.map((folder) => ({
        folder,
        fullPath: getFolderFullPath(folder),
      }));

      for (const { folder, fullPath } of selectedFolderPaths) {
        if (isSameOrDescendantPath(normalizedTargetPath, fullPath)) {
          throw new Error(`Cannot move folder "${folder.name}" into itself or its subfolders.`);
        }
      }

      const rootSelectedIds = new Set<string>();
      for (const file of selectedFiles) {
        const filePath = isFolder(file) ? getFolderFullPath(file) : normalizeFolderPath(file.folderPath);
        const isCoveredBySelectedParent = selectedFolderPaths.some(
          ({ folder, fullPath }) => folder.id !== file.id && isSameOrDescendantPath(filePath, fullPath)
        );

        if (!isCoveredBySelectedParent) {
          rootSelectedIds.add(file.id);
        }
      }

      const movedRootFolders = selectedFolders
        .filter((folder) => rootSelectedIds.has(folder.id))
        .map((folder) => {
          const oldFullPath = getFolderFullPath(folder);
          const newFullPath = normalizedTargetPath === "/"
            ? `/${folder.name}`
            : `${normalizedTargetPath}/${folder.name}`;
          return { folder, oldFullPath, newFullPath };
        });
      
      const updatedFiles = files.map((f) => {
        if (rootSelectedIds.has(f.id)) {
          if (normalizeFolderPath(f.folderPath) === normalizedTargetPath) return f;
          return { ...f, folderPath: normalizedTargetPath };
        }

        for (const { oldFullPath, newFullPath } of movedRootFolders) {
          const currentPath = normalizeFolderPath(f.folderPath);
          if (currentPath === oldFullPath) {
            return { ...f, folderPath: newFullPath };
          }
          if (currentPath.startsWith(`${oldFullPath}/`)) {
            return { ...f, folderPath: `${newFullPath}${currentPath.substring(oldFullPath.length)}` };
          }
        }

        return f;
      });

      const hasChanges = updatedFiles.some((file, index) => file !== files[index]);
      if (!hasChanges) {
        toast.info("Items are already in that folder");
        return;
      }

      backupFilesForRollback();
      setFiles(updatedFiles);
      toast.success(`Successfully moved ${fileIds.length} item(s)`);
      queueIndexSave(channelId);
    } catch (err: any) {
      console.error("Failed to move items:", err);
      toast.error(err.message || "Failed to move items");
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
    moveMultipleToTrash,
    restoreMultipleFromTrash,
    deleteMultiplePermanently,
    starMultiple,
    archiveMultiple,
    unarchiveMultiple,
    toggleOffline,
    moveMultipleFilesOrFolders,
  };
}
