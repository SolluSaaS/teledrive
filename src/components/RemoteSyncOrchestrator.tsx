/**
 * Headless orchestrator that runs the multi-device sync loop AND the
 * scheduled-backup tick listener.
 *
 * Mounted once at the App root (post-auth). Manages the lifecycle of:
 *   - `startRemoteSync` / `stopRemoteSync` based on auth, plan, bootstrap
 *   - `ensureTickListenerStarted` (so the Rust timer's tick events reach
 *     the snapshot sender) on app start
 *
 * Renders nothing. All state lives in module-scoped vars inside
 * remoteSync.ts / scheduler.ts. This component is purely the React glue
 * to the auth and plan stores.
 */
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useFileStore } from "@/stores/fileStore";
import { useLicenseStore } from "@/stores/licenseStore";
import { startRemoteSync, stopRemoteSync } from "@/lib/sync/remoteSync";
import {
  applyIntervalChange,
  ensureTickListenerStarted,
  stopBackupSchedule,
} from "@/lib/backup/scheduler";
import { getStorageChannelId } from "@/lib/telegram/channelManager";

export default function RemoteSyncOrchestrator(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const plan = useLicenseStore((s) => s.plan);
  const bootstrapComplete = useFileStore((s) => s.bootstrapComplete);
  const lastIndexMsgId = useFileStore((s) => s.lastIndexMsgId);
  const intervalMinutes =
    useLicenseStore((s) => s.license?.scheduledBackupIntervalMinutes) ?? null;

  // Effect 1 — bootstrap listener for backup ticks. Runs once on mount,
  // tears down on unmount. The listener itself stays across the lifetime
  // of the app — we want Rust ticks to reach the snapshot sender even if
  // the user is currently on the Settings page (where the orchestrator
  // component is still mounted via App.tsx).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureTickListenerStarted();
      } catch (err) {
        if (!cancelled) console.warn("[RemoteSyncOrchestrator] tick listener failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      void stopBackupSchedule();
    };
  }, []);

  // Effect 2 — react to plan + interval changes. When the user picks a
  // new interval, push it to the Rust timer.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (intervalMinutes === null || intervalMinutes <= 0) {
      void applyIntervalChange(null);
      return;
    }
    void applyIntervalChange(intervalMinutes);
  }, [isAuthenticated, intervalMinutes]);

  // Effect 3 — react to auth + bootstrap + plan changes. Start the
  // remote sync loop when all pre-conditions are met; stop on any
  // pre-condition failing.
  useEffect(() => {
    if (!isAuthenticated || !bootstrapComplete) {
      stopRemoteSync();
      return;
    }

    let cancelled = false;
    let retryHandle: ReturnType<typeof setTimeout> | null = null;

    async function tryStart(): Promise<void> {
      if (cancelled) return;
      try {
        const phone = useAuthStore.getState().phoneNumber;
        const channelId = await getStorageChannelId(phone);
        if (cancelled) return;
        if (channelId) {
          startRemoteSync(channelId, plan);
        }
      } catch (err) {
        console.warn(
          "[RemoteSyncOrchestrator] channel id not ready, retrying in 2s:",
          err,
        );
        retryHandle = setTimeout(tryStart, 2000);
      }
    }

    void tryStart();

    return () => {
      cancelled = true;
      if (retryHandle) clearTimeout(retryHandle);
      stopRemoteSync();
    };
  }, [isAuthenticated, plan, bootstrapComplete, lastIndexMsgId]);

  return null;
}
