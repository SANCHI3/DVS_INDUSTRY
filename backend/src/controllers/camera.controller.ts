import type { Request, Response } from 'express';
import { CameraService } from '../services/camera.service';
import { sendNoContent, sendSuccess } from '../utils/response';
import type { HeartbeatInput } from '../validators/camera.validator';

const cameraService = new CameraService();

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

export async function getSnapshot(req: Request, res: Response): Promise<void> {
  const { data, at } = await cameraService.getSnapshot(String(req.params['id']));
  res.setHeader('Content-Type', 'image/jpeg');
  // Private: only signed-in users fetch it, and only through the API
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (at) res.setHeader('Last-Modified', at.toUTCString());
  res.send(data);
}
