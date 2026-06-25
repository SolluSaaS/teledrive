import React, { useState, useEffect, useCallback, useRef } from "react";
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

interface FileBrowserProps {
  folderPath?: string;
  mode?: "drive" | "starred" | "recent" | "trash" | "search";
  searchQuery?: string;
}

export function FileBrowser({ folderPath = "/", mode = "drive", searchQuery = "" }: FileBrowserProps) {
  const navigate = useNavigate();
  const {
    files,
    selectedIds,
    isLoading,
    setFolder,
    toggleSelect,
    setSelectedIds,
    clearSelection,
  } = useFileStore();

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
    deletePermanently,
    emptyTrash,
    isOperating,
  } = useFileActions();

  const isMobile = useIsMobile();
  const touchTimeoutRef = useRef<any>(null);
  const [mobileContextFile, setMobileContextFile] = useState<TeleFile | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TeleFile | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [emptyTrashDialogOpen, setEmptyTrashDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeleFile | null>(null);

  // Update current folder path in store on mount/change
  useEffect(() => {
    if (mode === "drive") {
      setFolder(folderPath);
    }
  }, [folderPath, mode, setFolder]);

  // Helper to match file against category filter
  const matchFilter = (file: TeleFile, filter: string) => {
    if (filter === "All") return true;
    const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
    if (isDir) return false; // Hide folders when a media filter is active

    const m = file.mime.toLowerCase();
    switch (filter) {
      case "Documents":
        return (
          m.startsWith("text/") ||
          m.includes("document") ||
          m.includes("msword") ||
          m === "application/pdf" ||
          m.includes("spreadsheet") ||
          m.includes("excel") ||
          m === "text/csv" ||
          m.includes("presentation") ||
          m.includes("powerpoint") ||
          m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          m === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );
      case "Images":
        return m.startsWith("image/");
      case "Videos":
        return m.startsWith("video/");
      case "Audio":
        return m.startsWith("audio/");
      case "Archives":
        return (
          m.includes("zip") ||
          m.includes("tar") ||
          m.includes("rar") ||
          m.includes("gzip") ||
          m.includes("archive")
        );
      default:
        return true;
    }
  };

  const getSortLabel = (val: string) => {
    switch (val) {
      case "name_asc":
        return "Name (A-Z)";
      case "name_desc":
        return "Name (Z-A)";
      case "date_desc":
        return "Newest";
      case "date_asc":
        return "Oldest";
      case "size_desc":
        return "Largest";
      case "size_asc":
        return "Smallest";
      default:
        return "Name (A-Z)";
    }
  };

  // Filter and sort files based on active mode
  const getFilteredFiles = () => {
    let filtered = [...files];

    if (mode === "drive") {
      // Show files in the active directory, not trashed
      filtered = filtered.filter((f) => f.folderPath === folderPath && !f.trashed);
    } else if (mode === "starred") {
      // Show all starred files, not trashed
      filtered = filtered.filter((f) => f.starred && !f.trashed);
    } else if (mode === "recent") {
      // Show all files, not trashed
      filtered = filtered.filter((f) => !f.trashed);
    } else if (mode === "trash") {
      // Show all trashed files
      filtered = filtered.filter((f) => f.trashed);
    } else if (mode === "search") {
      // Show search matches among non-trashed files
      filtered = fuzzySearch(filtered.filter((f) => !f.trashed), searchQuery);
    }

    // Apply category filter
    filtered = filtered.filter((file) => matchFilter(file, filterType));

    // Sort: Folders always first, then by active sortBy
    filtered.sort((a, b) => {
      const aIsDir = a.mime === "inode/directory" || a.mime === "application/x-directory";
      const bIsDir = b.mime === "inode/directory" || b.mime === "application/x-directory";

      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;

      // Recent page default is date_desc if sortBy is default
      const activeSortBy = mode === "recent" && sortBy === "name_asc" ? "date_desc" : sortBy;

      switch (activeSortBy) {
        case "name_asc":
          return a.name.localeCompare(b.name);
        case "name_desc":
          return b.name.localeCompare(a.name);
        case "date_asc":
          return (a.lastOpenedAt || a.uploadedAt) - (b.lastOpenedAt || b.uploadedAt);
        case "date_desc":
          return (b.lastOpenedAt || b.uploadedAt) - (a.lastOpenedAt || a.uploadedAt);
        case "size_asc":
          return a.size - b.size;
        case "size_desc":
          return b.size - a.size;
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return filtered;
  };

  const displayFiles = getFilteredFiles();

  const folders = displayFiles.filter(
    (f) => f.mime === "inode/directory" || f.mime === "application/x-directory"
  );
  const regularFiles = displayFiles.filter(
    (f) => f.mime !== "inode/directory" && f.mime !== "application/x-directory"
  );

  // Breadcrumbs calculation
  const getBreadcrumbs = () => {
    if (folderPath === "/") return [];
    const segments = folderPath.split("/").filter(Boolean);
    let accumPath = "";
    return segments.map((seg) => {
      accumPath += `/${seg}`;
      return {
        name: seg,
        link: `/drive/folder${accumPath}`,
      };
    });
  };

  const breadcrumbs = getBreadcrumbs();

  // Navigation handlers
  const handleItemClick = (e: React.MouseEvent, file: TeleFile) => {
    // If Ctrl/Cmd/Shift is pressed, handle selection
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      toggleSelect(file.id);
      return;
    }

    // Single click select on mobile / desktop
    toggleSelect(file.id);
  };

  const handleItemDoubleClick = (file: TeleFile) => {
    const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
    if (isDir) {
      clearSelection();
      navigate(`/drive/folder${file.folderPath === "/" ? "" : file.folderPath}/${file.name}`);
    } else {
      // Preview action (handled in Phase 8)
      toastPreview(file);
    }
  };

  const toastPreview = (file: TeleFile) => {
    // For now, emit a custom event so preview modal can listen to it
    const event = new CustomEvent("teledrive-preview-file", { detail: file });
    window.dispatchEvent(event);
  };

  const handleDownload = (file: TeleFile) => {
    const event = new CustomEvent("teledrive-download-file", { detail: file });
    window.dispatchEvent(event);
  };

  const triggerUpload = () => {
    const event = new CustomEvent("teledrive-trigger-upload");
    window.dispatchEvent(event);
  };

  const triggerFolderUpload = () => {
    const event = new CustomEvent("teledrive-trigger-folder-upload");
    window.dispatchEvent(event);
  };

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
    
    const handleDeleteSelected = async () => {
      if (selectedIds.length > 0) {
        const confirmDelete = window.confirm(`Permanently delete ${selectedIds.length} items from trash?`);
        if (confirmDelete) {
          for (const id of selectedIds) {
            await deletePermanently(id);
          }
          clearSelection();
        }
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
    for (const id of selectedIds) {
      const file = files.find((f) => f.id === id);
      if (file) await moveToTrash(file);
    }
    clearSelection();
  };

  const handleBulkRestore = async () => {
    for (const id of selectedIds) {
      const file = files.find((f) => f.id === id);
      if (file) await restoreFromTrash(file);
    }
    clearSelection();
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`Are you sure you want to permanently delete these ${selectedIds.length} items?`)) {
      for (const id of selectedIds) {
        await deletePermanently(id);
      }
      clearSelection();
    }
  };

  // Render helpers
  const getHeaderTitle = () => {
    switch (mode) {
      case "starred":
        return "Starred";
      case "recent":
        return "Recent";
      case "trash":
        return "Trash";
      case "search":
        return `Search results for "${searchQuery}"`;
      default:
        if (folderPath !== "/") {
          const segments = folderPath.split("/").filter(Boolean);
          return segments[segments.length - 1] || "My Drive";
        }
        return "My Drive";
    }
  };

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
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto animate-fade-in">
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
    <div className="flex flex-col h-full p-4 md:p-6 lg:p-8 space-y-6">
      {/* File Browser Header Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-slate-200 dark:border-slate-800/60 pb-4 shrink-0">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-850 dark:text-slate-100">
            {getHeaderTitle()}
          </h1>
          {mode === "drive" && breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 overflow-x-auto whitespace-nowrap py-1">
              <Link
                to="/drive/my-drive"
                onClick={clearSelection}
                className="flex items-center gap-1 hover:text-brand-500 transition-colors font-medium text-slate-500 dark:text-slate-400"
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
                      className="hover:text-brand-500 transition-colors font-semibold text-slate-650 dark:text-slate-400"
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
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth py-0.5 max-w-full">
          {["All", "Documents", "Images", "Videos", "Audio", "Archives"].map((filter) => {
            const isActive = filterType === filter;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => setFilterType(filter)}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold rounded-xl border transition-all cursor-pointer whitespace-nowrap duration-150",
                  isActive
                    ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-brand-600 dark:text-brand-400 shadow-sm"
                    : "bg-slate-100/80 dark:bg-slate-900/50 border-transparent text-muted-foreground hover:bg-slate-200/50 dark:hover:bg-slate-800/80 hover:text-foreground"
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
                <span>Sort: {getSortLabel(sortBy)}</span>
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
        <div className="flex-1 overflow-y-auto min-h-0 select-none pb-20 pr-1 space-y-8">
          {/* Folders Section */}
          {folders.length > 0 && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                Folders
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
                {folders.map((folder) => {
                  const isSelected = selectedIds.includes(folder.id);
                  return (
                    <FileContextMenu
                      key={folder.id}
                      file={folder}
                      onPreview={toastPreview}
                      onDownload={handleDownload}
                      onRename={openRenameDialog}
                      onStarToggle={toggleStar}
                      onTrash={moveToTrash}
                    >
                      <div
                        onClick={(e) => handleItemClick(e, folder)}
                        onDoubleClick={() => handleItemDoubleClick(folder)}
                        onTouchStart={() => handleTouchStartItem(folder)}
                        onTouchEnd={handleTouchEndItem}
                        onTouchMove={handleTouchEndItem}
                        className={cn(
                          "group relative flex items-center justify-between p-3.5 rounded-xl border bg-white dark:bg-slate-900 transition-all duration-200 cursor-pointer hover:shadow-sm select-none",
                          isSelected
                            ? "border-brand-500 bg-brand-50/50 dark:border-brand-500 dark:bg-brand-950/20 ring-1 ring-brand-500"
                            : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-6">
                          <Folder className="h-5 w-5 text-brand-500 fill-brand-500/10 shrink-0 stroke-[1.5]" />
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                            {folder.name}
                          </span>
                        </div>
                        <div className="absolute right-2" onClick={(e) => e.stopPropagation()}>
                          <FileActionsMenu
                            file={folder}
                            onPreview={toastPreview}
                            onDownload={handleDownload}
                            onRename={openRenameDialog}
                            onStarToggle={toggleStar}
                            onTrash={moveToTrash}
                            onDeletePermanently={setDeleteTarget}
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
                {regularFiles.map((file) => {
                  const isSelected = selectedIds.includes(file.id);
                  return (
                    <FileContextMenu
                      key={file.id}
                      file={file}
                      onPreview={toastPreview}
                      onDownload={handleDownload}
                      onRename={openRenameDialog}
                      onStarToggle={toggleStar}
                      onTrash={moveToTrash}
                      onDeletePermanently={setDeleteTarget}
                    >
                      <div
                        onClick={(e) => handleItemClick(e, file)}
                        onDoubleClick={() => handleItemDoubleClick(file)}
                        onTouchStart={() => handleTouchStartItem(file)}
                        onTouchEnd={handleTouchEndItem}
                        onTouchMove={handleTouchEndItem}
                        className={cn(
                          "group relative flex flex-col rounded-2xl border bg-white dark:bg-slate-900 transition-all duration-200 cursor-pointer overflow-hidden text-left hover:shadow-md select-none h-44",
                          isSelected
                            ? "border-brand-500 bg-brand-50/50 dark:border-brand-500 dark:bg-brand-950/20 ring-1 ring-brand-500"
                            : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        )}
                      >
                        {/* Upper icon/preview box */}
                        <div className="flex-1 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-center p-4 relative border-b border-slate-100 dark:border-slate-800/40">
                          <FileIcon mime={file.mime} size="lg" />
                          {file.starred && (
                            <Star className="absolute top-2 right-2 h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          )}
                        </div>

                        {/* Lower text & action menu info */}
                        <div className="p-3 flex items-center justify-between gap-2 bg-white dark:bg-slate-900">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate pr-1">
                              {file.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {formatFileSize(file.size)}
                            </p>
                          </div>
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            <FileActionsMenu
                              file={file}
                              onPreview={toastPreview}
                              onDownload={handleDownload}
                              onRename={openRenameDialog}
                              onStarToggle={toggleStar}
                              onTrash={moveToTrash}
                              onDeletePermanently={setDeleteTarget}
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
        <div className="flex-1 overflow-y-auto min-h-0 select-none pb-20 border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900/40">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 tracking-wider">
                <th className="py-3 px-4 w-12 text-center">
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
                    className="rounded border-slate-300 dark:border-slate-700 text-brand-500 focus:ring-brand-500"
                  />
                </th>
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4 hidden sm:table-cell">Storage Channel ID</th>
                <th className="py-3 px-4 hidden md:table-cell">Size</th>
                <th className="py-3 px-4 hidden lg:table-cell">Uploaded Date</th>
                <th className="py-3 px-4 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {displayFiles.map((file) => {
                const isSelected = selectedIds.includes(file.id);
                const isDir = file.mime === "inode/directory" || file.mime === "application/x-directory";
                
                return (
                  <FileContextMenu
                    key={file.id}
                    file={file}
                    onPreview={toastPreview}
                    onDownload={handleDownload}
                    onRename={openRenameDialog}
                    onStarToggle={toggleStar}
                    onTrash={moveToTrash}
                    onDeletePermanently={setDeleteTarget}
                  >
                    <tr
                      onClick={(e) => handleItemClick(e, file)}
                      onDoubleClick={() => handleItemDoubleClick(file)}
                      onTouchStart={() => handleTouchStartItem(file)}
                      onTouchEnd={handleTouchEndItem}
                      onTouchMove={handleTouchEndItem}
                      className={cn(
                        "group border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-900/30 cursor-pointer transition-colors duration-150",
                        isSelected && "bg-brand-50/40 dark:bg-brand-950/15"
                      )}
                    >
                      <td className="py-2.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(file.id)}
                          className="rounded border-slate-300 dark:border-slate-700 text-brand-500 focus:ring-brand-500"
                        />
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-slate-800 dark:text-slate-200 text-xs">
                        <div className="flex items-center gap-2.5">
                          <FileIcon mime={file.mime} size="sm" className="p-0.5 rounded bg-transparent" />
                          <span className="truncate max-w-[200px] sm:max-w-xs">{file.name}</span>
                          {file.starred && (
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 hidden sm:table-cell text-[10px] text-muted-foreground truncate max-w-[120px] font-mono">
                        {file.channelId}
                      </td>
                      <td className="py-2.5 px-4 hidden md:table-cell text-xs text-slate-500 dark:text-slate-400">
                        {isDir ? "—" : formatFileSize(file.size)}
                      </td>
                      <td className="py-2.5 px-4 hidden lg:table-cell text-xs text-slate-500 dark:text-slate-400">
                        {new Date(file.uploadedAt).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <FileActionsMenu
                          file={file}
                          onPreview={toastPreview}
                          onDownload={handleDownload}
                          onRename={openRenameDialog}
                          onStarToggle={toggleStar}
                          onTrash={moveToTrash}
                          onDeletePermanently={setDeleteTarget}
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

      {/* Floating Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-4 bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-5 py-2.5 rounded-full shadow-2xl border border-slate-800 dark:border-slate-200 animate-slide-up">
          <span className="text-xs font-bold whitespace-nowrap">
            {selectedIds.length} Selected
          </span>
          <div className="h-4 w-px bg-slate-700 dark:bg-slate-300" />
          
          <div className="flex items-center gap-1">
            {mode === "trash" ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleBulkRestore}
                  className="h-8 w-8 rounded-full hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900"
                  title="Restore selected"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleBulkDelete}
                  className="h-8 w-8 rounded-full hover:bg-slate-800 dark:hover:bg-slate-100 text-red-400"
                  title="Delete permanently"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleBulkTrash}
                  className="h-8 w-8 rounded-full hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900"
                  title="Move selected to trash"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            
            <Button
              variant="ghost"
              size="icon"
              onClick={clearSelection}
              className="h-8 w-8 rounded-full hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900"
              title="Clear selection"
            >
              <X className="h-4 w-4" />
            </Button>
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
                  <FileIcon mime={mobileContextFile.mime} size="sm" />
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
    </div>
  );
}
