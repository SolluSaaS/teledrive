/**
 * Backup scheduler — JS-side wrapper around the Rust timer commands.
 *
 * The Rust side (src-tauri/src/lib.rs) owns the timer via
 * `start_backup_scheduler(interval_minutes)` / `stop_backup_scheduler()`.
 * When the timer fires, it emits a `teledrive://backup-tick` Tauri event
 * into the webview. This module:
 *   1. Forwards interval changes to Rust.
 *   2. Listens for tick events and dispatches them to `takeSnapshot`.
 *   3. Surfaces status to the React layer (currently via fileStore).
 *
 * The interval value is the source of truth in `licenseStore.license.
 * scheduledBackupIntervalMinutes` — when the user picks a new interval,
 * `setProSchedule` updates both the backend AND triggers
 * `applyIntervalChange(intervalMinutes)` here so the timer restarts with
 * the new value.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { takeSnapshot } from "./snapshot";
import { getStorageChannelId } from "../telegram/channelManager";
import { useAuthStore } from "@/stores/authStore";
import { useFileStore } from "@/stores/fileStore";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

let tickUnlisten: UnlistenFn | null = null;
let currentIntervalMinutes: number | null = null;

/**
 * Apply a new interval. Pass null to stop the timer entirely. Pass a
 * positive integer (1..10080) to (re)start it with the new cadence.
 *
 * Idempotent: calling with the same value is a no-op (Rust timer handles
 * the case of restarting with the same interval — start first calls stop,
 * so any interval change is honored).
 */
export async function applyIntervalChange(intervalMinutes: number | null): Promise<void> {
  if (intervalMinutes === currentIntervalMinutes) {
    return;
  }
  currentIntervalMinutes = intervalMinutes;
  try {
    if (intervalMinutes === null || intervalMinutes <= 0) {
      await invoke("stop_backup_scheduler");
      return;
    }
    await invoke("start_backup_scheduler", { intervalMinutes });
  } catch (err) {
    console.warn("[backup.scheduler] Tauri command failed:", err);
    currentIntervalMinutes = null; // back to "unknown" so a retry is possible
    throw err;
  }
}

/**
 * Start listening for tick events. Idempotent: tears down any existing
 * listener first so a re-start (e.g. on logout/login) doesn't double-fire.
 */
export async function ensureTickListenerStarted(): Promise<void> {
  if (tickUnlisten) {
    await tickUnlisten();
    tickUnlisten = null;
  }
  tickUnlisten = await listen("teledrive://backup-tick", async () => {
    await onTick();
  });
}

/**
 * Stop listening for tick events and stop the Rust timer. Used by logout.
 */
export async function stopBackupSchedule(): Promise<void> {
  if (tickUnlisten) {
    await tickUnlisten();
    tickUnlisten = null;
  }
  try {
    await tauriInvoke("stop_backup_scheduler");
  } catch (err) {
    console.warn("[backup.scheduler] stop_backup_scheduler failed:", err);
  }
  currentIntervalMinutes = null;
}

/**
 * Tick handler. Called by the Tauri event listener. Looks up the
 * authenticated channel id, sets the indicator, runs the snapshot, then
 * clears the indicator.
 */
async function onTick(): Promise<void> {
  const setIndexQueueState = useFileStore.getState().setIndexQueueState;
  const phone = useAuthStore.getState().phoneNumber;
  let channelId: string | undefined;
  try {
    channelId = await getStorageChannelId(phone);
  } catch (err) {
    console.warn("[backup.scheduler] getStorageChannelId failed:", err);
  }
  if (!channelId) {
    toast.warning("Scheduled backup skipped", {
      description: "Storage channel is not ready yet. Backup will retry next tick.",
    });
    return;
  }

  setIndexQueueState("backup-running");
  try {
    const result = await takeSnapshot(channelId, "auto");
    if (result.messageId) {
      toast.success("Backup complete", {
        description: `${result.fileCount} file${result.fileCount === 1 ? "" : "s"} snapshot saved.`,
      });
    } else {
      toast.error("Backup failed", {
        description: "See the Plan & Devices page for details.",
      });
    }
  } finally {
    setIndexQueueState("idle");
  }
}

/**
 * Manually trigger a snapshot right now (the "Run now" button).
 * Doesn't interact with the timer — just runs one snapshot synchronously.
 */
export async function runBackupNow(): Promise<{ messageId: number | null; fileCount: number }> {
  const phone = useAuthStore.getState().phoneNumber;
  const channelId = await getStorageChannelId(phone);
  if (!channelId) {
    toast.error("Storage channel not ready", {
      description: "Please complete first login before running a backup.",
    });
    return { messageId: null, fileCount: 0 };
  }

  const setIndexQueueState = useFileStore.getState().setIndexQueueState;
  setIndexQueueState("backup-running");
  try {
    const result = await takeSnapshot(channelId, "manual");
    if (result.messageId) {
      toast.success("Backup complete", {
        description: `${result.fileCount} file${result.fileCount === 1 ? "" : "s"} snapshot saved.`,
      });
    } else {
      toast.error("Backup failed", {
        description: "The Telegram send did not complete. See vault_state.log for details.",
      });
    }
    return { messageId: result.messageId, fileCount: result.fileCount };
  } finally {
    setIndexQueueState("idle");
  }
}
