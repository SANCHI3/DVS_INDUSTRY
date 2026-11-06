import express, { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as CameraController from '../controllers/camera.controller';
import {
  cameraIdParamSchema,
  cameraRenameSchema,
  heartbeatSchema,
  liveTokenQuerySchema,
  streamAuthSchema,
} from '../validators/camera.validator';
import { ROLES } from '../constants';

/**
 * Factory CCTV status. The perception PC inside the factory pushes heartbeats
 * and snapshots out to here; nothing here ever connects to the cameras.
 */
const router = Router();

/**
 * POST /api/v1/cameras/stream-auth
 * Asked by the video server on the CCTV PC before it shows anyone a stream.
 * It cannot sign in, so this route is open: the answer depends only on the
 * signed 2-minute pass from /live-token. 200 = allow, 401 = refuse.
 */
router.post(
  '/stream-auth',
  validateRequest({ body: streamAuthSchema }),
  CameraController.streamAuth,
);

router.use(authenticate);

// Same readers as the Security page
const SEC_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION] as const;
const SERVICE = [ROLES.PERCEPTION_SERVICE] as const;

/** GET /api/v1/cameras/ping: lets the installer check the service key. Access: PERCEPTION_SERVICE */
router.get('/ping', authorize(...SERVICE), CameraController.ping);

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

/**
 * PATCH /api/v1/cameras/:id
 * Body: { name?, zone? }. The name and area shown everywhere; heartbeats never
 * change them. Access: ADMIN
 */
router.patch(
  '/:id',
  authorize(ROLES.ADMIN),
  validateRequest({ params: cameraIdParamSchema, body: cameraRenameSchema }),
  asyncHandler(CameraController.renameCamera),
);

/** GET /api/v1/cameras/:id/snapshot: the latest picture (image/jpeg). Access: ADMIN, MANAGER, PRODUCTION */
router.get(
  '/:id/snapshot',
  authorize(...SEC_READ),
  validateRequest({ params: cameraIdParamSchema }),
  asyncHandler(CameraController.getSnapshot),
);

/**
 * GET /api/v1/cameras/:id/live-token?quality=sd|hd
 * A 2-minute pass for one camera's live video, or why there is none.
 * Each viewing is written to the audit log. Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/:id/live-token',
  authorize(...SEC_READ),
  validateRequest({ params: cameraIdParamSchema, query: liveTokenQuerySchema }),
  CameraController.liveToken,
);

export default router;
