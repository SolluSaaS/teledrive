import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { HardDrive, Clock, Star, Trash2, Settings, Menu, Database, Loader2, Archive } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileStore } from "@/stores/fileStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import SearchBar from "./SearchBar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { bootstrapTeleDrive } from "@/lib/telegram/bootstrap";
import { triggerFilePicker, triggerFolderPicker } from "@/lib/upload/fileSelector";
import { addFilesToUploadQueue } from "@/lib/upload/uploadManager";
import { UploadProgressPanel } from "@/components/upload/UploadProgressPanel";
import { downloadFileFromTelegram } from "@/lib/telegram/downloader";
import { FilePreviewModal } from "@/components/preview/FilePreviewModal";
import { TeleFile } from "@/lib/types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function DriveLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  
  const [previewFile, setPreviewFile] = useState<TeleFile | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Pull-to-refresh states
  const [pullProgress, setPullProgress] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartRef = useRef(0);

  // Intercept browser/webview back button (popstate)
  useEffect(() => {
    const handlePopState = () => {
      // If any modal is active, close them and consume the back action
      if (shortcutsOpen || mobileActionsOpen || previewFile) {
        setShortcutsOpen(false);
        setMobileActionsOpen(false);
        setPreviewFile(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [shortcutsOpen, mobileActionsOpen, previewFile]);

  // Hook up keyboard shortcuts
  useKeyboardShortcuts({
    onToggleHelp: () => {
      setShortcutsOpen((prev) => {
        const next = !prev;
        if (next) {
          window.history.pushState({ modal: "shortcuts" }, "");
        }
        return next;
      });
    },
  });

  // Register upload, download, preview, and refresh listeners
  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      addFilesToUploadQueue(Array.from(droppedFiles));
    }
  };

  useEffect(() => {
    const handleUploadTrigger = () => {
      triggerFilePicker();
    };

    const handleFolderUploadTrigger = () => {
      triggerFolderPicker();
    };

    const handleDownloadTrigger = (e: Event) => {
      const file = (e as CustomEvent).detail as TeleFile;
      if (file) {
        downloadFileFromTelegram(file.channelId, file.messageId, file.name);
      }
    };

    const handlePreviewTrigger = (e: Event) => {
      const file = (e as CustomEvent).detail as TeleFile;
      if (file) {
        setPreviewFile(file);
        window.history.pushState({ modal: "preview" }, "");
      }
    };

    const handleRefreshFiles = async () => {
      try {
        await bootstrapTeleDrive();
      } catch (err) {
        console.error("Refresh failed:", err);
      }
    };

    window.addEventListener("teledrive-trigger-upload", handleUploadTrigger);
    window.addEventListener("teledrive-trigger-folder-upload", handleFolderUploadTrigger);
    window.addEventListener("teledrive-download-file", handleDownloadTrigger);
    window.addEventListener("teledrive-preview-file", handlePreviewTrigger);
    window.addEventListener("teledrive-refresh-files", handleRefreshFiles);
    
    return () => {
      window.removeEventListener("teledrive-trigger-upload", handleUploadTrigger);
      window.removeEventListener("teledrive-trigger-folder-upload", handleFolderUploadTrigger);
      window.removeEventListener("teledrive-download-file", handleDownloadTrigger);
      window.removeEventListener("teledrive-preview-file", handlePreviewTrigger);
      window.removeEventListener("teledrive-refresh-files", handleRefreshFiles);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    const mainEl = e.currentTarget;
    if (mainEl.scrollTop === 0) {
      touchStartRef.current = e.touches[0].clientY;
    } else {
      touchStartRef.current = 0;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartRef.current === 0 || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartRef.current;
    
    if (deltaY > 0) {
      const progress = Math.min(Math.round((deltaY / 120) * 100), 100);
      setPullProgress(progress);
      
      if (deltaY > 10) {
        if (e.cancelable) e.preventDefault();
      }
    }
  };

  const handleTouchEnd = async () => {
    if (touchStartRef.current === 0 || isRefreshing) return;
    touchStartRef.current = 0;
    
    if (pullProgress >= 80) {
      setIsRefreshing(true);
      setPullProgress(100);
      try {
        await bootstrapTeleDrive();
      } catch (err) {
        console.error("Failed to refresh:", err);
      } finally {
        setIsRefreshing(false);
        setPullProgress(0);
      }
    } else {
      setPullProgress(0);
    }
  };

  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);

  const files = useFileStore((state) => state.files);

  // Only sum active (non-trashed) file sizes; guard against NaN from BigInt
  const safeSize = (raw: unknown): number => {
    const n = Number(raw);
    return isFinite(n) && n >= 0 ? n : 0;
  };
  const totalSizeBytes = files
    .filter((f) => !f.trashed && f.mime !== "inode/directory")
    .reduce((acc, f) => acc + safeSize(f.size), 0);

  const formatBytes = (bytes: number) => {
    if (!bytes || !isFinite(bytes) || bytes <= 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formattedUsedSize = formatBytes(totalSizeBytes);

  // Extract phone initials (e.g. "+91 9876..." -> "+9")
  const getInitials = (phone: string | null) => {
    if (!phone) return "TD";
    const cleaned = phone.replace(/[^0-9+]/g, "");
    if (cleaned.startsWith("+")) {
      return cleaned.slice(0, 2);
    }
    return cleaned.slice(0, 2).toUpperCase() || "TD";
  };

  const archivedCount = files.filter((f) => f.archived && !f.trashed).length;
  const starredCount  = files.filter((f) => f.starred && !f.trashed && !f.archived).length;
  const trashCount    = files.filter((f) => f.trashed).length;
  const totalCount    = files.filter((f) => !f.trashed && !f.archived).length;

  const navItems = [
    { label: "My Drive",  icon: HardDrive, path: "/drive/my-drive",  badge: totalCount },
    { label: "Recent",   icon: Clock,      path: "/drive/recent" },
    { label: "Starred",  icon: Star,       path: "/drive/starred",   badge: starredCount },
    { label: "Archived", icon: Archive,    path: "/drive/archived",  badge: archivedCount },
    { label: "Trash",    icon: Trash2,     path: "/drive/trash",     badge: trashCount },
  ];

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-slate-50/50 dark:bg-slate-900/10">
      {/* Navigation items */}
      <nav className="flex-1 px-3 py-4 space-y-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            location.pathname === item.path ||
            (item.path === "/drive/my-drive" && location.pathname.startsWith("/drive/folder/"));
          return (
            <Link
              key={item.label}
              to={item.path}
              onClick={() => isMobile && setSidebarOpen(false)}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 ${
                isActive
                  ? "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 text-brand-600 dark:text-brand-400 shadow-sm"
                  : "text-muted-foreground hover:bg-slate-100/80 dark:hover:bg-slate-900/50 hover:text-foreground border border-transparent"
              }`}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {(item as any).badge > 0 && (
                <span className="ml-auto text-[10px] font-bold bg-brand-100 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800/50 rounded-full px-2 py-0.5 min-w-[20px] text-center">
                  {(item as any).badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Storage panel wrapped in a beautiful card matching the settings design */}
      <div className="mx-3 mb-4 p-4 border border-slate-200 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/30 shadow-sm space-y-3 select-none">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-550 dark:text-slate-400 uppercase tracking-wider">
          <Database className="h-4 w-4 text-brand-500" />
          <span>Storage</span>
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
            {formattedUsedSize} <span className="text-xs font-normal text-muted-foreground">used</span>
          </div>
          <div className="text-[10px] font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 rounded-full px-2.5 py-0.5 inline-block select-none">
            Unlimited Storage
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col h-screen overflow-hidden bg-background text-foreground relative"
    >
      {/* Drag & Drop full screen overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/70 dark:bg-slate-950/75 backdrop-blur-md border-4 border-dashed border-brand-500 m-4 rounded-3xl animate-in fade-in zoom-in-95 duration-200 select-none pointer-events-none">
          <div className="flex flex-col items-center gap-4 text-brand-600 dark:text-brand-400">
            <div className="p-6 rounded-full bg-brand-50 dark:bg-brand-950/50 border border-brand-200 dark:border-brand-800 animate-bounce">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight">Drop files to upload</h2>
            <p className="text-sm font-semibold text-muted-foreground">Upload directly to the current directory in TeleDrive</p>
          </div>
        </div>
      )}
      
      {/* Topbar */}
      <header className="flex items-center justify-between border-b px-4 h-14 md:h-16 shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          {isMobile && (
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[var(--sidebar-width)] p-0 pt-10">
                <div className="px-6 py-2 flex items-center gap-2">
                  <img
                    src="/teledrive.png"
                    alt="TeleDrive Logo"
                    className="h-6 w-6 object-contain rounded-lg shadow-sm"
                  />
                  <span className="text-xl font-bold text-slate-800 dark:text-slate-200 tracking-tight">TeleDrive</span>
                </div>
                <SidebarContent />
              </SheetContent>
            </Sheet>
          )}

          {/* Logo / Title */}
          <Link to="/drive/my-drive" className="flex items-center gap-2">
            <img
              src="/teledrive.png"
              alt="TeleDrive Logo"
              className="h-7 w-7 object-contain rounded-lg shadow-sm shrink-0"
            />
            <span className="hidden sm:inline-block text-lg font-bold tracking-tight text-slate-800 dark:text-slate-200">
              TeleDrive
            </span>
          </Link>
        </div>

        {/* Search bar wrapper */}
        <div className="flex-1 max-w-2xl mx-4 md:mx-8">
          <SearchBar />
        </div>

        {/* Right side items */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/settings")}
            className="h-10 w-10 rounded-full hover:bg-muted hidden md:flex"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Button>

          <Avatar className="h-9 w-9 border cursor-pointer hover:opacity-90 transition-opacity" onClick={() => navigate("/settings")}>
            <AvatarFallback className="bg-brand-500 text-white font-bold text-xs select-none">
              {getInitials(phoneNumber)}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-white text-xs font-semibold py-1.5 px-4 flex items-center justify-center gap-2 select-none animate-fade-in shrink-0">
          <svg className="h-4 w-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-3.536 4.978 4.978 0 011.414-3.536m0 0L8.464 8.464" />
          </svg>
          <span>You are currently offline. Some features may be unavailable.</span>
        </div>
      )}

      {/* Main shell */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (Desktop) */}
        {!isMobile && (
          <aside className="w-[var(--sidebar-width)] border-r border-slate-200 dark:border-slate-800/80 shrink-0">
            <SidebarContent />
          </aside>
        )}

        {/* Main Content Area */}
        <main
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex-1 overflow-y-auto bg-slate-50/30 dark:bg-slate-950/20 pb-[calc(var(--mobile-nav-height)+16px)] md:pb-6 relative"
        >
          {/* Pull to refresh spinner */}
          {(pullProgress > 0 || isRefreshing) && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-50 flex items-center justify-center bg-white dark:bg-slate-900 border dark:border-slate-800 shadow-md rounded-full transition-all"
              style={{
                top: `${12 + (pullProgress / 100) * 32}px`,
                width: "36px",
                height: "36px",
                opacity: pullProgress / 100,
                transform: `translate(-50%, 0) rotate(${pullProgress * 3.6}deg)`,
              }}
            >
              <Loader2 className={cn("h-4.5 w-4.5 text-brand-500", isRefreshing && "animate-spin")} />
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Bottom Nav (Mobile) */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 h-[var(--mobile-nav-height)] border-t bg-background flex items-center justify-around z-40 pb-[env(safe-area-inset-bottom)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.path ||
              (item.path === "/drive/my-drive" && location.pathname.startsWith("/drive/folder/"));
            return (
              <Link
                key={item.label}
                to={item.path}
                className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${
                  isActive ? "text-brand-500 font-semibold" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5 mb-0.5" />
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
          
          {/* Settings tab for mobile bottom nav */}
          <Link
            to="/settings"
            className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${
              location.pathname === "/settings" ? "text-brand-500 font-semibold" : "text-muted-foreground"
            }`}
          >
            <Settings className="h-5 w-5 mb-0.5" />
            <span className="text-[10px]">Settings</span>
          </Link>
        </nav>
      )}
      <FilePreviewModal
        file={previewFile}
        onClose={() => {
          setPreviewFile(null);
          if (window.history.state?.modal === "preview") {
            window.history.back();
          }
        }}
      />
      <UploadProgressPanel />

      {/* Mobile Floating Action Button (FAB) */}
      {isMobile && (location.pathname === "/drive/my-drive" || location.pathname.startsWith("/drive/folder/")) && (
        <Sheet open={mobileActionsOpen} onOpenChange={(open) => {
          setMobileActionsOpen(open);
          if (open) {
            window.history.pushState({ modal: "actions" }, "");
          } else if (window.history.state?.modal === "actions") {
            window.history.back();
          }
        }}>
          <SheetTrigger asChild>
            <Button
              className="fixed bottom-20 right-6 h-14 w-14 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-xl z-40 flex items-center justify-center transition-transform active:scale-95 border-0 cursor-pointer"
              size="icon"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl px-6 py-5 max-h-[300px] bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-4 uppercase tracking-wider select-none">Create New</h3>
            <div className="grid grid-cols-3 gap-3 pb-6 select-none">
              <button
                onClick={() => {
                  setMobileActionsOpen(false);
                  if (window.history.state?.modal === "actions") window.history.back();
                  const event = new CustomEvent("teledrive-trigger-create-folder");
                  window.dispatchEvent(event);
                }}
                className="flex flex-col items-center justify-center p-3 border rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 transition-colors bg-transparent cursor-pointer"
              >
                <div className="h-9 w-9 rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-500 flex items-center justify-center mb-1.5">
                  <HardDrive className="h-4.5 w-4.5" />
                </div>
                <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 text-center">Folder</span>
              </button>

              <button
                onClick={() => {
                  setMobileActionsOpen(false);
                  if (window.history.state?.modal === "actions") window.history.back();
                  triggerFilePicker();
                }}
                className="flex flex-col items-center justify-center p-3 border rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 transition-colors bg-transparent cursor-pointer"
              >
                <div className="h-9 w-9 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-1.5">
                  <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 text-center">Files</span>
              </button>

              <button
                onClick={() => {
                  setMobileActionsOpen(false);
                  if (window.history.state?.modal === "actions") window.history.back();
                  triggerFolderPicker();
                }}
                className="flex flex-col items-center justify-center p-3 border rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 transition-colors bg-transparent cursor-pointer"
              >
                <div className="h-9 w-9 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-500 flex items-center justify-center mb-1.5">
                  <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.062-9.748l2 2A1.5 1.5 0 0115.62 9H19.5A1.5 1.5 0 0121 10.5v9a1.5 1.5 0 01-1.5 1.5H4.5A1.5 1.5 0 013 19.5v-12A1.5 1.5 0 014.5 6h4.88a1.5 1.5 0 011.06.44l2.622 2.622H19.5" />
                  </svg>
                </div>
                <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 text-center">Folder</span>
              </button>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Keyboard Shortcuts Dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={(open) => {
        setShortcutsOpen(open);
        if (!open && window.history.state?.modal === "shortcuts") {
          window.history.back();
        }
      }}>
        <DialogContent className="rounded-2xl max-w-lg p-6 bg-white dark:bg-slate-900 border dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-800 dark:text-slate-200">
              Keyboard Shortcuts
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2 select-none">
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Navigation & Search</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Focus Search</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">/ or ⌘F</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Clear selection / blur</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">Esc</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Scroll to top</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">g g</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Scroll to bottom</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">g l</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Show shortcuts help</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">?</kbd>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Actions on Selection</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Select all items</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">⌘A</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Move to Trash</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">Del / Backspace</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Rename item</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">F2</kbd>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Download file</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border dark:border-slate-700 rounded text-[10px] font-semibold text-slate-700 dark:text-slate-300">⌘D</kbd>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
