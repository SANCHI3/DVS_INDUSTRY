import api, { unwrap } from '../api';

export type CameraStatus = 'CONNECTING' | 'ONLINE' | 'OFFLINE' | 'VIDEO_LOSS';

export interface CameraDto {
  id: string;
  channel: number | null;
  name: string;
  zone: string | null;
  plantName?: string;
  plantZone?: string | null;
  enabled: boolean;
  status: CameraStatus;
  statusDetail: string | null;
  statusSince: string | null;
  lastHeartbeatAt: string | null;
  lastFrameAt: string | null;
  achievedFps: number | null;
  inferMs: number | null;
  hasSnapshot: boolean;
  snapshotAt: string | null;
  lastDetection: { incidentId: number; incidentNumber: string; type: string; occurredAt: string } | null;
  sources: string[];
  duplicate: boolean;
}

export interface MonitoringDto {
  state: 'online' | 'offline' | 'never';
  since: string | null;
  lastSeenAt?: string | null;
  offlineAlert?: boolean;
  version?: string | null;
  lastUpdateCheck?: string | null;
  updateWaiting?: string | null;
  updatesOff?: boolean;
  notice?: string | null;
  liveEnabled?: boolean;
  instances: Array<{ id: string; source: 'LIVE' | 'DEV'; online: boolean; lastHeartbeatAt: string }>;
}

export interface CamerasOverview {
  cameras: CameraDto[];
  monitoring: MonitoringDto;
}

export type LiveQuality = 'sd' | 'hd';
export type LiveAccess =
  | { available: true; token: string; whepUrl: string; hlsUrl: string; expiresAt: string }
  | { available: false; reason: 'monitoring-offline' | 'camera-offline' | 'not-enabled' };

/** A 2-minute pass for one camera's live video, or why there is none. */
export async function getLivePass(id: string, quality: LiveQuality): Promise<LiveAccess> {
  return unwrap(await api.get(`/cameras/${encodeURIComponent(id)}/live-token`, { params: { quality } }));
}

/** The name and area shown everywhere. Empty goes back to what the plant reports. */
export async function renameCamera(id: string, names: { name: string; zone: string }): Promise<void> {
  await api.patch(`/cameras/${encodeURIComponent(id)}`, names);
}

export async function getCameras(): Promise<CamerasOverview> {
  return unwrap(await api.get('/cameras'));
}

/** The camera's latest picture as a Blob (the API needs the bearer token, so no plain <img src>). */
export async function getCameraSnapshot(id: string): Promise<Blob> {
  const res = await api.get(`/cameras/${encodeURIComponent(id)}/snapshot`, { responseType: 'blob' });
  return res.data as Blob;
}
