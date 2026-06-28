/**
 * /api/devices/* endpoints. Auth required.
 *
 * Backend returns `{ devices: [...] }` for the list (NOT a bare array) and
 * `{ revoked: true, device: {...} }` for the delete — both shapes mirrored
 * here so the client sees consistent envelopes.
 */
import { apiDelete, apiGet } from './client';
import type { Device } from './types';

export interface ListDevicesResponse {
  devices: Device[];
}

export function listDevices(): Promise<ListDevicesResponse> {
  return apiGet<ListDevicesResponse>('/api/devices');
}

export interface RevokeDeviceResponse {
  revoked: true;
  device: Pick<Device, 'id' | 'deviceName' | 'os'>;
}

export function revokeDevice(deviceId: string): Promise<RevokeDeviceResponse> {
  return apiDelete<RevokeDeviceResponse>(`/api/devices/${encodeURIComponent(deviceId)}`);
}