import { create } from "zustand";
import { TeleFile, UploadItem } from "../lib/types";

interface FileState {
  files: TeleFile[];
  currentFolder: string;
  selectedIds: string[];
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
  isLoading: false,
  uploadQueue: [],
  setFiles: (files) => set({ files }),
  setFolder: (currentFolder) => set({ currentFolder, selectedIds: [] }),
  toggleSelect: (id) =>
    set((state) => {
      const isSelected = state.selectedIds.includes(id);
      const selectedIds = isSelected
        ? state.selectedIds.filter((x) => x !== id)
        : [...state.selectedIds, id];
      return { selectedIds };
    }),
  setSelectedIds: (selectedIds) => set({ selectedIds }),
  clearSelection: () => set({ selectedIds: [] }),
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
