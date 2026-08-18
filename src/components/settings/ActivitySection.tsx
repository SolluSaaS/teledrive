/**
 * ActivitySection — settings panel for the Pro Activity Log feature.
 *
 * Renders inside PlanSection (Settings → Plan & Devices). For FREE users
 * the section is visible but disabled with an "Upgrade to enable" CTA.
 * For PRO users it shows a unified, newest-first timeline that merges:
 *   - EventLog rows (file CRUD, uploads, moves, deletes, multi-device
 *     sync merges, offline toggles)
 *   - BackupJob rows (manual + scheduled snapshot runs with status,
 *     fileCount, totalBytes)
 *
 * Source tag surfaces as a small badge next to each row so PRO users can
 * tell at a glance whether an entry came from the audit log (backup) or
 * the event stream (event).
 *
 * State lives in `useActivityLog` (bridge between licenseStore + the
 * two backend endpoints).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Sparkles,
  RefreshCw,
  Upload,
  Edit3,
  Trash2,
  RotateCcw,
  Archive,
  Star,
  FolderPlus,
  FolderInput,
  Wifi,
  Shield,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useActivityLog,
  type ActivityItem,
  type ActivitySource,
} from "@/hooks/useActivityLog";
import { formatDistanceToNow } from "@/lib/utils";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

/** Activity type → small lucide icon. Falls back to Activity. */
function iconForType(type: string) {
  switch (type) {
    case "file.uploaded":
      return Upload;
    case "file.renamed":
      return Edit3;
    case "file.trashed":
    case "files.trashed":
      return Trash2;
    case "file.restored":
    case "files.restored":
      return RotateCcw;
    case "file.archived":
    case "files.archived":
      return Archive;
    case "file.unarchived":
    case "files.unarchived":
      return Archive;
    case "file.starred":
    case "files.starred":
      return Star;
    case "file.unstarred":
    case "files.unstarred":
      return Star;
    case "file.deleted":
    case "files.deleted":
    case "file.deleted.acknowledged":
      return Trash2;
    case "folder.created":
      return FolderPlus;
    case "files.moved":
      return FolderInput;
    case "file.offlineToggled":
      return Wifi;
    case "sync.remoteDelta":
      return Wifi;
    case "backup.manual":
    case "backup.auto":
      return Shield;
    default:
      return Activity;
  }
}

/** Tone per source — keeps the row visually anchored to where it came from. */
const SOURCE_TONE: Record<ActivitySource, string> = {
  backup:
    "bg-brand-500/10 dark:bg-brand-500/20 border-brand-500/30 text-brand-700 dark:text-brand-300",
  event:
    "bg-slate-500/10 dark:bg-slate-500/20 border-slate-400/30 text-slate-700 dark:text-slate-300",
};

/** Render one timeline row. `absolute` is shown on hover via title attr. */
function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = iconForType(item.type);
  const ms = useMemo(() => {
    const t = Date.parse(item.occurredAt);
    return Number.isFinite(t) ? t : 0;
  }, [item.occurredAt]);

  return (
    <li
      className="flex items-start gap-3 px-5 py-3 first:pt-5 last:pb-5"
      title={Number.isFinite(ms) ? new Date(ms).toLocaleString() : item.occurredAt}
    >
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 border ${SOURCE_TONE[item.source]}`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
            {item.label}
          </p>
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0 h-4 font-bold"
          >
            {item.source}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {ms > 0 ? `${formatDistanceToNow(ms)} ago` : "—"}
        </p>
      </div>
    </li>
  );
}

const SOURCE_FILTER_OPTIONS: Array<{
  value: "all" | ActivitySource;
  label: string;
}> = [
  { value: "all", label: "All activity" },
  { value: "event", label: "Events only" },
  { value: "backup", label: "Backups only" },
];

export default function ActivitySection() {
  const navigate = useNavigate();
  const { items, isLoading, error, refresh, isPro } = useActivityLog();

  const [sourceFilter, setSourceFilter] = useState<"all" | ActivitySource>("all");

  // Re-fetch when the user upgrades mid-session — the items list will fill in.
  useEffect(() => {
    if (isPro && items.length === 0 && !isLoading && !error) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro]);

  const visibleItems = useMemo(() => {
    if (sourceFilter === "all") return items;
    return items.filter((it) => it.source === sourceFilter);
  }, [items, sourceFilter]);

  function handleUpgradeClick() {
    navigate("/settings");
    setTimeout(() => {
      toast("Tap Upgrade on the plan card to enable Pro features.", {
        duration: 4000,
      });
    }, 400);
  }

  async function handleRefresh() {
    try {
      await refresh();
    } catch (err) {
      console.warn("[ActivitySection] refresh failed:", err);
    }
  }

  const currentFilterLabel =
    SOURCE_FILTER_OPTIONS.find((o) => o.value === sourceFilter)?.label ??
    "All activity";

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Activity
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          A unified timeline of uploads, file changes, multi-device syncs, and
          backups — newest first.
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
              The Activity log is available on the Pro plan. Upgrade to see a
              unified timeline of every action that touched your drive.
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

      {/* Timeline card */}
      <div className="p-0 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl bg-white dark:bg-slate-900/40 shadow-xs overflow-hidden">
        {/* Toolbar: filter + refresh */}
        <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-200/60 dark:border-slate-800/60">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={!isPro}
                className="rounded-xl text-xs font-semibold border-slate-200 dark:border-slate-800"
              >
                <span>{currentFilterLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="rounded-xl">
              {SOURCE_FILTER_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  onSelect={() => setSourceFilter(o.value)}
                  className="rounded-lg text-sm font-semibold cursor-pointer"
                >
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={!isPro || isLoading}
            className="rounded-xl text-xs font-bold"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            {isLoading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {/* Body */}
        {!isPro ? (
          <div className="p-6 text-center">
            <Activity className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">
              Upgrade to Pro to see your activity timeline.
            </p>
          </div>
        ) : error ? (
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Couldn't load activity
              </p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                className="mt-3 rounded-xl text-xs font-bold h-8 px-4"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          </div>
        ) : isLoading && items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin inline-block mr-2" />
            Loading activity…
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="p-6 text-center">
            <Activity className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">
              {items.length === 0
                ? "No activity yet. Upload a file or run a backup to get started."
                : "No events match this filter."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
            {visibleItems.map((it) => (
              <ActivityRow key={it.id} item={it} />
            ))}
          </ul>
        )}
      </div>

      {/* Info card */}
      <div className="p-4 rounded-2xl bg-slate-100/50 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-850/30 text-xs text-muted-foreground leading-relaxed">
        💡 <strong>What's tracked:</strong> file uploads, renames, moves,
        deletes, archive / star / offline toggles, folder creation, multi-device
        syncs, and every backup run. Entries are append-only — we never delete
        or rewrite history.
      </div>
    </div>
  );
}