import { z } from 'zod';

// ── Reusable fields ───────────────────────────────────────────────────────────

const decimalString = (label: string) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/, `${label} must be a valid decimal (e.g. 100.500)`)
    .refine((v) => parseFloat(v) >= 0, `${label} must be >= 0`);

const optionalDecimalString = (label: string) => decimalString(label).optional().nullable();

const positiveDecimalString = (label: string) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/, `${label} must be a valid decimal`)
    .refine((v) => parseFloat(v) > 0, `${label} must be > 0`);

// ── Material schemas ──────────────────────────────────────────────────────────

export const createMaterialSchema = z.object({
  name: z.string().min(1, 'Name is required').max(150).trim(),
  code: z
    .string()
    .min(1, 'Code is required')
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, 'Code must be uppercase letters, digits, hyphens, or underscores')
    .trim(),
  description: z.string().max(500).trim().optional().nullable(),
  unit: z.string().min(1, 'Unit is required').max(20).trim(),
  category: z.string().max(100).trim().optional().nullable(),
  location: z.string().max(100).trim().optional().nullable(),
  minStockLevel: decimalString('Min stock level').optional().default('0'),
  maxStockLevel: optionalDecimalString('Max stock level'),
  costPerUnit: optionalDecimalString('Cost per unit'),
  currency: z.string().length(3).toUpperCase().optional().default('INR'),
});

export const updateMaterialSchema = z
  .object({
    name: z.string().min(1).max(150).trim().optional(),
    description: z.string().max(500).trim().optional().nullable(),
    unit: z.string().min(1).max(20).trim().optional(),
    category: z.string().max(100).trim().optional().nullable(),
    location: z.string().max(100).trim().optional().nullable(),
    minStockLevel: decimalString('Min stock level').optional(),
    maxStockLevel: optionalDecimalString('Max stock level'),
    costPerUnit: optionalDecimalString('Cost per unit'),
    currency: z.string().length(3).toUpperCase().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  });

export const materialIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Material id must be a positive integer'),
});

export const materialQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  category: z.string().max(100).trim().optional(),
  status: z.enum(['active', 'inactive', 'all']).optional().default('active'),
  lowStockOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  sortBy: z
    .enum(['name', 'code', 'currentStock', 'createdAt', 'updatedAt'])
    .optional()
    .default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

// ── Stock adjustment schema ───────────────────────────────────────────────────

// ADJUSTMENT quantities are signed (e.g. "-2.5" after a stock count found a
// shortfall); every other movement type takes a positive quantity and the
// type decides the direction.
export const stockAdjustmentSchema = z
  .object({
    type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'SCRAP', 'RETURN']),
    quantity: z
      .string()
      .regex(/^-?\d+(\.\d{1,3})?$/, 'Quantity must be a valid decimal (e.g. 100.500)')
      .refine((v) => parseFloat(v) !== 0, 'Quantity must not be zero'),
    referenceNo: z.string().max(50).trim().optional().nullable(),
    reason: z.string().max(500).trim().optional().nullable(),
    performedById: z.coerce.number().int().positive().optional().nullable(),
    performedByName: z.string().max(150).trim().optional().nullable(),
    departmentId: z.coerce.number().int().positive().optional().nullable(),
    departmentName: z.string().max(150).trim().optional().nullable(),
  })
  .refine((v) => v.type === 'ADJUSTMENT' || !v.quantity.startsWith('-'), {
    message: 'Quantity must be positive; only ADJUSTMENT accepts a negative value',
    path: ['quantity'],
  });

// ── Transaction query ─────────────────────────────────────────────────────────

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  materialId: z.coerce.number().int().positive().optional(),
  type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'SCRAP', 'RETURN']).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  referenceNo: z.string().max(50).trim().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ── Scrap record schemas ──────────────────────────────────────────────────────

export const createScrapRecordSchema = z.object({
  materialId: z.coerce.number().int().positive('materialId is required'),
  quantity: positiveDecimalString('Quantity'),
  unit: z.string().min(1).max(20).trim(),
  departmentId: z.coerce.number().int().positive().optional().nullable(),
  departmentName: z.string().max(150).trim().optional().nullable(),
  employeeId: z.coerce.number().int().positive().optional().nullable(),
  employeeName: z.string().max(150).trim().optional().nullable(),
  reason: z.string().max(500).trim().optional().nullable(),
  recoveryValue: optionalDecimalString('Recovery value'),
  recordedAt: z.coerce.date().optional(),
});

export const scrapQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  materialId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
export type MaterialQueryInput = z.infer<typeof materialQuerySchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type TransactionQueryInput = z.infer<typeof transactionQuerySchema>;
export type CreateScrapRecordInput = z.infer<typeof createScrapRecordSchema>;
export type ScrapQueryInput = z.infer<typeof scrapQuerySchema>;
