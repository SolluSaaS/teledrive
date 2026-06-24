import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { HardDrive, Clock, Star, Trash2, Settings, Menu, Database, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileStore } from "@/stores/fileStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import SearchBar from "./SearchBar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { bootstrapTeleDrive } from "@/lib/telegram/bootstrap";
import { triggerFilePicker } from "@/lib/upload/fileSelector";
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
  useEffect(() => {
    const handleUploadTrigger = () => {
      triggerFilePicker();
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
    window.addEventListener("teledrive-download-file", handleDownloadTrigger);
    window.addEventListener("teledrive-preview-file", handlePreviewTrigger);
    window.addEventListener("teledrive-refresh-files", handleRefreshFiles);
    
    return () => {
      window.removeEventListener("teledrive-trigger-upload", handleUploadTrigger);
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

  // Calculate mock storage based on actual file sizes in store + 0.5 GB base
  const totalSizeBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const usedGB = (totalSizeBytes / (1024 * 1024 * 1024) + 0.12).toFixed(2);
  const limitGB = 15;
  const storagePercentage = Math.min(Math.round((parseFloat(usedGB) / limitGB) * 100), 100);

  // Extract phone initials (e.g. "+91 9876..." -> "+9")
  const getInitials = (phone: string | null) => {
    if (!phone) return "TD";
    const cleaned = phone.replace(/[^0-9+]/g, "");
    if (cleaned.startsWith("+")) {
      return cleaned.slice(0, 2);
    }
    return cleaned.slice(0, 2).toUpperCase() || "TD";
  };

  const navItems = [
    { label: "My Drive", icon: HardDrive, path: "/drive/my-drive" },
    { label: "Recent", icon: Clock, path: "/drive/recent" },
    { label: "Starred", icon: Star, path: "/drive/starred" },
    { label: "Trash", icon: Trash2, path: "/drive/trash" },
  ];

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-background">
      {/* Navigation items */}
      <nav className="flex-1 px-2 py-4 space-y-1">
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
              className={`flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400 font-semibold"
                  : "text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <Separator />

      {/* Storage panel */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="h-4 w-4" />
          <span>Storage</span>
        </div>
        <Progress value={storagePercentage} className="h-1.5 bg-slate-100 dark:bg-slate-900" />
        <div className="text-xs text-muted-foreground">
          {usedGB} GB of {limitGB} GB used
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs font-semibold rounded-full border-brand-200 hover:bg-brand-50 text-brand-600 dark:border-brand-900 dark:text-brand-400 dark:hover:bg-brand-950/20"
        >
          Buy storage
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
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
                <div className="px-6 py-2">
                  <span className="text-xl font-bold text-brand-500 tracking-tight">TeleDrive</span>
                </div>
                <SidebarContent />
              </SheetContent>
            </Sheet>
          )}

          {/* Logo / Title */}
          <Link to="/drive/my-drive" className="flex items-center gap-2">
            <svg
              className="h-7 w-7 text-brand-500 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
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
          <aside className="w-[var(--sidebar-width)] border-r shrink-0 bg-background/50">
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
              <Loader2 className={cn("h-4.5 w-4.5 text-blue-500", isRefreshing && "animate-spin")} />
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
              className="fixed bottom-20 right-6 h-14 w-14 rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-xl z-40 flex items-center justify-center transition-transform active:scale-95 border-0 cursor-pointer"
              size="icon"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl px-6 py-5 max-h-[300px] bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-4 uppercase tracking-wider select-none">Create New</h3>
            <div className="grid grid-cols-2 gap-4 pb-6 select-none">
              <button
                onClick={() => {
                  setMobileActionsOpen(false);
                  if (window.history.state?.modal === "actions") window.history.back();
                  const event = new CustomEvent("teledrive-trigger-create-folder");
                  window.dispatchEvent(event);
                }}
                className="flex flex-col items-center justify-center p-4 border rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 transition-colors bg-transparent cursor-pointer"
              >
                <div className="h-10 w-10 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-500 flex items-center justify-center mb-2">
                  <HardDrive className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Folder</span>
              </button>

              <button
                onClick={() => {
                  setMobileActionsOpen(false);
                  if (window.history.state?.modal === "actions") window.history.back();
                  triggerFilePicker();
                }}
                className="flex flex-col items-center justify-center p-4 border rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 transition-colors bg-transparent cursor-pointer"
              >
                <div className="h-10 w-10 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-2">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Upload</span>
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
