import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as InquiryController from '../controllers/inquiry.controller';
import {
  createInquirySchema,
  inquiryIdParamSchema,
  inquiryQuerySchema,
  updateInquiryStatusSchema,
} from '../validators/inquiry.validator';
import { ROLES } from '../constants';

const router = Router();

// The contact form is public, so it gets its own tight limit per IP
const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many inquiries from this network. Please try again in an hour.',
    },
  },
});

/**
 * POST /api/v1/inquiries
 * Website contact form. Public; 5 per hour per IP; honeypot field `website`.
 */
router.post(
  '/',
  inquiryLimiter,
  validateRequest({ body: createInquirySchema }),
  asyncHandler(InquiryController.createInquiry),
);

/**
 * GET /api/v1/inquiries
 * Newest first. Query: ?status ?page ?pageSize
 * Access: ADMIN
 */
router.get(
  '/',
  authenticate,
  authorize(ROLES.ADMIN),
  validateRequest({ query: inquiryQuerySchema }),
  asyncHandler(InquiryController.listInquiries),
);

/**
 * PATCH /api/v1/inquiries/:id
 * Body: { status: NEW | CONTACTED | CLOSED }
 * Access: ADMIN
 */
router.patch(
  '/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  validateRequest({ params: inquiryIdParamSchema, body: updateInquiryStatusSchema }),
  asyncHandler(InquiryController.updateInquiryStatus),
);

export default router;
