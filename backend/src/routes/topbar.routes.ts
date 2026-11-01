import { Router, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { sendNoContent, sendSuccess } from '../utils/response';
import { NotificationsService } from '../services/notifications.service';
import { SearchService } from '../services/search.service';
import { ROLES } from '../constants';
import type { AuthenticatedRequest } from '../types';

/** The staff top bar: notification bell and search box. */
const STAFF = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.HR,
  ROLES.STORE,
  ROLES.PRODUCTION,
  ROLES.SALES,
] as const;

const notifications = new NotificationsService();
const searcher = new SearchService();

export const notificationsRouter = Router();
notificationsRouter.use(authenticate, authorize(...STAFF));

/**
 * GET /api/v1/notifications
 * Feed for the bell, computed from current data and filtered by role.
 */
notificationsRouter.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    sendSuccess(res, await notifications.list(req.user!));
  }),
);

/**
 * POST /api/v1/notifications/seen
 * The user opened the bell: everything up to now counts as read.
 */
notificationsRouter.post(
  '/seen',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await notifications.markSeen(req.user!.id);
    sendNoContent(res);
  }),
);

const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });

export const searchRouter = Router();
searchRouter.use(authenticate, authorize(...STAFF));

/**
 * GET /api/v1/search?q=
 * Employees, work orders, client orders, purchase orders and materials the
 * role may open; up to 5 of each.
 */
searchRouter.get(
  '/',
  validateRequest({ query: searchQuerySchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { q } = req.query as unknown as z.infer<typeof searchQuerySchema>;
    sendSuccess(res, await searcher.search(req.user!.role, q));
  }),
);
