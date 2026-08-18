/**
 * BackupProgressOverlay — bottom-right toast-style panel that surfaces
 * backup progress regardless of where the user is in the app.
 *
 * Driven by the singleton `useBackupProgressStore`. When a backup is:
 *   - active: shows progress bar + current file + per-file count
 *   - done: shows summary ("3 uploaded, 0 failed") for ~6s then auto-dismisses
 *   - failed: shows error message + a Retry button, stays until dismissed
 *   - cancelled: shows "Cancelled" briefly then auto-dismisses
 *
 * Why a separate component (not just a sonner toast)
 * --------------------------------------------------
 * Sonner toasts are short-lived and don't support progress bars. For a
 * backup that may take many minutes, the user needs a persistent
 * panel that updates as files upload.
 *
 * The overlay is mounted once at the app root (DriveLayout) and
 * conditionally renders based on store state — so it's zero-cost when
 * idle.
 */
import { useEffect, useState } from "react";
import {
  Cloud,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
  AlertCircle,
} from "lucide-react";
import { useBackupProgressStore } from "@/stores/backupProgressStore";
import { cn } from "@/lib/utils";
import { useLicenseStore } from "@/stores/licenseStore";

const AUTO_DISMISS_MS = 6000;

export function BackupProgressOverlay() {
  const state = useBackupProgressStore();
  const plan = useLicenseStore((s) => s.plan);
  const isPro = plan === "PRO";

  // Track the last "done/failed/cancelled" timestamp so we can auto-
  // dismiss the panel after AUTO_DISMISS_MS. The store doesn't own
  // this — we hold it locally because it's purely a UI concern.
  const [dismissAfter, setDismissAfter] = useState<number | null>(null);

  useEffect(() => {
    if (state.status === "done" || state.status === "cancelled") {
      setDismissAfter(Date.now() + AUTO_DISMISS_MS);
    } else if (state.status === "failed") {
      setDismissAfter(null); // sticky until user dismisses
    } else {
      setDismissAfter(null);
    }
  }, [state.status, state.finishedAt]);

  useEffect(() => {
    if (dismissAfter === null) return;
    const remaining = dismissAfter - Date.now();
    if (remaining <= 0) {
      state.clear();
      return;
    }
    const timer = setTimeout(() => state.clear(), remaining);
    return () => clearTimeout(timer);
  }, [dismissAfter, state]);

  // Idle: render nothing.
  if (state.status === "idle") return null;

  const percent =
    state.total > 0
      ? Math.min(100, Math.round((state.uploaded / state.total) * 100))
      : 0;

  const isActive = state.status === "walking" || state.status === "uploading";

  const title = isActive
    ? state.status === "walking"
      ? "Scanning folders…"
      : `Backing up — ${state.uploaded} / ${state.total}`
    : state.status === "done"
      ? state.lastResult && state.lastResult.filesUploaded > 0
        ? `Backup complete — ${state.lastResult.filesUploaded} file${state.lastResult.filesUploaded === 1 ? "" : "s"} uploaded`
        : "Backup complete — nothing changed"
      : state.status === "cancelled"
        ? "Backup cancelled"
        : "Backup failed";

  const sublabel = (() => {
    if (isActive) {
      // Retry state takes priority over the current-file label — when a
      // chunk is in a FLOOD_WAIT backoff the user wants to know WHY the
      // counter is frozen ("Retrying 3/5 — waiting 30s for rate limit"),
      // not the long path of the file they're stuck on.
      if (state.retry) {
        const r = state.retry;
        const waitSec = Math.max(1, Math.round(r.waitMs / 1000));
        if (r.floodSeconds != null) {
          return `Retrying ${r.attempt}/${r.maxAttempts} — Telegram rate limit, waiting ${waitSec}s`;
        }
        return `Retrying ${r.attempt}/${r.maxAttempts} — network blip, waiting ${waitSec}s`;
      }
      if (state.status === "uploading" && state.currentFile) {
        return truncateMid(state.currentFile, 56);
      }
      if (state.status === "walking") {
        return "Reading folder contents from disk";
      }
      return "";
    }
    if (state.status === "done" && state.lastResult) {
      const parts: string[] = [];
      if (state.lastResult.filesUploaded > 0) parts.push(`${state.lastResult.filesUploaded} uploaded`);
      if (state.lastResult.filesSkipped > 0) parts.push(`${state.lastResult.filesSkipped} unchanged`);
      if (state.lastResult.filesFailed > 0) parts.push(`${state.lastResult.filesFailed} failed`);
      return parts.join(" · ");
    }
    if (state.status === "failed" && state.error) return state.error;
    if (state.status === "cancelled") return "You can resume anytime.";
    return "";
  })();

  // Visual tone per status
  const tone =
    state.status === "failed"
      ? "border-red-300/70 dark:border-red-700/60 bg-red-50/95 dark:bg-red-950/60"
      : state.status === "cancelled"
        ? "border-slate-300/70 dark:border-slate-700/60 bg-white/95 dark:bg-slate-900/80"
        : state.status === "done"
          ? "border-emerald-300/70 dark:border-emerald-700/60 bg-emerald-50/95 dark:bg-emerald-950/60"
          : "border-brand-300/70 dark:border-brand-700/60 bg-white/95 dark:bg-slate-900/90";

  const iconColor =
    state.status === "failed"
      ? "text-red-600 dark:text-red-400"
      : state.status === "done"
        ? "text-emerald-600 dark:text-emerald-400"
        : state.status === "cancelled"
          ? "text-slate-500 dark:text-slate-400"
          : "text-brand-600 dark:text-brand-400";

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-[360px] max-w-[calc(100vw-3rem)] animate-in slide-in-from-bottom-4 fade-in duration-300"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "rounded-2xl shadow-2xl border backdrop-blur-md overflow-hidden",
          tone,
        )}
      >
        {/* Header strip */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className={cn("shrink-0", iconColor)}>
            {isActive ? (
              state.status === "walking" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Cloud className="h-5 w-5 animate-pulse" />
              )
            ) : state.status === "done" ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : state.status === "cancelled" ? (
              <XCircle className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100 truncate">
              {title}
            </p>
            {sublabel && (
              <p
                className={cn(
                  "text-[11px] mt-0.5 truncate",
                  state.status === "failed"
                    ? "text-red-700/80 dark:text-red-300/80"
                    : state.status === "done"
                      ? "text-emerald-700/80 dark:text-emerald-300/80"
                      : "text-slate-500 dark:text-slate-400",
                )}
                title={sublabel}
              >
                {sublabel}
              </p>
            )}
          </div>
          {/* Close button (sticky on failure, instant on done/cancelled) */}
          <button
            type="button"
            onClick={() => state.clear()}
            className="h-7 w-7 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-700/60 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress bar (only while active) */}
        {isActive && (
          <div className="px-4 pb-3">
            <div className="h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-800/80 overflow-hidden">
              {state.total > 0 ? (
                <div
                  className="h-full bg-brand-500 dark:bg-brand-400 transition-all duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              ) : (
                // Indeterminate (walking phase): animated shimmer
                <div
                  className="h-full w-1/3 bg-brand-500 dark:bg-brand-400 animate-[indeterminate_1.4s_ease-in-out_infinite]"
                  style={{ animationName: "indeterminate" }}
                />
              )}
            </div>
            {state.total > 0 && (
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mt-1.5">
                {percent}%
              </p>
            )}
          </div>
        )}

        {/* Failure actions */}
        {state.status === "failed" && (
          <div className="px-4 pb-3 flex items-center gap-2">
            {!isPro && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300 italic">
                Upgrade to Pro to enable device backup.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Inline keyframes for indeterminate animation (avoids touching the
          global tailwind config). */}
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

/** Truncate a path in the middle: /Users/me/very/long/.../file.pdf */
function truncateMid(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + "…" + s.slice(s.length - half);
}