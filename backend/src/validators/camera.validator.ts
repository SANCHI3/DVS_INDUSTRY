import { z } from 'zod';

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

export const cameraStatusEnum = z.enum(['CONNECTING', 'ONLINE', 'OFFLINE', 'VIDEO_LOSS']);

const cameraHeartbeatItem = z.object({
  id: z.string().regex(SAFE_ID, 'Camera id: letters, digits, . _ - only'),
  channel: z.coerce.number().int().min(1).max(64).optional().nullable(),
  name: z.string().min(1).max(100).trim(),
  zone: z.string().max(100).trim().optional().nullable(),
  enabled: z.boolean().optional().default(true),
  status: cameraStatusEnum,
  statusDetail: z.string().max(200).trim().optional().nullable(),
  lastFrameAt: z.coerce.date().optional().nullable(),
  achievedFps: z.number().min(0).max(1000).optional().nullable(),
  inferMs: z.number().min(0).max(600_000).optional().nullable(),
});

/** POST /cameras/heartbeat: every camera's status from one perception service. */
export const heartbeatSchema = z.object({
  instanceId: z.string().regex(SAFE_ID, 'Instance id: letters, digits, . _ - only'),
  source: z
    .enum(['live', 'dev', 'LIVE', 'DEV'])
    .optional()
    .default('live')
    .transform((s) => s.toUpperCase() as 'LIVE' | 'DEV'),
  // Device, connection path, queue size; small and free-form
  info: z
    .record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
    .optional()
    .refine((v) => v === undefined || Object.keys(v).length <= 20, 'Too many info fields'),
  cameras: z.array(cameraHeartbeatItem).max(64),
});

export const cameraIdParamSchema = z.object({
  id: z.string().regex(SAFE_ID, 'Invalid camera id'),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
export type CameraHeartbeatItem = z.infer<typeof cameraHeartbeatItem>;
