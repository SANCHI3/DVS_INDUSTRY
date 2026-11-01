import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as ReportsController from '../controllers/reports.controller';
import { reportQuerySchema, attendanceReportQuerySchema } from '../validators/reports.validator';
import { ROLES } from '../constants';

const router = Router();
router.use(authenticate);

// ── Role groups ───────────────────────────────────────────────────────────────
const ALL_ROLES = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.HR,
  ROLES.STORE,
  ROLES.PRODUCTION,
  ROLES.SALES,
] as const;
const REPORT_ROLES = [ROLES.ADMIN, ROLES.MANAGER] as const;
const STORE_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.STORE] as const;
const HR_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.HR] as const;
const SECURITY_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION] as const;

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/reports/dashboard
 * Combined KPIs + chart data in a single call.
 * Access: All authenticated roles
 */
router.get('/dashboard', authorize(...ALL_ROLES), asyncHandler(ReportsController.getDashboard));

/**
 * GET /api/v1/reports/dashboard/kpis
 * KPI numbers only (lightweight).
 * Access: All authenticated roles
 */
router.get(
  '/dashboard/kpis',
  authorize(...ALL_ROLES),
  asyncHandler(ReportsController.getDashboardKPIs),
);

/**
 * GET /api/v1/reports/dashboard/charts
 * Chart data only — order status pie, scrap by dept, scrap trend, recent orders.
 * Access: All authenticated roles
 */
router.get(
  '/dashboard/charts',
  authorize(...ALL_ROLES),
  asyncHandler(ReportsController.getDashboardCharts),
);

// ════════════════════════════════════════════════════════════════
// REPORTS
// All support optional query params: ?fromDate ?toDate ?departmentId
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/reports/inventory
 * Stock levels, valuation, low-stock status for all materials.
 * Access: ADMIN, MANAGER, STORE
 */
router.get(
  '/inventory',
  authorize(...STORE_ROLES),
  validateRequest({ query: reportQuerySchema }),
  asyncHandler(ReportsController.getInventoryReport),
);

/**
 * GET /api/v1/reports/workforce
 * All employees — department breakdown, status counts.
 * Access: ADMIN, MANAGER, HR
 */
router.get(
  '/workforce',
  authorize(...HR_ROLES),
  validateRequest({ query: reportQuerySchema }),
  asyncHandler(ReportsController.getWorkforceReport),
);

/**
 * GET /api/v1/reports/orders
 * Client orders + purchase orders summary.
 * Access: ADMIN, MANAGER
 */
router.get(
  '/orders',
  authorize(...REPORT_ROLES),
  validateRequest({ query: reportQuerySchema }),
  asyncHandler(ReportsController.getOrdersReport),
);

/**
 * GET /api/v1/reports/scrap
 * Scrap records grouped by dept / material.
 * Access: ADMIN, MANAGER, STORE
 */
router.get(
  '/scrap',
  authorize(...STORE_ROLES),
  validateRequest({ query: reportQuerySchema }),
  asyncHandler(ReportsController.getScrapReport),
);

/**
 * GET /api/v1/reports/suppliers
 * Supplier performance — ratings, PO delivery rate.
 * Access: ADMIN, MANAGER
 */
router.get(
  '/suppliers',
  authorize(...REPORT_ROLES),
  validateRequest({ query: reportQuerySchema }),
  asyncHandler(ReportsController.getSupplierReport),
);

/**
 * GET /api/v1/reports/clients
 * Client order history, revenue per client.
 * Access: ADMIN, MANAGER
 */
router.get(
  '/clients',
  authorize(...REPORT_ROLES),
  validateRequest({ query: reportQuerySchema }),
  asyncHandler(ReportsController.getClientReport),
);

/**
 * GET /api/v1/reports/attendance
 * Per-employee attendance summary for a date range.
 * Query: ?fromDate ?toDate ?departmentId ?sortBy ?sortOrder
 * Access: ADMIN, MANAGER, HR
 */
router.get(
  '/attendance',
  authorize(...HR_ROLES),
  validateRequest({ query: attendanceReportQuerySchema }),
  asyncHandler(ReportsController.getAttendanceReport),
);

/**
 * GET /api/v1/reports/production
 * Work order completion, output quantities, rejection rates.
 * Query: ?fromDate ?toDate ?departmentId
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/production',
  authorize(ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION),
  validateRequest({ query: reportQuerySchema }),
  asyncHandler(ReportsController.getProductionReport),
);

/**
 * GET /api/v1/reports/security
 * Security incidents with status/severity counts, resolution time and alerts.
 * Query: ?fromDate ?toDate ?departmentId
 * Access: ADMIN, MANAGER, PRODUCTION (same as security read access)
 */
router.get(
  '/security',
  authorize(...SECURITY_ROLES),
  validateRequest({ query: reportQuerySchema }),
  asyncHandler(ReportsController.getSecurityReport),
);

export default router;
