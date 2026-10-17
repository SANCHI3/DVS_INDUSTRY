import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateRequest } from '../middleware/validateRequest';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import type { AuthenticatedRequest } from '../types';
import { AssistantService } from './assistant.service';
import { ASSISTANT_ROLES } from './tools';

export const askSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Please type a question')
    .max(500, 'Questions can be at most 500 characters'),
});

/** Built on first use so tests can mock env before the LLM client is created. */
let service: AssistantService | null = null;
function getService(): AssistantService {
  service ??= new AssistantService();
  return service;
}

/** 20 questions per user per 10 minutes (keyed by user, not IP). */
const askLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `assistant:${(req as AuthenticatedRequest).user?.id ?? 'anonymous'}`,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message:
        'You have asked 20 questions in 10 minutes. Please wait a few minutes and try again.',
    },
  },
});

const router = Router();

router.use(authenticate, authorize(...ASSISTANT_ROLES));

/** GET /api/v1/assistant/status → { configured } */
router.get('/status', (_req, res: Response) => {
  sendSuccess(res, { configured: getService().configured });
});

/** POST /api/v1/assistant/ask { question } → { answer, toolsUsed, sources, grounded } */
router.post(
  '/ask',
  askLimiter,
  validateRequest({ body: askSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { question } = req.body as z.infer<typeof askSchema>;
    const user = req.user!;
    const result = await getService().ask(
      question,
      { id: user.id, email: user.email, role: user.role },
      { ipAddress: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null },
    );
    sendSuccess(res, result);
  }),
);

export default router;
