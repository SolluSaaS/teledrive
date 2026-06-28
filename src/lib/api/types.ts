/**
 * Mirrored types from `teledrive-backend` (Fastify + Mongoose).
 *
 * Keep in sync with:
 *   - teledrive-backend/src/routes/auth.ts         (LoginResponse, VerifyResponse)
 *   - teledrive-backend/src/routes/payment.ts      (CreateOrderResponse)
 *   - teledrive-backend/src/routes/license.ts      (LicenseResponse)
 *   - teledrive-backend/src/routes/devices.ts      (DeviceResponse)
 *   - teledrive-backend/src/routes/user.ts         (UserResponse)
 *   - teledrive-backend/src/models/User.ts         (Plan enum)
 *   - teledrive-backend/src/models/Device.ts       (OS enum)
 *
 * Manual mirror for now. When the backend schema stabilizes, consider
 * generating these via `tsc --emitDeclarationOnly` from a shared package,
 * but a 1-pager comment is cheaper than the build pipeline for v1.
 */

/** Subscription plan. Free users get 1 device; Pro users get 2. */
export type Plan = 'FREE' | 'PRO';

/** Operating system of the desktop install. Matches the backend Device model enum. */
export type OS = 'macos' | 'windows' | 'linux' | 'ios' | 'android';

/** Status of a license record. */
export type LicenseStatus = 'active' | 'expired' | 'refunded' | 'cancelled';

/** Active device entry returned by /api/devices and embedded in /api/auth/login. */
export interface Device {
  id: string;
  deviceName: string;
  os: OS;
  activatedAt: string; // ISO 8601
  lastSeenAt: string;  // ISO 8601
}

/** License record returned by /api/license and embedded in /api/auth/login. */
export interface License {
  id: string;
  plan: Plan;
  status: LicenseStatus;
  deviceLimit: number;
  purchasedAt: string; // ISO 8601
  expiresAt: string | null; // null for lifetime
  /**
   * Pro-only: user-configured cadence for automatic backup snapshots.
   * null = disabled. Lives on the License (not User) so promo licenses
   * can carry their own override. Backend enforces PRO-only writes —
   * see routes/user.ts PATCH /api/user/me.
   */
  scheduledBackupIntervalMinutes?: number | null;
}

/** User profile. */
export interface User {
  telegramUserId: string;
  phoneNumber: string;
  plan: Plan;
  createdAt?: string;
}

/** Body for POST /api/auth/login. */
export interface LoginRequest {
  telegramUserId: string;
  phoneNumber: string;
  installationId: string; // SHA-256 hex of the raw UUID
  deviceName: string;
  os: OS;
}

/** Body for POST /api/auth/verify. */
export interface VerifyRequest {
  jwt: string;
  /**
   * Optional. When present, the backend bumps the matching device's
   * lastSeenAt (touchDevice) so the Plan & Devices panel shows this
   * device as "online now" instead of "last seen N days ago".
   */
  installationId?: string;
}

/** Body for PATCH /api/user/me. */
export interface PatchUserRequest {
  phoneNumber?: string;
  /**
   * Pro-only: minutes between automatic backup snapshots. null = disabled.
   * Backend enforces 1..10080 and PRO-only writes.
   */
  scheduledBackupIntervalMinutes?: number | null;
}

/**
 * One row in the user's backup-job audit history. Mirrors the
 * teledrive-backend BackupJob model.
 */
export interface BackupJob {
  id: string;
  scheduledFor: string; // ISO 8601
  ranAt: string;        // ISO 8601
  channelId: string;
  snapshotMessageId: number | null;
  fileCount: number;
  totalBytes: number;
  triggeredBy: 'manual' | 'auto';
  status: 'success' | 'failed';
  error: string | null;
}

/** Body for POST /api/backup/log. */
export interface RecordBackupJobRequest {
  scheduledFor: string; // ISO 8601
  channelId: string;
  snapshotMessageId: number | null;
  fileCount: number;
  totalBytes: number;
  triggeredBy: 'manual' | 'auto';
  status: 'success' | 'failed';
  error?: string | null;
}

/** Response from GET /api/backup/history. */
export interface BackupHistoryResponse {
  items: BackupJob[];
}

/**
 * One row in the user's activity audit trail. Mirrors the
 * teledrive-backend EventLog model.
 */
export interface EventLog {
  id: string;
  /** Event type. Free-form; known values listed in EVENT_TYPES. */
  type: string;
  /** Event-specific data. JSON-safe primitives + nested objects only. */
  payload: Record<string, unknown>;
  /** When the event happened on the desktop. */
  occurredAt: string; // ISO 8601
  /** When the backend persisted the row. */
  createdAt: string;  // ISO 8601
}

/** Body for POST /api/events/log. */
export interface RecordEventRequest {
  type: string;
  payload?: Record<string, unknown>;
  occurredAt?: string; // ISO 8601
}

/** Response from GET /api/events/recent. */
export interface EventRecentResponse {
  items: EventLog[];
}

/** Response from /api/auth/login. */
export interface LoginResponse {
  jwt: string;
  user: User;
  plan: Plan;
  license: License | null;
  activeDevices: Device[];
  deviceLimit: number;
  canActivateDevice: boolean;
}

/** Response from /api/auth/verify. Same shape as LoginResponse minus jwt. */
export type VerifyResponse = Omit<LoginResponse, 'jwt'>;

/** Response from /api/payment/create-order. */
export interface CreateOrderResponse {
  orderId: string;
  amount: number;     // paise (smallest currency unit)
  currency: string;   // 'INR'
  plan: Plan;
  keyId: string;      // Razorpay key id — safe to expose to frontend
}

/** Standard error envelope from the backend (matches middleware/error.ts). */
export interface ApiErrorBody {
  error?: string;
  message?: string;
  statusCode?: number;
}