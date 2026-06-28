/**
 * Backend API base URL configuration.
 *
 * Reads `VITE_API_BASE_URL` from Vite's env handling at build time. In dev
 * the default is `http://localhost:3000` (matches `teledrive-backend`'s
 * default port). For production, set the env to your deployed URL
 * (e.g. `https://teledrive-backend.onrender.com`).
 *
 * Vite injects any var prefixed with `VITE_` into the client bundle — that
 * means the value ends up in JS. That's intentional: the URL is public info
 * (we still need CORS on the backend to gate access). Secrets like the JWT
 * are NOT in env — they live in Tauri Stronghold.
 */
const DEFAULT_BASE_URL = 'http://localhost:3000';

/** Resolved at module load. Override at build time via `VITE_API_BASE_URL`. */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  DEFAULT_BASE_URL;

/** Convenience for components / tests that want a fresh lookup. */
export function getBaseUrl(): string {
  return API_BASE_URL;
}