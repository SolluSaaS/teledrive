/**
 * License / plan / device store.
 *
 * Owns the backend session (JWT), the cached plan/license/device projection,
 * and the connectivity flag. Decoupled from `authStore` so backend HTTP
 * concerns don't leak into the Telegram session lifecycle.
 *
 * On module load this store registers two callbacks with the API client:
 *   1. `setJwtGetter`  — so authenticated requests can attach Bearer token
 *   2. `setUnauthorizedHandler` — so 401s wipe the JWT + surface a toast
 *
 * Persistence: the JWT lives in Tauri Stronghold (`backend_jwt` key). Plan
 * + license + device list are kept in memory only — they're rehydrated from
 * the next successful `/api/auth/verify` or `/api/auth/login` call.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import {
  setJwtGetter,
  setUnauthorizedHandler,
  loginBackend,
  verifyBackend,
  listDevices,
  revokeDevice,
  patchMe,
} from '@/lib/api';
import type {
  Device,
  License,
  LicenseResponse,
  LoginRequest,
  LoginResponse,
  PatchUserRequest,
  Plan,
  VerifyResponse,
} from '@/lib/api';
import { getOrCreateInstallationId, hashInstallationId } from '@/lib/secure/deviceId';
import { initStronghold, shGet, shRemove, shSave, shSet } from '@/lib/secure/stronghold';

const STRONGHOLD_KEY_JWT = 'backend_jwt';

/**
 * Internal — pulls a fresh projection from `/api/auth/verify` and merges it
 * with the existing plan/license. Called by verify/refresh/login paths so
 * the store always reflects the current backend state.
 *
 * Passes the hashed installationId so the backend can bump this device's
 * lastSeenAt via touchDevice (see teledrive-backend/services/device.service).
 */
async function fetchFullProjection(jwt: string): Promise<VerifyResponse> {
  const installationIdRaw = await getOrCreateInstallationId();
  const installationId = await hashInstallationId(installationIdRaw);
  return verifyBackend(jwt, installationId);
}

interface LicenseState {
  // ── Authenticated backend session ──
  jwt: string | null;
  // ── Cached projection from /api/auth/login or /api/auth/verify ──
  plan: Plan;
  license: License | null;
  activeDevices: Device[];
  deviceLimit: number;
  canActivateDevice: boolean;
  // ── Connectivity ──
  backendReachable: boolean;
  // ── Race guard ──
  inFlightVerify: Promise<void> | null;

  // ── Actions ──
  /** Login + activate this device on the backend. Idempotent on retries. */
  loginToBackend: (params: {
    telegramUserId: string;
    phoneNumber: string;
    deviceName: string;
    os: 'macos' | 'windows' | 'linux' | 'ios' | 'android';
  }) => Promise<void>;
  /**
   * Re-establish a backend session WITHOUT requiring a full Telegram login.
   * Re-derives the telegramUserId from the existing Telegram client and
   * hits /api/auth/login again so a fresh JWT is persisted. Used by the
   * Plan & Devices panel when the user has no stored JWT but is already
   * signed in to Telegram.
   */
  reconnectToBackend: (params: {
    phoneNumber: string;
    deviceName: string;
    os: 'macos' | 'windows' | 'linux' | 'ios' | 'android';
  }) => Promise<void>;
  /** Re-verify a stored JWT. Safe to call multiple times — returns cached promise. */
  verifyBackendSession: () => Promise<void>;
  /** Refresh the cached projection by hitting /api/auth/verify. */
  refreshBackendState: () => Promise<void>;
  /** Wipe JWT + cached state. Does NOT touch the Telegram session. */
  logoutFromBackend: () => Promise<void>;
  /** Revoke one of the user's active devices (e.g. another laptop). */
  revokeDeviceById: (deviceId: string) => Promise<void>;
  /**
   * Update the user's scheduled-backup cadence. Pro-only; backend enforces
   * 403 if the user is not PRO. Pass null to disable. The change is
   * persisted server-side AND mirrored into the in-memory license projection
   * so the UI reflects the new value immediately (no refetch needed).
   */
  setProSchedule: (intervalMinutes: number | null) => Promise<void>;
}

/**
 * Apply a fresh projection (from login or verify) to the store.
 */
function applyProjection(
  set: (partial: Partial<LicenseState>) => void,
  projection: VerifyResponse,
): void {
  set({
    plan: projection.plan,
    license: projection.license,
    activeDevices: projection.activeDevices ?? [],
    deviceLimit: projection.deviceLimit,
    canActivateDevice: projection.canActivateDevice,
    backendReachable: true,
  });
}

async function readStoredJwt(): Promise<string | null> {
  try {
    await initStronghold();
    return await shGet(STRONGHOLD_KEY_JWT);
  } catch {
    return null;
  }
}

async function persistJwt(jwt: string): Promise<void> {
  try {
    await initStronghold();
    await shSet(STRONGHOLD_KEY_JWT, jwt);
    await shSave();
  } catch (err) {
    console.warn('[licenseStore] failed to persist JWT in Stronghold:', err);
  }
}

async function clearPersistedJwt(): Promise<void> {
  try {
    await initStronghold();
    await shRemove(STRONGHOLD_KEY_JWT);
    await shSave();
  } catch (err) {
    console.warn('[licenseStore] failed to clear JWT in Stronghold:', err);
  }
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  jwt: null,
  plan: 'FREE',
  license: null,
  activeDevices: [],
  deviceLimit: 1,
  canActivateDevice: true,
  backendReachable: false,
  inFlightVerify: null,

  async loginToBackend({ telegramUserId, phoneNumber, deviceName, os }) {
    let loginRes: LoginResponse;
    try {
      const installationIdRaw = await getOrCreateInstallationId();
      const installationId = await hashInstallationId(installationIdRaw);
      const payload: LoginRequest = {
        telegramUserId,
        phoneNumber,
        installationId,
        deviceName,
        os,
      };
      loginRes = await loginBackend(payload);
    } catch (err) {
      // Backend unreachable / 4xx / 5xx — degrade gracefully.
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[licenseStore] loginToBackend failed:', message);
      set({ backendReachable: false });
      toast.warning("Couldn't reach the license server", {
        description: 'You can keep using TeleDrive. Try Refresh in Settings → Plan & Devices later.',
      });
      return;
    }

    try {
      await persistJwt(loginRes.jwt);
    } catch {
      // Already logged inside persistJwt.
    }
    set({ jwt: loginRes.jwt });
    applyProjection(set, loginRes);
  },

  async reconnectToBackend({ phoneNumber, deviceName, os }) {
    // Re-derive the REAL telegram user ID from the active Telegram client.
    // The user is already signed in to Telegram (otherwise they wouldn't be
    // seeing the Plan page), so this call MUST succeed — if it doesn't,
    // something is broken upstream (client not initialised, session lost).
    let telegramUserId = '';
    try {
      const { getClient } = await import('@/lib/telegram/client');
      const me = await getClient().getMe();
      telegramUserId = String((me as any)?.id ?? '');
      if (!/^\d{1,64}$/.test(telegramUserId)) {
        throw new Error(`getMe returned non-numeric id: ${JSON.stringify(telegramUserId).slice(0, 80)}`);
      }
    } catch (err) {
      console.warn('[licenseStore] reconnectToBackend: getMe failed:', err);
      toast.error('Could not read Telegram user ID', {
        description:
          'Your Telegram session looks stale. Log out and sign in again from Settings → Telegram Account.',
      });
      return;
    }

    // Delegate to the standard login flow — backend upsert is keyed on
    // telegramUserId so a fresh row only appears if a different account is
    // being signed in. Re-login with the SAME telegramUserId + hashed
    // installationId refreshes the existing device row (no duplicates).
    await get().loginToBackend({ telegramUserId, phoneNumber, deviceName, os });
  },

  verifyBackendSession: async () => {
    const inflight = get().inFlightVerify;
    if (inflight) return inflight;

    const promise = (async () => {
      const jwt = await readStoredJwt();
      if (!jwt) {
        // No stored JWT — nothing to verify. Leave store in initial state.
        set({ backendReachable: false });
        return;
      }
      try {
        const projection = await fetchFullProjection(jwt);
        set({ jwt });
        applyProjection(set, projection);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The 401 handler already wiped the JWT via the registered callback;
        // we just need to mark unreachable and warn if it's not a 401.
        const status = (err as { status?: number })?.status;
        if (status !== 401) {
          console.warn('[licenseStore] verifyBackendSession failed:', message);
          set({ backendReachable: false });
          toast.warning("Couldn't reach the license server", {
            description: 'Using cached state. Refresh in Settings → Plan & Devices to retry.',
          });
        }
      }
    })();

    set({ inFlightVerify: promise });
    try {
      await promise;
    } finally {
      set({ inFlightVerify: null });
    }
  },

  refreshBackendState: async () => {
    const jwt = get().jwt ?? (await readStoredJwt());
    if (!jwt) {
      // No stored JWT — trigger a one-click reconnect. The Plan page also
      // exposes a manual "Reconnect" button for the rare case the auto
      // retry isn't desired.
      const { useAuthStore } = await import('@/stores/authStore');
      const phoneNumber = useAuthStore.getState().phoneNumber;
      if (!phoneNumber) {
        toast.error('Not signed in to the license server', {
          description: 'Reconnect your Telegram account to refresh plan info.',
        });
        return;
      }
      try {
        await get().reconnectToBackend({
          phoneNumber,
          deviceName: (await import('@/lib/secure/deviceInfo')).getDeviceName(),
          os: (await import('@/lib/secure/deviceInfo')).detectOS(),
        });
      } catch {
        // toast already shown by reconnectToBackend / loginToBackend
      }
      return;
    }
    try {
      const projection = await fetchFullProjection(jwt);
      set({ jwt });
      applyProjection(set, projection);
      toast.success('Plan refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number })?.status;
      if (status !== 401) {
        toast.error('Refresh failed', { description: message });
      }
    }
  },

  setProSchedule: async (intervalMinutes) => {
    // Client-side guard for instant feedback; the server is the authoritative
    // gate (it will 403 if the user is no longer PRO). The interval value
    // must be null (disabled) or a positive number of minutes within the
    // backend's accepted range (1..10080 = 1 week).
    if (
      intervalMinutes !== null &&
      (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080)
    ) {
      toast.error('Invalid schedule', {
        description: 'Pick an interval between 1 minute and 1 week.',
      });
      return;
    }
    if (get().plan !== 'PRO') {
      toast.error('Pro feature', {
        description: 'Scheduled backup is available on the Pro plan. Upgrade to enable.',
      });
      return;
    }
    const payload: PatchUserRequest = { scheduledBackupIntervalMinutes: intervalMinutes };
    try {
      const updated = await patchMe(payload);
      // Mirror the response into the cached license so the UI updates
      // immediately. If the backend returned a license, use it; otherwise
      // just patch the existing license's field.
      set((prev) => ({
        license: updated.license
          ? {
              ...prev.license,
              ...updated.license,
              scheduledBackupIntervalMinutes:
                updated.license.scheduledBackupIntervalMinutes ?? null,
            }
          : prev.license,
      }));
      toast.success(
        intervalMinutes ? 'Backup schedule saved' : 'Scheduled backup disabled',
      );
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const message = err instanceof Error ? err.message : String(err);
      if (status === 403) {
        toast.error('Pro feature', {
          description: message || 'Scheduled backup is available on the Pro plan.',
        });
      } else {
        toast.error('Could not save schedule', { description: message });
      }
      throw err;
    }
  },

  logoutFromBackend: async () => {
    // Best-effort: try to revoke the current device row, then wipe the JWT.
    // We don't currently identify our own device id without the hashed ID
    // mapping, so we just confirm connectivity and let the row time out on
    // the next plan flip. Future work: store the device id alongside the
    // JWT in Stronghold so we can DELETE the exact row here.
    const jwt = get().jwt;
    if (jwt) {
      try {
        await listDevices();
      } catch {
        // Ignore — we still wipe the local JWT.
      }
    }
    await clearPersistedJwt();
    set({
      jwt: null,
      plan: 'FREE',
      license: null,
      activeDevices: [],
      deviceLimit: 1,
      canActivateDevice: true,
      backendReachable: false,
    });
  },

  revokeDeviceById: async (deviceId) => {
    const before = get().activeDevices.length;
    try {
      await revokeDevice(deviceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Could not revoke device', { description: message });
      throw err;
    }
    // Refresh the local list.
    await get().refreshBackendState();
    const after = get().activeDevices.length;
    if (after < before) {
      toast.success('Device revoked');
    }
  },
}));

/** Test-only escape hatch — lets the plan-section tests reset state between cases. */
export function __resetLicenseStoreForTests(): void {
  useLicenseStore.setState({
    jwt: null,
    plan: 'FREE',
    license: null,
    activeDevices: [],
    deviceLimit: 1,
    canActivateDevice: true,
    backendReachable: false,
    inFlightVerify: null,
  });
}

// ── Register the API client callbacks exactly once on module load ──

setJwtGetter(async () => {
  const stored = useLicenseStore.getState().jwt;
  if (stored) return stored;
  try {
    return await readStoredJwt();
  } catch {
    return null;
  }
});

setUnauthorizedHandler((reason) => {
  // Wipe in-memory + persisted JWT so subsequent calls don't keep trying
  // a token the backend has rejected.
  void clearPersistedJwt();
  useLicenseStore.setState({ jwt: null, backendReachable: false });
  toast.error('License session expired', {
    description: `${reason}. Reconnect your Telegram account to refresh.`,
  });
});

// Suppress unused-warning for LicenseResponse import (re-exported for callers).
export type { LicenseResponse };
