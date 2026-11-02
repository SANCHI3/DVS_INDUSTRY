import express, { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as CameraController from '../controllers/camera.controller';
import { cameraIdParamSchema, heartbeatSchema } from '../validators/camera.validator';
import { ROLES } from '../constants';

/**
 * Factory CCTV status. The perception PC inside the factory pushes heartbeats
 * and snapshots out to here; nothing here ever connects to the cameras.
 */
const router = Router();
router.use(authenticate);

// Same readers as the Security page
const SEC_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION] as const;
const SERVICE = [ROLES.PERCEPTION_SERVICE] as const;

/**
 * POST /api/v1/cameras/heartbeat
 * Body: { instanceId, source: live|dev, info?, cameras: [{ id, channel, name, zone, status, ... }] }
 * Every ~30 s from each perception service. Access: PERCEPTION_SERVICE
 */
router.post(
  '/heartbeat',
  authorize(...SERVICE),
  validateRequest({ body: heartbeatSchema }),
  asyncHandler(CameraController.heartbeat),
);

/**
 * POST /api/v1/cameras/:id/snapshot   (Content-Type: image/jpeg, <= 100 KB, <= 640 px wide)
 * Replaces the camera's latest picture. Access: PERCEPTION_SERVICE
 */
router.post(
  '/:id/snapshot',
  authorize(...SERVICE),
  express.raw({ type: 'image/jpeg', limit: '110kb' }),
  validateRequest({ params: cameraIdParamSchema }),
  asyncHandler(CameraController.uploadSnapshot),
);

/** GET /api/v1/cameras: status of every camera + monitoring PC. Access: ADMIN, MANAGER, PRODUCTION */
router.get('/', authorize(...SEC_READ), asyncHandler(CameraController.listCameras));

/** GET /api/v1/cameras/:id/snapshot: the latest picture (image/jpeg). Access: ADMIN, MANAGER, PRODUCTION */
router.get(
  '/:id/snapshot',
  authorize(...SEC_READ),
  validateRequest({ params: cameraIdParamSchema }),
  asyncHandler(CameraController.getSnapshot),
);

export default router;
