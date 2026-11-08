import type { Request, Response } from 'express';
import { AuditRepository } from '../repositories/audit.repository';
import { CameraService, type LiveQuality } from '../services/camera.service';
import type { AuthenticatedRequest } from '../types';
import { decideStreamAuth } from '../utils/liveToken';
import { streamAuthLog } from '../utils/streamAuthLog';
import { sendNoContent, sendSuccess } from '../utils/response';
import type {
  CameraRenameInput,
  HeartbeatInput,
  StreamAuthInput,
} from '../validators/camera.validator';

const cameraService = new CameraService();
const auditRepo = new AuditRepository();

/** One audit line per person and camera, not one per renewed pass. */
const LIVE_AUDIT_EVERY_MS = 10 * 60_000;
const lastLiveAudit = new Map<string, number>();

export function ping(_req: Request, res: Response): void {
  sendSuccess(res, { ok: true });
}

export async function heartbeat(req: Request, res: Response): Promise<void> {
  const result = await cameraService.heartbeat(req.body as HeartbeatInput);
  sendSuccess(res, result, 200, 'Heartbeat received');
}

export async function uploadSnapshot(req: Request, res: Response): Promise<void> {
  await cameraService.saveSnapshot(String(req.params['id']), req.body);
  sendNoContent(res);
}

export async function listCameras(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await cameraService.list());
}

export async function renameCamera(req: Request, res: Response): Promise<void> {
  const names = await cameraService.rename(String(req.params['id']), req.body as CameraRenameInput);
  sendSuccess(res, names, 200, 'Camera updated');
}

export async function getSnapshot(req: Request, res: Response): Promise<void> {
  const { data, at } = await cameraService.getSnapshot(String(req.params['id']));
  res.setHeader('Content-Type', 'image/jpeg');
  // Private: only signed-in users fetch it, and only through the API
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (at) res.setHeader('Last-Modified', at.toUTCString());
  res.send(data);
}

export function liveToken(req: AuthenticatedRequest, res: Response): void {
  const id = String(req.params['id']);
  const quality = (req.query['quality'] ?? 'sd') as LiveQuality;
  const user = req.user;
  const access = cameraService.liveAccess(id, quality, user?.id ?? 0);
  if (access.available && user) {
    const key = `${user.id}:${id}`;
    const now = Date.now();
    if (now - (lastLiveAudit.get(key) ?? 0) >= LIVE_AUDIT_EVERY_MS) {
      lastLiveAudit.set(key, now);
      void auditRepo.log({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'LIVE_VIEW',
        entity: 'Camera',
        entityId: id,
        method: req.method,
        path: req.originalUrl.split('?')[0] ?? req.originalUrl,
        statusCode: 200,
        after: { quality },
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
    }
  }
  sendSuccess(res, access);
}

export function streamAuth(req: Request, res: Response): void {
  const body = req.body as StreamAuthInput;
  const { allowed, reason } = decideStreamAuth(body);
  streamAuthLog.add({
    path: body.path,
    protocol: body.protocol,
    action: body.action,
    allowed,
    reason,
  });
  res.status(allowed ? 200 : 401).end();
}

export async function liveCheck(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await cameraService.liveCheck());
}
