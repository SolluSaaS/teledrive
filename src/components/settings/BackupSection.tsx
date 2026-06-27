/**
 * BackupSection — settings panel for the scheduled-backup Pro feature.
 *
 * Renders inside PlanSection (Settings → Plan & Devices). For FREE users
 * the section is visible but disabled with an "Upgrade to enable" CTA.
 * For PRO users it shows:
 *   - A read-only "Live sync" status badge (running / off).
 *   - An interval dropdown (Off / Daily / Weekly).
 *   - "Run now" button + last-attempt timestamp.
 *
 * State lives in `useBackupSchedule` (bridge between licenseStore +
 * fileStore + the Rust timer).
 */
import { useState } from "react";
import { Clock, Sparkles, RefreshCw, History, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBackupSchedule } from "@/hooks/useBackupSchedule";
import { formatDistanceToNow } from "@/lib/utils";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const INTERVAL_PRESETS: Array<{
  value: string;
  label: string;
  minutes: number | null;
}> = [
  { value: "off", label: "Off", minutes: null },
  { value: "daily", label: "Daily", minutes: 1440 },
  { value: "weekly", label: "Weekly", minutes: 10080 },
];

export default function BackupSection() {
  const navigate = useNavigate();
  const {
    intervalMinutes,
    isPro,
    lastBackupAt,
    isRunning,
    setIntervalMinutes,
    runNow,
  } = useBackupSchedule();

  const [pendingValue, setPendingValue] = useState<string | null>(null);

  const currentPreset =
    INTERVAL_PRESETS.find((p) => p.minutes === intervalMinutes)?.value ?? "off";

  async function handleChange(value: string) {
    const preset = INTERVAL_PRESETS.find((p) => p.value === value);
    if (!preset) return;
    setPendingValue(value);
    try {
      await setIntervalMinutes(preset.minutes);
    } catch (err) {
      console.warn("[BackupSection] setIntervalMinutes failed:", err);
    } finally {
      setPendingValue(null);
    }
  }

  async function handleRunNow() {
    if (!isPro) {
      toast("Run now is a Pro feature", {
        description: "Upgrade to enable scheduled and manual backups.",
      });
      return;
    }
    try {
      await runNow();
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
          Scheduled Backup
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Automatically snapshot your Telegram storage index so you can recover
          from any unexpected state.
        </p>
      </div>

      {/* Pro gate banner (FREE users only) */}
      {!isPro && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20">
          <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Pro feature
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1 leading-relaxed">
              Scheduled and manual backups are available on the Pro plan.
              Upgrade to enable automatic daily or weekly snapshots.
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

      {/* Interval selector (PRO) */}
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
              {isPro && intervalMinutes !== null && (
                <Badge className="bg-brand-500 hover:bg-brand-550 dark:bg-brand-500/20 dark:text-brand-300 dark:border dark:border-brand-500/30 text-white font-extrabold text-[10px] uppercase tracking-wider px-2 py-0.5 border-0">
                  Active
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              How often TeleDrive should take a snapshot of your file index.
              Snapshots are text-only audit messages; your files stay in
              Telegram untouched.
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!isPro || pendingValue !== null}
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

        {/* Last run + Run now */}
        <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-slate-200/60 dark:border-slate-800/60">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <History className="h-3.5 w-3.5" />
            <span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Last backup:
              </span>{" "}
              {lastBackupLabel}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 h-9 px-4 disabled:opacity-50"
            onClick={handleRunNow}
            disabled={!isPro || isRunning}
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

      {/* Info card explaining the snapshot mechanism */}
      <div className="p-4 rounded-2xl bg-slate-100/50 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-850/30 text-xs text-muted-foreground leading-relaxed">
        💡 <strong>How snapshots work:</strong> TeleDrive posts a small
        audit message to your private storage channel at the scheduled
        cadence. The message records the file count and total size — your
        actual files are never copied or duplicated.
      </div>
    </div>
  );
}
