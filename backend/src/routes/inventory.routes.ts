import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as InventoryController from '../controllers/inventory.controller';
import {
  createMaterialSchema,
  updateMaterialSchema,
  materialIdParamSchema,
  materialQuerySchema,
  stockAdjustmentSchema,
  transactionQuerySchema,
  createScrapRecordSchema,
  scrapQuerySchema,
  createPartSpecSchema,
} from '../validators/inventory.validator';
import { ROLES } from '../constants';

const router = Router();

// All inventory routes require authentication
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

const WRITE_ROLES = [ROLES.ADMIN, ROLES.STORE] as const;
const STOCK_ROLES = [ROLES.ADMIN, ROLES.STORE, ROLES.PRODUCTION] as const;
const ADMIN_ONLY = [ROLES.ADMIN] as const;
const REPORT_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.STORE] as const;

// ══ STATISTICS ════════════════════════════════════════════════════════════════
// Must be declared BEFORE /:id routes

/**
 * GET /api/v1/inventory/statistics
 * Access: ADMIN, MANAGER, STORE
 */
router.get(
  '/statistics',
  authorize(...REPORT_ROLES),
  asyncHandler(InventoryController.getStatistics),
);

// ══ TRANSACTIONS ══════════════════════════════════════════════════════════════

/**
 * GET /api/v1/inventory/transactions
 * List all stock transactions with filters.
 * Access: ADMIN, MANAGER, STORE
 */
router.get(
  '/transactions',
  authorize(...REPORT_ROLES),
  validateRequest({ query: transactionQuerySchema }),
  asyncHandler(InventoryController.getAllTransactions),
);

// ══ SCRAP RECORDS ═════════════════════════════════════════════════════════════

/**
 * POST /api/v1/inventory/scrap
 * Record scrap + auto-deduct from stock.
 * Access: ADMIN, STORE, PRODUCTION
 */
router.post(
  '/scrap',
  authorize(...STOCK_ROLES),
  validateRequest({ body: createScrapRecordSchema }),
  asyncHandler(InventoryController.recordScrap),
);

/**
 * GET /api/v1/inventory/scrap
 * List scrap records with filters.
 * Access: ADMIN, MANAGER, STORE
 */
router.get(
  '/scrap',
  authorize(...REPORT_ROLES),
  validateRequest({ query: scrapQuerySchema }),
  asyncHandler(InventoryController.getScrapRecords),
);

// ══ PART SPECS ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/inventory/parts
 * Part master: RM grade, strip size and sheet yield per part.
 * Access: All roles
 */
router.get('/parts', authorize(...ALL_ROLES), asyncHandler(InventoryController.getPartSpecs));

/**
 * POST /api/v1/inventory/parts
 * Add a part to the part master.
 * Access: ADMIN, STORE
 */
router.post(
  '/parts',
  authorize(...WRITE_ROLES),
  validateRequest({ body: createPartSpecSchema }),
  asyncHandler(InventoryController.createPartSpec),
);

// ══ MATERIALS ═════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/inventory
 * Create a new material.
 * Access: ADMIN, STORE
 */
router.post(
  '/',
  authorize(...WRITE_ROLES),
  validateRequest({ body: createMaterialSchema }),
  asyncHandler(InventoryController.createMaterial),
);

/**
 * GET /api/v1/inventory
 * List materials — search, filter, sort, paginate.
 * Query: ?search ?category ?status ?lowStockOnly ?sortBy ?sortOrder ?page ?pageSize
 * Access: All roles
 */
router.get(
  '/',
  authorize(...ALL_ROLES),
  validateRequest({ query: materialQuerySchema }),
  asyncHandler(InventoryController.getAllMaterials),
);

/**
 * GET /api/v1/inventory/:id
 * Get material by ID.
 * Access: All roles
 */
router.get(
  '/:id',
  authorize(...ALL_ROLES),
  validateRequest({ params: materialIdParamSchema }),
  asyncHandler(InventoryController.getMaterialById),
);

/**
 * PATCH /api/v1/inventory/:id
 * Update material metadata (not stock level — use /stock for that).
 * Access: ADMIN, STORE
 */
router.patch(
  '/:id',
  authorize(...WRITE_ROLES),
  validateRequest({ params: materialIdParamSchema, body: updateMaterialSchema }),
  asyncHandler(InventoryController.updateMaterial),
);

/**
 * DELETE /api/v1/inventory/:id
 * Soft-delete a material.
 * Access: ADMIN only
 */
router.delete(
  '/:id',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: materialIdParamSchema }),
  asyncHandler(InventoryController.deleteMaterial),
);

/**
 * PATCH /api/v1/inventory/:id/restore
 * Restore a soft-deleted material.
 * Access: ADMIN only
 */
router.patch(
  '/:id/restore',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: materialIdParamSchema }),
  asyncHandler(InventoryController.restoreMaterial),
);

/**
 * POST /api/v1/inventory/:id/stock
 * Adjust stock level (IN / OUT / ADJUSTMENT / SCRAP / RETURN).
 * Access: ADMIN, STORE, PRODUCTION
 */
router.post(
  '/:id/stock',
  authorize(...STOCK_ROLES),
  validateRequest({ params: materialIdParamSchema, body: stockAdjustmentSchema }),
  asyncHandler(InventoryController.adjustStock),
);

/**
 * GET /api/v1/inventory/:id/transactions
 * Get stock transaction history for a single material.
 * Access: ADMIN, MANAGER, STORE
 */
router.get(
  '/:id/transactions',
  authorize(...REPORT_ROLES),
  validateRequest({ params: materialIdParamSchema }),
  asyncHandler(InventoryController.getMaterialTransactions),
);

export default router;
