import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as AnalyticsController from '../controllers/analytics.controller';
import {
  analyticsQuerySchema,
  materialIdParamSchema,
  productionAnalyticsQuerySchema,
} from '../validators/analytics.validator';
import { ROLES } from '../constants';

const router = Router();
router.use(authenticate);

const STORE_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.STORE] as const;
const PRODUCTION_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION] as const;
const MANAGEMENT_ROLES = [ROLES.ADMIN, ROLES.MANAGER] as const;

/**
 * GET /api/v1/analytics/inventory
 * Demand forecast, dynamic reorder point / safety stock / EOQ, ABC-XYZ class
 * and stock-out prediction per material, plus stock-movement anomalies.
 * Query: historyDays, horizonDays, serviceLevel, defaultLeadTimeDays, orderCost, holdingRate
 */
router.get(
  '/inventory',
  authorize(...STORE_ROLES),
  validateRequest({ query: analyticsQuerySchema }),
  asyncHandler(AnalyticsController.getInventoryIntelligence),
);

/**
 * GET /api/v1/analytics/inventory/:materialId/forecast
 * Daily history, forecast with 80% prediction interval and projected stock.
 */
router.get(
  '/inventory/:materialId/forecast',
  authorize(...STORE_ROLES),
  validateRequest({ params: materialIdParamSchema, query: analyticsQuerySchema }),
  asyncHandler(AnalyticsController.getMaterialForecast),
);

/**
 * GET /api/v1/analytics/production
 * OEE-style index per department, weekly quality trend and p-chart (SPC).
 * Query: historyDays, department
 */
router.get(
  '/production',
  authorize(...PRODUCTION_ROLES),
  validateRequest({ query: productionAnalyticsQuerySchema }),
  asyncHandler(AnalyticsController.getProductionPerformance),
);

/**
 * GET /api/v1/analytics/plant-health
 * Composite 0-100 Plant Health Index (inventory, production, quality, safety,
 * workforce) with safety-quality correlation and prioritised insights.
 */
router.get(
  '/plant-health',
  authorize(...MANAGEMENT_ROLES),
  validateRequest({ query: analyticsQuerySchema }),
  asyncHandler(AnalyticsController.getPlantHealth),
);

export default router;
