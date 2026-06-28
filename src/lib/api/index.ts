/**
 * Barrel export for the API layer. Import as `from '@/lib/api'`.
 */
export * from './config';
export * from './types';
export * from './client';
export { loginBackend, verifyBackend } from './auth';
export { getMe, patchMe, type MeResponse } from './user';
export { getLicense, deactivateLicense, type LicenseResponse } from './license';
export { listDevices, revokeDevice } from './devices';
export { createOrder } from './payment';
export { recordBackupJob, listBackupHistory } from './backup';
export { loadRazorpayScript, getRazorpay } from './razorpayLoader';