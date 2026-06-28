/**
 * useActivityLog — unified activity timeline for the Settings → Plan &
 * Devices → Activity panel.
 *
 * Merges two backend streams into a single `ActivityItem[]` sorted by
 * timestamp (newest first):
 *   1. `listRecentEvents()` → append-only EventLog rows (file CRUD,
 *      uploads, multi-device sync merges, etc.)
 *   2. `listBackupHistory()` → BackupJob rows (manual + scheduled
 *      snapshot runs with fileCount + totalBytes + status)
 *
 * Both endpoints are JWT-authenticated. The merge happens client-side
 * because the sources have different shapes — the only shared field is
 * the timestamp (`occurredAt` for events, `ranAt` for backups).
 *
 * PRO gate is mirrored from `useBackupSchedule`: FREE users see the
 * amber banner in the UI, but the hook still runs (so the user can see
 * "0 events" if they downgrade — history isn't deleted).
 */
import { useCallback, useEffect, useState } from "react";
import { listRecentEvents } from "@/lib/api/events";
import { listBackupHistory } from "@/lib/api/backup";
import { useLicenseStore } from "@/stores/licenseStore";
import type { BackupJob, EventLog } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";

/** Source tag — surfaces in the UI as a small badge next to each row. */
export type ActivitySource = "backup" | "event";

/**
 * Unified timeline entry. Either `source === "event"` (with `type` /
 * `payload` from EventLog) or `source === "backup"` (with `triggeredBy` /
 * `status` / `fileCount` / `totalBytes` from BackupJob).
 */
export interface ActivityItem {
  /** Stable id. `${source}-${id}` to avoid collisions across types. */
  id: string;
  source: ActivitySource;
  /** Sort key — ISO 8601 string. Newest first. */
  occurredAt: string;
  /** event.type or 'backup.manual' / 'backup.auto'. */
  type: string;
  /** Event payload (events) or backup metadata (backups). */
  payload: Record<string, unknown>;
  /** Convenience copy for the row label — derived at merge time. */
  label: string;
}

export interface UseActivityLog {
  items: ActivityItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isPro: boolean;
}

/**
 * Convert an EventLog row into a unified ActivityItem.
 * `label` is derived from `type` and known payload shapes so the UI
 * can stay declarative.
 */
function toEventItem(e: EventLog): ActivityItem {
  const payload = e.payload ?? {};
  let label: string;
  switch (e.type) {
    case "file.uploaded":
      label = `Uploaded "${payload.name ?? "file"}"`;
      break;
    case "file.renamed":
      label = `Renamed to "${payload.name ?? "file"}"`;
      break;
    case "file.trashed":
      label = `Moved "${payload.name ?? "file"}" to Trash`;
      break;
    case "file.restored":
      label = `Restored "${payload.name ?? "file"}" from Trash`;
      break;
    case "file.archived":
      label = `Archived "${payload.name ?? "file"}"`;
      break;
    case "file.unarchived":
      label = `Unarchived "${payload.name ?? "file"}"`;
      break;
    case "file.starred":
      label = `Starred "${payload.name ?? "file"}"`;
      break;
    case "file.unstarred":
      label = `Unstarred "${payload.name ?? "file"}"`;
      break;
    case "file.deleted":
      label = `Deleted "${payload.name ?? payload.fileId ?? "file"}" permanently`;
      break;
    case "file.deleted.acknowledged":
      label = `Removed file from Telegram storage`;
      break;
    case "folder.created":
      label = `Created folder "${payload.name ?? ""}"`;
      break;
    case "files.trashed":
      label = `Moved ${payload.count ?? "?"} item(s) to Trash`;
      break;
    case "files.restored":
      label = `Restored ${payload.count ?? "?"} item(s)`;
      break;
    case "files.archived":
      label = `Archived ${payload.count ?? "?"} item(s)`;
      break;
    case "files.unarchived":
      label = `Unarchived ${payload.count ?? "?"} item(s)`;
      break;
    case "files.starred":
      label = `Starred ${payload.count ?? "?"} item(s)`;
      break;
    case "files.unstarred":
      label = `Unstarred ${payload.count ?? "?"} item(s)`;
      break;
    case "files.deleted":
      label = `Deleted ${payload.count ?? "?"} item(s) permanently`;
      break;
    case "files.moved":
      label = `Moved ${payload.count ?? "?"} item(s) to ${payload.target ?? "another folder"}`;
      break;
    case "file.offlineToggled":
      label = payload.offline
        ? `Cached "${payload.name ?? "file"}" offline`
        : `Removed offline cache for "${payload.name ?? "file"}"`;
      break;
    case "sync.remoteDelta":
      label = `Synced ${payload.fileCount ?? "?"} file(s) from another device`;
      break;
    default:
      // Unknown type — show the raw type so future additions render
      // something readable without a code change.
      label = e.type;
  }
  return {
    id: `event-${e.id}`,
    source: "event",
    occurredAt: e.occurredAt,
    type: e.type,
    payload,
    label,
  };
}

function toBackupItem(b: BackupJob): ActivityItem {
  const ok = b.status === "success";
  const sizeMb = (b.totalBytes / (1024 * 1024)).toFixed(1);
  const label = ok
    ? `Backup completed (${b.fileCount} file(s), ${sizeMb} MB)`
    : `Backup failed${b.error ? `: ${b.error}` : ""}`;
  return {
    id: `backup-${b.id}`,
    source: "backup",
    occurredAt: b.ranAt,
    type: `backup.${b.triggeredBy}`,
    payload: {
      fileCount: b.fileCount,
      totalBytes: b.totalBytes,
      status: b.status,
      triggeredBy: b.triggeredBy,
      snapshotMessageId: b.snapshotMessageId,
    },
    label,
  };
}

export function useActivityLog(): UseActivityLog {
  const plan = useLicenseStore((s) => s.plan);
  const isPro = plan === "PRO";

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Parallel fetch — both endpoints are independent.
      const [eventsRes, backupsRes] = await Promise.all([
        listRecentEvents(100).catch((err) => {
          // Don't fail the whole refresh if events is unreachable —
          // the audit log (backups) is the canonical source.
          console.warn("[useActivityLog] listRecentEvents failed:", err);
          return { items: [] as EventLog[] };
        }),
        listBackupHistory().catch((err) => {
          console.warn("[useActivityLog] listBackupHistory failed:", err);
          return { items: [] as BackupJob[] };
        }),
      ]);

      const merged = [
        ...eventsRes.items.map(toEventItem),
        ...backupsRes.items.map(toBackupItem),
      ].sort((a, b) =>
        a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
      );
      setItems(merged);
    } catch (err) {
      // Both endpoints failed. Surface a friendly message.
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load activity";
      setError(msg);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-load on mount. Empty dep array — refresh is stable via useCallback.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, isLoading, error, refresh, isPro };
}