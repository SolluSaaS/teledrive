/**
 * /api/events/* endpoints. Auth required.
 *
 * - POST /api/events/log    — append an activity event (fire-and-forget
 *                             from the desktop, see lib/events/index.ts)
 * - GET  /api/events/recent — list the user's most recent 100 events
 *
 * Append-only by design — duplicates are accepted and surfaced in the UI
 * as separate rows. Useful when two devices log the same sync.
 */
import { apiGet, apiPost } from './client';
import type { EventLog, RecordEventRequest } from './types';

export interface RecordEventResponse {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export function recordEvent(payload: RecordEventRequest): Promise<RecordEventResponse> {
  return apiPost<RecordEventResponse>('/api/events/log', payload);
}

export function listRecentEvents(limit = 100): Promise<{ items: EventLog[] }> {
  return apiGet<{ items: EventLog[] }>(`/api/events/recent?limit=${limit}`);
}