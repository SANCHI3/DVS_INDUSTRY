import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as OrdersController from '../controllers/orders.controller';
import {
  createSupplierSchema,
  updateSupplierSchema,
  supplierIdParamSchema,
  supplierQuerySchema,
  createClientSchema,
  updateClientSchema,
  clientIdParamSchema,
  clientQuerySchema,
  createClientOrderSchema,
  updateClientOrderSchema,
  clientOrderIdParamSchema,
  clientOrderQuerySchema,
  dispatchOrderSchema,
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  purchaseOrderIdParamSchema,
  purchaseOrderQuerySchema,
} from '../validators/orders.validator';
import { ROLES } from '../constants';

const router = Router();
router.use(authenticate);

// ── Role groups ───────────────────────────────────────────────────────────────
// Client records and client orders: internal staff + the client themselves
// (CLIENT requests are further scoped to their own records in the controller).
// Suppliers must not see customer orders or values.
const CLIENT_READ_ROLES = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.HR,
  ROLES.STORE,
  ROLES.PRODUCTION,
  ROLES.SALES,
  ROLES.CLIENT,
] as const;
// SUPPLIER requests are scoped to their own supplier record in the controller.
const SUPPLIER_ORDER_READ_ROLES = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.HR,
  ROLES.STORE,
  ROLES.PRODUCTION,
  ROLES.SALES,
  ROLES.SUPPLIER,
] as const;
const SALES_WRITE = [ROLES.ADMIN, ROLES.SALES, ROLES.MANAGER] as const;
const CLIENT_WRITE = [...SALES_WRITE, ROLES.CLIENT] as const;
const STORE_WRITE = [ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER] as const;
const ADMIN_MGR = [ROLES.ADMIN, ROLES.MANAGER] as const;
const ADMIN_ONLY = [ROLES.ADMIN] as const;

// ══ STATISTICS ════════════════════════════════════════════════════════════════

/** GET /api/v1/orders/statistics */
router.get('/statistics', authorize(...ADMIN_MGR), asyncHandler(OrdersController.getStatistics));

// ══ SUPPLIERS ═════════════════════════════════════════════════════════════════

/** GET /api/v1/orders/suppliers */
router.get(
  '/suppliers',
  authorize(...SUPPLIER_ORDER_READ_ROLES),
  validateRequest({ query: supplierQuerySchema }),
  asyncHandler(OrdersController.getAllSuppliers),
);

/** POST /api/v1/orders/suppliers */
router.post(
  '/suppliers',
  authorize(...STORE_WRITE),
  validateRequest({ body: createSupplierSchema }),
  asyncHandler(OrdersController.createSupplier),
);

/** GET /api/v1/orders/suppliers/:id */
router.get(
  '/suppliers/:id',
  authorize(...SUPPLIER_ORDER_READ_ROLES),
  validateRequest({ params: supplierIdParamSchema }),
  asyncHandler(OrdersController.getSupplierById),
);

/** PATCH /api/v1/orders/suppliers/:id */
router.patch(
  '/suppliers/:id',
  authorize(...STORE_WRITE),
  validateRequest({ params: supplierIdParamSchema, body: updateSupplierSchema }),
  asyncHandler(OrdersController.updateSupplier),
);

/** DELETE /api/v1/orders/suppliers/:id */
router.delete(
  '/suppliers/:id',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: supplierIdParamSchema }),
  asyncHandler(OrdersController.deleteSupplier),
);

/** PATCH /api/v1/orders/suppliers/:id/restore */
router.patch(
  '/suppliers/:id/restore',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: supplierIdParamSchema }),
  asyncHandler(OrdersController.restoreSupplier),
);

// ══ CLIENTS ═══════════════════════════════════════════════════════════════════

/** GET /api/v1/orders/clients */
router.get(
  '/clients',
  authorize(...CLIENT_READ_ROLES),
  validateRequest({ query: clientQuerySchema }),
  asyncHandler(OrdersController.getAllClients),
);

/** POST /api/v1/orders/clients */
router.post(
  '/clients',
  authorize(...SALES_WRITE),
  validateRequest({ body: createClientSchema }),
  asyncHandler(OrdersController.createClient),
);

/** GET /api/v1/orders/clients/:id */
router.get(
  '/clients/:id',
  authorize(...CLIENT_READ_ROLES),
  validateRequest({ params: clientIdParamSchema }),
  asyncHandler(OrdersController.getClientById),
);

/** PATCH /api/v1/orders/clients/:id */
router.patch(
  '/clients/:id',
  authorize(...SALES_WRITE),
  validateRequest({ params: clientIdParamSchema, body: updateClientSchema }),
  asyncHandler(OrdersController.updateClient),
);

/** DELETE /api/v1/orders/clients/:id */
router.delete(
  '/clients/:id',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: clientIdParamSchema }),
  asyncHandler(OrdersController.deleteClient),
);

/** PATCH /api/v1/orders/clients/:id/restore */
router.patch(
  '/clients/:id/restore',
  authorize(...ADMIN_ONLY),
  validateRequest({ params: clientIdParamSchema }),
  asyncHandler(OrdersController.restoreClient),
);

// ══ CLIENT ORDERS ══════════════════════════════════════════════════════════════

/** GET /api/v1/orders/client-orders */
router.get(
  '/client-orders',
  authorize(...CLIENT_READ_ROLES),
  validateRequest({ query: clientOrderQuerySchema }),
  asyncHandler(OrdersController.getAllClientOrders),
);

/** POST /api/v1/orders/client-orders */
router.post(
  '/client-orders',
  authorize(...CLIENT_WRITE),
  validateRequest({ body: createClientOrderSchema }),
  asyncHandler(OrdersController.createClientOrder),
);

/** GET /api/v1/orders/client-orders/:id */
router.get(
  '/client-orders/:id',
  authorize(...CLIENT_READ_ROLES),
  validateRequest({ params: clientOrderIdParamSchema }),
  asyncHandler(OrdersController.getClientOrderById),
);

/** PATCH /api/v1/orders/client-orders/:id */
router.patch(
  '/client-orders/:id',
  authorize(...CLIENT_WRITE),
  validateRequest({ params: clientOrderIdParamSchema, body: updateClientOrderSchema }),
  asyncHandler(OrdersController.updateClientOrder),
);

/** PATCH /api/v1/orders/client-orders/:id/approve */
router.patch(
  '/client-orders/:id/approve',
  authorize(...SALES_WRITE),
  validateRequest({ params: clientOrderIdParamSchema }),
  asyncHandler(OrdersController.approveClientOrder),
);

/** PATCH /api/v1/orders/client-orders/:id/production */
router.patch(
  '/client-orders/:id/production',
  authorize(ROLES.ADMIN, ROLES.PRODUCTION, ROLES.MANAGER),
  validateRequest({ params: clientOrderIdParamSchema }),
  asyncHandler(OrdersController.markClientOrderInProduction),
);

/** PATCH /api/v1/orders/client-orders/:id/dispatch */
router.patch(
  '/client-orders/:id/dispatch',
  authorize(ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER),
  validateRequest({ params: clientOrderIdParamSchema, body: dispatchOrderSchema }),
  asyncHandler(OrdersController.dispatchClientOrder),
);

/** PATCH /api/v1/orders/client-orders/:id/deliver */
router.patch(
  '/client-orders/:id/deliver',
  authorize(ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER),
  validateRequest({ params: clientOrderIdParamSchema }),
  asyncHandler(OrdersController.deliverClientOrder),
);

/** PATCH /api/v1/orders/client-orders/:id/cancel */
router.patch(
  '/client-orders/:id/cancel',
  authorize(...CLIENT_WRITE),
  validateRequest({ params: clientOrderIdParamSchema }),
  asyncHandler(OrdersController.cancelClientOrder),
);

// ══ PURCHASE ORDERS ════════════════════════════════════════════════════════════

/** GET /api/v1/orders/purchase-orders */
router.get(
  '/purchase-orders',
  authorize(...SUPPLIER_ORDER_READ_ROLES),
  validateRequest({ query: purchaseOrderQuerySchema }),
  asyncHandler(OrdersController.getAllPurchaseOrders),
);

/** POST /api/v1/orders/purchase-orders */
router.post(
  '/purchase-orders',
  authorize(...STORE_WRITE),
  validateRequest({ body: createPurchaseOrderSchema }),
  asyncHandler(OrdersController.createPurchaseOrder),
);

/** GET /api/v1/orders/purchase-orders/:id */
router.get(
  '/purchase-orders/:id',
  authorize(...SUPPLIER_ORDER_READ_ROLES),
  validateRequest({ params: purchaseOrderIdParamSchema }),
  asyncHandler(OrdersController.getPurchaseOrderById),
);

/** PATCH /api/v1/orders/purchase-orders/:id */
router.patch(
  '/purchase-orders/:id',
  authorize(...STORE_WRITE),
  validateRequest({ params: purchaseOrderIdParamSchema, body: updatePurchaseOrderSchema }),
  asyncHandler(OrdersController.updatePurchaseOrder),
);

/** PATCH /api/v1/orders/purchase-orders/:id/confirm */
router.patch(
  '/purchase-orders/:id/confirm',
  authorize(...STORE_WRITE),
  validateRequest({ params: purchaseOrderIdParamSchema }),
  asyncHandler(OrdersController.confirmPurchaseOrder),
);

/** PATCH /api/v1/orders/purchase-orders/:id/transit */
router.patch(
  '/purchase-orders/:id/transit',
  authorize(...STORE_WRITE),
  validateRequest({ params: purchaseOrderIdParamSchema }),
  asyncHandler(OrdersController.markPOInTransit),
);

/** PATCH /api/v1/orders/purchase-orders/:id/deliver */
router.patch(
  '/purchase-orders/:id/deliver',
  authorize(...STORE_WRITE),
  validateRequest({ params: purchaseOrderIdParamSchema }),
  asyncHandler(OrdersController.deliverPurchaseOrder),
);

/** PATCH /api/v1/orders/purchase-orders/:id/cancel */
router.patch(
  '/purchase-orders/:id/cancel',
  authorize(...STORE_WRITE),
  validateRequest({ params: purchaseOrderIdParamSchema }),
  asyncHandler(OrdersController.cancelPurchaseOrder),
);

export default router;
