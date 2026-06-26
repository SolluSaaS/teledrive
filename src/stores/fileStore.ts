import { create } from "zustand";
import { TeleFile, UploadItem } from "../lib/types";

interface FileState {
  files: TeleFile[];
  currentFolder: string;
  selectedIds: string[];
  /** O(1) lookup mirror of selectedIds — always kept in sync */
  selectedIdsSet: Set<string>;
  isLoading: boolean;
  isSyncing: boolean;
  uploadQueue: UploadItem[];
  isOperating: boolean;
  setFiles: (files: TeleFile[]) => void;
  setSyncing: (isSyncing: boolean) => void;
  setFolder: (path: string) => void;
  toggleSelect: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
  addToQueue: (item: UploadItem) => void;
  updateQueueItem: (id: string, patch: Partial<UploadItem>) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  setLoading: (loading: boolean) => void;
  setIsOperating: (isOperating: boolean) => void;
}

const getInitialFiles = (): TeleFile[] => {
  try {
    const cached = localStorage.getItem("teledrive_cached_files");
    return cached ? JSON.parse(cached) : [];
  } catch (err) {
    console.warn("[fileStore] Failed to load cached files from localStorage:", err);
    return [];
  }
};

export const useFileStore = create<FileState>((set) => ({
  files: getInitialFiles(),
  currentFolder: "/",
  selectedIds: [],
  selectedIdsSet: new Set<string>(),
  isLoading: false,
  isSyncing: false,
  uploadQueue: [],
  isOperating: false,
  setFiles: (files) => {
    try {
      localStorage.setItem("teledrive_cached_files", JSON.stringify(files));
    } catch (err) {
      console.warn("[fileStore] Failed to cache files to localStorage:", err);
    }
    set({ files });
  },
  setSyncing: (isSyncing) => set({ isSyncing }),
  setFolder: (currentFolder) =>
    set({ currentFolder, selectedIds: [], selectedIdsSet: new Set() }),
  toggleSelect: (id) =>
    set((state) => {
      const next = new Set(state.selectedIdsSet);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: Array.from(next), selectedIdsSet: next };
    }),
  setSelectedIds: (selectedIds) =>
    set({ selectedIds, selectedIdsSet: new Set(selectedIds) }),
  clearSelection: () => set({ selectedIds: [], selectedIdsSet: new Set() }),
  addToQueue: (item) =>
    set((state) => ({ uploadQueue: [...state.uploadQueue, item] })),
  updateQueueItem: (id, patch) =>
    set((state) => ({
      uploadQueue: state.uploadQueue.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    })),
  removeFromQueue: (id) =>
    set((state) => ({
      uploadQueue: state.uploadQueue.filter((item) => item.id !== id),
    })),
  clearQueue: () => set({ uploadQueue: [] }),
  setLoading: (isLoading) => set({ isLoading }),
  setIsOperating: (isOperating) => set({ isOperating }),
}));
