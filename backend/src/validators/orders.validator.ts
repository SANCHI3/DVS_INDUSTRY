import { z } from 'zod';

// ── Reusable ──────────────────────────────────────────────────────────────────

const nameField = z.string().min(1).max(150).trim();
const codeField = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[A-Z0-9_-]+$/, 'Code must be uppercase letters, digits, hyphens, or underscores')
  .trim();
const optStr = (max = 255) => z.string().max(max).trim().optional().nullable();
const optEmail = z.string().email().toLowerCase().trim().optional().nullable();
const optPhone = z
  .string()
  .regex(/^\+?[0-9\s\-().]{7,20}$/)
  .optional()
  .nullable();
const optCost = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal')
  .optional()
  .nullable();

const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

// ── Supplier ──────────────────────────────────────────────────────────────────

export const createSupplierSchema = z.object({
  name: nameField,
  code: codeField,
  contactName: optStr(100),
  email: optEmail,
  phone: optPhone,
  address: optStr(300),
  city: optStr(100),
  state: optStr(100),
  country: z.string().max(100).optional().default('India'),
  gstin: optStr(20),
  rating: z
    .string()
    .regex(/^[0-5](\.\d)?$/, 'Rating must be 0.0–5.0')
    .optional()
    .nullable(),
  leadTimeDays: z.coerce.number().int().positive().optional().nullable(),
  reliability: optStr(20),
  materials: optStr(500),
});

export const updateSupplierSchema = z
  .object({
    name: z.string().min(1).max(150).trim().optional(),
    contactName: optStr(100),
    email: optEmail,
    phone: optPhone,
    address: optStr(300),
    city: optStr(100),
    state: optStr(100),
    country: z.string().max(100).optional(),
    gstin: optStr(20),
    rating: z
      .string()
      .regex(/^[0-5](\.\d)?$/)
      .optional()
      .nullable(),
    leadTimeDays: z.coerce.number().int().positive().optional().nullable(),
    reliability: optStr(20),
    materials: optStr(500),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export const supplierIdParamSchema = idParam;

export const supplierQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  sortBy: z.enum(['name', 'code', 'rating', 'createdAt']).optional().default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

// ── Client ────────────────────────────────────────────────────────────────────

export const createClientSchema = z.object({
  name: nameField,
  code: codeField,
  contactName: optStr(100),
  email: optEmail,
  phone: optPhone,
  address: optStr(300),
  city: optStr(100),
  state: optStr(100),
  country: z.string().max(100).optional().default('India'),
  gstin: optStr(20),
});

export const updateClientSchema = z
  .object({
    name: z.string().min(1).max(150).trim().optional(),
    contactName: optStr(100),
    email: optEmail,
    phone: optPhone,
    address: optStr(300),
    city: optStr(100),
    state: optStr(100),
    country: z.string().max(100).optional(),
    gstin: optStr(20),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export const clientIdParamSchema = idParam;

export const clientQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  sortBy: z.enum(['name', 'code', 'createdAt']).optional().default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

// ── Client Orders ─────────────────────────────────────────────────────────────

export const createClientOrderSchema = z.object({
  clientId: z.coerce.number().int().positive('clientId is required'),
  product: z.string().min(1).max(200).trim(),
  quantity: z.coerce.number().int().positive('Quantity must be a positive integer'),
  unit: z.string().max(20).optional().default('pcs'),
  value: optCost,
  currency: z.string().length(3).toUpperCase().optional().default('INR'),
  requiredDate: z.coerce.date().optional().nullable(),
  notes: optStr(500),
  // Part from the Parts Master; product text stays the description
  partSpecId: z.coerce.number().int().positive().optional().nullable(),
});

export const updateClientOrderSchema = z
  .object({
    product: z.string().min(1).max(200).trim().optional(),
    quantity: z.coerce.number().int().positive().optional(),
    unit: z.string().max(20).optional(),
    value: optCost,
    requiredDate: z.coerce.date().optional().nullable(),
    notes: optStr(500),
    partSpecId: z.coerce.number().int().positive().optional().nullable(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export const dispatchOrderSchema = z.object({
  dispatchNote: optStr(500),
  challanNumber: optStr(50),
  invoiceNumber: optStr(50),
});

export const clientOrderIdParamSchema = idParam;

export const clientOrderQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  clientId: z.coerce.number().int().positive().optional(),
  status: z
    .enum(['PENDING', 'APPROVED', 'IN_PRODUCTION', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'all'])
    .optional()
    .default('all'),
  search: z.string().max(100).trim().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortBy: z
    .enum(['orderDate', 'requiredDate', 'value', 'createdAt'])
    .optional()
    .default('orderDate'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ── Purchase Orders ───────────────────────────────────────────────────────────

export const createPurchaseOrderSchema = z.object({
  supplierId: z.coerce.number().int().positive('supplierId is required'),
  material: z.string().min(1).max(200).trim(),
  quantity: z.string().min(1).max(50).trim(),
  unit: optStr(20),
  totalCost: optCost,
  currency: z.string().length(3).toUpperCase().optional().default('INR'),
  expectedDelivery: z.coerce.date().optional().nullable(),
  notes: optStr(500),
  // Stock material bought; receiving the PO adds to its stock
  materialId: z.coerce.number().int().positive().optional().nullable(),
});

export const updatePurchaseOrderSchema = z
  .object({
    material: z.string().min(1).max(200).trim().optional(),
    quantity: z.string().min(1).max(50).trim().optional(),
    unit: optStr(20),
    totalCost: optCost,
    expectedDelivery: z.coerce.date().optional().nullable(),
    notes: optStr(500),
    materialId: z.coerce.number().int().positive().optional().nullable(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export const purchaseOrderIdParamSchema = idParam;

export const purchaseOrderQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  supplierId: z.coerce.number().int().positive().optional(),
  status: z
    .enum(['PENDING', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'all'])
    .optional()
    .default('all'),
  search: z.string().max(100).trim().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortBy: z
    .enum(['orderDate', 'expectedDelivery', 'totalCost', 'createdAt'])
    .optional()
    .default('orderDate'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type SupplierQueryInput = z.infer<typeof supplierQuerySchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ClientQueryInput = z.infer<typeof clientQuerySchema>;
export type CreateClientOrderInput = z.infer<typeof createClientOrderSchema>;
export type UpdateClientOrderInput = z.infer<typeof updateClientOrderSchema>;
export type DispatchOrderInput = z.infer<typeof dispatchOrderSchema>;
export type ClientOrderQueryInput = z.infer<typeof clientOrderQuerySchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type PurchaseOrderQueryInput = z.infer<typeof purchaseOrderQuerySchema>;

/** Supplier portal: confirm or dispatch its own PO. */
export const supplierPurchaseOrderActionSchema = z.object({
  dispatchDate: z.coerce.date().optional().nullable(),
  note: optStr(300),
});
export type SupplierPurchaseOrderActionInput = z.infer<typeof supplierPurchaseOrderActionSchema>;

/** Receiving a PO: the quantity that arrived (defaults to what is still due). */
export const receivePurchaseOrderSchema = z.object({
  receivedQty: z.coerce.number().positive().max(1e9).optional(),
});
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
