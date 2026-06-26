import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../lib/secure/vault";
import { addFile, removeFile, updateFile, deleteTelegramMessage, runExclusive } from "../lib/storage/metadataStore";
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
    return fileActionQueue.enqueue(async () => {
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
      }
    });
  };

  const renameFile = async (fileId: string, newName: string) => {
    if (!newName.trim()) return;
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const allFiles = useFileStore.getState().files;
        const fileToRename = allFiles.find((f) => f.id === fileId);
        if (!fileToRename) throw new Error("File not found");

        const isFolder = fileToRename.mime === "inode/directory" || fileToRename.mime === "application/x-directory";
        let updated: TeleFile[];

        if (isFolder) {
          const oldPath = fileToRename.folderPath === "/" 
            ? `/${fileToRename.name}` 
            : `${fileToRename.folderPath}/${fileToRename.name}`;
          
          const newPath = fileToRename.folderPath === "/" 
            ? `/${newName.trim()}` 
            : `${fileToRename.folderPath}/${newName.trim()}`;

          await runExclusive(async () => {
            const files = useFileStore.getState().files;
            const updatedFiles = files.map((f) => {
              if (f.id === fileId) {
                return { ...f, name: newName.trim() };
              }
              if (f.folderPath === oldPath) {
                return { ...f, folderPath: newPath };
              }
              if (f.folderPath.startsWith(oldPath + "/")) {
                return { ...f, folderPath: newPath + f.folderPath.substring(oldPath.length) };
              }
              return f;
            });
            await saveIndex(channelId, updatedFiles);
            updated = updatedFiles;
          });
        } else {
          updated = await updateFile(channelId, fileId, { name: newName.trim() });
        }
        
        setFiles(updated!);
        toast.success("Renamed successfully");
      } catch (err: any) {
        console.error("Failed to rename:", err);
        toast.error(err.message || "Failed to rename");
      }
    });
  };

  const toggleStar = async (file: TeleFile) => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const allFiles = useFileStore.getState().files;
        const currentFile = allFiles.find((f) => f.id === file.id);
        const nextStarred = currentFile ? !currentFile.starred : !file.starred;
        const updated = await updateFile(channelId, file.id, { starred: nextStarred });
        setFiles(updated);
        toast.success(nextStarred ? "Added to Starred" : "Removed from Starred");
      } catch (err: any) {
        console.error("Failed to toggle star:", err);
        toast.error(err.message || "Failed to update star");
      }
    });
  };

  const moveToTrash = async (file: TeleFile) => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
        let updated: TeleFile[];

        if (isFolder) {
          const folderPathPrefix = file.folderPath === "/" 
            ? `/${file.name}` 
            : `${file.folderPath}/${file.name}`;
          
          await runExclusive(async () => {
            const files = useFileStore.getState().files;
            const updatedFiles = files.map((f) => {
              if (f.id === file.id || f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")) {
                return { ...f, trashed: true };
              }
              return f;
            });
            await saveIndex(channelId, updatedFiles);
            updated = updatedFiles;
          });
        } else {
          updated = await updateFile(channelId, file.id, { trashed: true });
        }

        setFiles(updated!);
        toast.success(`Moved "${file.name}" to Trash`);
      } catch (err: any) {
        console.error("Failed to move to trash:", err);
        toast.error(err.message || "Failed to move to trash");
      }
    });
  };

  const restoreFromTrash = async (file: TeleFile) => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
        let updated: TeleFile[];

        if (isFolder) {
          const folderPathPrefix = file.folderPath === "/" 
            ? `/${file.name}` 
            : `${file.folderPath}/${file.name}`;
          
          await runExclusive(async () => {
            const files = useFileStore.getState().files;
            const updatedFiles = files.map((f) => {
              if (f.id === file.id || f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")) {
                return { ...f, trashed: false };
              }
              return f;
            });
            await saveIndex(channelId, updatedFiles);
            updated = updatedFiles;
          });
        } else {
          updated = await updateFile(channelId, file.id, { trashed: false });
        }

        setFiles(updated!);
        toast.success(`Restored "${file.name}"`);
      } catch (err: any) {
        console.error("Failed to restore:", err);
        toast.error(err.message || "Failed to restore");
      }
    });
  };

  const archiveFile = async (file: TeleFile) => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
        let updated: TeleFile[];

        if (isFolder) {
          const folderPathPrefix = file.folderPath === "/" 
            ? `/${file.name}` 
            : `${file.folderPath}/${file.name}`;
          
          await runExclusive(async () => {
            const files = useFileStore.getState().files;
            const updatedFiles = files.map((f) => {
              if (f.id === file.id || f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")) {
                return { ...f, archived: true, starred: false };
              }
              return f;
            });
            await saveIndex(channelId, updatedFiles);
            updated = updatedFiles;
          });
        } else {
          updated = await updateFile(channelId, file.id, { archived: true, starred: false });
        }

        setFiles(updated!);
        toast.success(`"${file.name}" archived`);
      } catch (err: any) {
        console.error("Failed to archive:", err);
        toast.error(err.message || "Failed to archive");
      }
    });
  };

  const unarchiveFile = async (file: TeleFile) => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
        let updated: TeleFile[];

        if (isFolder) {
          const folderPathPrefix = file.folderPath === "/" 
            ? `/${file.name}` 
            : `${file.folderPath}/${file.name}`;
          
          await runExclusive(async () => {
            const files = useFileStore.getState().files;
            const updatedFiles = files.map((f) => {
              if (f.id === file.id || f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")) {
                return { ...f, archived: false };
              }
              return f;
            });
            await saveIndex(channelId, updatedFiles);
            updated = updatedFiles;
          });
        } else {
          updated = await updateFile(channelId, file.id, { archived: false });
        }

        setFiles(updated!);
        toast.success(`"${file.name}" moved back to My Drive`);
      } catch (err: any) {
        console.error("Failed to unarchive:", err);
        toast.error(err.message || "Failed to unarchive");
      }
    });
  };

  const deletePermanently = async (fileId: string) => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const allFiles = useFileStore.getState().files;
        const fileToDelete = allFiles.find((f) => f.id === fileId);
        if (!fileToDelete) throw new Error("File not found");

        const isFolder = fileToDelete.mime === "inode/directory" || fileToDelete.mime === "application/x-directory";
        let updated: TeleFile[];

        if (isFolder) {
          const folderPathPrefix = fileToDelete.folderPath === "/" 
            ? `/${fileToDelete.name}` 
            : `${fileToDelete.folderPath}/${fileToDelete.name}`;
          
          await runExclusive(async () => {
            const files = useFileStore.getState().files;
            const targets = files.filter((f) => f.id === fileId || f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/"));
            const active = files.filter((f) => f.id !== fileId && f.folderPath !== folderPathPrefix && !f.folderPath.startsWith(folderPathPrefix + "/"));

            // Clear local offline caches
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
            await saveIndex(channelId, active);
            updated = active;
          });
        } else {
          await removeOfflineCache(fileId);
          updated = await removeFile(channelId, fileId);
        }

        setFiles(updated!);
        toast.success("Deleted permanently");
      } catch (err: any) {
        console.error("Failed to delete permanently:", err);
        toast.error(err.message || "Failed to delete");
      }
    });
  };

  const emptyTrash = async () => {
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        await runExclusive(async () => {
          const allFiles = useFileStore.getState().files;

          const trashed = allFiles.filter((f) => f.trashed);
          const active = allFiles.filter((f) => !f.trashed);

          if (trashed.length === 0) {
            toast.info("Trash is already empty");
            return;
          }

          // Clear local offline caches
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

          await saveIndex(channelId, active);
          setFiles(active);

          toast.success(
            trashed.length === 1
              ? "1 item deleted permanently"
              : `${trashed.length} items deleted permanently`
          );
        });
      } catch (err: any) {
        console.error("Failed to empty trash:", err);
        toast.error(err.message || "Failed to empty trash");
      }
    });
  };

  const moveMultipleToTrash = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        await runExclusive(async () => {
          const files = useFileStore.getState().files;
          const fileIdSet = new Set(fileIds);
          const targetFiles = files.filter((f) => fileIdSet.has(f.id));
          
          const folderPrefixes = targetFiles
            .filter(isFolder)
            .map(getFolderFullPath);

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

          await saveIndex(channelId, updatedFiles);
          setFiles(updatedFiles);
        });
        toast.success(`Moved ${fileIds.length} item(s) to Trash`);
      } catch (err: any) {
        console.error("Failed to move multiple to trash:", err);
        toast.error(err.message || "Failed to move items to trash");
      }
    });
  };

  const restoreMultipleFromTrash = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        await runExclusive(async () => {
          const files = useFileStore.getState().files;
          const fileIdSet = new Set(fileIds);
          const targetFiles = files.filter((f) => fileIdSet.has(f.id));
          
          const folderPrefixes = targetFiles
            .filter(isFolder)
            .map(getFolderFullPath);

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

          await saveIndex(channelId, updatedFiles);
          setFiles(updatedFiles);
        });
        toast.success(`Restored ${fileIds.length} item(s)`);
      } catch (err: any) {
        console.error("Failed to restore multiple from trash:", err);
        toast.error(err.message || "Failed to restore items");
      }
    });
  };

  const deleteMultiplePermanently = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        await runExclusive(async () => {
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

          // Clear local offline caches
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
          await saveIndex(channelId, active);
          setFiles(active);
        });
        toast.success(`Deleted ${fileIds.length} item(s) permanently`);
      } catch (err: any) {
        console.error("Failed to delete multiple permanently:", err);
        toast.error(err.message || "Failed to delete items");
      }
    });
  };

  const archiveMultiple = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        await runExclusive(async () => {
          const files = useFileStore.getState().files;
          const fileIdSet = new Set(fileIds);
          const targetFiles = files.filter((f) => fileIdSet.has(f.id));
          
          const folderPrefixes = targetFiles
            .filter(isFolder)
            .map(getFolderFullPath);

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

          await saveIndex(channelId, updatedFiles);
          setFiles(updatedFiles);
        });
        toast.success(`Archived ${fileIds.length} item(s)`);
      } catch (err: any) {
        console.error("Failed to archive multiple:", err);
        toast.error(err.message || "Failed to archive items");
      }
    });
  };

  const unarchiveMultiple = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        await runExclusive(async () => {
          const files = useFileStore.getState().files;
          const fileIdSet = new Set(fileIds);
          const targetFiles = files.filter((f) => fileIdSet.has(f.id));
          
          const folderPrefixes = targetFiles
            .filter(isFolder)
            .map(getFolderFullPath);

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

          await saveIndex(channelId, updatedFiles);
          setFiles(updatedFiles);
        });
        toast.success(`Moved ${fileIds.length} item(s) back to My Drive`);
      } catch (err: any) {
        console.error("Failed to unarchive multiple:", err);
        toast.error(err.message || "Failed to unarchive items");
      }
    });
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
    return fileActionQueue.enqueue(async () => {
      try {
        const channelId = await getChannelId();
        const normalizedTargetPath = normalizeFolderPath(targetFolderPath);
        let didMove = false;
        
        await runExclusive(async () => {
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

          await saveIndex(channelId, updatedFiles);
          setFiles(updatedFiles);
          didMove = true;
        });

        if (didMove) {
          toast.success(`Successfully moved ${fileIds.length} item(s)`);
        }
      } catch (err: any) {
        console.error("Failed to move items:", err);
        toast.error(err.message || "Failed to move items");
      }
    });
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
    archiveMultiple,
    unarchiveMultiple,
    toggleOffline,
    moveMultipleFilesOrFolders,
  };
}
