import type { CameraStatus, IncidentSource } from '@prisma/client';

export interface CameraLive {
  channel: number | null;
  name: string;
  zone: string | null;
  enabled: boolean;
  status: CameraStatus;
  statusDetail: string | null;
  statusSince: Date | null;
  lastHeartbeatAt: Date | null;
  lastFrameAt: Date | null;
  achievedFps: number | null;
  inferMs: number | null;
  /** A change could not be saved; try again on the next heartbeat */
  unsaved: boolean;
}

export interface InstanceLive {
  source: IncidentSource;
  cameraIds: string[];
  info: Record<string, unknown> | null;
  lastHeartbeatAt: Date;
  savedAt: Date | null;
}

export interface SnapshotLive {
  data: Buffer | null;
  at: Date | null;
  savedAt: Date | null;
}

/**
 * Heartbeats and pictures, kept in this process's memory.
 *
 * The CCTV PC reports every 30 s and sends 8 pictures every 2 minutes. Writing
 * each to Neon would keep the free database awake around the clock, so the
 * database only hears about status changes (and a picture every 30 minutes).
 * After a restart the next heartbeat fills this in again within 30 s.
 */
export class CameraState {
  readonly cameras = new Map<string, CameraLive>();
  readonly instances = new Map<string, InstanceLive>();
  readonly snapshots = new Map<string, SnapshotLive>();
  hydrated = false;
}

/** One per process: every CameraService reads the same memory. */
export const sharedCameraState = new CameraState();
