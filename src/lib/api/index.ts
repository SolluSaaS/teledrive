/**
 * Barrel export for the API layer. Import as `from '@/lib/api'`.
 */
export * from './config';
export * from './types';
export * from './client';
export { loginBackend, verifyBackend } from './auth';
export { getMe, patchMe, setProBackupFolders, type MeResponse, type BackupFoldersPayload } from './user';
export { getLicense, deactivateLicense, type LicenseResponse } from './license';
export { listDevices, revokeDevice } from './devices';
export { createOrder } from './payment';
export { recordBackupJob, listBackupHistory } from './backup';
export { recordEvent, listRecentEvents, type RecordEventResponse } from './events';
export { loadRazorpayScript, getRazorpay } from './razorpayLoader';