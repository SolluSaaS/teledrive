/**
 * Stable per-install device identity.
 *
 * On first call, generates a UUIDv4 with `crypto.randomUUID()` and persists
 * it in Tauri Stronghold. Every subsequent call returns the same ID — the
 * user can install, uninstall, and reinstall the app and the same machine
 * still maps to the same backend `Device` row.
 *
 * The raw UUID is the secret — it's the only thing that proves "this is the
 * same install". `hashInstallationId()` SHA-256-hashes it before the value
 * ever leaves the device; only the hash reaches the backend
 * (matches `backend/src/utils/hash.ts` → `hashInstallationId`).
 *
 * If Stronghold is unavailable, falls back to localStorage so the app
 * still works. In that degraded state the raw ID sits in plaintext at rest
 * (acceptable for v1 since this is a single-user desktop app).
 */
import { initStronghold, shGet, shSet, shSave } from './stronghold';

const STORAGE_KEY = 'teledrive_installation_id';
const FALLBACK_LS_KEY = 'teledrive_installation_id_fallback';

let cachedRawId: string | null = null;

/**
 * Return a stable per-install UUIDv4 string. Generated lazily on first
 * call. Persisted in Stronghold, with a localStorage fallback.
 */
export async function getOrCreateInstallationId(): Promise<string> {
  if (cachedRawId) return cachedRawId;

  // Try Stronghold first.
  try {
    await initStronghold();
    const existing = await shGet(STORAGE_KEY);
    if (existing) {
      cachedRawId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    await shSet(STORAGE_KEY, fresh);
    await shSave();
    cachedRawId = fresh;
    return fresh;
  } catch (err) {
    console.warn('[deviceId] Stronghold unavailable, falling back to localStorage:', err);
  }

  // Fallback path — plaintext localStorage. Only happens if Stronghold
  // init throws (corrupted snapshot, platform quirk, etc.).
  try {
    const existing = localStorage.getItem(FALLBACK_LS_KEY);
    if (existing) {
      cachedRawId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    localStorage.setItem(FALLBACK_LS_KEY, fresh);
    cachedRawId = fresh;
    return fresh;
  } catch (err) {
    // localStorage blocked too — last resort: ephemeral ID. The user will
    // get a new device row on the backend every cold start, which is
    // acceptable as a degraded mode.
    console.error('[deviceId] localStorage unavailable, using ephemeral ID:', err);
    const fresh = crypto.randomUUID();
    cachedRawId = fresh;
    return fresh;
  }
}

/**
 * SHA-256 hash of the raw installation ID. Returns 64-char lowercase hex.
 * This is what the backend actually sees and what it stores in the Device
 * collection's `hashedDeviceId` field.
 *
 * Must match `backend/src/utils/hash.ts` exactly — both sides hash the
 * raw UUID with SHA-256.
 */
export async function hashInstallationId(raw: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Wipe the cached ID. Used by tests and the "Reset install ID" debug action.
 * Does NOT touch Stronghold or localStorage directly — call the underlying
 * remove APIs separately if you also want to purge persisted state.
 */
export function resetInstallationIdCache(): void {
  cachedRawId = null;
}
