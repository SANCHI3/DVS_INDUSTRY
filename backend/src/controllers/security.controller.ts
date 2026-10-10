import type { Request, Response } from 'express';
import { ForbiddenError } from '../errors';
import { ROLES } from '../constants';
import type { AuthenticatedRequest } from '../types';
import { SecurityService } from '../services/security.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import type {
  CreateIncidentInput,
  UpdateIncidentInput,
  IncidentQueryInput,
  IncidentStatusInput,
  AssignIncidentInput,
  CreateIncidentUpdateInput,
  CreateAlertInput,
  UpdateAlertInput,
  AlertQueryInput,
  SecurityKpiQueryInput,
  IncidentAiSummaryInput,
} from '../validators/security.validator';
import type {
  IncidentFilters,
  AlertFilters,
  CreateIncidentData,
  UpdateIncidentData,
  CreateAlertData,
  UpdateAlertData,
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
  AlertType,
} from '../interfaces';

const svc = new SecurityService();

function parseId(raw: string | string[] | undefined): number {
  return parseInt(String(raw ?? '0'), 10);
}

/** Actor fields always come from the authenticated account, never the body. */
function actorOf(req: AuthenticatedRequest): { id: number | null; name: string | null } {
  return { id: req.user?.id ?? null, name: req.user?.fullName ?? null };
}

// Roles allowed to create incidents with a caller-chosen external number. The
// number doubles as an idempotency key, so a matching existing incident is
// returned — which must not become a read path for roles without SEC_READ.
const EXTERNAL_ID_ROLES: readonly string[] = [ROLES.ADMIN, ROLES.PERCEPTION_SERVICE];

// ══ KPIs ══════════════════════════════════════════════════════════════════════

export async function getKPIs(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as SecurityKpiQueryInput;
  sendSuccess(res, await svc.getKPIs(q.departmentId, q.fromDate, q.toDate));
}

// ══ INCIDENTS ═════════════════════════════════════════════════════════════════

export async function createIncident(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as CreateIncidentInput;
  if (body.incident_id !== undefined && !EXTERNAL_ID_ROLES.includes(req.user?.role ?? '')) {
    throw new ForbiddenError('Only the perception service or an admin may set incident_id');
  }
  const actor = actorOf(req);
  const data: CreateIncidentData = {
    incidentNumber: body.incident_id,
    title: body.title,
    description: body.description,
    aiSummary: body.aiSummary ?? body.summary ?? null,
    confidenceScore: body.confidenceScore ?? null,
    type: body.type as IncidentType,
    severity: body.severity as IncidentSeverity,
    location: body.location ?? null,
    departmentId: body.departmentId ?? null,
    departmentName: body.departmentName ?? null,
    reportedById: actor.id,
    reportedByName: actor.name ?? body.reportedByName ?? null,
    assignedToId: body.assignedToId ?? null,
    assignedToName: body.assignedToName ?? null,
    occurredAt: body.occurredAt,
  };
  sendCreated(res, await svc.createIncident(data), 'Security incident reported successfully');
}

export async function getAllIncidents(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as IncidentQueryInput;
  const filters: IncidentFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
    status: q.status as IncidentStatus | 'all',
    severity: q.severity as IncidentSeverity | 'all',
    type: q.type as IncidentType | 'all',
  };
  if (q.search !== undefined) filters.search = q.search;
  if (q.departmentId !== undefined) filters.departmentId = q.departmentId;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await svc.getAllIncidents(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getIncidentById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getIncidentById(parseId(req.params['id'])));
}

export async function getIncidentDetail(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getIncidentDetail(parseId(req.params['id'])));
}

export async function updateIncident(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as UpdateIncidentInput;
  const data: UpdateIncidentData = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.aiSummary !== undefined) {
    data.aiSummary = body.aiSummary;
  } else if (body.summary !== undefined) {
    data.aiSummary = body.summary;
  }
  if (body.type !== undefined) data.type = body.type as IncidentType;
  if (body.severity !== undefined) data.severity = body.severity as IncidentSeverity;
  if (body.status !== undefined) data.status = body.status as IncidentStatus;
  if (body.location !== undefined) data.location = body.location;
  if (body.departmentId !== undefined) data.departmentId = body.departmentId;
  if (body.departmentName !== undefined) data.departmentName = body.departmentName;
  if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId;
  if (body.assignedToName !== undefined) data.assignedToName = body.assignedToName;
  if (body.occurredAt !== undefined) data.occurredAt = body.occurredAt;
  if (body.resolvedAt !== undefined) data.resolvedAt = body.resolvedAt;
  if (body.closedAt !== undefined) data.closedAt = body.closedAt;
  if (body.rootCause !== undefined) data.rootCause = body.rootCause;
  if (body.correctiveAction !== undefined) data.correctiveAction = body.correctiveAction;

  sendSuccess(res, await svc.updateIncident(id, data), 200, 'Incident updated successfully');
}

export async function updateIncidentAiSummary(req: Request, res: Response): Promise<void> {
  const body = req.body as IncidentAiSummaryInput;
  sendSuccess(
    res,
    await svc.updateIncidentAiSummary(body.incident_id, body.summary),
    200,
    'Incident AI summary updated successfully',
  );
}

export async function transitionStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as IncidentStatusInput;
  const incident = await svc.transitionIncidentStatus(
    id,
    body.status as IncidentStatus,
    body.comment ?? null,
    actorOf(req).id,
    actorOf(req).name,
    body.rootCause ?? null,
    body.correctiveAction ?? null,
  );
  sendSuccess(res, incident, 200, `Incident status updated to ${incident.status}`);
}

export async function assignIncident(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as AssignIncidentInput;
  sendSuccess(
    res,
    await svc.assignIncident(id, body.assignedToId, body.assignedToName ?? null),
    200,
    'Incident assigned successfully',
  );
}

export async function deleteIncident(req: Request, res: Response): Promise<void> {
  await svc.deleteIncident(parseId(req.params['id']));
  sendNoContent(res);
}

// ── Incident Updates ──────────────────────────────────────────────────────────

export async function addIncidentUpdate(req: AuthenticatedRequest, res: Response): Promise<void> {
  const incidentId = parseId(req.params['id']);
  const body = req.body as CreateIncidentUpdateInput;
  const update = await svc.addUpdate(incidentId, {
    comment: body.comment,
    statusChange: (body.statusChange ?? null) as IncidentStatus | null,
    updatedById: actorOf(req).id,
    updatedByName: actorOf(req).name,
  });
  sendCreated(res, update, 'Incident update added');
}

export async function getIncidentUpdates(req: Request, res: Response): Promise<void> {
  const incidentId = parseId(req.params['id']);
  sendSuccess(res, await svc.getUpdates(incidentId));
}

export async function deleteIncidentUpdate(req: Request, res: Response): Promise<void> {
  const incidentId = parseId(req.params['id']);
  const updateId = parseId(req.params['updateId']);
  await svc.deleteUpdate(incidentId, updateId);
  sendNoContent(res);
}

// ══ ALERTS ════════════════════════════════════════════════════════════════════

export async function createAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as CreateAlertInput;
  const data: CreateAlertData = {
    title: body.title,
    message: body.message,
    type: body.type as AlertType,
    severity: body.severity as IncidentSeverity,
    source: body.source ?? null,
    location: body.location ?? null,
    departmentId: body.departmentId ?? null,
    departmentName: body.departmentName ?? null,
    incidentId: body.incidentId ?? null,
    expiresAt: body.expiresAt ?? null,
    createdById: actorOf(req).id,
  };
  sendCreated(res, await svc.createAlert(data), 'Security alert created successfully');
}

export async function getAllAlerts(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as AlertQueryInput;
  const filters: AlertFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
    type: q.type as AlertType | 'all',
    severity: q.severity as IncidentSeverity | 'all',
    status: q.status as 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'EXPIRED' | 'all',
  };
  if (q.search !== undefined) filters.search = q.search;
  if (q.departmentId !== undefined) filters.departmentId = q.departmentId;
  if (q.incidentId !== undefined) filters.incidentId = q.incidentId;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await svc.getAllAlerts(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getAlertById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getAlertById(parseId(req.params['id'])));
}

export async function updateAlert(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as UpdateAlertInput;
  const data: UpdateAlertData = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.message !== undefined) data.message = body.message;
  if (body.type !== undefined) data.type = body.type as AlertType;
  if (body.severity !== undefined) data.severity = body.severity as IncidentSeverity;
  if (body.source !== undefined) data.source = body.source;
  if (body.location !== undefined) data.location = body.location;
  if (body.departmentId !== undefined) data.departmentId = body.departmentId;
  if (body.departmentName !== undefined) data.departmentName = body.departmentName;
  if (body.incidentId !== undefined) data.incidentId = body.incidentId;
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt;

  sendSuccess(res, await svc.updateAlert(id, data), 200, 'Alert updated successfully');
}

export async function acknowledgeAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const alert = await svc.acknowledgeAlert(id, {
    acknowledgedById: actorOf(req).id,
    acknowledgedByName: actorOf(req).name,
  });
  sendSuccess(res, alert, 200, 'Alert acknowledged');
}

export async function resolveAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const alert = await svc.resolveAlert(id, {
    resolvedById: actorOf(req).id,
    resolvedByName: actorOf(req).name,
  });
  sendSuccess(res, alert, 200, 'Alert resolved');
}

export async function deleteAlert(req: Request, res: Response): Promise<void> {
  await svc.deleteAlert(parseId(req.params['id']));
  sendNoContent(res);
}
