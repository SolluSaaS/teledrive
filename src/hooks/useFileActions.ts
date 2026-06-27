import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../lib/secure/vault";
import { deleteTelegramMessage } from "../lib/storage/metadataStore";
import { useFileStore } from "../stores/fileStore";
import { useAuthStore } from "../stores/authStore";
import { TeleFile } from "../lib/types";
import { toast } from "sonner";
import { cacheFileOffline, removeOfflineCache } from "../lib/storage/offlineStorage";
import { invoke } from "@tauri-apps/api/core";
import { enqueueSave, flushAllQueues, retryQueue } from "../lib/storage/indexQueue";
import { useCallback, useMemo } from "react";


/**
 * ActionQueue — serializes offline-toggle operations (which touch local FS)
 * so a single file can't have two concurrent download/remove flows.
 *
 * Index writes are no longer serialized here. The IndexQueue owns all
 * index persistence and coalesces concurrent actions automatically.
 */
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

/**
 * Push a snapshot of the current files array onto the rollback ring.
 * Each call to `applyOptimistic` does this BEFORE mutating, so each action
 * gets its own independent rollback target (replaces the old global
 * `originalFilesBeforeOptimistic` which only worked for the first action).
 */
function pushSnapshotForRollback(): void {
  useFileStore.getState().pushSnapshot();
}

/**
 * Pop the most recent rollback snapshot and restore the files array to it.
 * Called when an action's index save fails with a HARD error.
 */
function rollbackToLastSnapshot(): boolean {
  const snap = useFileStore.getState().popSnapshot();
  if (!snap) return false;
  useFileStore.getState().setFiles(snap);
  return true;
}

/**
 * Optimistically apply a new files array and persist it to Telegram.
 *
 * - Pushes a rollback snapshot BEFORE the optimistic update so each call
 *   has its own independent rollback target.
 * - Routes the persistence through the IndexQueue, which coalesces
 *   concurrent calls into a single Telegram edit. Transient errors
 *   (FLOOD_WAIT, timeout) stay optimistic and retry indefinitely; hard
 *   errors trigger a rollback to the snapshot.
 */
async function applyOptimistic(
  channelId: string,
  nextFiles: TeleFile[],
  options: { skipRollbackOnHardError?: boolean } = {}
): Promise<void> {
  const store = useFileStore.getState();

  // Suppress writes before bootstrap completes. Bootstrap reads the
  // authoritative index from Telegram and populates the store; if a user
  // action fires before that, persisting our optimistic state would
  // overwrite Telegram with a partial / stale index and lose data on
  // the next restart. The user can retry the action once bootstrap
  // completes (which takes < 1s in practice).
  if (!store.bootstrapComplete) {
    await invoke("log_vault_state", {
      state: `ACTION_SUPPRESSED_PRE_BOOTSTRAP files=${nextFiles.length}`,
    }).catch(() => {});
    // Roll back the optimistic update silently — the action will need
    // to be re-run after bootstrap. The user typically never sees this
    // because bootstrap completes before they can interact.
    if (!options.skipRollbackOnHardError) {
      rollbackToLastSnapshot();
    }
    toast.error("Still loading your drive — please retry in a moment.");
    throw new Error("Bootstrap not complete");
  }

  pushSnapshotForRollback();
  store.setFiles(nextFiles);
  store.setSyncing(true);

  try {
    await enqueueSave(channelId, nextFiles);
    // Commit succeeded (or is being transparently retried). Clear this
    // snapshot from the ring — the optimistic state is now canonical.
    useFileStore.getState().popSnapshot();
    await invoke("log_vault_state", {
      state: `ACTION_OK files=${nextFiles.length}`,
    }).catch(() => {});
  } catch (err: any) {
    if (options.skipRollbackOnHardError) {
      await invoke("log_vault_state", {
        state: `ACTION_HARD_ERR_NO_ROLLBACK: ${err?.message ?? err}`,
      }).catch(() => {});
      throw err;
    }
    // Hard error path: roll back to the pre-action snapshot.
    const rolled = rollbackToLastSnapshot();
    await invoke("log_vault_state", {
      state: `ACTION_HARD_ERR rolled=${rolled}: ${err?.message ?? err}`,
    }).catch(() => {});
    toast.error(
      `Save failed and was rolled back: ${err?.message ?? "Unknown error"}`
    );
    throw err;
  } finally {
    useFileStore.getState().setSyncing(false);
  }
}

if (typeof window !== "undefined") {
  // Best-effort flush on tab close. The queue resolves any pending entries
  // so callers don't hang. We don't try to await (browsers can't).
  window.addEventListener("beforeunload", () => {
    void flushAllQueues();
  });

  // Expose a tiny dev hook so the diagnostics page can force a retry.
  (window as any).__teledriveRetryIndex = (channelId: string) =>
    retryQueue(channelId);
}

export function useFileActions() {
  const isOperating = useFileStore((state) => state.isOperating);
  const currentFolder = useFileStore((state) => state.currentFolder);
  const phoneNumber = useAuthStore((state) => state.phoneNumber);

  const getChannelId = useCallback(async () => {
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
  }, [phoneNumber]);

  const createFolder = useCallback(async (name: string) => {
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

      const files = useFileStore.getState().files;
      toast.success(`Folder "${name}" created successfully`);
      await applyOptimistic(channelId, [...files, newFolder]);
    } catch (err: any) {
      console.error("Failed to create folder:", err);
      toast.error(err.message || "Failed to create folder");
    }
  }, [currentFolder, getChannelId]);

  const renameFile = useCallback(async (fileId: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const fileToRename = allFiles.find((f) => f.id === fileId);
      if (!fileToRename) throw new Error("File not found");

      const isFolder = fileToRename.mime === "inode/directory" || fileToRename.mime === "application/x-directory";

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

      toast.success("Renamed successfully");
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to rename:", err);
      toast.error(err.message || "Failed to rename");
    }
  }, [getChannelId]);

  const toggleStar = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const currentFile = allFiles.find((f) => f.id === file.id);
      const nextStarred = currentFile ? !currentFile.starred : !file.starred;

      const updatedFiles = allFiles.map((f) =>
        f.id === file.id ? { ...f, starred: nextStarred } : f
      );

      toast.success(nextStarred ? "Added to Starred" : "Removed from Starred");
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to toggle star:", err);
      toast.error(err.message || "Failed to update star");
    }
  }, [getChannelId]);

  const moveToTrash = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;

      const folderPathPrefix = file.folderPath === "/"
        ? `/${file.name}`
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, trashed: true };
        }
        return f;
      });

      toast.success(`Moved "${file.name}" to Trash`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to move to trash:", err);
      toast.error(err.message || "Failed to move to trash");
    }
  }, [getChannelId]);

  const restoreFromTrash = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;

      const folderPathPrefix = file.folderPath === "/"
        ? `/${file.name}`
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, trashed: false };
        }
        return f;
      });

      toast.success(`Restored "${file.name}"`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to restore from trash:", err);
      toast.error(err.message || "Failed to restore");
    }
  }, [getChannelId]);

  const archiveFile = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;

      const folderPathPrefix = file.folderPath === "/"
        ? `/${file.name}`
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, archived: true, starred: false };
        }
        return f;
      });

      toast.success(`"${file.name}" archived`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to archive:", err);
      toast.error(err.message || "Failed to archive");
    }
  }, [getChannelId]);

  const unarchiveFile = useCallback(async (file: TeleFile) => {
    try {
      const channelId = await getChannelId();
      const isFolder = file.mime === "inode/directory" || file.mime === "application/x-directory";
      const allFiles = useFileStore.getState().files;

      const folderPathPrefix = file.folderPath === "/"
        ? `/${file.name}`
        : `${file.folderPath}/${file.name}`;

      const updatedFiles = allFiles.map((f) => {
        if (f.id === file.id || (isFolder && (f.folderPath === folderPathPrefix || f.folderPath.startsWith(folderPathPrefix + "/")))) {
          return { ...f, archived: false };
        }
        return f;
      });

      toast.success(`"${file.name}" moved back to My Drive`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to unarchive:", err);
      toast.error(err.message || "Failed to unarchive");
    }
  }, [getChannelId]);

  const deletePermanently = useCallback(async (fileId: string) => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const fileToDelete = allFiles.find((f) => f.id === fileId);
      if (!fileToDelete) throw new Error("File not found");

      const isFolder = fileToDelete.mime === "inode/directory" || fileToDelete.mime === "application/x-directory";

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

      toast.success("Deleted permanently");
      await applyOptimistic(channelId, active);

      // After the index commits, asynchronously delete offline caches and
      // Telegram messages in the background. If the index save had failed,
      // applyOptimistic would have rolled back and we'd never reach here.
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
  }, [getChannelId]);

  const emptyTrash = useCallback(async () => {
    try {
      const channelId = await getChannelId();
      const allFiles = useFileStore.getState().files;
      const trashed = allFiles.filter((f) => f.trashed);
      const active = allFiles.filter((f) => !f.trashed);

      if (trashed.length === 0) {
        toast.info("Trash is already empty");
        return;
      }

      toast.success(
        trashed.length === 1
          ? "1 item deleted permanently"
          : `${trashed.length} items deleted permanently`
      );
      await applyOptimistic(channelId, active);

      // After the index commits, asynchronously clear cache & delete telegram messages in background
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
  }, [getChannelId]);

  const moveMultipleToTrash = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
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

      toast.success(`Moved ${fileIds.length} item(s) to Trash`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to move multiple to trash:", err);
      toast.error(err.message || "Failed to move items to trash");
    }
  }, [getChannelId]);

  const restoreMultipleFromTrash = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
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

      toast.success(`Restored ${fileIds.length} item(s)`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to restore multiple from trash:", err);
      toast.error(err.message || "Failed to restore items");
    }
  }, [getChannelId]);

  const deleteMultiplePermanently = useCallback(async (fileIds: string[]) => {
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

      toast.success(`Deleted ${fileIds.length} item(s) permanently`);
      await applyOptimistic(channelId, active);

      // After the index commits, asynchronously clear cache & delete telegram messages in background
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
  }, [getChannelId]);

  const archiveMultiple = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
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

      toast.success(`Archived ${fileIds.length} item(s)`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to archive multiple:", err);
      toast.error(err.message || "Failed to archive items");
    }
  }, [getChannelId]);

  const starMultiple = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
      const files = useFileStore.getState().files;
      const fileIdSet = new Set(fileIds);
      const targetFiles = files.filter((f) => fileIdSet.has(f.id));

      const folderPrefixes = targetFiles
        .filter(isFolder)
        .map(getFolderFullPath);

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

      toast.success(`Starred ${fileIds.length} item(s)`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to star multiple:", err);
      toast.error(err.message || "Failed to star items");
    }
  }, [getChannelId]);

  const unarchiveMultiple = useCallback(async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    try {
      const channelId = await getChannelId();
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

      toast.success(`Moved ${fileIds.length} item(s) back to My Drive`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to unarchive multiple:", err);
      toast.error(err.message || "Failed to unarchive items");
    }
  }, [getChannelId]);

  const toggleOffline = useCallback(async (file: TeleFile) => {
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

        // Update the offline flag through the same optimistic + queue path
        // as every other action. This way a flood-wait on the index write
        // doesn't block the user, and the toggle stays consistent with the
        // visible files array.
        const updatedFiles = useFileStore
          .getState()
          .files.map((f) =>
            f.id === file.id ? { ...f, offline: nextOffline } : f
          );
        await applyOptimistic(channelId, updatedFiles);
      } catch (err: any) {
        console.error("Failed to toggle offline availability:", err);
        toast.error(err.message || "Failed to update offline status");
      }
    });
  }, [getChannelId]);

  const moveMultipleFilesOrFolders = useCallback(async (fileIds: string[], targetFolderPath: string) => {
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

      toast.success(`Successfully moved ${fileIds.length} item(s)`);
      await applyOptimistic(channelId, updatedFiles);
    } catch (err: any) {
      console.error("Failed to move items:", err);
      toast.error(err.message || "Failed to move items");
    }
  }, [getChannelId]);

  return useMemo(() => ({
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
  }), [
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
  ]);
}
