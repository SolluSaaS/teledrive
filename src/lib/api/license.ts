/**
 * /api/license/* endpoints. Auth required.
 */
import { apiGet, apiPost } from './client';
import type { License } from './types';

export interface LicenseResponse {
  active: License | null;
  history: License[];
}

export function getLicense(): Promise<LicenseResponse> {
  return apiGet<LicenseResponse>('/api/license');
}

/** Revoke the user's active license. The user falls back to FREE plan. */
export function deactivateLicense(): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>('/api/license/deactivate');
}