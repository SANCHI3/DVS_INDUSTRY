import { z } from 'zod';

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  userId: z.coerce.number().int().positive().optional(),
  action: z
    .enum([
      'CREATE',
      'UPDATE',
      'DELETE',
      'LOGIN',
      'LOGIN_FAILED',
      'LOGOUT',
      'EXPORT',
      'STATUS_CHANGE',
      'BULK_ACTION',
      'all',
    ])
    .optional()
    .default('all'),
  entity: z.string().max(100).trim().optional(),
  entityId: z.string().max(50).trim().optional(),
  search: z.string().max(100).trim().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const auditIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
export type AuditIdParamInput = z.infer<typeof auditIdParamSchema>;
