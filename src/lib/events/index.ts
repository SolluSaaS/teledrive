/**
 * Fire-and-forget activity event logger.
 *
 * The desktop calls `logEvent({ type, payload? })` at every action success
 * point (upload finished, file renamed, multi-device sync merged, etc.).
 * The POST to `/api/events/log` is non-blocking — the call site uses
 * `void logEvent(...)` and we swallow errors with `console.warn`.
 *
 * Why fire-and-forget:
 *   - Event logging is best-effort audit, never state. A failed POST
 *     shouldn't block the user's actual action.
 *   - The user-facing action has already committed locally + to Telegram
 *     by the time we get here. Retrying on a network blip is not worth
 *     blocking the UI for.
 *   - We don't need a local outbox — the backend's append-only EventLog
 *     is the source of truth, and missing rows are acceptable.
 *
 * The JWT is auto-injected by `apiPost` via the registered getter in
 * `lib/api/client.ts`. No store coupling here — keep this module pure.
 */
import { recordEvent } from '@/lib/api';

/**
 * Known event types. Keep in sync with
 * `teledrive-backend/src/models/EventLog.ts` (`EVENT_TYPES`).
 *
 * The function itself accepts any string up to 64 chars; this list is
 * just for IDE autocomplete and a future lint check.
 */
export type KnownEventType =
  // Single-file CRUD
  | 'file.uploaded'
  | 'file.renamed'
  | 'file.trashed'
  | 'file.restored'
  | 'file.archived'
  | 'file.unarchived'
  | 'file.starred'
  | 'file.unstarred'
  | 'file.deleted'
  | 'file.deleted.acknowledged'
  // Folders
  | 'folder.created'
  // Multi-file batches — payload.count = number of files
  | 'files.moved'
  | 'files.trashed'
  | 'files.restored'
  | 'files.archived'
  | 'files.starred'
  | 'files.unstarred'
  | 'files.deleted'
  // Sync / backup
  | 'sync.remoteDelta'
  | 'backup.manual'
  | 'backup.auto';

export interface LogEventOptions {
  type: KnownEventType | string;
  /** Event-specific data. Keep JSON-safe: primitives + nested objects. */
  payload?: Record<string, unknown>;
  /**
   * Override the wall-clock timestamp. Defaults to `new Date()`.
   * Useful for tests; the live UI never sets this.
   */
  occurredAt?: string;
}

/**
 * Append an event row to the backend audit log. Swallows all errors —
 * event logging must never interrupt the calling code path.
 */
export function logEvent(opts: LogEventOptions): void {
  const occurredAt = opts.occurredAt ?? new Date().toISOString();
  void recordEvent({
    type: opts.type,
    payload: opts.payload ?? {},
    occurredAt,
  }).catch((err) => {
    console.warn(`[events] log failed for "${opts.type}":`, err);
  });
}