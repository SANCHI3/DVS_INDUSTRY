import { z } from 'zod';

// ── Shared enums ──────────────────────────────────────────────────────────────

const incidentTypeEnum = z.enum([
  'FIRE',
  'FIRE_SMOKE',
  'SMOKE',
  'CROWD',
  'FIGHT',
  'FALL',
  'THEFT',
  'INJURY',
  'PROPERTY_DAMAGE',
  'UNAUTHORIZED_ACCESS',
  'EQUIPMENT_FAILURE',
  'CHEMICAL_SPILL',
  'NEAR_MISS',
  'OTHER',
]);

const incidentSeverityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const incidentStatusEnum = z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED']);

const alertTypeEnum = z.enum([
  'SAFETY',
  'SECURITY',
  'MAINTENANCE',
  'FIRE',
  'INTRUSION',
  'ENVIRONMENTAL',
  'CUSTOM',
]);

// ════════════════════════════════════════════════════════════════
// INCIDENTS
// ════════════════════════════════════════════════════════════════

export const createIncidentSchema = z.object({
  incident_id: z.string().min(1).max(100).trim().optional(),
  title: z.string().min(1, 'Title is required').max(200).trim(),
  description: z.string().min(1, 'Description is required').max(2000).trim(),
  aiSummary: z.string().max(2000).trim().optional().nullable(),
  summary: z.string().min(1).max(1000).trim().optional().nullable(),
  confidenceScore: z.coerce.number().min(0).max(1).optional().nullable(),
  type: incidentTypeEnum,
  severity: incidentSeverityEnum.optional().default('MEDIUM'),
  location: z.string().max(200).trim().optional().nullable(),
  departmentId: z.coerce.number().int().positive().optional().nullable(),
  departmentName: z.string().max(150).trim().optional().nullable(),
  reportedById: z.coerce.number().int().positive().optional().nullable(),
  reportedByName: z.string().max(150).trim().optional().nullable(),
  assignedToId: z.coerce.number().int().positive().optional().nullable(),
  assignedToName: z.string().max(150).trim().optional().nullable(),
  occurredAt: z.coerce.date().optional(),
  // Factory CCTV: which camera and which perception PC (never a stream URL)
  cameraId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .optional()
    .nullable(),
  cameraName: z.string().max(100).trim().optional().nullable(),
  cameraZone: z.string().max(100).trim().optional().nullable(),
  cameraChannel: z.coerce.number().int().min(1).max(64).optional().nullable(),
  instanceId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .optional()
    .nullable(),
  source: z
    .enum(['live', 'dev', 'LIVE', 'DEV'])
    .optional()
    .transform((s) => (s ? (s.toUpperCase() as 'LIVE' | 'DEV') : undefined)),
});

export const updateIncidentSchema = z
  .object({
    title: z.string().min(1).max(200).trim().optional(),
    description: z.string().min(1).max(2000).trim().optional(),
    aiSummary: z.string().max(2000).trim().optional().nullable(),
    summary: z.string().min(1).max(1000).trim().optional().nullable(),
    confidenceScore: z.coerce.number().min(0).max(1).optional().nullable(),
    type: incidentTypeEnum.optional(),
    severity: incidentSeverityEnum.optional(),
    status: incidentStatusEnum.optional(),
    location: z.string().max(200).trim().optional().nullable(),
    departmentId: z.coerce.number().int().positive().optional().nullable(),
    departmentName: z.string().max(150).trim().optional().nullable(),
    assignedToId: z.coerce.number().int().positive().optional().nullable(),
    assignedToName: z.string().max(150).trim().optional().nullable(),
    occurredAt: z.coerce.date().optional(),
    resolvedAt: z.coerce.date().optional().nullable(),
    closedAt: z.coerce.date().optional().nullable(),
    rootCause: z.string().max(2000).trim().optional().nullable(),
    correctiveAction: z.string().max(2000).trim().optional().nullable(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  });

export const incidentIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Incident id must be a positive integer'),
});

export const incidentAiSummarySchema = z.object({
  incident_id: z.string().min(1, 'incident_id is required').max(100).trim(),
  summary: z.string().min(1, 'summary is required').max(1000).trim(),
});

export const incidentEscalationSchema = z.object({
  incident_id: z.string().min(1, 'incident_id is required').max(100).trim(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  confidenceScore: z.coerce.number().min(0).max(1).optional(),
  reason: z.string().min(1, 'reason is required').max(1000).trim(),
});

/** The perception service saw the same event on the same camera again. */
export const incidentRepeatSchema = z.object({
  incident_id: z.string().min(1).max(100).trim(),
  seenAt: z.coerce.date().optional(),
});
export type IncidentRepeatInput = z.infer<typeof incidentRepeatSchema>;

export const incidentQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  type: z
    .enum([
      'FIRE',
      'FIRE_SMOKE',
      'SMOKE',
      'CROWD',
      'FIGHT',
      'FALL',
      'THEFT',
      'INJURY',
      'PROPERTY_DAMAGE',
      'UNAUTHORIZED_ACCESS',
      'EQUIPMENT_FAILURE',
      'CHEMICAL_SPILL',
      'NEAR_MISS',
      'OTHER',
      'all',
    ])
    .optional()
    .default('all'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'all']).optional().default('all'),
  status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED', 'all']).optional().default('all'),
  departmentId: z.coerce.number().int().positive().optional(),
  cameraId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .optional(),
  // Developer test detections are hidden unless asked for
  includeTest: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortBy: z
    .enum(['occurredAt', 'createdAt', 'severity', 'status'])
    .optional()
    .default('occurredAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// Status transition shortcut
export const incidentStatusSchema = z.object({
  status: incidentStatusEnum,
  comment: z.string().max(1000).trim().optional().nullable(),
  updatedById: z.coerce.number().int().positive().optional().nullable(),
  updatedByName: z.string().max(150).trim().optional().nullable(),
  rootCause: z.string().max(2000).trim().optional().nullable(),
  correctiveAction: z.string().max(2000).trim().optional().nullable(),
});

// Assign to someone
export const assignIncidentSchema = z.object({
  assignedToId: z.coerce.number().int().positive().nullable(),
  assignedToName: z.string().max(150).trim().optional().nullable(),
});

// ── Incident Updates ──────────────────────────────────────────────────────────

export const createIncidentUpdateSchema = z.object({
  comment: z.string().min(1, 'Comment is required').max(2000).trim(),
  statusChange: incidentStatusEnum.optional().nullable(),
  updatedById: z.coerce.number().int().positive().optional().nullable(),
  updatedByName: z.string().max(150).trim().optional().nullable(),
});

export const incidentUpdateIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  updateId: z.coerce.number().int().positive(),
});

// ════════════════════════════════════════════════════════════════
// ALERTS
// ════════════════════════════════════════════════════════════════

export const createAlertSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200).trim(),
  message: z.string().min(1, 'Message is required').max(2000).trim(),
  type: alertTypeEnum,
  severity: incidentSeverityEnum.optional().default('MEDIUM'),
  source: z.string().max(100).trim().optional().nullable(),
  location: z.string().max(200).trim().optional().nullable(),
  departmentId: z.coerce.number().int().positive().optional().nullable(),
  departmentName: z.string().max(150).trim().optional().nullable(),
  incidentId: z.coerce.number().int().positive().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  createdById: z.coerce.number().int().positive().optional().nullable(),
});

export const updateAlertSchema = z
  .object({
    title: z.string().min(1).max(200).trim().optional(),
    message: z.string().min(1).max(2000).trim().optional(),
    type: alertTypeEnum.optional(),
    severity: incidentSeverityEnum.optional(),
    source: z.string().max(100).trim().optional().nullable(),
    location: z.string().max(200).trim().optional().nullable(),
    departmentId: z.coerce.number().int().positive().optional().nullable(),
    departmentName: z.string().max(150).trim().optional().nullable(),
    incidentId: z.coerce.number().int().positive().optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided for update',
  });

export const alertIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Alert id must be a positive integer'),
});

export const alertQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().max(100).trim().optional(),
  type: z
    .enum([
      'SAFETY',
      'SECURITY',
      'MAINTENANCE',
      'FIRE',
      'INTRUSION',
      'ENVIRONMENTAL',
      'CUSTOM',
      'all',
    ])
    .optional()
    .default('all'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'all']).optional().default('all'),
  status: z
    .enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED', 'all'])
    .optional()
    .default('all'),
  departmentId: z.coerce.number().int().positive().optional(),
  incidentId: z.coerce.number().int().positive().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'severity', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// Acknowledge / Resolve action bodies
export const acknowledgeAlertSchema = z.object({
  acknowledgedById: z.coerce.number().int().positive().optional().nullable(),
  acknowledgedByName: z.string().max(150).trim().optional().nullable(),
});

export const resolveAlertSchema = z.object({
  resolvedById: z.coerce.number().int().positive().optional().nullable(),
  resolvedByName: z.string().max(150).trim().optional().nullable(),
});

// ── KPI query ─────────────────────────────────────────────────────────────────

export const securityKpiQuerySchema = z.object({
  departmentId: z.coerce.number().int().positive().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;
export type IncidentAiSummaryInput = z.infer<typeof incidentAiSummarySchema>;
export type IncidentEscalationInput = z.infer<typeof incidentEscalationSchema>;
export type IncidentQueryInput = z.infer<typeof incidentQuerySchema>;
export type IncidentStatusInput = z.infer<typeof incidentStatusSchema>;
export type AssignIncidentInput = z.infer<typeof assignIncidentSchema>;
export type CreateIncidentUpdateInput = z.infer<typeof createIncidentUpdateSchema>;
export type CreateAlertInput = z.infer<typeof createAlertSchema>;
export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;
export type AlertQueryInput = z.infer<typeof alertQuerySchema>;
export type AcknowledgeAlertInput = z.infer<typeof acknowledgeAlertSchema>;
export type ResolveAlertInput = z.infer<typeof resolveAlertSchema>;
export type SecurityKpiQueryInput = z.infer<typeof securityKpiQuerySchema>;

/** An incident by id or by its number (the perception service knows INC-...). */
export const evidenceRefParamSchema = z.object({
  ref: z.string().regex(/^(\d{1,10}|[A-Za-z0-9-]{3,100})$/, 'Invalid incident reference'),
});

export const evidenceFileQuerySchema = z.object({
  file: z.string().min(1).max(300),
});

/** One action on many incidents (Incident Center multi-select). */
export const bulkIncidentSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  action: z.enum(['investigate', 'resolve', 'false_alarm', 'assign']),
  reason: z.string().trim().max(500).optional(),
  assignedToId: z.number().int().positive().optional(),
});

export type BulkIncidentInput = z.infer<typeof bulkIncidentSchema>;
