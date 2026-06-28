/**
 * useBackupSchedule — bridges the licenseStore's scheduled interval value
 * to the BackupSection UI and the actual Rust timer.
 *
 * Reads `license.scheduledBackupIntervalMinutes` (server-authoritative)
 * and the user's plan (PRO gate). Exposes a single `setIntervalMinutes`
 * that calls into `licenseStore.setProSchedule` (which PATCHes the
 * backend) AND `applyIntervalChange` (which restarts the Rust timer).
 *
 * Also tracks the last-attempt timestamp from the fileStore so the UI
 * can show "Last backup: 3h ago" without polling.
 */
import { useCallback, useMemo } from "react";
import { useLicenseStore } from "@/stores/licenseStore";
import { useFileStore } from "@/stores/fileStore";
import { applyIntervalChange, runBackupNow } from "@/lib/backup/scheduler";

export type BackupIntervalMinutes = number | null;

export interface UseBackupSchedule {
  /** Current schedule. null = disabled. 1440 = daily, 10080 = weekly. */
  intervalMinutes: BackupIntervalMinutes;
  /** True iff the user has an active Pro license (the gate). */
  isPro: boolean;
  /** Last successful or failed backup timestamp (ms), null = never. */
  lastBackupAt: number | null;
  /** True iff a snapshot is currently in flight. */
  isRunning: boolean;
  /**
   * Update the schedule. Calls the backend PATCH first; if the user is
   * not PRO, the backend rejects with 403 and we surface a toast. Only
   * after the backend succeeds do we restart the Rust timer — so a
   * server-side rejection doesn't leave the local timer ticking.
   */
  setIntervalMinutes: (minutes: BackupIntervalMinutes) => Promise<void>;
  /** Trigger a manual snapshot right now. Resolves when done. */
  runNow: () => Promise<void>;
}

export function useBackupSchedule(): UseBackupSchedule {
  const plan = useLicenseStore((s) => s.plan);
  const license = useLicenseStore((s) => s.license);
  const lastBackupAt = useFileStore((s) => s.lastBackupAt);
  const indexQueueState = useFileStore((s) => s.indexQueueState);
  const setProSchedule = useLicenseStore((s) => s.setProSchedule);

  const isPro = plan === "PRO";

  const intervalMinutes = useMemo<BackupIntervalMinutes>(() => {
    const v = license?.scheduledBackupIntervalMinutes;
    return typeof v === "number" && v > 0 ? v : null;
  }, [license?.scheduledBackupIntervalMinutes]);

  const setIntervalMinutes = useCallback(
    async (minutes: BackupIntervalMinutes) => {
      if (!isPro) {
        // Defensive — the server is authoritative, but early-return keeps
        // the UI snappy.
        return;
      }
      await setProSchedule(minutes);
      // Restart the Rust timer with the new value (or stop it).
      await applyIntervalChange(minutes);
    },
    [isPro, setProSchedule],
  );

  const runNow = useCallback(async () => {
    if (!isPro) return;
    await runBackupNow();
  }, [isPro]);

  return {
    intervalMinutes,
    isPro,
    lastBackupAt,
    isRunning: indexQueueState === "backup-running",
    setIntervalMinutes,
    runNow,
  };
}
