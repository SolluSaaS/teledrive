import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Grid,
  List,
  FolderPlus,
  Upload,
  ChevronRight,
  Home,
  Star,
  Trash2,
  X,
  FolderOpen,
  Folder,
  FileCheck,
  RotateCcw,
  ArrowUpDown,
  Eye,
  Download,
  Edit2,
  Archive,
  CheckCircle,
  Check,
  Plus,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { TeleFile } from "@/lib/types";
import { useFileStore } from "@/stores/fileStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileActions } from "@/hooks/useFileActions";
import { FileIcon } from "./FileIcon";
import { FileContextMenu } from "./FileContextMenu";
import { FileActionsMenu } from "./FileActionsMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { fuzzySearch } from "@/lib/search/searchEngine";
import { getFileCategory, getFileIconType } from "@/lib/files/fileUtils";
import { isEditableFile } from "@/lib/files/editableTypes";
import { useFileBrowserDragAndDrop } from "@/hooks/useFileBrowserDragAndDrop";

// ---------------------------------------------------------------------------
// Utility: human-readable file size
// ---------------------------------------------------------------------------
function formatFileSize(bytes: unknown): string {
  const n = Number(bytes);
  if (!n || !isFinite(n) || n <= 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// ---------------------------------------------------------------------------
// Utility: human-readable file type
// ---------------------------------------------------------------------------
function getFileType(file: TeleFile): string {
  const isDir = isDirectory(file);
  if (isDir) return "Folder";
  
  const ext = file.name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "PDF Document";
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
    case "gif":
    case "svg":
      return "Image";
    case "mp4":
    case "mkv":
    case "mov":
    case "avi":
    case "webm":
      return "Video";
    case "mp3":
    case "wav":
    case "m4a":
    case "ogg":
    case "flac":
      return "Audio";
    case "txt":
    case "md":
    case "rtf":
      return "Text Document";
    case "zip":
    case "tar":
    case "gz":
    case "rar":
    case "7z":
      return "Archive";
    case "doc":
    case "docx":
      return "Word Document";
    case "xls":
    case "xlsx":
    case "csv":
      return "Spreadsheet";
    case "ppt":
    case "pptx":
      return "Presentation";
    case "html":
    case "css":
    case "js":
    case "ts":
    case "tsx":
    case "json":
    case "py":
    case "rs":
    case "go":
    case "c":
    case "cpp":
      return "Source Code";
    default:
      return ext ? `${ext.toUpperCase()} File` : "File";
  }
}

function isDirectory(file: TeleFile): boolean {
  return file.mime === "inode/directory" || file.mime === "application/x-directory";
}

// Stable empty array reference — used as a fallback for `indexedFiles` so
// consumers (and React deps) see the SAME identity on every render instead
// of allocating a fresh `[]` each time. Avoids spurious downstream re-runs.
const EMPTY_FILES: readonly TeleFile[] = Object.freeze([]) as readonly TeleFile[];


const fileHoverStyles: Record<string, string> = {
  image: "hover:border-rose-300/80 dark:hover:border-rose-800/60 hover:shadow-[0_10px_20px_-10px_rgba(244,63,94,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(244,63,94,0.35)]",
  video: "hover:border-purple-300/80 dark:hover:border-purple-800/60 hover:shadow-[0_10px_20px_-10px_rgba(168,85,247,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(168,85,247,0.35)]",
  audio: "hover:border-amber-300/80 dark:hover:border-amber-800/60 hover:shadow-[0_10px_20px_-10px_rgba(245,158,11,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(245,158,11,0.35)]",
  pdf: "hover:border-red-300/80 dark:hover:border-red-800/60 hover:shadow-[0_10px_20px_-10px_rgba(239,68,68,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(239,68,68,0.35)]",
  spreadsheet: "hover:border-emerald-300/80 dark:hover:border-emerald-800/60 hover:shadow-[0_10px_20px_-10px_rgba(16,185,129,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(16,185,129,0.35)]",
  document: "hover:border-blue-300/80 dark:hover:border-blue-800/60 hover:shadow-[0_10px_20px_-10px_rgba(59,130,246,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(59,130,246,0.35)]",
  presentation: "hover:border-orange-300/80 dark:hover:border-orange-800/60 hover:shadow-[0_10px_20px_-10px_rgba(249,115,22,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(249,115,22,0.35)]",
  code: "hover:border-indigo-300/80 dark:hover:border-indigo-800/60 hover:shadow-[0_10px_20px_-10px_rgba(99,102,241,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(99,102,241,0.35)]",
  archive: "hover:border-yellow-300/80 dark:hover:border-yellow-800/60 hover:shadow-[0_10px_20px_-10px_rgba(234,179,8,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(234,179,8,0.35)]",
  file: "hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-[0_10px_20px_-10px_rgba(148,163,184,0.25)] dark:hover:shadow-[0_10px_20px_-10px_rgba(148,163,184,0.35)]",
};

interface FileBrowserProps {
  folderPath?: string;
  mode?: "drive" | "starred" | "recent" | "trash" | "search" | "archived";
  searchQuery?: string;
}

export function FileBrowser({ folderPath = "/", mode = "drive", searchQuery = "" }: FileBrowserProps) {
  const navigate = useNavigate();
  const files = useFileStore((state) => state.files);
  const selectedIds = useFileStore((state) => state.selectedIds);
  const selectedIdsSet = useFileStore((state) => state.selectedIdsSet);
  const isLoading = useFileStore((state) => state.isLoading);
  const setFolder = useFileStore((state) => state.setFolder);
  const toggleSelect = useFileStore((state) => state.toggleSelect);
  const setSelectedIds = useFileStore((state) => state.setSelectedIds);
  const clearSelection = useFileStore((state) => state.clearSelection);

  const {
    viewMode,
    setViewMode,
    sortBy,
    setSortBy,
    filterType,
    setFilterType,
  } = useUIStore();
  const {
    createFolder,
    renameFile,
    toggleStar,
    moveToTrash,
    restoreFromTrash,
    archiveFile,
    unarchiveFile,
    deletePermanently,
    emptyTrash,
    isOperating,
    moveMultipleToTrash,
    restoreMultipleFromTrash,
    deleteMultiplePermanently,
    toggleOffline,
    moveMultipleFilesOrFolders,
  } = useFileActions();

  const isMobile = useIsMobile();
  const touchTimeoutRef = useRef<any>(null);
  const [mobileContextFile, setMobileContextFile] = useState<TeleFile | null>(null);

  const {
    dragOverId,
    draggedId,
    internalDrag,
    isDraggingActive,
    suppressClickRef,
    handlePointerDown,
    handleDragOverCard,
    handleDrop,
    handleGlobalDragOver,
    handleGlobalDrop,
  } = useFileBrowserDragAndDrop({
    files,
    folderPath,
    isMobile,
    selectedIds,
    selectedIdsSet,
    clearSelection,
    moveMultipleFilesOrFolders,
  });

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TeleFile | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [emptyTrashDialogOpen, setEmptyTrashDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeleFile | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Update current folder path in store on mount/change
  useEffect(() => {
    if (mode === "drive") {
      const currentFolder = useFileStore.getState().currentFolder;
      if (currentFolder !== folderPath) {
        setFolder(folderPath);
      }
    }
  }, [folderPath, mode, setFolder]);

  // ── Memoized derived data ───────────────────────────────────────────────

  const sortLabel = useMemo(() => {
    switch (sortBy) {
      case "name_asc": return "Name (A-Z)";
      case "name_desc": return "Name (Z-A)";
      case "date_desc": return "Newest";
      case "date_asc": return "Oldest";
      case "size_desc": return "Largest";
      case "size_asc": return "Smallest";
      default: return "Name (A-Z)";
    }
  }, [sortBy]);

  const activeSortBy = useMemo(
    () => (mode === "recent" && sortBy === "name_asc" ? "date_desc" : sortBy),
    [mode, sortBy],
  );

  const activeFiles = useMemo(
    () => files.filter((file) => !file.trashed && !file.archived),
    [files],
  );

  const folderEntriesIndex = useMemo(() => {
    const index = new Map<string, TeleFile[]>();
    for (const file of activeFiles) {
      const bucket = index.get(file.folderPath);
      if (bucket) {
        bucket.push(file);
      } else {
        index.set(file.folderPath, [file]);
      }
    }
    return index;
  }, [activeFiles]);

  // Compute ONLY the slice that the current `mode` actually needs.
// Previously this allocated four filtered arrays eagerly (starred/recent/
// archived/trash) on every render, costing 3×O(N) wasted work when only
// one of them was being read by `displayFiles`. Now we compute exactly
// one slice — and we only pay for folderEntriesIndex.get(folderPath) when
// the user is on a drive/folder view.
  const indexedFiles = useMemo(() => {
    switch (mode) {
      case "drive":
        return folderEntriesIndex.get(folderPath) ?? EMPTY_FILES;
      case "starred":
        return activeFiles.filter((file) => file.starred);
      case "recent":
        return activeFiles;
      case "trash":
        return files.filter((file) => file.trashed);
      case "archived":
        return files.filter((file) => file.archived && !file.trashed);
      default:
        // search mode — fuzzySearch handles its own filtering; pass activeFiles.
        return activeFiles;
    }
  }, [mode, folderEntriesIndex, folderPath, activeFiles, files]);

  // Full filtered + sorted display list — optimized for folder navigation
  const { displayFiles, folders, regularFiles } = useMemo(() => {
    let filtered: TeleFile[];

    if (mode === "search") {
      filtered = fuzzySearch(activeFiles, searchQuery);
    } else {
      // Always copy before sorting so we never mutate the bucket arrays
      // inside folderEntriesIndex (which are themselves memoized; mutating
      // them silently corrupts the cache for the next render).
      filtered = [...indexedFiles];
    }

    const visibleFiles =
      filterType === "All"
        ? filtered
        : filtered.filter((f) => !isDirectory(f) && getFileCategory(f.name, f.mime) === filterType);

    visibleFiles.sort((a, b) => {
      const aIsDir = isDirectory(a);
      const bIsDir = isDirectory(b);
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      switch (activeSortBy) {
        case "name_asc": return a.name.localeCompare(b.name);
        case "name_desc": return b.name.localeCompare(a.name);
        case "date_asc": return (a.lastOpenedAt || a.uploadedAt) - (b.lastOpenedAt || b.uploadedAt);
        case "date_desc": return (b.lastOpenedAt || b.uploadedAt) - (a.lastOpenedAt || a.uploadedAt);
        case "size_asc": return a.size - b.size;
        case "size_desc": return b.size - a.size;
        default: return a.name.localeCompare(b.name);
      }
    });

    const nextFolders: TeleFile[] = [];
    const nextRegularFiles: TeleFile[] = [];
    for (const file of visibleFiles) {
      if (isDirectory(file)) {
        nextFolders.push(file);
      } else {
        nextRegularFiles.push(file);
      }
    }

    return {
      displayFiles: visibleFiles,
      folders: nextFolders,
      regularFiles: nextRegularFiles,
    };
  }, [activeFiles, activeSortBy, filterType, indexedFiles, mode, searchQuery]);

  // Breadcrumbs — only recompute when folderPath changes
  const breadcrumbs = useMemo(() => {
    if (folderPath === "/") return [];
    const segments = folderPath.split("/").filter(Boolean);
    let accumPath = "";
    return segments.map((seg) => {
      accumPath += `/${seg}`;
      return { name: seg, link: `/drive/folder${accumPath}` };
    });
  }, [folderPath]);

  // Header title — only recompute when mode/folderPath/searchQuery change
  const headerTitle = useMemo(() => {
    switch (mode) {
      case "starred": return "Starred";
      case "recent": return "Recent";
      case "trash": return "Trash";
      case "archived": return "Archived";
      case "search": return `Search results for "${searchQuery}"`;
      default:
        if (folderPath !== "/") {
          const segments = folderPath.split("/").filter(Boolean);
          return segments[segments.length - 1] || "My Drive";
        }
        return "My Drive";
    }
  }, [mode, folderPath, searchQuery]);

  // ── Memoized callbacks ──────────────────────────────────────────────────

  const toastPreview = useCallback((file: TeleFile) => {
    window.dispatchEvent(new CustomEvent("teledrive-preview-file", { detail: file }));
  }, []);

  const handleEdit = useCallback((file: TeleFile) => {
    window.dispatchEvent(new CustomEvent("teledrive-edit-file", { detail: file }));
  }, []);

  const handleDownload = useCallback((file: TeleFile) => {
    window.dispatchEvent(new CustomEvent("teledrive-download-file", { detail: file }));
  }, []);

  const triggerUpload = useCallback(() => {
    window.dispatchEvent(new CustomEvent("teledrive-trigger-upload"));
  }, []);

  const triggerFolderUpload = useCallback(() => {
    window.dispatchEvent(new CustomEvent("teledrive-trigger-folder-upload"));
  }, []);

  const handleItemClick = useCallback((e: React.MouseEvent, file: TeleFile) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
    }
    toggleSelect(file.id);
  }, [toggleSelect]);

  const handleItemDoubleClick = useCallback((file: TeleFile) => {
    if (suppressClickRef.current) return;
    const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
    if (isDir) {
      clearSelection();
      navigate(`/drive/folder${file.folderPath === "/" ? "" : file.folderPath}/${file.name}`);
    } else {
      toastPreview(file);
    }
  }, [clearSelection, navigate, toastPreview]);

  // Dialog actions
  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFolderName.trim()) {
      createFolder(newFolderName);
      setNewFolderName("");
      setCreateDialogOpen(false);
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renameTarget && newFileName.trim()) {
      renameFile(renameTarget.id, newFileName);
      setNewFileName("");
      setRenameTarget(null);
      setRenameDialogOpen(false);
    }
  };

  const openRenameDialog = useCallback((file: TeleFile) => {
    setRenameTarget(file);
    setNewFileName(file.name);
    setRenameDialogOpen(true);
  }, []);

  // Listen to keyboard shortcut events
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const file = (e as CustomEvent).detail as TeleFile;
      if (file) {
        openRenameDialog(file);
      }
    };
    
    const handleDeleteSelected = () => {
      if (selectedIds.length > 0) {
        setBulkDeleteDialogOpen(true);
      }
    };

    const handleCreateFolderTrigger = () => {
      setCreateDialogOpen(true);
    };

    window.addEventListener("teledrive-rename-file-event", handleRenameEvent);
    window.addEventListener("teledrive-delete-selected", handleDeleteSelected);
    window.addEventListener("teledrive-trigger-create-folder", handleCreateFolderTrigger);
    return () => {
      window.removeEventListener("teledrive-rename-file-event", handleRenameEvent);
      window.removeEventListener("teledrive-delete-selected", handleDeleteSelected);
      window.removeEventListener("teledrive-trigger-create-folder", handleCreateFolderTrigger);
    };
  }, [openRenameDialog, deletePermanently, selectedIds, clearSelection]);

  const handleTouchStartItem = (file: TeleFile) => {
    if (!isMobile) return;
    if (touchTimeoutRef.current) window.clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = window.setTimeout(() => {
      setMobileContextFile(file);
    }, 600);
  };

  const handleTouchEndItem = () => {
    if (touchTimeoutRef.current) {
      window.clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }
  };

  // Bulk actions
  const handleBulkTrash = async () => {
    await moveMultipleToTrash(selectedIds);
    clearSelection();
  };

  const handleBulkRestore = async () => {
    await restoreMultipleFromTrash(selectedIds);
    clearSelection();
  };

  const handleBulkDelete = () => {
    setBulkDeleteDialogOpen(true);
  };

  const confirmBulkDelete = async () => {
    setBulkDeleteDialogOpen(false);
    await deleteMultiplePermanently(selectedIds);
    clearSelection();
  };

  // Render helpers (headerTitle is now memoized above)

  const renderEmptyState = () => {
    let title = "Your drive is empty";
    let subtitle = "Upload files or create folders to get started.";
    let Icon = FolderOpen;

    if (mode === "starred") {
      title = "No starred files";
      subtitle = "Add stars to files you want to find easily later.";
      Icon = Star;
    } else if (mode === "recent") {
      title = "No recent files";
      subtitle = "Files you've recently viewed or uploaded will appear here.";
      Icon = FileCheck;
    } else if (mode === "trash") {
      title = "Trash is empty";
      subtitle = "Items moved to the trash will show up here.";
      Icon = Trash2;
    } else if (mode === "archived") {
      title = "No archived files";
      subtitle = "Archive files you want to keep but don't need in your main drive.";
      Icon = Archive;
    } else if (mode === "search") {
      title = "No search results";
      subtitle = `We couldn't find any items matching "${searchQuery}".`;
      Icon = FolderOpen;
    } else if (folderPath !== "/") {
      title = "This folder is empty";
      subtitle = "Upload files or create folders in this directory.";
      Icon = Folder;
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto animate-slide-up-fade">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-brand-100/40 dark:bg-brand-950/20 blur-xl rounded-full scale-150 animate-pulse" />
          <Icon className="relative h-16 w-16 text-brand-500/80 stroke-[1.5]" />
        </div>

        <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
          {title}
        </h3>

        <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
          {subtitle}
        </p>

        {mode === "drive" && (
          <div className="flex gap-3 justify-center">
            <Button
              onClick={triggerUpload}
              className="rounded-xl bg-brand-500 hover:bg-brand-600 font-semibold px-5 text-sm shadow-sm"
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(true)}
              className="rounded-xl font-semibold px-5 text-sm border-slate-200 dark:border-slate-800"
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col h-full p-4 md:p-6 lg:p-8 space-y-6", isDraggingActive && "dragging-active")}>
      {/* File Browser Header Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-slate-200 dark:border-slate-800/60 pb-4 shrink-0">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-850 dark:text-slate-100">
            {headerTitle}
          </h1>
          {mode === "drive" && breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 overflow-x-auto whitespace-nowrap py-1">
              <Link
                to="/drive/my-drive"
                onClick={clearSelection}
                onDragOver={(e) => handleDragOverCard(e, "crumb_home")}
                onDrop={(e) => handleDrop(e, "/")}
                data-drop-path="/"
                className={cn(
                  "flex items-center gap-1 hover:text-brand-500 transition-colors font-medium text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-md transition-all",
                  isDraggingActive && "pointer-events-none-children",
                  dragOverId === "crumb_home" && "bg-brand-500/10 text-brand-600 dark:text-brand-400 ring-2 ring-brand-500/20"
                )}
              >
                <Home className="h-3.5 w-3.5 shrink-0" />
                <span>My Drive</span>
              </Link>

              {breadcrumbs.map((crumb, idx) => (
                <div key={crumb.link} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />
                  {idx === breadcrumbs.length - 1 ? (
                    <span className="font-bold text-slate-800 dark:text-slate-200 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80">
                      {crumb.name}
                    </span>
                  ) : (
                      <Link
                        to={crumb.link}
                        onClick={clearSelection}
                        onDragOver={(e) => handleDragOverCard(e, `crumb_${crumb.link}`)}
                        onDrop={(e) => {
                          const targetPath = crumb.link.substring("/drive/folder".length);
                          handleDrop(e, targetPath);
                        }}
                        data-drop-path={crumb.link.substring("/drive/folder".length) || "/"}
                        className={cn(
                          "hover:text-brand-500 transition-colors font-semibold text-slate-650 dark:text-slate-400 px-1.5 py-0.5 rounded-md transition-all",
                          isDraggingActive && "pointer-events-none-children",
                        dragOverId === `crumb_${crumb.link}` && "bg-brand-500/10 text-brand-600 dark:text-brand-400 ring-2 ring-brand-500/20"
                      )}
                    >
                      {crumb.name}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto sm:mt-1">
          {mode === "drive" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateDialogOpen(true)}
                className="h-8.5 rounded-xl text-xs gap-1.5 font-semibold border-slate-200 dark:border-slate-800"
              >
                <FolderPlus className="h-3.5 w-3.5 text-brand-500" />
                <span>New Folder</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    className="h-8.5 rounded-xl text-xs bg-brand-500 hover:bg-brand-600 font-semibold gap-1.5 text-white shadow-sm cursor-pointer border-0"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-xl p-1 bg-white dark:bg-slate-900 border dark:border-slate-200 dark:border-slate-800 shadow-lg">
                  <DropdownMenuItem
                    onClick={triggerUpload}
                    className="rounded-lg text-xs font-semibold px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Upload className="mr-2 h-3.5 w-3.5 text-blue-500" />
                    Upload Files
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={triggerFolderUpload}
                    className="rounded-lg text-xs font-semibold px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Folder className="mr-2 h-3.5 w-3.5 text-amber-500" />
                    Upload Folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {mode === "trash" && displayFiles.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEmptyTrashDialogOpen(true)}
              className="h-8.5 rounded-xl text-xs border-red-200 text-red-600 dark:border-red-950 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 font-semibold"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Empty Trash
            </Button>
          )}

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block" />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="h-8.5 w-8.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
            title={viewMode === "grid" ? "List View" : "Grid View"}
          >
            {viewMode === "grid" ? (
              <List className="h-4.5 w-4.5 text-slate-600 dark:text-slate-400" />
            ) : (
              <Grid className="h-4.5 w-4.5 text-slate-600 dark:text-slate-400" />
            )}
          </Button>
        </div>
      </div>

      {/* Filters and Sorting Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-1.5 shrink-0 select-none">
        {/* Category Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth py-1 max-w-full">
          {["All", "Documents", "Images", "Videos", "Audio"].map((filter) => {
            const isActive = filterType === filter;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => setFilterType(filter)}
                className={cn(
                  "px-3.5 py-1.5 text-xs font-bold rounded-full border transition-all duration-200 cursor-pointer whitespace-nowrap active:scale-95",
                  isActive
                    ? "bg-brand-500 text-white border-brand-500 shadow-xs dark:bg-brand-500/20 dark:text-brand-400 dark:border-brand-500/30"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-muted-foreground hover:border-slate-300 dark:hover:border-slate-700 hover:text-foreground hover:shadow-xs"
                )}
              >
                {filter}
              </button>
            );
          })}
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 px-3 flex items-center gap-1.5"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span>Sort: {sortLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 rounded-xl p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md z-50"
            >
              {[
                { value: "name_asc", label: "Name (A to Z)" },
                { value: "name_desc", label: "Name (Z to A)" },
                { value: "date_desc", label: "Newest uploaded" },
                { value: "date_asc", label: "Oldest uploaded" },
                { value: "size_desc", label: "Size (largest)" },
                { value: "size_asc", label: "Size (smallest)" },
              ].map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setSortBy(opt.value)}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 text-xs rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-700 dark:text-slate-200",
                    sortBy === opt.value && "font-bold text-brand-600 dark:text-brand-400 bg-brand-50/50 dark:bg-brand-950/10"
                  )}
                >
                  <span>{opt.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Files Display Area */}
      {isLoading ? (
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 overflow-y-auto">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-3 animate-pulse space-y-3"
            >
              <div className="h-10 w-10 bg-slate-200 dark:bg-slate-800 rounded-xl" />
              <div className="space-y-1.5">
                <div className="h-3 w-3/4 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-2 w-1/2 bg-slate-200 dark:bg-slate-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : displayFiles.length === 0 ? (
        renderEmptyState()
      ) : viewMode === "grid" ? (
        /* GRID VIEW */
        <div
          className="flex-1 overflow-y-auto min-h-0 select-none pb-20 pr-1 space-y-8"
          onDragOver={handleGlobalDragOver}
          onDrop={handleGlobalDrop}
        >
          {/* Folders Section */}
          {folders.length > 0 && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                Folders
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 px-1 py-1 overflow-visible">
                {folders.map((folder, index) => {
                  const isSelected = selectedIdsSet.has(folder.id);
                  const isBeingDragged = draggedId !== null && (draggedId === folder.id || (isSelected && selectedIdsSet.has(draggedId)));
                  return (
                    <FileContextMenu
                      key={folder.id}
                      file={folder}
                      onPreview={toastPreview}
                      onEdit={handleEdit}
                      onDownload={handleDownload}
                      onRename={openRenameDialog}
                      onStarToggle={toggleStar}
                      onTrash={moveToTrash}
                      onDeletePermanently={setDeleteTarget}
                      onArchive={archiveFile}
                      onUnarchive={unarchiveFile}
                    >
                      <div
                        onClick={(e) => handleItemClick(e, folder)}
                        onDoubleClick={() => handleItemDoubleClick(folder)}
                        onMouseDown={(e) => handlePointerDown(e, folder, "folder-grid")}
                        onTouchStart={() => handleTouchStartItem(folder)}
                        onTouchEnd={handleTouchEndItem}
                        onTouchMove={handleTouchEndItem}
                        data-folder-id={folder.id}
                        style={{ animationDelay: `${Math.min(index, 15) * 20}ms` }}
                        className={cn(
                          "group relative flex items-center justify-between gap-3 p-3.5 pr-3.5 rounded-xl border transition-all duration-300 ease-out cursor-pointer hover:-translate-y-0.5 select-none animate-slide-up-fade overflow-visible backdrop-blur-md",
                          isSelected
                            ? "border-brand-400 bg-brand-50/45 dark:border-brand-500/80 dark:bg-brand-950/18 shadow-[0_0_0_1px_rgba(76,141,246,0.35),0_10px_24px_-18px_rgba(26,115,232,0.55)]"
                            : dragOverId === folder.id
                            ? "border-brand-500 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-950/24 shadow-[0_0_0_2px_rgba(26,115,232,0.16),0_14px_28px_-18px_rgba(26,115,232,0.65)] -translate-y-0.5"
                            : "border-slate-200/60 dark:border-slate-800/50 bg-white/60 dark:bg-slate-900/20 hover:border-brand-300 dark:hover:border-brand-800/80 hover:bg-white/80 dark:hover:bg-slate-900/40 hover:shadow-[0_10px_20px_-10px_rgba(26,115,232,0.18)]",
                          isBeingDragged && "opacity-40"
                        )}
                      >
                        {/* Drop-target "+" badge — only visible while dragging over this folder */}
                        {dragOverId === folder.id && isDraggingActive && (
                          <span className="absolute -right-2.5 -top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 shadow-[0_10px_22px_-12px_rgba(26,115,232,0.85)] ring-4 ring-white dark:ring-slate-900 pointer-events-none animate-folder-drop-badge">
                            <Plus className="h-3.5 w-3.5 text-white" />
                          </span>
                        )}
                        <div className="flex items-center gap-3 min-w-0 flex-1 pointer-events-none">
                          <Folder className="h-5 w-5 text-brand-500 fill-brand-500/10 shrink-0 stroke-[1.5] transition-transform duration-300 ease-out group-hover:scale-110" />
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                            {folder.name}
                          </span>
                        </div>
                        <div className="shrink-0 ml-auto" data-no-drag onClick={(e) => e.stopPropagation()}>
                          <FileActionsMenu
                            file={folder}
                            onPreview={toastPreview}
                            onEdit={handleEdit}
                            onDownload={handleDownload}
                            onRename={openRenameDialog}
                            onStarToggle={toggleStar}
                            onTrash={moveToTrash}
                            onDeletePermanently={setDeleteTarget}
                            onArchive={archiveFile}
                            onUnarchive={unarchiveFile}
                          />
                        </div>
                      </div>
                    </FileContextMenu>
                  );
                })}
              </div>
            </div>
          )}

          {/* Files Section */}
          {regularFiles.length > 0 && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                Files
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {regularFiles.map((file, index) => {
                  const isSelected = selectedIdsSet.has(file.id);
                  const iconType = getFileIconType(file.name, file.mime);
                  const hoverClass = fileHoverStyles[iconType] || fileHoverStyles.file;
                  return (
                    <FileContextMenu
                      key={file.id}
                      file={file}
                      onPreview={toastPreview}
                      onEdit={handleEdit}
                      onDownload={handleDownload}
                      onRename={openRenameDialog}
                      onStarToggle={toggleStar}
                      onTrash={moveToTrash}
                      onDeletePermanently={setDeleteTarget}
                      onArchive={archiveFile}
                      onUnarchive={unarchiveFile}
                      onOfflineToggle={toggleOffline}
                    >
                      <div
                        onClick={(e) => handleItemClick(e, file)}
                        onDoubleClick={() => handleItemDoubleClick(file)}
                        onMouseDown={(e) => handlePointerDown(e, file, "file-grid")}
                        onTouchStart={() => handleTouchStartItem(file)}
                        onTouchEnd={handleTouchEndItem}
                        onTouchMove={handleTouchEndItem}
                        style={{ animationDelay: `${Math.min(folders.length + index, 15) * 20}ms` }}
                        className={cn(
                          "group relative flex flex-col rounded-2xl border transition-all duration-300 ease-out cursor-pointer overflow-hidden text-left hover:-translate-y-0.5 select-none h-44 animate-slide-up-fade backdrop-blur-md",
                          isSelected
                            ? "border-brand-500 bg-brand-50/45 dark:border-brand-500/80 dark:bg-brand-950/20 shadow-[0_0_0_1px_rgba(76,141,246,0.35),0_10px_24px_-18px_rgba(26,115,232,0.55)]"
                            : cn(
                                "border-slate-200/60 dark:border-slate-800/50 bg-white/60 dark:bg-slate-900/20 hover:bg-white/80 dark:hover:bg-slate-900/40",
                                hoverClass
                              ),
                          (draggedId !== null && (draggedId === file.id || (isSelected && selectedIdsSet.has(draggedId)))) && "opacity-40"
                        )}
                      >
                        {/* Upper icon/preview box */}
                        <div className="flex-1 bg-slate-50/20 dark:bg-slate-950/20 flex items-center justify-center p-4 relative border-b border-slate-100/60 dark:border-slate-800/30 pointer-events-none">
                          <FileIcon name={file.name} mime={file.mime} size="lg" />
                          {file.starred && (
                            <Star className="absolute top-2 right-2 h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          )}
                          {file.offline && (
                            <CheckCircle className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-green-500 fill-green-500/20 dark:fill-green-950/30 shrink-0" />
                          )}
                        </div>

                        {/* Lower text & action menu info */}
                        <div className="p-3 pr-2 relative bg-white/40 dark:bg-slate-950/25 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1 pointer-events-none">
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                              {file.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {formatFileSize(file.size)}
                            </p>
                          </div>
                          <div className="shrink-0" data-no-drag onClick={(e) => e.stopPropagation()}>
                          <FileActionsMenu
                            file={file}
                            onPreview={toastPreview}
                            onEdit={handleEdit}
                            onDownload={handleDownload}
                            onRename={openRenameDialog}
                            onStarToggle={toggleStar}
                            onTrash={moveToTrash}
                            onDeletePermanently={setDeleteTarget}
                            onArchive={archiveFile}
                            onUnarchive={unarchiveFile}
                            onOfflineToggle={toggleOffline}
                          />
                          </div>
                        </div>
                      </div>
                    </FileContextMenu>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* LIST VIEW */
        <div
          className="flex-1 overflow-y-auto min-h-0 select-none pb-20 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 shadow-xs"
          onDragOver={handleGlobalDragOver}
          onDrop={handleGlobalDrop}
        >
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-150 dark:border-slate-800 text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none bg-slate-50/50 dark:bg-slate-950/20">
                <th className="py-3.5 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === displayFiles.length && displayFiles.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(displayFiles.map((f) => f.id));
                      } else {
                        clearSelection();
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-500 focus:ring-brand-500/30 dark:bg-slate-950 transition-colors cursor-pointer"
                  />
                </th>
                <th className="py-3.5 px-4 font-extrabold">Name</th>
                <th className="py-3.5 px-4 hidden sm:table-cell font-extrabold">Type</th>
                <th className="py-3.5 px-4 hidden md:table-cell font-extrabold">Size</th>
                <th className="py-3.5 px-4 hidden lg:table-cell font-extrabold">Last Modified</th>
                <th className="py-3.5 px-4 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {displayFiles.map((file, index) => {
                const isSelected = selectedIdsSet.has(file.id);
                const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
                
                return (
                  <FileContextMenu
                    key={file.id}
                    file={file}
                    onPreview={toastPreview}
                    onEdit={handleEdit}
                    onDownload={handleDownload}
                    onRename={openRenameDialog}
                    onStarToggle={toggleStar}
                    onTrash={moveToTrash}
                    onDeletePermanently={setDeleteTarget}
                    onArchive={archiveFile}
                    onUnarchive={unarchiveFile}
                    onOfflineToggle={toggleOffline}
                  >
                    <tr
                      onClick={(e) => handleItemClick(e, file)}
                      onDoubleClick={() => handleItemDoubleClick(file)}
                      onMouseDown={(e) => handlePointerDown(e, file, "list-row")}
                      onTouchStart={() => handleTouchStartItem(file)}
                      onTouchEnd={handleTouchEndItem}
                      onTouchMove={handleTouchEndItem}
                      {...(isDir ? { 'data-folder-id': file.id } : {})}
                      style={{ animationDelay: `${Math.min(index, 15) * 20}ms` }}
                      className={cn(
                        "group border-b border-slate-100 dark:border-slate-800/45 hover:bg-slate-50/75 dark:hover:bg-slate-800/10 cursor-pointer transition-all duration-150 animate-slide-up-fade",
                        isSelected && "bg-brand-50/40 dark:bg-brand-950/15",
                        dragOverId === file.id && isDir && "bg-brand-50/70 dark:bg-brand-950/30 border-brand-500 border-2",
                        (draggedId !== null && (draggedId === file.id || (isSelected && selectedIdsSet.has(draggedId)))) && "opacity-40"
                      )}
                    >
                      <td className="py-3 px-4 text-center" data-no-drag onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(file.id)}
                          className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-500 focus:ring-brand-500/30 dark:bg-slate-950 transition-colors cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200 text-xs">
                        <div className="flex items-center gap-3 pointer-events-none">
                          <FileIcon name={file.name} mime={file.mime} size="sm" className="shrink-0" />
                          <span className="truncate max-w-[200px] sm:max-w-xs">{file.name}</span>
                          {file.starred && (
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0 ml-0.5" />
                          )}
                          {file.offline && (
                            <CheckCircle className="h-3.5 w-3.5 text-green-500 fill-green-500/20 dark:fill-green-950/30 shrink-0 ml-0.5" />
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell text-xs text-slate-550 dark:text-slate-400 pointer-events-none">
                        {getFileType(file)}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-xs text-slate-500 dark:text-slate-400 pointer-events-none">
                        {isDir ? "—" : formatFileSize(file.size)}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell text-xs text-slate-500 dark:text-slate-400 pointer-events-none">
                        {new Date(file.uploadedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-center" data-no-drag onClick={(e) => e.stopPropagation()}>
                        <FileActionsMenu
                          file={file}
                          onPreview={toastPreview}
                          onEdit={handleEdit}
                          onDownload={handleDownload}
                          onRename={openRenameDialog}
                          onStarToggle={toggleStar}
                          onTrash={moveToTrash}
                          onDeletePermanently={setDeleteTarget}
                          onArchive={archiveFile}
                          onUnarchive={unarchiveFile}
                          onOfflineToggle={toggleOffline}
                        />
                      </td>
                    </tr>
                  </FileContextMenu>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {internalDrag && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-50 pointer-events-none rounded-2xl shadow-2xl"
          style={{
            left: internalDrag.x - internalDrag.offsetX,
            top: internalDrag.y - internalDrag.offsetY,
            width: internalDrag.width,
            height: internalDrag.height,
          }}
        >
          {internalDrag.previewVariant === "folder-grid" ? (
            <div className="h-full rounded-xl border border-brand-200/90 bg-white/96 dark:border-slate-700/90 dark:bg-slate-900/96 backdrop-blur-md px-3.5 pr-3.5 flex items-center justify-between gap-3 shadow-[0_16px_32px_-20px_rgba(15,23,42,0.45)]">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Folder className="h-5 w-5 text-brand-500 fill-brand-500/10 shrink-0 stroke-[1.5]" />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                  {internalDrag.previewFile.name}
                </span>
              </div>
              <MoreHorizontal className="h-4 w-4 text-slate-400 shrink-0" />
            </div>
          ) : internalDrag.previewVariant === "list-row" ? (
            <div className="h-full rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white/96 dark:bg-slate-900/96 backdrop-blur-md flex items-center gap-3 px-4 shadow-[0_16px_32px_-20px_rgba(15,23,42,0.45)]">
              <FileIcon
                name={internalDrag.previewFile.name}
                mime={internalDrag.previewFile.mime}
                size="sm"
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {internalDrag.previewFile.name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {internalDrag.ids.length > 1 ? `${internalDrag.ids.length} items` : formatFileSize(internalDrag.previewFile.size)}
                </p>
              </div>
              <MoreHorizontal className="h-4 w-4 text-slate-400 shrink-0" />
            </div>
          ) : (
            <div className="h-full rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white/96 dark:bg-slate-950/96 backdrop-blur-md overflow-hidden shadow-[0_20px_40px_-24px_rgba(15,23,42,0.5)]">
              <div className="flex-1 h-[calc(100%-51px)] min-h-0 bg-slate-50/70 dark:bg-slate-900/40 flex items-center justify-center p-4 border-b border-slate-100 dark:border-slate-800/50">
                <FileIcon name={internalDrag.previewFile.name} mime={internalDrag.previewFile.mime} size="lg" />
              </div>
              <div className="h-[51px] px-3 py-2.5 bg-white/96 dark:bg-slate-950/96">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                  {internalDrag.previewFile.name}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {internalDrag.ids.length > 1 ? `${internalDrag.ids.length} items` : formatFileSize(internalDrag.previewFile.size)}
                </p>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* Floating Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-4 bg-white/95 dark:bg-slate-950/95 text-slate-800 dark:text-slate-100 px-5 py-2.5 rounded-full shadow-2xl border border-slate-200 dark:border-slate-800/80 backdrop-blur-md animate-slide-up select-none">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-extrabold bg-brand-500 px-2.5 py-0.5 rounded-full text-white">{selectedIds.length}</span>
            <span className="text-xs font-bold whitespace-nowrap text-slate-750 dark:text-slate-200">Selected</span>
          </div>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
          
          <div className="flex items-center gap-1.5">
            {mode === "trash" ? (
              <>
                <button
                  type="button"
                  onClick={handleBulkRestore}
                  className="h-8.5 w-8.5 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-brand-500 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-slate-900/60 transition-all duration-150 active:scale-95 cursor-pointer border-0 bg-transparent outline-none"
                  title="Restore selected"
                >
                  <RotateCcw className="h-4.5 w-4.5" />
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  className="h-8.5 w-8.5 rounded-full flex items-center justify-center text-red-500 dark:text-red-400 hover:text-red-650 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all duration-150 active:scale-95 cursor-pointer border-0 bg-transparent outline-none"
                  title="Delete permanently"
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleBulkTrash}
                  className="h-8.5 w-8.5 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-red-550 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all duration-150 active:scale-95 cursor-pointer border-0 bg-transparent outline-none"
                  title="Move selected to trash"
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
              </>
            )}
            
            <button
              type="button"
              onClick={clearSelection}
              className="h-8.5 w-8.5 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-900/60 transition-all duration-150 active:scale-95 cursor-pointer border-0 bg-transparent outline-none"
              title="Clear selection"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      )}

      {/* dialog for creating folder */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">New Folder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateFolderSubmit} className="space-y-4 pt-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              autoFocus
              className="rounded-xl h-10"
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateDialogOpen(false)}
                className="rounded-xl h-10 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newFolderName.trim()}
                className="rounded-xl h-10 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold px-4"
              >
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* dialog for renaming file */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="rounded-2xl max-w-sm bg-white dark:bg-slate-900 border dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Rename Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-4 pt-2">
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="New name"
              autoFocus
              className="rounded-xl h-10"
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameDialogOpen(false)}
                className="rounded-xl h-10 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newFileName.trim()}
                className="rounded-xl h-10 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold px-4"
              >
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mobile Context Menu Bottom Sheet */}
      {isMobile && (
        <Sheet open={!!mobileContextFile} onOpenChange={(open) => !open && setMobileContextFile(null)}>
          <SheetContent side="bottom" className="rounded-t-2xl px-6 py-5 max-h-[420px] bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            {mobileContextFile && (
              <div className="space-y-4 select-none">
                <div className="flex items-center gap-3 border-b pb-3">
                  <FileIcon name={mobileContextFile.name} mime={mobileContextFile.mime} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                      {mobileContextFile.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {mobileContextFile.mime === "inode/directory" || mobileContextFile.mime === "application/x-directory"
                        ? "Folder"
                        : formatFileSize(mobileContextFile.size)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1 pb-6">
                  {mobileContextFile.mime !== "inode/directory" && mobileContextFile.mime !== "application/x-directory" && !mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        setMobileContextFile(null);
                        toastPreview(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Eye className="h-4 w-4 text-slate-500" />
                      <span>Preview</span>
                    </button>
                  )}
                  {mobileContextFile.mime !== "inode/directory" && mobileContextFile.mime !== "application/x-directory" && !mobileContextFile.trashed && isEditableFile(mobileContextFile) && (
                    <button
                      onClick={() => {
                        const f = mobileContextFile;
                        setMobileContextFile(null);
                        handleEdit(f);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Edit2 className="h-4 w-4 text-slate-500" />
                      <span>Edit</span>
                    </button>
                  )}
                  {mobileContextFile.mime !== "inode/directory" && mobileContextFile.mime !== "application/x-directory" && !mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        setMobileContextFile(null);
                        handleDownload(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      <span>Download</span>
                    </button>
                  )}
                  {mobileContextFile.mime !== "inode/directory" && mobileContextFile.mime !== "application/x-directory" && !mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        const f = mobileContextFile;
                        setMobileContextFile(null);
                        toggleOffline(f);
                      }}
                      className="flex items-center justify-between px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <div className="flex items-center gap-3">
                        <CheckCircle className={`h-4 w-4 ${mobileContextFile.offline ? "text-green-500 fill-green-500/20" : "text-slate-500"}`} />
                        <span>Available offline</span>
                      </div>
                      {mobileContextFile.offline && <Check className="h-4 w-4 text-green-500 shrink-0" />}
                    </button>
                  )}
                  {!mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        setMobileContextFile(null);
                        openRenameDialog(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Edit2 className="h-4 w-4 text-slate-500" />
                      <span>Rename</span>
                    </button>
                  )}
                  {!mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        setMobileContextFile(null);
                        toggleStar(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Star className={`h-4 w-4 ${mobileContextFile.starred ? "fill-amber-400 text-amber-400" : "text-slate-500"}`} />
                      <span>{mobileContextFile.starred ? "Remove from Starred" : "Add to Starred"}</span>
                    </button>
                  )}
                  {mobileContextFile.trashed ? (
                    <button
                      onClick={async () => {
                        setMobileContextFile(null);
                        await restoreFromTrash(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-semibold text-slate-700 dark:text-slate-200 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <RotateCcw className="h-4 w-4 text-slate-500" />
                      <span>Restore</span>
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        setMobileContextFile(null);
                        await moveToTrash(mobileContextFile);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20 text-left font-semibold text-red-600 dark:text-red-400 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Trash2 className="h-4 w-4 text-slate-500" />
                      <span>Move to Trash</span>
                    </button>
                  )}
                  {mobileContextFile.trashed && (
                    <button
                      onClick={() => {
                        const f = mobileContextFile;
                        setMobileContextFile(null);
                        setDeleteTarget(f);
                      }}
                      className="flex items-center gap-3 px-3 py-3 text-sm rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20 text-left font-semibold text-red-600 dark:text-red-400 border-0 cursor-pointer w-full bg-transparent"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Delete Permanently</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Empty Trash confirmation dialog (replaces window.confirm)           */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={emptyTrashDialogOpen} onOpenChange={setEmptyTrashDialogOpen}>
        <DialogContent className="rounded-2xl max-w-sm p-6 bg-white dark:bg-slate-900 border dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              Empty Trash
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">
            This will permanently delete <strong>{displayFiles.length} item{displayFiles.length !== 1 ? "s" : ""}</strong> from
            your Telegram storage channel. This action <strong>cannot be undone</strong>.
          </p>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs font-semibold"
              onClick={() => setEmptyTrashDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isOperating}
              className="rounded-xl text-xs font-semibold bg-red-500 hover:bg-red-600 text-white border-0"
              onClick={async () => {
                setEmptyTrashDialogOpen(false);
                await emptyTrash();
                clearSelection();
              }}
            >
              {isOperating ? "Deleting…" : "Delete All Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Individual item permanent delete confirmation dialog               */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="rounded-2xl max-w-sm p-6 bg-white dark:bg-slate-900 border dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              Delete Permanently
            </DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">
              Are you sure you want to permanently delete <strong>{deleteTarget.name}</strong>?
              {deleteTarget.mime !== "inode/directory" && deleteTarget.mime !== "application/x-directory" && (
                <> This will delete the actual file from your Telegram storage channel.</>
              )}
              This action <strong>cannot be undone</strong>.
            </p>
          )}
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs font-semibold"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isOperating}
              className="rounded-xl text-xs font-semibold bg-red-500 hover:bg-red-600 text-white border-0"
              onClick={async () => {
                if (deleteTarget) {
                  const targetId = deleteTarget.id;
                  setDeleteTarget(null);
                  await deletePermanently(targetId);
                }
              }}
            >
              {isOperating ? "Deleting…" : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ------------------------------------------------------------------ */}
      {/* Bulk permanent delete confirmation dialog                           */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <DialogContent className="rounded-2xl max-w-sm p-6 bg-white dark:bg-slate-900 border dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              Delete {selectedIds.length} Item{selectedIds.length !== 1 ? "s" : ""} Permanently
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">
            This will permanently delete <strong>{selectedIds.length} selected item{selectedIds.length !== 1 ? "s" : ""}</strong> from
            your Telegram storage channel. This action <strong>cannot be undone</strong>.
          </p>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs font-semibold"
              onClick={() => setBulkDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isOperating}
              className="rounded-xl text-xs font-semibold bg-red-500 hover:bg-red-600 text-white border-0"
              onClick={confirmBulkDelete}
            >
              {isOperating ? "Deleting…" : `Delete ${selectedIds.length} Item${selectedIds.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
