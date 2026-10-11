import { z } from 'zod';

/** Tunable planning parameters shared by the Smart Analytics endpoints. */
export const analyticsQuerySchema = z.object({
  historyDays: z.coerce.number().int().min(30).max(365).optional().default(90),
  horizonDays: z.coerce.number().int().min(7).max(90).optional().default(30),
  serviceLevel: z.coerce.number().min(0.5).max(0.995).optional().default(0.95),
  defaultLeadTimeDays: z.coerce.number().int().min(1).max(180).optional().default(7),
  orderCost: z.coerce.number().min(0).max(1_000_000).optional().default(500),
  holdingRate: z.coerce.number().min(0.01).max(1).optional().default(0.2),
});

export const productionAnalyticsQuerySchema = z.object({
  historyDays: z.coerce.number().int().min(7).max(365).optional().default(90),
  department: z.string().trim().min(1).max(120).optional(),
});

export const supplierScorecardQuerySchema = z.object({
  historyDays: z.coerce.number().int().min(30).max(730).optional().default(180),
});

export const materialIdParamSchema = z.object({
  materialId: z.coerce.number().int().positive(),
});

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
export type ProductionAnalyticsQueryInput = z.infer<typeof productionAnalyticsQuerySchema>;
export type SupplierScorecardQueryInput = z.infer<typeof supplierScorecardQuerySchema>;
