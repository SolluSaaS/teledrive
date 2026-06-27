/**
 * /api/auth/* endpoints.
 */
import { apiPost } from './client';
import type { LoginRequest, LoginResponse, VerifyRequest, VerifyResponse } from './types';

/** Upsert user, activate device, issue JWT. Called after Telegram login. */
export function loginBackend(payload: LoginRequest): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/api/auth/login', payload, { skipAuth: true });
}

/**
 * Re-verify an existing JWT. Called on cold start with a stored token; if
 * 401, the client.ts unauthorized handler wipes the JWT.
 *
 * When `installationId` is provided, the backend bumps the matching
 * device's lastSeenAt (touchDevice) so the Plan & Devices panel shows
 * this device as "online now" instead of "last seen N days ago".
 */
export function verifyBackend(
  jwt: string,
  installationId?: string,
): Promise<VerifyResponse> {
  const body: VerifyRequest = { jwt };
  if (installationId) body.installationId = installationId;
  return apiPost<VerifyResponse>('/api/auth/verify', body, {
    skipAuth: true,
  });
}