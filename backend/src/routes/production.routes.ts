import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as ProductionController from '../controllers/production.controller';
import {
  createWorkOrderSchema,
  updateWorkOrderSchema,
  workOrderIdParamSchema,
  workOrderQuerySchema,
  workOrderStatusSchema,
  createOutputSchema,
  updateOutputSchema,
  outputIdParamSchema,
  outputQuerySchema,
  productionKpiQuerySchema,
  productionTrendQuerySchema,
  targetMonthParamSchema,
  targetYearQuerySchema,
  saveTargetSchema,
} from '../validators/production.validator';
import { ROLES } from '../constants';

const router = Router();
router.use(authenticate);

// ── Role groups ───────────────────────────────────────────────────────────────
const PROD_WRITE = [ROLES.ADMIN, ROLES.PRODUCTION] as const;
const PROD_MANAGE = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION] as const;
const PROD_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION, ROLES.HR] as const;
// Company-wide targets are a management decision
const TARGET_EDIT = [ROLES.ADMIN, ROLES.MANAGER] as const;

// ════════════════════════════════════════════════════════════════
// KPIs & TREND  (before parameterised routes to avoid conflicts)
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/production/kpis
 * Production KPIs — counts, quantities, completion/rejection rates, by-status breakdown.
 * Query: ?departmentId ?fromDate ?toDate
 * Access: ADMIN, MANAGER, PRODUCTION, HR
 */
router.get(
  '/kpis',
  authorize(...PROD_READ),
  validateRequest({ query: productionKpiQuerySchema }),
  asyncHandler(ProductionController.getKPIs),
);

/**
 * GET /api/v1/production/trend
 * Daily production output trend for last N days (7 or 30).
 * Query: ?days ?departmentId
 * Access: ADMIN, MANAGER, PRODUCTION, HR
 */
router.get(
  '/trend',
  authorize(...PROD_READ),
  validateRequest({ query: productionTrendQuerySchema }),
  asyncHandler(ProductionController.getProductionTrend),
);

// ════════════════════════════════════════════════════════════════
// MONTHLY TARGETS & KPI THRESHOLDS
// ════════════════════════════════════════════════════════════════

/** GET /api/v1/production/targets?year=2026 — targets set for each month of a year */
router.get(
  '/targets',
  authorize(...PROD_READ),
  validateRequest({ query: targetYearQuerySchema }),
  asyncHandler(ProductionController.getTargets),
);

/** GET /api/v1/production/targets/:month/performance — target vs recorded output */
router.get(
  '/targets/:month/performance',
  authorize(...PROD_READ),
  validateRequest({ params: targetMonthParamSchema }),
  asyncHandler(ProductionController.getMonthlyPerformance),
);

/** PUT /api/v1/production/targets/:month — create or update (409 if changed meanwhile) */
router.put(
  '/targets/:month',
  authorize(...TARGET_EDIT),
  validateRequest({ params: targetMonthParamSchema, body: saveTargetSchema }),
  asyncHandler(ProductionController.saveTarget),
);

/** DELETE /api/v1/production/targets/:month */
router.delete(
  '/targets/:month',
  authorize(ROLES.ADMIN),
  validateRequest({ params: targetMonthParamSchema }),
  asyncHandler(ProductionController.deleteTarget),
);

// ════════════════════════════════════════════════════════════════
// WORK ORDERS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/production/work-orders
 * List work orders with filters.
 * Query: ?search ?status ?priority ?departmentId ?clientOrderId ?fromDate ?toDate ?page ?pageSize ?sortBy ?sortOrder
 * Access: ADMIN, MANAGER, PRODUCTION, HR
 */
router.get(
  '/work-orders',
  authorize(...PROD_READ),
  validateRequest({ query: workOrderQuerySchema }),
  asyncHandler(ProductionController.getAllWorkOrders),
);

/**
 * POST /api/v1/production/work-orders
 * Create a new work order (WO number auto-generated).
 * Access: ADMIN, PRODUCTION
 */
router.post(
  '/work-orders',
  authorize(...PROD_WRITE),
  validateRequest({ body: createWorkOrderSchema }),
  asyncHandler(ProductionController.createWorkOrder),
);

/**
 * GET /api/v1/production/work-orders/:id
 * Get a single work order (summary view — no output rows).
 * Access: ADMIN, MANAGER, PRODUCTION, HR
 */
router.get(
  '/work-orders/:id',
  authorize(...PROD_READ),
  validateRequest({ params: workOrderIdParamSchema }),
  asyncHandler(ProductionController.getWorkOrderById),
);

/**
 * GET /api/v1/production/work-orders/:id/detail
 * Get a work order with all its output records.
 * Access: ADMIN, MANAGER, PRODUCTION, HR
 */
router.get(
  '/work-orders/:id/detail',
  authorize(...PROD_READ),
  validateRequest({ params: workOrderIdParamSchema }),
  asyncHandler(ProductionController.getWorkOrderDetail),
);

/**
 * PATCH /api/v1/production/work-orders/:id
 * Update work order fields (product, dates, assignment, notes, etc.).
 * Access: ADMIN, PRODUCTION
 */
router.patch(
  '/work-orders/:id',
  authorize(...PROD_WRITE),
  validateRequest({ params: workOrderIdParamSchema, body: updateWorkOrderSchema }),
  asyncHandler(ProductionController.updateWorkOrder),
);

/**
 * PATCH /api/v1/production/work-orders/:id/status
 * Status transition shortcut — validates state-machine rules.
 * Body: { status, actualStart?, actualEnd?, notes? }
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.patch(
  '/work-orders/:id/status',
  authorize(...PROD_MANAGE),
  validateRequest({ params: workOrderIdParamSchema, body: workOrderStatusSchema }),
  asyncHandler(ProductionController.transitionStatus),
);

/**
 * DELETE /api/v1/production/work-orders/:id
 * Soft-delete (sets deletedAt + status CANCELLED).
 * Cannot delete COMPLETED work orders.
 * Access: ADMIN only
 */
router.delete(
  '/work-orders/:id',
  authorize(ROLES.ADMIN),
  validateRequest({ params: workOrderIdParamSchema }),
  asyncHandler(ProductionController.deleteWorkOrder),
);

// ════════════════════════════════════════════════════════════════
// OUTPUT RECORDS  (nested under /work-orders/:id/outputs)
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/production/work-orders/:id/outputs
 * List output records for a work order.
 * Query: ?fromDate ?toDate ?page ?pageSize ?sortOrder
 * Access: ADMIN, MANAGER, PRODUCTION, HR
 */
router.get(
  '/work-orders/:id/outputs',
  authorize(...PROD_READ),
  validateRequest({ params: workOrderIdParamSchema, query: outputQuerySchema }),
  asyncHandler(ProductionController.getOutputs),
);

/**
 * POST /api/v1/production/work-orders/:id/outputs
 * Record production output (good / rejected / scrap quantities).
 * Work order must be RELEASED or IN_PROGRESS.
 * Access: ADMIN, PRODUCTION
 */
router.post(
  '/work-orders/:id/outputs',
  authorize(...PROD_WRITE),
  validateRequest({ params: workOrderIdParamSchema, body: createOutputSchema }),
  asyncHandler(ProductionController.addOutput),
);

/**
 * PATCH /api/v1/production/work-orders/:id/outputs/:outputId
 * Correct an existing output entry.
 * Access: ADMIN, PRODUCTION
 */
router.patch(
  '/work-orders/:id/outputs/:outputId',
  authorize(...PROD_WRITE),
  validateRequest({ params: outputIdParamSchema, body: updateOutputSchema }),
  asyncHandler(ProductionController.updateOutput),
);

/**
 * DELETE /api/v1/production/work-orders/:id/outputs/:outputId
 * Delete an output entry (correction / mistake).
 * Access: ADMIN, PRODUCTION
 */
router.delete(
  '/work-orders/:id/outputs/:outputId',
  authorize(...PROD_WRITE),
  validateRequest({ params: outputIdParamSchema }),
  asyncHandler(ProductionController.deleteOutput),
);

export default router;
