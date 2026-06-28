/**
 * Typed `fetch` wrapper for the teledrive-backend.
 *
 * - Builds URLs from `API_BASE_URL` (config.ts).
 * - JSON-encodes bodies and parses responses.
 * - Auto-injects `Authorization: Bearer <jwt>` if a JWT getter is registered
 *   and returns a non-null token. The getter is registered by the license
 *   store at boot; this avoids a circular dependency between the client and
 *   the store.
 * - Handles 401 by calling a registered handler (also from the store) so
 *   the store can wipe its JWT and surface a toast.
 * - 15s default timeout via AbortController; overridable per call.
 *
 * No axios, no extra deps.
 */
import { API_BASE_URL } from './config';
import type { ApiErrorBody } from './types';

/** Default per-request timeout. Override via `apiGet(..., { timeoutMs: 30_000 })`. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Thrown by every API helper when the server returns a non-2xx response or
 * the request fails at the network layer. Carries the HTTP status (when
 * available) and the parsed body (when JSON).
 */
export class ApiError extends Error {
  status: number;
  body: ApiErrorBody | string | null;

  constructor(message: string, status: number, body: ApiErrorBody | string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** JWT getter — registered by the license store on import. */
let getJwtFn: (() => Promise<string | null>) | null = null;
/** 401 handler — registered by the license store on import. */
let onUnauthorizedFn: ((reason: string) => void) | null = null;

/**
 * Register the function used to fetch the current JWT. Called once by
 * `licenseStore` at module load. Re-registering replaces the prior getter.
 */
export function setJwtGetter(fn: () => Promise<string | null>): void {
  getJwtFn = fn;
}

/**
 * Register a handler invoked when the backend returns 401. The license
 * store uses this to wipe its in-memory JWT + Stronghold entry and surface
 * a "session expired" toast.
 */
export function setUnauthorizedHandler(fn: (reason: string) => void): void {
  onUnauthorizedFn = fn;
}

/** Options accepted by every API helper. */
export interface ApiRequestOptions {
  /** Extra headers to merge in (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>;
  /** Request timeout in ms. Default 15s. */
  timeoutMs?: number;
  /** Skip the Authorization header even if a JWT is available. */
  skipAuth?: boolean;
}

interface InternalOptions extends ApiRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/** Internal core — handles URL build, headers, timeout, JSON, error parsing. */
async function apiFetch<T>(path: string, opts: InternalOptions): Promise<T> {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (!opts.skipAuth && getJwtFn) {
    const jwt = await getJwtFn();
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `Request timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
          : err.message
        : 'Network request failed';
    throw new ApiError(message, 0, null);
  } finally {
    clearTimeout(timer);
  }

  // Parse body (may be empty for 204).
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && onUnauthorizedFn) {
      onUnauthorizedFn(typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as ApiErrorBody).message ?? 'Session expired')
        : 'Session expired');
    }
    throw new ApiError(
      typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as ApiErrorBody).message ?? res.statusText)
        : res.statusText,
      res.status,
      parsed as ApiErrorBody | string | null,
    );
  }

  return parsed as T;
}

export function apiGet<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
  return apiFetch<T>(path, { ...opts, method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown, opts?: ApiRequestOptions): Promise<T> {
  return apiFetch<T>(path, { ...opts, method: 'POST', body });
}

export function apiPatch<T>(path: string, body?: unknown, opts?: ApiRequestOptions): Promise<T> {
  return apiFetch<T>(path, { ...opts, method: 'PATCH', body });
}

export function apiDelete<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
  return apiFetch<T>(path, { ...opts, method: 'DELETE' });
}