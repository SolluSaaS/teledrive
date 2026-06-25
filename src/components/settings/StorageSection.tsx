import { useState, useCallback } from "react";
import { HardDrive, RefreshCw, Info, Loader2 } from "lucide-react";
import { useFileStore } from "@/stores/fileStore";
import { loadIndex } from "@/lib/storage/metadataStore";
import { getSecret, VAULT_KEY_CHANNEL_ID } from "@/lib/secure/vault";
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
      const channelId = await getSecret(VAULT_KEY_CHANNEL_ID);
      if (!channelId) {
        toast.error("Storage channel not initialised yet.");
        return;
      }
      const freshFiles = await loadIndex(channelId);
      setFiles(freshFiles);
      toast.success("Storage refreshed from Telegram.");
    } catch (err: any) {
      console.error("[StorageSection] Recalculate failed:", err);
      toast.error(err?.message || "Failed to refresh storage data.");
    } finally {
      setIsRefreshing(false);
    }
  }, [setFiles]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Storage Usage</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor your Telegram storage bucket space consumption.
        </p>
      </div>

      <div className="p-5 border rounded-lg bg-background space-y-5">
        {/* Total used */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-brand-50 dark:bg-brand-950/20 border border-brand-200 flex items-center justify-center text-brand-600 shrink-0">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Total Space Used</span>
            {isRefreshing ? (
              <span className="text-xl font-bold flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Calculating…
              </span>
            ) : (
              <span className="text-xl font-bold">{formattedSize}</span>
            )}
          </div>
        </div>

        {/* Used / unlimited label */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">
              {isRefreshing ? "Calculating…" : `${formattedSize} used`}
            </span>
            <span className="font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 rounded-full px-2.5 py-0.5 select-none">
              Unlimited Storage Available
            </span>
          </div>
        </div>

        <Separator />

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4 text-sm py-1">
          <div>
            <span className="text-xs text-muted-foreground block">Files stored</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {isRefreshing ? "…" : activeFiles.length}
            </span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Folders created</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {isRefreshing ? "…" : activeFolders.length}
            </span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">In Trash</span>
            <span className="font-bold text-slate-500 dark:text-slate-400">
              {isRefreshing ? "…" : trashedItems.length}
            </span>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={isRefreshing}
          onClick={handleRecalculate}
          className="rounded-full text-xs font-semibold gap-2"
        >
          {isRefreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {isRefreshing ? "Recalculating…" : "Recalculate"}
        </Button>
      </div>

      {/* Info banner */}
      <div className="flex gap-3 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-muted-foreground">
        <Info className="h-5 w-5 shrink-0 mt-0.5" />
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
