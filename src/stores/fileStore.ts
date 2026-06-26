import { create } from "zustand";
import { TeleFile, UploadItem } from "../lib/types";

interface FileState {
  files: TeleFile[];
  currentFolder: string;
  selectedIds: string[];
  /** O(1) lookup mirror of selectedIds — always kept in sync */
  selectedIdsSet: Set<string>;
  isLoading: boolean;
  uploadQueue: UploadItem[];
  setFiles: (files: TeleFile[]) => void;
  setFolder: (path: string) => void;
  toggleSelect: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
  addToQueue: (item: UploadItem) => void;
  updateQueueItem: (id: string, patch: Partial<UploadItem>) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  setLoading: (loading: boolean) => void;
}

export const useFileStore = create<FileState>((set) => ({
  files: [],
  currentFolder: "/",
  selectedIds: [],
  selectedIdsSet: new Set<string>(),
  isLoading: false,
  uploadQueue: [],
  setFiles: (files) => set({ files }),
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
}));
