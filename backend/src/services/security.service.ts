import { SecurityRepository } from '../repositories/security.repository';
import type {
  SecurityIncidentDto,
  SecurityIncidentDetail,
  IncidentListResult,
  IncidentFilters,
  CreateIncidentData,
  UpdateIncidentData,
  IncidentUpdateDto,
  CreateIncidentUpdateData,
  SecurityAlertDto,
  AlertListResult,
  AlertFilters,
  CreateAlertData,
  UpdateAlertData,
  AcknowledgeAlertData,
  ResolveAlertData,
  SecurityKPIs,
  IncidentStatus,
  IncidentSeverity,
} from '../interfaces';
import { Prisma } from '@prisma/client';
import { NotFoundError, BadRequestError } from '../errors';
import { logger } from '../logger';
import { publishSecurityEvent } from '../lib/securityEvents';

/**
 * SecurityService — business rules:
 *
 * Incidents:
 *  1. Status machine: OPEN → INVESTIGATING → RESOLVED → CLOSED
 *     OPEN can jump directly to RESOLVED (minor incidents)
 *     CLOSED is terminal — no further transitions
 *  2. resolvedAt auto-set when status → RESOLVED
 *  3. closedAt auto-set when status → CLOSED
 *  4. Cannot delete a CLOSED incident (archival)
 *  5. Incident update's statusChange must follow the same machine
 *
 * Alerts:
 *  6. EXPIRED and RESOLVED are terminal — cannot transition back
 *  7. ACTIVE or ACKNOWLEDGED alerts can be resolved (acknowledging first is optional)
 *  8. Auto-expire: if expiresAt is past and status is ACTIVE → mark EXPIRED
 *  9. Cannot delete ACTIVE/CRITICAL alerts directly — must resolve first
 */

const ALLOWED_INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'RESOLVED'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

const SEVERITY_ORDER: IncidentSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export class SecurityService {
  private readonly repo: SecurityRepository;

  constructor() {
    this.repo = new SecurityRepository();
  }

  // ══ INCIDENTS ════════════════════════════════════════════════════════════

  async createIncident(data: CreateIncidentData): Promise<SecurityIncidentDto> {
    const incidentNumber = data.incidentNumber?.trim();
    if (incidentNumber) {
      const existing = await this.repo.findIncidentByNumber(incidentNumber);
      if (existing) {
        logger.info('Security incident reused', {
          id: existing.id,
          number: existing.incidentNumber,
        });
        return existing;
      }
    }

    try {
      const incident = await this.repo.createIncident(data);
      logger.info('Security incident created', {
        id: incident.id,
        number: incident.incidentNumber,
      });
      publishSecurityEvent({ type: 'incident.created', incident });
      return incident;
    } catch (err) {
      // Two concurrent reports with the same external number: the loser of the
      // unique-constraint race returns the winner's row (idempotent create).
      if (
        incidentNumber &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.repo.findIncidentByNumber(incidentNumber);
        if (existing) return existing;
      }
      throw err;
    }
  }

  async updateIncident(id: number, data: UpdateIncidentData): Promise<SecurityIncidentDto> {
    const existing = await this.getIncidentOrThrow(id);

    // Rule 1 — status machine
    if (data.status !== undefined && data.status !== existing.status) {
      const allowed = ALLOWED_INCIDENT_TRANSITIONS[existing.status];
      if (!allowed.includes(data.status)) {
        throw new BadRequestError(
          `Cannot transition incident from ${existing.status} to ${data.status}. ` +
            `Allowed: ${allowed.join(', ') || 'none'}`,
        );
      }
      // Rule 2 & 3 — auto-set timestamps
      if (data.status === 'RESOLVED' && data.resolvedAt === undefined) {
        data.resolvedAt = new Date();
      }
      if (data.status === 'CLOSED' && data.closedAt === undefined) {
        data.closedAt = new Date();
      }
    }

    const incident = await this.repo.updateIncident(id, data);
    logger.info('Security incident updated', { id, status: incident.status });
    publishSecurityEvent({ type: 'incident.updated', incident, previousSeverity: existing.severity });
    return incident;
  }

  async getIncidentById(id: number): Promise<SecurityIncidentDto> {
    return this.getIncidentOrThrow(id);
  }

  async getIncidentDetail(id: number): Promise<SecurityIncidentDetail> {
    const detail = await this.repo.findIncidentDetail(id);
    if (!detail) throw new NotFoundError(`Security incident with id ${id} not found`);
    return detail;
  }

  async updateIncidentAiSummary(
    incidentNumber: string,
    aiSummary: string,
  ): Promise<SecurityIncidentDto> {
    const existing = await this.repo.findIncidentByNumber(incidentNumber);
    if (!existing) {
      throw new NotFoundError(`Security incident ${incidentNumber} not found`);
    }

    const incident = await this.repo.updateIncident(existing.id, { aiSummary });
    logger.info('Security incident AI summary updated', {
      id: incident.id,
      number: incident.incidentNumber,
    });
    publishSecurityEvent({ type: 'incident.updated', incident, previousSeverity: existing.severity });
    return incident;
  }

  /**
   * Raise an incident's severity and/or AI confidence by its external incident
   * number (used by the perception service, e.g. a fall where the person stays
   * down, or a detection that grows more certain). Both values can only go up
   * -- a request that raises neither is a no-op -- and every raise is recorded
   * as an incident update so the change is auditable.
   */
  async escalateIncidentSeverity(
    incidentNumber: string,
    severity: IncidentSeverity,
    reason: string,
    updatedById: number | null = null,
    updatedByName: string | null = null,
    confidenceScore?: number,
  ): Promise<SecurityIncidentDto> {
    const existing = await this.repo.findIncidentByNumber(incidentNumber);
    if (!existing) {
      throw new NotFoundError(`Security incident ${incidentNumber} not found`);
    }
    if (existing.status === 'RESOLVED' || existing.status === 'CLOSED') return existing;

    const raiseSeverity = SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(existing.severity);
    const raiseConfidence =
      confidenceScore !== undefined && confidenceScore > (existing.confidenceScore ?? 0);
    if (!raiseSeverity && !raiseConfidence) return existing;

    const changes: string[] = [];
    if (raiseSeverity) changes.push(`severity ${existing.severity} -> ${severity}`);
    if (raiseConfidence) {
      const pct = (v: number | null) => `${Math.round((v ?? 0) * 100)}%`;
      changes.push(`confidence ${pct(existing.confidenceScore)} -> ${pct(confidenceScore)}`);
    }
    const incident = await this.repo.updateIncident(existing.id, {
      ...(raiseSeverity && { severity }),
      ...(raiseConfidence && { confidenceScore }),
    });
    await this.repo.addIncidentUpdate({
      incidentId: existing.id,
      comment: `Raised ${changes.join(', ')}: ${reason}`,
      updatedById,
      updatedByName,
    });
    logger.info('Security incident escalated', {
      id: incident.id,
      number: incident.incidentNumber,
      changes,
    });
    publishSecurityEvent({
      type: 'incident.updated',
      incident,
      previousSeverity: existing.severity,
      previousConfidence: existing.confidenceScore,
    });
    return incident;
  }

  async getAllIncidents(filters: IncidentFilters): Promise<IncidentListResult> {
    return this.repo.findAllIncidents(filters);
  }

  async deleteIncident(id: number): Promise<void> {
    const existing = await this.getIncidentOrThrow(id);
    // Rule 4 — cannot delete CLOSED
    if (existing.status === 'CLOSED') {
      throw new BadRequestError('Cannot delete a closed incident. It is permanently archived.');
    }
    await this.repo.softDeleteIncident(id);
    logger.info('Security incident soft-deleted', { id });
    publishSecurityEvent({ type: 'incident.deleted', incidentId: id });
  }

  // ── Status transition shortcut ────────────────────────────────────────────

  async transitionIncidentStatus(
    id: number,
    status: IncidentStatus,
    comment?: string | null,
    updatedById?: number | null,
    updatedByName?: string | null,
    rootCause?: string | null,
    correctiveAction?: string | null,
  ): Promise<SecurityIncidentDto> {
    const incident = await this.updateIncident(id, {
      status,
      ...(rootCause !== undefined && { rootCause }),
      ...(correctiveAction !== undefined && { correctiveAction }),
    });

    // Add an automatic update entry if a comment or status change occurred
    const updateComment = comment?.trim() || `Status changed to ${status}`;
    await this.repo.addIncidentUpdate({
      incidentId: id,
      comment: updateComment,
      statusChange: status,
      updatedById: updatedById ?? null,
      updatedByName: updatedByName ?? null,
    });

    return incident;
  }

  // ── Assign ────────────────────────────────────────────────────────────────

  async assignIncident(
    id: number,
    assignedToId: number | null,
    assignedToName?: string | null,
  ): Promise<SecurityIncidentDto> {
    const existing = await this.getIncidentOrThrow(id);
    const incident = await this.repo.updateIncident(id, {
      assignedToId,
      assignedToName: assignedToName ?? null,
    });
    logger.info('Incident assigned', { id, assignedToId });
    publishSecurityEvent({ type: 'incident.updated', incident, previousSeverity: existing.severity });
    return incident;
  }

  // ── Incident Updates ──────────────────────────────────────────────────────

  async addUpdate(
    incidentId: number,
    data: Omit<CreateIncidentUpdateData, 'incidentId'>,
  ): Promise<IncidentUpdateDto> {
    const incident = await this.getIncidentOrThrow(incidentId);

    // Rule 5 — statusChange must follow machine
    if (data.statusChange != null && data.statusChange !== incident.status) {
      const allowed = ALLOWED_INCIDENT_TRANSITIONS[incident.status];
      if (!allowed.includes(data.statusChange)) {
        throw new BadRequestError(
          `Cannot set statusChange to ${data.statusChange} — incident is ${incident.status}`,
        );
      }
      // Propagate the status change to the parent incident
      await this.repo.updateIncident(incidentId, {
        status: data.statusChange,
        ...(data.statusChange === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
        ...(data.statusChange === 'CLOSED' ? { closedAt: new Date() } : {}),
      });
    }

    const update = await this.repo.addIncidentUpdate({ ...data, incidentId });
    logger.info('Incident update added', { incidentId, updateId: update.id });
    return update;
  }

  async getUpdates(incidentId: number): Promise<IncidentUpdateDto[]> {
    await this.getIncidentOrThrow(incidentId);
    return this.repo.findUpdatesByIncident(incidentId);
  }

  async deleteUpdate(incidentId: number, updateId: number): Promise<void> {
    await this.getIncidentOrThrow(incidentId);
    const update = await this.repo.findUpdateById(updateId);
    if (!update) throw new NotFoundError(`Incident update ${updateId} not found`);
    if (update.incidentId !== incidentId) {
      throw new BadRequestError(`Update ${updateId} does not belong to incident ${incidentId}`);
    }
    await this.repo.deleteIncidentUpdate(updateId);
    logger.info('Incident update deleted', { incidentId, updateId });
  }

  // ══ ALERTS ═══════════════════════════════════════════════════════════════

  async createAlert(data: CreateAlertData): Promise<SecurityAlertDto> {
    // Validate incidentId if provided
    if (data.incidentId != null) {
      await this.getIncidentOrThrow(data.incidentId);
    }
    const alert = await this.repo.createAlert(data);
    logger.info('Security alert created', { id: alert.id, number: alert.alertNumber });
    return alert;
  }

  async updateAlert(id: number, data: UpdateAlertData): Promise<SecurityAlertDto> {
    const existing = await this.getAlertOrThrow(id);

    // Rule 6 — terminal check
    if (existing.status === 'RESOLVED' || existing.status === 'EXPIRED') {
      throw new BadRequestError(`Cannot update a ${existing.status.toLowerCase()} alert`);
    }

    if (data.incidentId != null) {
      await this.getIncidentOrThrow(data.incidentId);
    }

    const alert = await this.repo.updateAlert(id, data);
    logger.info('Security alert updated', { id });
    return alert;
  }

  async acknowledgeAlert(id: number, data: AcknowledgeAlertData): Promise<SecurityAlertDto> {
    const existing = await this.getAlertOrThrow(id);

    if (existing.status !== 'ACTIVE') {
      throw new BadRequestError(
        `Cannot acknowledge an alert with status "${existing.status}". Alert must be ACTIVE.`,
      );
    }

    // Auto-expire check before acknowledging
    await this.autoExpireIfNeeded(existing);

    const alert = await this.repo.acknowledgeAlert(id, data);
    logger.info('Security alert acknowledged', { id });
    return alert;
  }

  async resolveAlert(id: number, data: ResolveAlertData): Promise<SecurityAlertDto> {
    const existing = await this.getAlertOrThrow(id);

    // Rule 6 — terminal
    if (existing.status === 'RESOLVED' || existing.status === 'EXPIRED') {
      throw new BadRequestError(`Alert is already ${existing.status.toLowerCase()}`);
    }

    const alert = await this.repo.resolveAlert(id, data);
    logger.info('Security alert resolved', { id });
    return alert;
  }

  async getAlertById(id: number): Promise<SecurityAlertDto> {
    return this.getAlertOrThrow(id);
  }

  async getAllAlerts(filters: AlertFilters): Promise<AlertListResult> {
    return this.repo.findAllAlerts(filters);
  }

  async deleteAlert(id: number): Promise<void> {
    const existing = await this.getAlertOrThrow(id);

    // Rule 9 — cannot delete ACTIVE + CRITICAL
    if (existing.status === 'ACTIVE' && existing.severity === 'CRITICAL') {
      throw new BadRequestError(
        'Cannot delete an ACTIVE CRITICAL alert. Resolve or acknowledge it first.',
      );
    }

    await this.repo.deleteAlert(id);
    logger.info('Security alert deleted', { id });
  }

  // ══ KPIs ═════════════════════════════════════════════════════════════════

  async getKPIs(departmentId?: number, fromDate?: Date, toDate?: Date): Promise<SecurityKPIs> {
    return this.repo.getKPIs(departmentId, fromDate, toDate);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getIncidentOrThrow(id: number): Promise<SecurityIncidentDto> {
    const incident = await this.repo.findIncidentById(id);
    if (!incident) throw new NotFoundError(`Security incident with id ${id} not found`);
    return incident;
  }

  private async getAlertOrThrow(id: number): Promise<SecurityAlertDto> {
    const alert = await this.repo.findAlertById(id);
    if (!alert) throw new NotFoundError(`Security alert with id ${id} not found`);
    return alert;
  }

  private async autoExpireIfNeeded(alert: SecurityAlertDto): Promise<void> {
    if (alert.expiresAt && alert.expiresAt < new Date() && alert.status === 'ACTIVE') {
      await this.repo.expireAlert(alert.id);
      throw new BadRequestError(
        `Alert has expired (expiresAt: ${alert.expiresAt.toISOString()}) and has been marked EXPIRED.`,
      );
    }
  }
}
