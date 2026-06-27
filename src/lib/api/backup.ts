/**
 * /api/backup/* endpoints. Auth required.
 *
 * - POST /api/backup/log    — record an audit row for a finished snapshot
 * - GET  /api/backup/history — list the user's most recent 50 runs
 *
 * Idempotent on (userId, scheduledFor) — two devices both running the
 * same tick will dedupe server-side.
 */
import { apiGet, apiPost } from './client';
import type {
  BackupHistoryResponse,
  RecordBackupJobRequest,
} from './types';

export function recordBackupJob(payload: RecordBackupJobRequest): Promise<unknown> {
  return apiPost('/api/backup/log', payload);
}

export function listBackupHistory(): Promise<BackupHistoryResponse> {
  return apiGet<BackupHistoryResponse>('/api/backup/history');
}