/**
 * BackupSection — settings panel for the device-backup Pro feature.
 *
 * Renders inside PlanSection (Settings → Plan & Devices). For FREE users
 * the section is visible but disabled with an "Upgrade to enable" CTA.
 * For PRO users it shows:
 *   - Source folders (auto-saved on pick)
 *   - Exclude patterns (auto-saved on add)
 *   - Backup cadence dropdown
 *   - Run-now button (progress surfaces in the bottom-right overlay)
 *
 * UX notes
 * --------
 * - "Save changes" button is gone. Every mutation persists immediately
 *   via the licenseStore action — see useBackupFolders for the why.
 * - Progress during a run lives in BackupProgressOverlay (mounted at
 *   app root), NOT inline in this section. The user can navigate away
 *   from Settings and still see the backup progress.
 */
import { useState } from "react";
import {
  Clock,
  Sparkles,
  RefreshCw,
  History,
  ChevronDown,
  Check,
  FolderPlus,
  X,
  Folder,
  FileX2,
  Plus,
  ArrowRight,
  Shield,
} from "lucide-react";
import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBackupSchedule } from "@/hooks/useBackupSchedule";
import { useBackupFolders } from "@/hooks/useBackupFolders";
import { useBackupRunner } from "@/hooks/useBackupRunner";
import { useBackupProgressStore } from "@/stores/backupProgressStore";
import { formatDistanceToNow } from "@/lib/utils";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const INTERVAL_PRESETS: Array<{
  value: string;
  label: string;
  minutes: number | null;
}> = [
  { value: "off", label: "Off", minutes: null },
  { value: "6h", label: "Every 6 hours", minutes: 360 },
  { value: "12h", label: "Every 12 hours", minutes: 720 },
  { value: "24h", label: "Every 24 hours", minutes: 1440 },
];

const MAX_FOLDERS = 5;
const MAX_EXCLUDES = 20;

export default function BackupSection() {
  const navigate = useNavigate();
  const {
    intervalMinutes,
    isPro,
    lastBackupAt,
    isRunning: scheduleIsRunning,
    setIntervalMinutes,
  } = useBackupSchedule();
  const {
    paths,
    excludes,
    isPro: foldersIsPro,
    isSaving,
    addFolder,
    removeFolder,
    addExclude,
    removeExclude,
  } = useBackupFolders();
  const {
    isRunning: runnerIsRunning,
    runNow: runRunnerNow,
    cancel,
  } = useBackupRunner();

  // Read the latest result from the global progress store so we can
  // show it inline below the Run-now button.
  const lastResult = useBackupProgressStore((s) => s.lastResult);

  const [excludeDraft, setExcludeDraft] = useState("");
  const [pendingInterval, setPendingInterval] = useState<string | null>(null);

  const isProCombined = isPro && foldersIsPro;
  const isRunning = scheduleIsRunning || runnerIsRunning;

  const currentPreset =
    INTERVAL_PRESETS.find((p) => p.minutes === intervalMinutes)?.value ?? "off";

  async function handleChange(value: string) {
    const preset = INTERVAL_PRESETS.find((p) => p.value === value);
    if (!preset) return;
    setPendingInterval(value);
    try {
      await setIntervalMinutes(preset.minutes);
    } catch (err) {
      console.warn("[BackupSection] setIntervalMinutes failed:", err);
    } finally {
      setPendingInterval(null);
    }
  }

  async function handleAddFolder() {
    if (!isProCombined) return;
    if (paths.length >= MAX_FOLDERS) {
      toast.warning(`At most ${MAX_FOLDERS} source folders.`);
      return;
    }
    try {
      const selected = await tauriOpenDialog({
        directory: true,
        multiple: false,
        title: "Pick a folder to back up",
      });
      if (!selected || typeof selected !== "string") return;
      // Auto-save — folder appears in the list the moment the server
      // echoes it back. No "Save changes" step.
      addFolder(selected);
    } catch (err) {
      console.warn("[BackupSection] folder picker failed:", err);
      toast.error("Could not open folder picker", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleAddExclude() {
    if (!isProCombined) return;
    if (excludes.length >= MAX_EXCLUDES) {
      toast.warning(`At most ${MAX_EXCLUDES} exclude patterns.`);
      return;
    }
    addExclude(excludeDraft);
    setExcludeDraft("");
  }

  async function handleRunNow() {
    if (!isProCombined) {
      toast("Run now is a Pro feature", {
        description: "Upgrade to enable scheduled and manual backups.",
      });
      return;
    }
    if (paths.length === 0) {
      toast("Pick at least one source folder first");
      return;
    }
    try {
      await runRunnerNow();
    } catch (err) {
      console.warn("[BackupSection] runNow failed:", err);
    }
  }

  function handleUpgradeClick() {
    navigate("/settings");
    setTimeout(() => {
      toast("Tap Upgrade on the plan card to enable Pro features.", {
        duration: 4000,
      });
    }, 400);
  }

  const lastBackupLabel = lastBackupAt
    ? `${formatDistanceToNow(lastBackupAt)} ago`
    : "Never";

  const currentLabel =
    INTERVAL_PRESETS.find((p) => p.value === currentPreset)?.label ?? "Off";

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Device Backup
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Pick folders on this Mac, and TeleDrive will upload them to your
          private storage channel so they're safe and reachable from the{" "}
          <code className="text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Backups</code>{" "}
          tab in the sidebar.
        </p>
      </div>

      {/* Pro gate banner (FREE users only) */}
      {!isProCombined && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20">
          <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Pro feature
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1 leading-relaxed">
              Device backup is available on the Pro plan. Upgrade to enable
              automatic uploads of your folders to your private Telegram
              storage channel.
            </p>
            <Button
              size="sm"
              className="mt-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs h-8 px-4"
              onClick={handleUpgradeClick}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Upgrade to Pro
            </Button>
          </div>
        </div>
      )}

      {/* Source folders (PRO) */}
      <div className="p-5 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 space-y-4 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-brand-500/10 dark:bg-brand-500/20 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0 mt-0.5">
            <Folder className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-extrabold text-slate-850 dark:text-slate-200 tracking-tight">
                Source folders
              </h4>
              <span className="text-xs text-muted-foreground">
                {paths.length}/{MAX_FOLDERS}
              </span>
              {isSaving && (
                <span className="text-[10px] text-muted-foreground italic">
                  saving…
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Pick folders on this computer. Their contents will be mirrored
              under{" "}
              <code className="text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                /TeleDrive Backups/&lt;this device&gt;/
              </code>
              , reachable from the{" "}
              <code className="text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Backups</code>{" "}
              sidebar entry. Saves automatically.
            </p>
            {paths.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No folders yet. Click "Add folder" below.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {paths.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 text-xs"
                  >
                    <Folder className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                    <span
                      className="flex-1 truncate font-mono text-[11px]"
                      title={p}
                    >
                      {p}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFolder(p)}
                      className="h-6 w-6 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors"
                      aria-label={`Remove ${p}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddFolder}
              disabled={!isProCombined || paths.length >= MAX_FOLDERS}
              className="rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 h-9 px-4"
            >
              <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
              Add folder
            </Button>
          </div>
        </div>
      </div>

      {/* Exclude patterns (PRO) */}
      <div className="p-5 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 space-y-4 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-brand-500/10 dark:bg-brand-500/20 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0 mt-0.5">
            <FileX2 className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-extrabold text-slate-850 dark:text-slate-200 tracking-tight">
                Exclude patterns
              </h4>
              <span className="text-xs text-muted-foreground">
                {excludes.length}/{MAX_EXCLUDES}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Glob patterns (matched against each path relative to a source
              folder). Supports <code className="text-[11px]">*</code>,{" "}
              <code className="text-[11px]">**</code>, and{" "}
              <code className="text-[11px]">?</code>. Examples:{" "}
              <code className="text-[11px]">node_modules</code>,{" "}
              <code className="text-[11px]">*.tmp</code>,{" "}
              <code className="text-[11px]">build/</code>.
            </p>
            {excludes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No excludes. Everything in your source folders will be backed up.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {excludes.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 text-xs"
                  >
                    <span
                      className="flex-1 truncate font-mono text-[11px]"
                      title={p}
                    >
                      {p}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeExclude(p)}
                      className="h-6 w-6 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors"
                      aria-label={`Remove ${p}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={excludeDraft}
                onChange={(e) => setExcludeDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddExclude();
                  }
                }}
                placeholder="e.g. *.tmp"
                disabled={!isProCombined || excludes.length >= MAX_EXCLUDES}
                className="h-9 text-xs font-mono rounded-xl flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddExclude}
                disabled={
                  !isProCombined ||
                  excludes.length >= MAX_EXCLUDES ||
                  excludeDraft.trim().length === 0
                }
                className="rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 h-9 px-3"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Cadence (PRO) */}
      <div className="p-5 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 space-y-4 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-full bg-brand-500/10 dark:bg-brand-500/20 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0 mt-0.5">
            <Clock className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-extrabold text-slate-850 dark:text-slate-200 tracking-tight">
                Backup cadence
              </h4>
              {isProCombined && intervalMinutes !== null && (
                <Badge className="bg-brand-500 hover:bg-brand-550 dark:bg-brand-500/20 dark:text-brand-300 dark:border dark:border-brand-500/30 text-white font-extrabold text-[10px] uppercase tracking-wider px-2 py-0.5 border-0">
                  Active
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              How often TeleDrive should re-scan your source folders and
              upload any new or changed files. Only changed files are
              re-uploaded — your existing backup is preserved.
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!isProCombined || pendingInterval !== null}
                  className="w-full sm:w-56 rounded-xl h-10 text-sm font-semibold justify-between border-slate-200 dark:border-slate-800"
                >
                  <span className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    {currentLabel}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-56 rounded-xl border-slate-200 dark:border-slate-800"
              >
                {INTERVAL_PRESETS.map((p) => {
                  const isCurrent = p.value === currentPreset;
                  return (
                    <DropdownMenuItem
                      key={p.value}
                      onSelect={() => handleChange(p.value)}
                      className="rounded-lg text-sm font-semibold cursor-pointer"
                    >
                      <span className="flex-1">{p.label}</span>
                      {isCurrent && (
                        <Check className="h-4 w-4 text-brand-500" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Last run + Run now / Cancel */}
        <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-slate-200/60 dark:border-slate-800/60">
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground min-w-0">
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Last backup:
                </span>{" "}
                {lastBackupLabel}
              </span>
            </div>
            {lastResult && (
              <div className="pl-5 text-[11px]">
                {lastResult.filesUploaded > 0 && (
                  <span>{lastResult.filesUploaded} uploaded, </span>
                )}
                {lastResult.filesSkipped > 0 && (
                  <span>{lastResult.filesSkipped} unchanged, </span>
                )}
                {lastResult.filesFailed > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {lastResult.filesFailed} failed
                  </span>
                )}
              </div>
            )}
            {isRunning && (
              <div className="pl-5 text-[11px] text-brand-600 dark:text-brand-400 font-semibold">
                See the progress panel in the bottom-right corner.
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button
                size="sm"
                variant="ghost"
                onClick={cancel}
                className="rounded-xl text-xs font-bold h-9 px-3 text-red-600 dark:text-red-400"
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 h-9 px-4 disabled:opacity-50"
              onClick={handleRunNow}
              disabled={!isProCombined || isRunning || paths.length === 0}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Backing up…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Run backup now
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Footer explainer + shortcut into the Backups view.
          Previously a single verbose info card; now split into a one-
          liner and a button that deep-links to /drive/backups so the
          user has an obvious path to verify a backup completed. The
          button is shown to PRO users only (FREE users see the Pro-
          feature banner above) but kept reachable for PRO users with
          zero backups so they can preview the read-only view. */}
      <div className="flex items-start sm:items-center gap-3 justify-between flex-wrap p-4 rounded-2xl bg-slate-100/50 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-850/30 text-xs text-muted-foreground leading-relaxed">
        <div className="flex-1 min-w-[220px]">
          💡 <strong className="text-slate-700 dark:text-slate-200">How backup works:</strong>{" "}
          TeleDrive walks the folders you pick, diffs against a local
          manifest (mtime + size), and uploads only new or changed files.
          Progress is shown in the bottom-right corner while a backup runs.
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate("/drive/backups")}
          disabled={!isProCombined}
          className="rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 h-9 px-4 shrink-0"
        >
          <Shield className="h-3.5 w-3.5 mr-1.5 text-brand-500" />
          View Backups
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}