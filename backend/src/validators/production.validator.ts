import { z } from 'zod';

// ── Reusable fields ───────────────────────────────────────────────────────────

const positiveDecimalString = (label: string) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/, `${label} must be a valid decimal (e.g. 100.000)`)
    .refine((v) => parseFloat(v) > 0, `${label} must be > 0`);

const nonNegativeDecimalString = (label: string) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/, `${label} must be a valid decimal`)
    .refine((v) => parseFloat(v) >= 0, `${label} must be >= 0`);

const workOrderStatusEnum = z.enum([
  'DRAFT',
  'RELEASED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
]);

const workOrderPriorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

// ════════════════════════════════════════════════════════════
// WORK ORDER
// ════════════════════════════════════════════════════════════

export const createWorkOrderSchema = z
  .object({
    product: z.string().min(1, 'Product is required').max(200).trim(),
    targetQuantity: positiveDecimalString('Target quantity'),
    unit: z.string().min(1).max(20).trim().optional().default('pcs'),
    scheduledStart: z.coerce.date().optional().nullable(),
    scheduledEnd: z.coerce.date().optional().nullable(),
    priority: workOrderPriorityEnum.optional().default('NORMAL'),
    departmentId: z.coerce.number().int().positive().optional().nullable(),
    departmentName: z.string().max(150).trim().optional().nullable(),
    assignedToId: z.coerce.number().int().positive().optional().nullable(),
    assignedToName: z.string().max(150).trim().optional().nullable(),
    clientOrderId: z.coerce.number().int().positive().optional().nullable(),
    notes: z.string().max(1000).trim().optional().nullable(),
  })
  .refine(
    (d) => d.scheduledStart == null || d.scheduledEnd == null || d.scheduledEnd >= d.scheduledStart,
    { message: 'scheduledEnd must be on or after scheduledStart', path: ['scheduledEnd'] },
  );

export const updateWorkOrderSchema = z
  .object({
    product: z.string().min(1).max(200).trim().optional(),
    targetQuantity: positiveDecimalString('Target quantity').optional(),
    unit: z.string().min(1).max(20).trim().optional(),
    scheduledStart: z.coerce.date().optional().nullable(),
    scheduledEnd: z.coerce.date().optional().nullable(),
    actualStart: z.coerce.date().optional().nullable(),
    actualEnd: z.coerce.date().optional().nullable(),
    status: workOrderStatusEnum.optional(),
    priority: workOrderPriorityEnum.optional(),
    departmentId: z.coerce.number().int().positive().optional().nullable(),
    departmentName: z.string().max(150).trim().optional().nullable(),
    assignedToId: z.coerce.number().int().positive().optional().nullable(),
    assignedToName: z.string().max(150).trim().optional().nullable(),
    clientOrderId: z.coerce.number().int().positive().optional().nullable(),
    notes: z.string().max(1000).trim().optional().nullable(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  })
  .refine(
    (d) => d.scheduledStart == null || d.scheduledEnd == null || d.scheduledEnd >= d.scheduledStart,
    { message: 'scheduledEnd must be on or after scheduledStart', path: ['scheduledEnd'] },
  )
  .refine((d) => d.actualStart == null || d.actualEnd == null || d.actualEnd >= d.actualStart, {
    message: 'actualEnd must be on or after actualStart',
    path: ['actualEnd'],
  });

export const workOrderIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Work order id must be a positive integer'),
});

export const workOrderQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  status: z
    .enum(['DRAFT', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'all'])
    .optional()
    .default('all'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT', 'all']).optional().default('all'),
  departmentId: z.coerce.number().int().positive().optional(),
  clientOrderId: z.coerce.number().int().positive().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortBy: z
    .enum(['workOrderNumber', 'product', 'scheduledStart', 'createdAt', 'status'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// Status transition shortcut  — PATCH /work-orders/:id/status
export const workOrderStatusSchema = z.object({
  status: workOrderStatusEnum,
  actualStart: z.coerce.date().optional().nullable(),
  actualEnd: z.coerce.date().optional().nullable(),
  notes: z.string().max(500).trim().optional().nullable(),
});

// ════════════════════════════════════════════════════════════
// WORK ORDER OUTPUT
// ════════════════════════════════════════════════════════════

export const createOutputSchema = z.object({
  goodQty: positiveDecimalString('Good quantity'),
  rejectedQty: nonNegativeDecimalString('Rejected quantity').optional().default('0'),
  scrapQty: nonNegativeDecimalString('Scrap quantity').optional().default('0'),
  recordedAt: z.coerce.date().optional(),
  recordedById: z.coerce.number().int().positive().optional().nullable(),
  recordedByName: z.string().max(150).trim().optional().nullable(),
  remarks: z.string().max(500).trim().optional().nullable(),
});

export const updateOutputSchema = z
  .object({
    goodQty: nonNegativeDecimalString('Good quantity').optional(),
    rejectedQty: nonNegativeDecimalString('Rejected quantity').optional(),
    scrapQty: nonNegativeDecimalString('Scrap quantity').optional(),
    recordedAt: z.coerce.date().optional(),
    recordedByName: z.string().max(150).trim().optional().nullable(),
    remarks: z.string().max(500).trim().optional().nullable(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  });

export const outputIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  outputId: z.coerce.number().int().positive(),
});

export const outputQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ════════════════════════════════════════════════════════════
// KPIs & TREND
// ════════════════════════════════════════════════════════════

export const productionKpiQuerySchema = z.object({
  departmentId: z.coerce.number().int().positive().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const productionTrendQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(30).optional().default(7),
  departmentId: z.coerce.number().int().positive().optional(),
});

// ── Inferred types ────────────────────────────────────────────────────────────

// ── Monthly target & KPI thresholds ────────────────────────────────────────────

const percentField = (label: string) =>
  z
    .number({ message: `${label} must be a number` })
    .min(0, `${label} cannot be negative`)
    .max(100, `${label} cannot exceed 100%`)
    .nullable()
    .optional();

export const targetMonthParamSchema = z.object({
  month: z
    .string()
    .regex(/^(20\d{2})-(0[1-9]|1[0-2])$/, 'Month must look like 2026-10 (years 2000–2099)'),
});

export const targetYearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2099).optional(),
});

export const saveTargetSchema = z.object({
  outputTarget: z
    .string()
    .trim()
    .regex(/^\d{1,11}(\.\d{1,3})?$/, 'Output target must be a number with up to 3 decimals')
    .refine((v) => parseFloat(v) > 0, 'Output target must be greater than 0'),
  unit: z.string().trim().min(1, 'Unit is required').max(20).optional().default('pcs'),
  targetCompletionRate: percentField('Target completion rate'),
  maxRejectionRate: percentField('Maximum rejection rate'),
  targetEmployeeEfficiency: percentField('Target employee efficiency'),
  notes: z.string().trim().max(500).optional().nullable(),
  // updatedAt of the record the user edited (null when creating). A mismatch
  // means someone else changed it, so the save is refused instead of overwriting.
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
});

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;
export type WorkOrderQueryInput = z.infer<typeof workOrderQuerySchema>;
export type WorkOrderStatusInput = z.infer<typeof workOrderStatusSchema>;
export type CreateOutputInput = z.infer<typeof createOutputSchema>;
export type UpdateOutputInput = z.infer<typeof updateOutputSchema>;
export type OutputQueryInput = z.infer<typeof outputQuerySchema>;
export type ProductionKpiQueryInput = z.infer<typeof productionKpiQuerySchema>;
export type ProductionTrendQueryInput = z.infer<typeof productionTrendQuerySchema>;
export type SaveTargetInput = z.infer<typeof saveTargetSchema>;
