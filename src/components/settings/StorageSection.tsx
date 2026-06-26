import { useState, useCallback } from "react";
import { HardDrive, RefreshCw, Info, Loader2 } from "lucide-react";
import { useFileStore } from "@/stores/fileStore";
import { loadIndex } from "@/lib/storage/metadataStore";
import { getSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "@/lib/secure/vault";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a byte count to a human-readable string.
 * Handles NaN / Infinity / 0 safely — never returns "undefined".
 */
function formatBytes(bytes: number): string {
  if (!bytes || !isFinite(bytes) || bytes <= 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  return `${value} ${sizes[i]}`;
}

/** Sanitises a file size field — GramJS may return BigInt or undefined. */
function safeSize(raw: unknown): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return isFinite(n) && n >= 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StorageSection() {
  const files = useFileStore((state) => state.files);
  const setFiles = useFileStore((state) => state.setFiles);
  const phoneNumber = useAuthStore((state) => state.phoneNumber);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Only count non-trashed, non-directory items as "files"
  const activeFiles = files.filter((f) => !f.trashed && f.mime !== "inode/directory");
  const activeFolders = files.filter((f) => !f.trashed && f.mime === "inode/directory");
  const trashedItems = files.filter((f) => f.trashed);

  // Sum file sizes — sanitise each size first to avoid NaN propagation
  const totalSizeBytes = activeFiles.reduce((acc, f) => acc + safeSize(f.size), 0);
  const formattedSize = formatBytes(totalSizeBytes);

  // -------------------------------------------------------------------------
  // Recalculate — actually re-fetches from Telegram
  // -------------------------------------------------------------------------
  const handleRecalculate = useCallback(async () => {
    setIsRefreshing(true);
    try {
      let channelId: string | null = null;
      if (phoneNumber) {
        channelId = await getSecret(channelIdKey(phoneNumber));
      }
      if (!channelId) {
        channelId = await getSecret(VAULT_KEY_CHANNEL_ID);
      }
      if (!channelId) {
        toast.error("Storage channel not initialised yet.");
        return;
      }
      let freshFiles = await loadIndex(channelId);
      try {
        const { syncOfflineStatusWithDisk } = await import("@/lib/storage/offlineStorage");
        freshFiles = await syncOfflineStatusWithDisk(freshFiles);
      } catch (err) {
        console.warn("[StorageSection] Failed to sync offline status with disk:", err);
      }
      setFiles(freshFiles);
      toast.success("Storage refreshed from Telegram.");
    } catch (err: any) {
      console.error("[StorageSection] Recalculate failed:", err);
      toast.error(err?.message || "Failed to refresh storage data.");
    } finally {
      setIsRefreshing(false);
    }
  }, [setFiles, phoneNumber]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Storage Usage</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor your Telegram storage bucket space consumption.
        </p>
      </div>

      <div className="p-6 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 space-y-6 shadow-xs animate-fade-in">
        {/* Total used */}
        <div className="flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-full bg-brand-500/10 dark:bg-brand-500/20 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Total Space Used</span>
            {isRefreshing ? (
              <span className="text-xl font-bold flex items-center gap-2 text-slate-550 dark:text-slate-400">
                <Loader2 className="h-4.5 w-4.5 animate-spin text-brand-500" />
                Calculating…
              </span>
            ) : (
              <span className="text-xl font-extrabold text-slate-850 dark:text-slate-100 tracking-tight">{formattedSize}</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs pt-1 select-none">
          <span className="text-xs text-muted-foreground font-semibold">
            {isRefreshing ? "Calculating…" : `${formattedSize} used`}
          </span>
          <span className="text-[10px] font-extrabold text-green-700 dark:text-green-400 bg-green-500/10 border border-green-500/20 dark:border-green-400/25 rounded-full px-2.5 py-0.5 select-none uppercase tracking-wider">
            Unlimited Storage Available
          </span>
        </div>

        <Separator />

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4 text-xs py-1 select-none">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Files stored</span>
            <span className="font-extrabold text-base text-slate-850 dark:text-slate-100">
              {isRefreshing ? "…" : activeFiles.length}
            </span>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Folders created</span>
            <span className="font-extrabold text-base text-slate-850 dark:text-slate-100">
              {isRefreshing ? "…" : activeFolders.length}
            </span>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">In Trash</span>
            <span className="font-bold text-base text-slate-500 dark:text-slate-400">
              {isRefreshing ? "…" : trashedItems.length}
            </span>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={isRefreshing}
          onClick={handleRecalculate}
          className="rounded-xl text-xs font-bold gap-2 h-10 border-slate-200 dark:border-slate-800 cursor-pointer"
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          ) : (
            <RefreshCw className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          )}
          {isRefreshing ? "Recalculating…" : "Recalculate"}
        </Button>
      </div>

      {/* Info banner */}
      <div className="flex gap-3.5 p-4 rounded-2xl border border-slate-200/40 dark:border-slate-850/30 bg-slate-100/50 dark:bg-slate-900/60 text-muted-foreground">
        <Info className="h-5 w-5 shrink-0 mt-0.5 text-brand-500" />
        <div className="space-y-1 text-xs leading-relaxed">
          <p>
            *Telegram does not impose an official cap on total storage inside personal private channels.
          </p>
          <p className="mt-1">
            However, individual file size limitations apply: up to <strong>2 GB</strong> per file for
            standard accounts, and up to <strong>4 GB</strong> for Telegram Premium subscribers.
          </p>
        </div>
      </div>
    </div>
  );
}

// Inline separator
function Separator() {
  return <div className="h-px bg-border my-2" />;
}
