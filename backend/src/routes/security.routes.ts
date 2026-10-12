import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as SecurityController from '../controllers/security.controller';
import {
  createIncidentSchema,
  updateIncidentSchema,
  incidentIdParamSchema,
  incidentQuerySchema,
  incidentStatusSchema,
  assignIncidentSchema,
  createIncidentUpdateSchema,
  incidentUpdateIdParamSchema,
  createAlertSchema,
  updateAlertSchema,
  alertIdParamSchema,
  alertQuerySchema,
  acknowledgeAlertSchema,
  resolveAlertSchema,
  securityKpiQuerySchema,
  incidentAiSummarySchema,
  incidentEscalationSchema,
} from '../validators/security.validator';
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
const SEC_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION] as const;
const SEC_WRITE = [ROLES.ADMIN, ROLES.MANAGER] as const;
const SEC_MANAGE = [ROLES.ADMIN] as const;
// The perception service may only report incidents and attach AI summaries.
const INCIDENT_REPORTERS = [...ALL_ROLES, ROLES.PERCEPTION_SERVICE] as const;
const AI_SUMMARY_WRITERS = [...SEC_WRITE, ROLES.PERCEPTION_SERVICE] as const;

// ════════════════════════════════════════════════════════════════
// KPIs (before parameterised routes)
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/security/kpis
 * Security KPIs — incident counts, alert counts, breakdowns, 7-day trend.
 * Query: ?departmentId ?fromDate ?toDate
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/kpis',
  authorize(...SEC_READ),
  validateRequest({ query: securityKpiQuerySchema }),
  asyncHandler(SecurityController.getKPIs),
);

// ════════════════════════════════════════════════════════════════
// INCIDENTS
// ════════════════════════════════════════════════════════════════

/**
 * PATCH /api/v1/security/incidents/ai-summary
 * Update an existing incident summary using its external incident number.
 * Body: { incident_id, summary }
 * Access: ADMIN, MANAGER, PERCEPTION_SERVICE
 */
router.patch(
  '/incidents/ai-summary',
  authorize(...AI_SUMMARY_WRITERS),
  validateRequest({ body: incidentAiSummarySchema }),
  asyncHandler(SecurityController.updateIncidentAiSummary),
);

/**
 * GET /api/v1/security/stream
 * Server-Sent Events: incident.created / incident.updated / incident.deleted,
 * pushed as they happen so dashboards update without polling or refresh.
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get('/stream', authorize(...SEC_READ), SecurityController.streamSecurityEvents);

/**
 * PATCH /api/v1/security/incidents/escalate
 * Raise an incident's severity using its external incident number. Severity
 * can only increase; each raise is logged as an incident update.
 * Body: { incident_id, severity, reason }
 * Access: ADMIN, MANAGER, PERCEPTION_SERVICE
 */
router.patch(
  '/incidents/escalate',
  authorize(...AI_SUMMARY_WRITERS),
  validateRequest({ body: incidentEscalationSchema }),
  asyncHandler(SecurityController.escalateIncidentSeverity),
);

/**
 * GET /api/v1/security/incidents
 * List incidents with filters.
 * Query: ?search ?type ?severity ?status ?departmentId ?fromDate ?toDate ?page ?pageSize ?sortBy ?sortOrder
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/incidents',
  authorize(...SEC_READ),
  validateRequest({ query: incidentQuerySchema }),
  asyncHandler(SecurityController.getAllIncidents),
);

/**
 * POST /api/v1/security/incidents
 * Report a new security incident (INC-NNNN auto-generated).
 * Access: All internal roles + PERCEPTION_SERVICE
 */
router.post(
  '/incidents',
  authorize(...INCIDENT_REPORTERS),
  validateRequest({ body: createIncidentSchema }),
  asyncHandler(SecurityController.createIncident),
);

/**
 * GET /api/v1/security/incidents/:id
 * Get incident summary.
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/incidents/:id',
  authorize(...SEC_READ),
  validateRequest({ params: incidentIdParamSchema }),
  asyncHandler(SecurityController.getIncidentById),
);

/**
 * GET /api/v1/security/incidents/:id/detail
 * Get incident with all updates + linked alerts.
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/incidents/:id/detail',
  authorize(...SEC_READ),
  validateRequest({ params: incidentIdParamSchema }),
  asyncHandler(SecurityController.getIncidentDetail),
);

/**
 * PATCH /api/v1/security/incidents/:id
 * Update incident fields.
 * Access: ADMIN, MANAGER
 */
router.patch(
  '/incidents/:id',
  authorize(...SEC_WRITE),
  validateRequest({ params: incidentIdParamSchema, body: updateIncidentSchema }),
  asyncHandler(SecurityController.updateIncident),
);

/**
 * PATCH /api/v1/security/incidents/:id/status
 * Status transition shortcut — validates state machine, adds update entry.
 * Body: { status, comment?, updatedById?, updatedByName?, rootCause?, correctiveAction? }
 * Access: ADMIN, MANAGER
 */
router.patch(
  '/incidents/:id/status',
  authorize(...SEC_WRITE),
  validateRequest({ params: incidentIdParamSchema, body: incidentStatusSchema }),
  asyncHandler(SecurityController.transitionStatus),
);

/**
 * PATCH /api/v1/security/incidents/:id/assign
 * Assign incident to an employee.
 * Body: { assignedToId, assignedToName? }
 * Access: ADMIN, MANAGER
 */
router.patch(
  '/incidents/:id/assign',
  authorize(...SEC_WRITE),
  validateRequest({ params: incidentIdParamSchema, body: assignIncidentSchema }),
  asyncHandler(SecurityController.assignIncident),
);

/**
 * DELETE /api/v1/security/incidents/:id
 * Soft-delete (blocked if status is CLOSED).
 * Access: ADMIN only
 */
router.delete(
  '/incidents/:id',
  authorize(...SEC_MANAGE),
  validateRequest({ params: incidentIdParamSchema }),
  asyncHandler(SecurityController.deleteIncident),
);

// ── Incident Updates (nested) ─────────────────────────────────────────────────

/**
 * GET /api/v1/security/incidents/:id/updates
 * List all update entries for an incident.
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/incidents/:id/updates',
  authorize(...SEC_READ),
  validateRequest({ params: incidentIdParamSchema }),
  asyncHandler(SecurityController.getIncidentUpdates),
);

/**
 * POST /api/v1/security/incidents/:id/updates
 * Add a comment / status-change entry to an incident.
 * Body: { comment, statusChange?, updatedById?, updatedByName? }
 * Access: ADMIN, MANAGER
 */
router.post(
  '/incidents/:id/updates',
  authorize(...SEC_WRITE),
  validateRequest({ params: incidentIdParamSchema, body: createIncidentUpdateSchema }),
  asyncHandler(SecurityController.addIncidentUpdate),
);

/**
 * DELETE /api/v1/security/incidents/:id/updates/:updateId
 * Delete an update entry.
 * Access: ADMIN only
 */
router.delete(
  '/incidents/:id/updates/:updateId',
  authorize(...SEC_MANAGE),
  validateRequest({ params: incidentUpdateIdParamSchema }),
  asyncHandler(SecurityController.deleteIncidentUpdate),
);

// ════════════════════════════════════════════════════════════════
// ALERTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/security/alerts
 * List alerts with filters.
 * Query: ?search ?type ?severity ?status ?departmentId ?incidentId ?fromDate ?toDate ?page ?pageSize ?sortBy ?sortOrder
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/alerts',
  authorize(...SEC_READ),
  validateRequest({ query: alertQuerySchema }),
  asyncHandler(SecurityController.getAllAlerts),
);

/**
 * POST /api/v1/security/alerts
 * Create a new alert (ALT-NNNN auto-generated).
 * Access: ADMIN, MANAGER
 */
router.post(
  '/alerts',
  authorize(...SEC_WRITE),
  validateRequest({ body: createAlertSchema }),
  asyncHandler(SecurityController.createAlert),
);

/**
 * GET /api/v1/security/alerts/:id
 * Get a single alert by ID.
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.get(
  '/alerts/:id',
  authorize(...SEC_READ),
  validateRequest({ params: alertIdParamSchema }),
  asyncHandler(SecurityController.getAlertById),
);

/**
 * PATCH /api/v1/security/alerts/:id
 * Update alert fields (blocked if RESOLVED or EXPIRED).
 * Access: ADMIN, MANAGER
 */
router.patch(
  '/alerts/:id',
  authorize(...SEC_WRITE),
  validateRequest({ params: alertIdParamSchema, body: updateAlertSchema }),
  asyncHandler(SecurityController.updateAlert),
);

/**
 * PATCH /api/v1/security/alerts/:id/acknowledge
 * Acknowledge an ACTIVE alert.
 * Body: { acknowledgedById?, acknowledgedByName? }
 * Access: ADMIN, MANAGER, PRODUCTION
 */
router.patch(
  '/alerts/:id/acknowledge',
  authorize(...SEC_READ),
  validateRequest({ params: alertIdParamSchema, body: acknowledgeAlertSchema }),
  asyncHandler(SecurityController.acknowledgeAlert),
);

/**
 * PATCH /api/v1/security/alerts/:id/resolve
 * Resolve an alert.
 * Body: { resolvedById?, resolvedByName? }
 * Access: ADMIN, MANAGER
 */
router.patch(
  '/alerts/:id/resolve',
  authorize(...SEC_WRITE),
  validateRequest({ params: alertIdParamSchema, body: resolveAlertSchema }),
  asyncHandler(SecurityController.resolveAlert),
);

/**
 * DELETE /api/v1/security/alerts/:id
 * Delete alert (blocked for ACTIVE + CRITICAL).
 * Access: ADMIN only
 */
router.delete(
  '/alerts/:id',
  authorize(...SEC_MANAGE),
  validateRequest({ params: alertIdParamSchema }),
  asyncHandler(SecurityController.deleteAlert),
);

export default router;
