/**
 * /api/user/* endpoints. Auth required.
 */
import { apiGet, apiPatch } from './client';
import type { License, PatchUserRequest, User } from './types';

/**
 * Response shape for GET /api/user/me and PATCH /api/user/me. Includes
 * the active License (with the new `scheduledBackupIntervalMinutes` field)
 * because PATCH may have just updated it.
 *
 * `backupFolders` is the Pro-only source-folder configuration for device
 * backup. Lives on the User (not License) because the folders are
 * per-user — multi-device users share the same list, but the manifest is
 * per-device (per desktop install).
 */
export interface MeResponse extends User {
  lastLoginAt?: string;
  license: License | null;
  backupFolders?: { paths: string[]; excludes: string[] };
}

/**
 * Body for PATCH /api/user/me/backup-folders (Pro-only).
 *
 * - paths: absolute local paths the user wants backed up. Order is
 *          preserved but not meaningful — the diff handles dedupe.
 * - excludes: glob patterns (relative to each source root) to skip.
 */
export interface BackupFoldersPayload {
  paths: string[];
  excludes: string[];
}

export function getMe(): Promise<MeResponse> {
  return apiGet<MeResponse>('/api/user/me');
}

export function patchMe(payload: PatchUserRequest): Promise<MeResponse> {
  return apiPatch<MeResponse>('/api/user/me', payload);
}

/**
 * Update the user's Pro backup source-folders list.
 *
 * Backend enforces: PRO plan only (403 otherwise), paths ≤ 5 entries,
 * each path ≤ 256 chars and absolute, excludes ≤ 20 entries each
 * ≤ 128 chars. See teledrive-backend/src/routes/user.ts.
 */
export function setProBackupFolders(
  payload: BackupFoldersPayload,
): Promise<MeResponse> {
  return apiPatch<MeResponse>('/api/user/me/backup-folders', payload);
}