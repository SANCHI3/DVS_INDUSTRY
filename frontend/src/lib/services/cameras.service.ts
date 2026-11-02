import api, { unwrap } from '../api';

export type CameraStatus = 'CONNECTING' | 'ONLINE' | 'OFFLINE' | 'VIDEO_LOSS';

export interface CameraDto {
  id: string;
  channel: number | null;
  name: string;
  zone: string | null;
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
  instances: Array<{ id: string; source: 'LIVE' | 'DEV'; online: boolean; lastHeartbeatAt: string }>;
}

export interface CamerasOverview {
  cameras: CameraDto[];
  monitoring: MonitoringDto;
}

export async function getCameras(): Promise<CamerasOverview> {
  return unwrap(await api.get('/cameras'));
}

/** The camera's latest picture as a Blob (the API needs the bearer token, so no plain <img src>). */
export async function getCameraSnapshot(id: string): Promise<Blob> {
  const res = await api.get(`/cameras/${encodeURIComponent(id)}/snapshot`, { responseType: 'blob' });
  return res.data as Blob;
}
