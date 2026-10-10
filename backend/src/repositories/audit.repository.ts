import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import { logger } from '../logger';
import type {
  AuditLogDto,
  AuditLogListResult,
  AuditLogFilters,
  CreateAuditLogData,
  AuditAction,
} from '../interfaces';

// ── Select shape ──────────────────────────────────────────────────────────────

const auditSelect = {
  id: true,
  userId: true,
  userEmail: true,
  userRole: true,
  action: true,
  entity: true,
  entityId: true,
  entityCode: true,
  method: true,
  path: true,
  statusCode: true,
  before: true,
  after: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} as const;

// ── Converter ─────────────────────────────────────────────────────────────────

type PrismaAuditLog = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

function toDto(r: PrismaAuditLog): AuditLogDto {
  return {
    id: r.id,
    userId: r.userId,
    userEmail: r.userEmail,
    userRole: r.userRole,
    action: r.action as AuditAction,
    entity: r.entity,
    entityId: r.entityId,
    entityCode: r.entityCode,
    method: r.method,
    path: r.path,
    statusCode: r.statusCode,
    before: r.before,
    after: r.after,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    createdAt: r.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export class AuditRepository {
  /** Fire-and-forget write — never throws so it never breaks the request. */
  async log(data: CreateAuditLogData): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: data.userId ?? null,
          userEmail: data.userEmail ?? null,
          userRole: data.userRole ?? null,
          action: data.action,
          entity: data.entity,
          entityId: data.entityId ?? null,
          entityCode: data.entityCode ?? null,
          method: data.method ?? null,
          path: data.path ?? null,
          statusCode: data.statusCode ?? null,
          before: data.before != null ? (data.before as Prisma.InputJsonValue) : Prisma.JsonNull,
          after: data.after != null ? (data.after as Prisma.InputJsonValue) : Prisma.JsonNull,
          ipAddress: data.ipAddress ?? null,
          userAgent: data.userAgent ?? null,
        },
      });
    } catch (err) {
      // Audit failures must not break business logic, but they must be visible
      logger.warn('Failed to write audit log entry', {
        action: data.action,
        path: data.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async findAll(f: AuditLogFilters): Promise<AuditLogListResult> {
    const {
      userId,
      action = 'all',
      entity,
      entityId,
      fromDate,
      toDate,
      search,
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = f;

    const where: Prisma.AuditLogWhereInput = {};

    if (userId !== undefined) where.userId = userId;
    if (entity !== undefined) where.entity = { equals: entity, mode: 'insensitive' };
    if (entityId !== undefined) where.entityId = entityId;
    if (action !== 'all' && action !== undefined) where.action = action as AuditAction;

    if (fromDate !== undefined || toDate !== undefined) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    if (search?.trim()) {
      where.OR = [
        { userEmail: { contains: search.trim(), mode: 'insensitive' } },
        { path: { contains: search.trim(), mode: 'insensitive' } },
        { entity: { contains: search.trim(), mode: 'insensitive' } },
        { entityCode: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [raws, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        select: auditSelect,
        orderBy: { createdAt: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { data: raws.map(toDto), total };
  }

  async findById(id: number): Promise<AuditLogDto | null> {
    const raw = await prisma.auditLog.findUnique({
      where: { id },
      select: auditSelect,
    });
    return raw !== null ? toDto(raw) : null;
  }
}
