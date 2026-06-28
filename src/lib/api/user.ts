/**
 * /api/user/* endpoints. Auth required.
 */
import { apiGet, apiPatch } from './client';
import type { License, PatchUserRequest, User } from './types';

/**
 * Response shape for GET /api/user/me and PATCH /api/user/me. Includes
 * the active License (with the new `scheduledBackupIntervalMinutes` field)
 * because PATCH may have just updated it.
 */
export interface MeResponse extends User {
  lastLoginAt?: string;
  license: License | null;
}

export function getMe(): Promise<MeResponse> {
  return apiGet<MeResponse>('/api/user/me');
}

export function patchMe(payload: PatchUserRequest): Promise<MeResponse> {
  return apiPatch<MeResponse>('/api/user/me', payload);
}