import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as PortalController from '../controllers/portal.controller';
import { portalPartyQuerySchema, sendPortalMessageSchema } from '../validators/portal.validator';
import { PORTAL_ROLES, PORTAL_STAFF_ROLES } from '../services/portal.service';

const router = Router();

router.use(authenticate);

const PORTAL_AND_STAFF = [...PORTAL_ROLES, ...PORTAL_STAFF_ROLES];

/**
 * GET /api/v1/portal/messages
 * One conversation, oldest first. Suppliers and clients get their own;
 * staff pass ?supplierId or ?clientId.
 */
router.get(
  '/messages',
  authorize(...PORTAL_AND_STAFF),
  validateRequest({ query: portalPartyQuerySchema }),
  asyncHandler(PortalController.getMessages),
);

/** POST /api/v1/portal/messages  { body, supplierId? | clientId? } */
router.post(
  '/messages',
  authorize(...PORTAL_AND_STAFF),
  validateRequest({ body: sendPortalMessageSchema }),
  asyncHandler(PortalController.sendMessage),
);

/** POST /api/v1/portal/messages/read  Marks the other side's messages read. */
router.post(
  '/messages/read',
  authorize(...PORTAL_AND_STAFF),
  validateRequest({ body: portalPartyQuerySchema }),
  asyncHandler(PortalController.markRead),
);

/** GET /api/v1/portal/threads  Staff inbox: one row per supplier / client. */
router.get('/threads', authorize(...PORTAL_STAFF_ROLES), asyncHandler(PortalController.getThreads));

export default router;
