/**
 * Multi-device sync coordinator (Pro feature).
 *
 * Polls the Telegram storage channel every POLL_INTERVAL_MS for new index
 * messages and merges any deltas into the in-memory fileStore. FREE users
 * stay on cold-start sync only — the coordinator short-circuits on
 * `plan !== 'PRO'`.
 *
 * Read-only by design: the poll never writes to Telegram, so two devices
 * polling simultaneously can't conflict. The bootstrap gate (`bootstrapComplete`)
 * is the only sequencing constraint — we never start polling until bootstrap
 * has set `lastIndexMsgId` to a sane value.
 *
 * FLOOD_WAIT safety: a single `client.getMessages` per poll, 5s timeout,
 * with the existing `withTelegramRetry` wrapper for backoff. At the default
 * 30s cadence we hit Telegram at most ~120×/hr per channel, well under any
 * known FLOOD_WAIT threshold.
 */
import { loadIndexIncremental } from "../storage/metadataStore";
import { withTelegramRetry } from "../telegram/rateLimit";
import { useFileStore } from "../../stores/fileStore";
import type { Plan } from "../api/types";
import { logEvent } from "../events";

const POLL_INTERVAL_MS = 30_000;
const SYNC_INDICATOR_MIN_MS = 800;

interface CoordinatorState {
  timerId: ReturnType<typeof setTimeout> | null;
  isRunning: boolean;
  currentChannelId: string | null;
  lastTickAt: number;
}

const state: CoordinatorState = {
  timerId: null,
  isRunning: false,
  currentChannelId: null,
  lastTickAt: 0,
};

/**
 * One poll cycle. Resolves with true if any files were merged, false if
 * nothing changed. NEVER throws — caller is the setTimeout loop and we
 * want it to keep running through transient errors.
 */
async function runOneTick(channelId: string, plan: Plan): Promise<boolean> {
  if (plan !== "PRO") return false;

  const lastMsgId = useFileStore.getState().lastIndexMsgId;
  if (lastMsgId <= 0) {
    // Bootstrap hasn't recorded a cursor yet — skip. Next start() call
    // (after bootstrap completes) will re-evaluate.
    return false;
  }

  let mergedAny = false;
  try {
    const result = await withTelegramRetry(
      () => loadIndexIncremental(channelId, lastMsgId),
      "remoteSync.loadIndexIncremental",
      3,
    );

    if (result.files.length > 0) {
      await useFileStore.getState().setRemoteDelta(result.files);
      mergedAny = true;
      logEvent({
        type: "sync.remoteDelta",
        payload: { fileCount: result.files.length, highestMsgId: result.highestMsgId },
      });
    }

    if (result.highestMsgId > lastMsgId) {
      useFileStore.getState().setLastIndexMsgId(result.highestMsgId);
    }
  } catch (err) {
    // withTelegramRetry has already classified and logged; just keep the
    // loop alive. Hard errors (AUTH_KEY_UNREGISTERED, etc.) cause the
    // wrapper to throw after retries are exhausted — caller (start) should
    // also stop on hard errors, but we handle that at the start level by
    // catching here.
    console.warn("[remoteSync] tick failed (will retry next interval):", err);
    return false;
  }

  // Briefly show the "syncing-remote" indicator so the user knows the
  // background loop is alive, then return to idle.
  if (mergedAny) {
    state.lastTickAt = Date.now();
    flashSyncIndicator();
  }
  return mergedAny;
}

function flashSyncIndicator(): void {
  const { setIndexQueueState } = useFileStore.getState();
  setIndexQueueState("syncing-remote");
  // After a short hold, drop back to idle (unless something else has taken
  // over the indicator in the meantime — useFileStore is the source of
  // truth, so we just set to "idle" when our window closes).
  setTimeout(() => {
    if (useFileStore.getState().indexQueueState === "syncing-remote") {
      setIndexQueueState("idle");
    }
  }, SYNC_INDICATOR_MIN_MS);
}

function scheduleNext(channelId: string, plan: Plan): void {
  if (!state.isRunning) return;
  state.timerId = setTimeout(async () => {
    await runOneTick(channelId, plan);
    scheduleNext(channelId, plan);
  }, POLL_INTERVAL_MS);
}

/**
 * Start the sync loop. Safe to call multiple times — subsequent calls are
 * no-ops unless the plan or channelId changed.
 */
export function startRemoteSync(channelId: string, plan: Plan): void {
  if (!channelId) {
    console.warn("[remoteSync] startRemoteSync called without channelId");
    return;
  }
  if (state.isRunning && state.currentChannelId === channelId) {
    // Already polling this channel; just ensure the plan is current by
    // restarting with the new plan if needed.
    if (plan !== "PRO") {
      stopRemoteSync();
    }
    return;
  }
  if (state.isRunning) {
    // Different channel — stop the old loop, start a new one.
    stopRemoteSync();
  }
  state.isRunning = true;
  state.currentChannelId = channelId;
  state.lastTickAt = 0;

  if (plan !== "PRO") {
    // FREE users stay on cold-start sync only. No polling.
    return;
  }

  // Don't start the loop until bootstrap has completed (lastIndexMsgId > 0).
  // If bootstrap hasn't finished yet, the orchestrator component will call
  // startRemoteSync again on bootstrapComplete.
  if (useFileStore.getState().lastIndexMsgId <= 0) {
    return;
  }

  scheduleNext(channelId, plan);
}

/**
 * Stop the sync loop. Used by logout, by orchestrator on auth loss, and
 * when the plan flips to FREE.
 */
export function stopRemoteSync(): void {
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  state.isRunning = false;
  state.currentChannelId = null;
  state.lastTickAt = 0;
  // If we were showing the indicator, drop it.
  if (useFileStore.getState().indexQueueState === "syncing-remote") {
    useFileStore.getState().setIndexQueueState("idle");
  }
}

/**
 * Test/dev hook — manually trigger one tick. Used by the in-app "Sync now"
 * button in Plan & Devices (future). Returns true if any files were merged.
 */
export async function runSyncTickOnce(channelId: string, plan: Plan): Promise<boolean> {
  return runOneTick(channelId, plan);
}

/** Read-only — returns the last successful tick timestamp (0 if never). */
export function getLastSyncTick(): number {
  return state.lastTickAt;
}
