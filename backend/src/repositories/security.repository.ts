import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import { nextDocumentNumber, withUniqueNumberRetry } from '../utils/documentNumber';
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
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
  AlertType,
  AlertStatus,
} from '../interfaces';

// ── Select shapes ─────────────────────────────────────────────────────────────

const incidentSelect = {
  id: true,
  incidentNumber: true,
  title: true,
  description: true,
  aiSummary: true,
  type: true,
  confidenceScore: true,
  severity: true,
  status: true,
  location: true,
  departmentId: true,
  departmentName: true,
  reportedById: true,
  reportedByName: true,
  assignedToId: true,
  assignedToName: true,
  occurredAt: true,
  resolvedAt: true,
  closedAt: true,
  rootCause: true,
  correctiveAction: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  _count: { select: { updates: true, alerts: true } },
} as const;

const incidentUpdateSelect = {
  id: true,
  incidentId: true,
  comment: true,
  statusChange: true,
  updatedById: true,
  updatedByName: true,
  createdAt: true,
} as const;

const alertSelect = {
  id: true,
  alertNumber: true,
  title: true,
  message: true,
  type: true,
  severity: true,
  status: true,
  source: true,
  location: true,
  departmentId: true,
  departmentName: true,
  incidentId: true,
  acknowledgedById: true,
  acknowledgedByName: true,
  acknowledgedAt: true,
  resolvedById: true,
  resolvedByName: true,
  resolvedAt: true,
  expiresAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ── Converters ────────────────────────────────────────────────────────────────

type PrismaIncident = Prisma.SecurityIncidentGetPayload<{ select: typeof incidentSelect }>;
type PrismaUpdate = Prisma.IncidentUpdateGetPayload<{ select: typeof incidentUpdateSelect }>;
type PrismaAlert = Prisma.SecurityAlertGetPayload<{ select: typeof alertSelect }>;

function toIncidentDto(r: PrismaIncident): SecurityIncidentDto {
  return {
    ...r,
    type: r.type as IncidentType,
    severity: r.severity as IncidentSeverity,
    status: r.status as IncidentStatus,
  };
}

function toUpdateDto(r: PrismaUpdate): IncidentUpdateDto {
  return {
    ...r,
    statusChange: r.statusChange as IncidentStatus | null,
  };
}

function toAlertDto(r: PrismaAlert): SecurityAlertDto {
  return {
    ...r,
    type: r.type as AlertType,
    severity: r.severity as IncidentSeverity,
    status: r.status as AlertStatus,
  };
}

// ── Auto-number helpers ───────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

export class SecurityRepository {
  // ══ INCIDENTS ════════════════════════════════════════════════════════════

  async createIncident(data: CreateIncidentData): Promise<SecurityIncidentDto> {
    const externalNumber = data.incidentNumber?.trim();
    // A caller-supplied number is an idempotency key: never retry with another
    const create = async (): Promise<SecurityIncidentDto> => {
      const incidentNumber =
        externalNumber || (await nextDocumentNumber('securityIncident', 'INC-', { pad: 4 }));
      const raw = await prisma.securityIncident.create({
        data: {
          incidentNumber,
          title: data.title,
          description: data.description,
          aiSummary: data.aiSummary ?? null,
          type: data.type,
          confidenceScore: data.confidenceScore ?? null,
          severity: data.severity ?? 'MEDIUM',
          location: data.location ?? null,
          departmentId: data.departmentId ?? null,
          departmentName: data.departmentName ?? null,
          reportedById: data.reportedById ?? null,
          reportedByName: data.reportedByName ?? null,
          assignedToId: data.assignedToId ?? null,
          assignedToName: data.assignedToName ?? null,
          occurredAt: data.occurredAt ?? new Date(),
        },
        select: incidentSelect,
      });
      return toIncidentDto(raw);
    };
    return externalNumber ? create() : withUniqueNumberRetry(create);
  }

  async updateIncident(id: number, data: UpdateIncidentData): Promise<SecurityIncidentDto> {
    const up: Prisma.SecurityIncidentUpdateInput = {};
    if (data.title !== undefined) up.title = data.title;
    if (data.description !== undefined) up.description = data.description;
    if (data.aiSummary !== undefined) up.aiSummary = data.aiSummary;
    if (data.type !== undefined) up.type = data.type;
    if (data.severity !== undefined) up.severity = data.severity;
    if (data.confidenceScore !== undefined) up.confidenceScore = data.confidenceScore;
    if (data.status !== undefined) up.status = data.status;
    if (data.location !== undefined) up.location = data.location;
    if (data.departmentId !== undefined) up.departmentId = data.departmentId;
    if (data.departmentName !== undefined) up.departmentName = data.departmentName;
    if (data.assignedToId !== undefined) up.assignedToId = data.assignedToId;
    if (data.assignedToName !== undefined) up.assignedToName = data.assignedToName;
    if (data.occurredAt !== undefined) up.occurredAt = data.occurredAt;
    if (data.resolvedAt !== undefined) up.resolvedAt = data.resolvedAt;
    if (data.closedAt !== undefined) up.closedAt = data.closedAt;
    if (data.rootCause !== undefined) up.rootCause = data.rootCause;
    if (data.correctiveAction !== undefined) up.correctiveAction = data.correctiveAction;

    const raw = await prisma.securityIncident.update({
      where: { id },
      data: up,
      select: incidentSelect,
    });
    return toIncidentDto(raw);
  }

  async findIncidentById(id: number): Promise<SecurityIncidentDto | null> {
    const raw = await prisma.securityIncident.findFirst({
      where: { id, deletedAt: null },
      select: incidentSelect,
    });
    return raw ? toIncidentDto(raw) : null;
  }

  async findIncidentByNumber(incidentNumber: string): Promise<SecurityIncidentDto | null> {
    const raw = await prisma.securityIncident.findFirst({
      where: { incidentNumber, deletedAt: null },
      select: incidentSelect,
    });
    return raw ? toIncidentDto(raw) : null;
  }

  async findIncidentDetail(id: number): Promise<SecurityIncidentDetail | null> {
    const raw = await prisma.securityIncident.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...incidentSelect,
        updates: { select: incidentUpdateSelect, orderBy: { createdAt: 'asc' } },
        alerts: { select: alertSelect, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!raw) return null;
    return {
      ...toIncidentDto(raw),
      updates: raw.updates.map(toUpdateDto),
      alerts: raw.alerts.map(toAlertDto),
    };
  }

  async findAllIncidents(f: IncidentFilters): Promise<IncidentListResult> {
    const {
      search,
      type = 'all',
      severity = 'all',
      status = 'all',
      departmentId,
      fromDate,
      toDate,
      sortBy = 'occurredAt',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = f;

    const where: Prisma.SecurityIncidentWhereInput = { deletedAt: null };

    if (type !== 'all') where.type = type as IncidentType;
    if (severity !== 'all') where.severity = severity as IncidentSeverity;
    if (status !== 'all') where.status = status as IncidentStatus;
    if (departmentId !== undefined) where.departmentId = departmentId;

    if (fromDate !== undefined || toDate !== undefined) {
      where.occurredAt = {};
      if (fromDate) where.occurredAt.gte = fromDate;
      if (toDate) where.occurredAt.lte = toDate;
    }

    if (search?.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: 'insensitive' } },
        { description: { contains: search.trim(), mode: 'insensitive' } },
        { incidentNumber: { contains: search.trim(), mode: 'insensitive' } },
        { location: { contains: search.trim(), mode: 'insensitive' } },
        { reportedByName: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.SecurityIncidentOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [raws, total] = await prisma.$transaction([
      prisma.securityIncident.findMany({
        where,
        select: incidentSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.securityIncident.count({ where }),
    ]);
    return { data: raws.map(toIncidentDto), total };
  }

  async softDeleteIncident(id: number): Promise<void> {
    await prisma.securityIncident.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Incident updates ──────────────────────────────────────────────────────

  async addIncidentUpdate(data: CreateIncidentUpdateData): Promise<IncidentUpdateDto> {
    const raw = await prisma.incidentUpdate.create({
      data: {
        incidentId: data.incidentId,
        comment: data.comment,
        statusChange: data.statusChange ?? null,
        updatedById: data.updatedById ?? null,
        updatedByName: data.updatedByName ?? null,
      },
      select: incidentUpdateSelect,
    });
    return toUpdateDto(raw);
  }

  async findUpdatesByIncident(incidentId: number): Promise<IncidentUpdateDto[]> {
    const raws = await prisma.incidentUpdate.findMany({
      where: { incidentId },
      select: incidentUpdateSelect,
      orderBy: { createdAt: 'asc' },
    });
    return raws.map(toUpdateDto);
  }

  async findUpdateById(updateId: number): Promise<IncidentUpdateDto | null> {
    const raw = await prisma.incidentUpdate.findUnique({
      where: { id: updateId },
      select: incidentUpdateSelect,
    });
    return raw ? toUpdateDto(raw) : null;
  }

  async deleteIncidentUpdate(updateId: number): Promise<void> {
    await prisma.incidentUpdate.delete({ where: { id: updateId } });
  }

  // ══ ALERTS ═══════════════════════════════════════════════════════════════

  async createAlert(data: CreateAlertData): Promise<SecurityAlertDto> {
    return withUniqueNumberRetry(async () => {
      const alertNumber = await nextDocumentNumber('securityAlert', 'ALT-', { pad: 4 });
      const raw = await prisma.securityAlert.create({
        data: {
          alertNumber,
          title: data.title,
          message: data.message,
          type: data.type,
          severity: data.severity ?? 'MEDIUM',
          source: data.source ?? null,
          location: data.location ?? null,
          departmentId: data.departmentId ?? null,
          departmentName: data.departmentName ?? null,
          incidentId: data.incidentId ?? null,
          expiresAt: data.expiresAt ?? null,
          createdById: data.createdById ?? null,
        },
        select: alertSelect,
      });
      return toAlertDto(raw);
    });
  }

  async updateAlert(id: number, data: UpdateAlertData): Promise<SecurityAlertDto> {
    const up: Prisma.SecurityAlertUpdateInput = {};
    if (data.title !== undefined) up.title = data.title;
    if (data.message !== undefined) up.message = data.message;
    if (data.type !== undefined) up.type = data.type;
    if (data.severity !== undefined) up.severity = data.severity;
    if (data.source !== undefined) up.source = data.source;
    if (data.location !== undefined) up.location = data.location;
    if (data.departmentId !== undefined) up.departmentId = data.departmentId;
    if (data.departmentName !== undefined) up.departmentName = data.departmentName;
    if (data.incidentId !== undefined)
      up.incident =
        data.incidentId != null ? { connect: { id: data.incidentId } } : { disconnect: true };
    if (data.expiresAt !== undefined) up.expiresAt = data.expiresAt;

    const raw = await prisma.securityAlert.update({
      where: { id },
      data: up,
      select: alertSelect,
    });
    return toAlertDto(raw);
  }

  async acknowledgeAlert(id: number, data: AcknowledgeAlertData): Promise<SecurityAlertDto> {
    const raw = await prisma.securityAlert.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: data.acknowledgedById ?? null,
        acknowledgedByName: data.acknowledgedByName ?? null,
        acknowledgedAt: new Date(),
      },
      select: alertSelect,
    });
    return toAlertDto(raw);
  }

  async resolveAlert(id: number, data: ResolveAlertData): Promise<SecurityAlertDto> {
    const raw = await prisma.securityAlert.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedById: data.resolvedById ?? null,
        resolvedByName: data.resolvedByName ?? null,
        resolvedAt: new Date(),
      },
      select: alertSelect,
    });
    return toAlertDto(raw);
  }

  async expireAlert(id: number): Promise<void> {
    await prisma.securityAlert.update({
      where: { id },
      data: { status: 'EXPIRED' },
    });
  }

  async findAlertById(id: number): Promise<SecurityAlertDto | null> {
    const raw = await prisma.securityAlert.findUnique({
      where: { id },
      select: alertSelect,
    });
    return raw ? toAlertDto(raw) : null;
  }

  async findAllAlerts(f: AlertFilters): Promise<AlertListResult> {
    const {
      search,
      type = 'all',
      severity = 'all',
      status = 'all',
      departmentId,
      incidentId,
      fromDate,
      toDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = f;

    const where: Prisma.SecurityAlertWhereInput = {};

    if (type !== 'all') where.type = type as AlertType;
    if (severity !== 'all') where.severity = severity as IncidentSeverity;
    if (status !== 'all') where.status = status as AlertStatus;
    if (departmentId !== undefined) where.departmentId = departmentId;
    if (incidentId !== undefined) where.incidentId = incidentId;

    if (fromDate !== undefined || toDate !== undefined) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    if (search?.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: 'insensitive' } },
        { message: { contains: search.trim(), mode: 'insensitive' } },
        { alertNumber: { contains: search.trim(), mode: 'insensitive' } },
        { location: { contains: search.trim(), mode: 'insensitive' } },
        { source: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.SecurityAlertOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [raws, total] = await prisma.$transaction([
      prisma.securityAlert.findMany({
        where,
        select: alertSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.securityAlert.count({ where }),
    ]);
    return { data: raws.map(toAlertDto), total };
  }

  async deleteAlert(id: number): Promise<void> {
    await prisma.securityAlert.delete({ where: { id } });
  }

  // ══ KPIs ═════════════════════════════════════════════════════════════════

  async getKPIs(departmentId?: number, fromDate?: Date, toDate?: Date): Promise<SecurityKPIs> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const incBase: Prisma.SecurityIncidentWhereInput = {
      deletedAt: null,
      ...(departmentId ? { departmentId } : {}),
    };

    const incPeriod: Prisma.SecurityIncidentWhereInput = {
      ...incBase,
      occurredAt: {
        gte: fromDate ?? startOfMonth,
        ...(toDate ? { lte: toDate } : {}),
      },
    };

    const alertBase: Prisma.SecurityAlertWhereInput = {
      ...(departmentId ? { departmentId } : {}),
    };

    const [
      totalIncidents,
      openIncidents,
      investigatingIncidents,
      resolvedThisMonth,
      criticalIncidents,
      totalAlerts,
      activeAlerts,
      acknowledgedAlerts,
      criticalAlerts,
      incByType,
      incBySeverity,
      alertByType,
    ] = await prisma.$transaction([
      prisma.securityIncident.count({ where: incBase }),
      prisma.securityIncident.count({ where: { ...incBase, status: 'OPEN' } }),
      prisma.securityIncident.count({ where: { ...incBase, status: 'INVESTIGATING' } }),
      prisma.securityIncident.count({ where: { ...incPeriod, status: 'RESOLVED' } }),
      prisma.securityIncident.count({
        where: { ...incBase, severity: 'CRITICAL', status: { notIn: ['CLOSED'] } },
      }),
      prisma.securityAlert.count({ where: alertBase }),
      prisma.securityAlert.count({ where: { ...alertBase, status: 'ACTIVE' } }),
      prisma.securityAlert.count({ where: { ...alertBase, status: 'ACKNOWLEDGED' } }),
      prisma.securityAlert.count({
        where: { ...alertBase, severity: 'CRITICAL', status: 'ACTIVE' },
      }),
      prisma.securityIncident.groupBy({
        by: ['type'],
        where: incBase,
        _count: { id: true },
        orderBy: { type: 'asc' },
      }),
      prisma.securityIncident.groupBy({
        by: ['severity'],
        where: incBase,
        _count: { id: true },
        orderBy: { severity: 'asc' },
      }),
      prisma.securityAlert.groupBy({
        by: ['type'],
        where: alertBase,
        _count: { id: true },
        orderBy: { type: 'asc' },
      }),
    ]);

    // 7-day incident trend
    const incidentTrend: Array<{ date: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);

      const count = await prisma.securityIncident.count({
        where: {
          ...incBase,
          occurredAt: { gte: d, lt: next },
        },
      });
      incidentTrend.push({
        date: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        count,
      });
    }

    return {
      totalIncidents,
      openIncidents,
      investigatingIncidents,
      resolvedThisMonth,
      criticalIncidents,
      totalAlerts,
      activeAlerts,
      acknowledgedAlerts,
      criticalAlerts,
      incidentsByType: incByType.map((r) => ({
        type: r.type as IncidentType,
        count: (r._count as { id?: number } | undefined)?.id ?? 0,
      })),
      incidentsBySeverity: incBySeverity.map((r) => ({
        severity: r.severity as IncidentSeverity,
        count: (r._count as { id?: number } | undefined)?.id ?? 0,
      })),
      alertsByType: alertByType.map((r) => ({
        type: r.type as AlertType,
        count: (r._count as { id?: number } | undefined)?.id ?? 0,
      })),
      incidentTrend,
    };
  }
}
