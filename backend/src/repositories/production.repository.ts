import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import { nextDocumentNumber, withUniqueNumberRetry } from '../utils/documentNumber';
import type {
  WorkOrderDto,
  WorkOrderListResult,
  WorkOrderFilters,
  WorkOrderDetail,
  CreateWorkOrderData,
  UpdateWorkOrderData,
  WorkOrderOutputDto,
  OutputListResult,
  OutputFilters,
  CreateOutputData,
  UpdateOutputData,
  ProductionKPIs,
  ProductionTrendEntry,
  WorkOrderStatus,
  WorkOrderPriority,
  ProductionTargetDto,
  SaveProductionTargetData,
  MonthOutputTotals,
} from '../interfaces';
import { monthKey, nextMonthStart } from '../utils/targetProgress';

// ── Select shapes ─────────────────────────────────────────────────────────────

const workOrderSelect = {
  id: true,
  workOrderNumber: true,
  product: true,
  targetQuantity: true,
  unit: true,
  scheduledStart: true,
  scheduledEnd: true,
  actualStart: true,
  actualEnd: true,
  status: true,
  priority: true,
  departmentId: true,
  departmentName: true,
  assignedToId: true,
  assignedToName: true,
  clientOrderId: true,
  notes: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  _count: { select: { outputs: true } },
  outputs: {
    select: {
      goodQty: true,
      rejectedQty: true,
      scrapQty: true,
    },
  },
} as const;

const workOrderListSelect = {
  id: true,
  workOrderNumber: true,
  product: true,
  targetQuantity: true,
  unit: true,
  scheduledStart: true,
  scheduledEnd: true,
  actualStart: true,
  actualEnd: true,
  status: true,
  priority: true,
  departmentId: true,
  departmentName: true,
  assignedToId: true,
  assignedToName: true,
  clientOrderId: true,
  notes: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  _count: { select: { outputs: true } },
  outputs: {
    select: {
      goodQty: true,
      rejectedQty: true,
      scrapQty: true,
    },
  },
} as const;

const outputSelect = {
  id: true,
  workOrderId: true,
  goodQty: true,
  rejectedQty: true,
  scrapQty: true,
  recordedAt: true,
  recordedById: true,
  recordedByName: true,
  remarks: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ── Converters ────────────────────────────────────────────────────────────────

type PrismaWorkOrder = Prisma.WorkOrderGetPayload<{ select: typeof workOrderSelect }>;
type PrismaOutput = Prisma.WorkOrderOutputGetPayload<{ select: typeof outputSelect }>;

function computeOutputTotals(
  outputs: Array<{
    goodQty: Prisma.Decimal;
    rejectedQty: Prisma.Decimal;
    scrapQty: Prisma.Decimal;
  }>,
): { producedQty: string; rejectedQty: string; scrapQty: string; completionRate: string } {
  let produced = 0,
    rejected = 0,
    scrap = 0;
  for (const o of outputs) {
    produced += o.goodQty.toNumber();
    rejected += o.rejectedQty.toNumber();
    scrap += o.scrapQty.toNumber();
  }
  return {
    producedQty: produced.toFixed(3),
    rejectedQty: rejected.toFixed(3),
    scrapQty: scrap.toFixed(3),
    completionRate: '0.0%', // filled below per-WO
  };
}

function toWorkOrderDto(r: PrismaWorkOrder): WorkOrderDto {
  const { producedQty, rejectedQty, scrapQty } = computeOutputTotals(r.outputs);
  const target = r.targetQuantity.toNumber();
  const produced = parseFloat(producedQty);
  const completionRate = target > 0 ? ((produced / target) * 100).toFixed(1) + '%' : '0.0%';

  return {
    id: r.id,
    workOrderNumber: r.workOrderNumber,
    product: r.product,
    targetQuantity: r.targetQuantity.toString(),
    unit: r.unit,
    scheduledStart: r.scheduledStart,
    scheduledEnd: r.scheduledEnd,
    actualStart: r.actualStart,
    actualEnd: r.actualEnd,
    status: r.status as WorkOrderStatus,
    priority: r.priority as WorkOrderPriority,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    assignedToId: r.assignedToId,
    assignedToName: r.assignedToName,
    clientOrderId: r.clientOrderId,
    notes: r.notes,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
    producedQty,
    rejectedQty,
    scrapQty,
    completionRate,
    _count: r._count,
  };
}

function toOutputDto(r: PrismaOutput): WorkOrderOutputDto {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    goodQty: r.goodQty.toString(),
    rejectedQty: r.rejectedQty.toString(),
    scrapQty: r.scrapQty.toString(),
    recordedAt: r.recordedAt,
    recordedById: r.recordedById,
    recordedByName: r.recordedByName,
    remarks: r.remarks,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export class ProductionRepository {
  // ══ WORK ORDERS ══════════════════════════════════════════════════════════

  async createWorkOrder(data: CreateWorkOrderData): Promise<WorkOrderDto> {
    return withUniqueNumberRetry(async () => {
      const workOrderNumber = await nextDocumentNumber('workOrder', 'WO-', { pad: 4 });
      const raw = await prisma.workOrder.create({
        data: {
          workOrderNumber,
          product: data.product,
          targetQuantity: data.targetQuantity,
          unit: data.unit ?? 'pcs',
          scheduledStart: data.scheduledStart ?? null,
          scheduledEnd: data.scheduledEnd ?? null,
          priority: data.priority ?? 'NORMAL',
          departmentId: data.departmentId ?? null,
          departmentName: data.departmentName ?? null,
          assignedToId: data.assignedToId ?? null,
          assignedToName: data.assignedToName ?? null,
          clientOrderId: data.clientOrderId ?? null,
          notes: data.notes ?? null,
          createdById: data.createdById ?? null,
        },
        select: workOrderSelect,
      });
      return toWorkOrderDto(raw);
    });
  }

  async updateWorkOrder(id: number, data: UpdateWorkOrderData): Promise<WorkOrderDto> {
    const up: Prisma.WorkOrderUpdateInput = {};
    if (data.product !== undefined) up.product = data.product;
    if (data.targetQuantity !== undefined) up.targetQuantity = data.targetQuantity;
    if (data.unit !== undefined) up.unit = data.unit;
    if (data.scheduledStart !== undefined) up.scheduledStart = data.scheduledStart;
    if (data.scheduledEnd !== undefined) up.scheduledEnd = data.scheduledEnd;
    if (data.actualStart !== undefined) up.actualStart = data.actualStart;
    if (data.actualEnd !== undefined) up.actualEnd = data.actualEnd;
    if (data.status !== undefined) up.status = data.status;
    if (data.priority !== undefined) up.priority = data.priority;
    if (data.departmentId !== undefined) up.departmentId = data.departmentId;
    if (data.departmentName !== undefined) up.departmentName = data.departmentName;
    if (data.assignedToId !== undefined) up.assignedToId = data.assignedToId;
    if (data.assignedToName !== undefined) up.assignedToName = data.assignedToName;
    if (data.clientOrderId !== undefined) up.clientOrderId = data.clientOrderId;
    if (data.notes !== undefined) up.notes = data.notes;

    const raw = await prisma.workOrder.update({
      where: { id },
      data: up,
      select: workOrderSelect,
    });
    return toWorkOrderDto(raw);
  }

  async findWorkOrderById(id: number): Promise<WorkOrderDto | null> {
    const raw = await prisma.workOrder.findFirst({
      where: { id, deletedAt: null },
      select: workOrderSelect,
    });
    return raw !== null ? toWorkOrderDto(raw) : null;
  }

  async findWorkOrderDetail(id: number): Promise<WorkOrderDetail | null> {
    const raw = await prisma.workOrder.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...workOrderSelect,
        outputs: {
          select: outputSelect,
          orderBy: { recordedAt: 'desc' },
        },
      },
    });
    if (raw === null) return null;

    const dto = toWorkOrderDto(raw);
    return {
      ...dto,
      outputs: raw.outputs.map(toOutputDto),
    };
  }

  async findAllWorkOrders(f: WorkOrderFilters): Promise<WorkOrderListResult> {
    const {
      search,
      status = 'all',
      priority = 'all',
      departmentId,
      clientOrderId,
      fromDate,
      toDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = f;

    const where: Prisma.WorkOrderWhereInput = { deletedAt: null };

    if (status !== 'all') where.status = status as WorkOrderStatus;
    if (priority !== 'all') where.priority = priority as WorkOrderPriority;
    if (departmentId !== undefined) where.departmentId = departmentId;
    if (clientOrderId !== undefined) where.clientOrderId = clientOrderId;

    if (fromDate !== undefined || toDate !== undefined) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    if (search?.trim()) {
      where.OR = [
        { product: { contains: search.trim(), mode: 'insensitive' } },
        { workOrderNumber: { contains: search.trim(), mode: 'insensitive' } },
        { departmentName: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.WorkOrderOrderByWithRelationInput = { [sortBy]: sortOrder };
    const skip = (page - 1) * pageSize;

    const [raws, total] = await prisma.$transaction([
      prisma.workOrder.findMany({
        where,
        select: workOrderListSelect,
        orderBy,
        skip,
        take: pageSize,
      }),
      prisma.workOrder.count({ where }),
    ]);

    return { data: raws.map(toWorkOrderDto), total };
  }

  async softDeleteWorkOrder(id: number): Promise<void> {
    await prisma.workOrder.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });
  }

  // ══ OUTPUTS ══════════════════════════════════════════════════════════════

  async createOutput(data: CreateOutputData): Promise<WorkOrderOutputDto> {
    const raw = await prisma.workOrderOutput.create({
      data: {
        workOrderId: data.workOrderId,
        goodQty: data.goodQty,
        rejectedQty: data.rejectedQty ?? '0',
        scrapQty: data.scrapQty ?? '0',
        recordedAt: data.recordedAt ?? new Date(),
        recordedById: data.recordedById ?? null,
        recordedByName: data.recordedByName ?? null,
        remarks: data.remarks ?? null,
      },
      select: outputSelect,
    });
    return toOutputDto(raw);
  }

  async updateOutput(outputId: number, data: UpdateOutputData): Promise<WorkOrderOutputDto> {
    const up: Prisma.WorkOrderOutputUpdateInput = {};
    if (data.goodQty !== undefined) up.goodQty = data.goodQty;
    if (data.rejectedQty !== undefined) up.rejectedQty = data.rejectedQty;
    if (data.scrapQty !== undefined) up.scrapQty = data.scrapQty;
    if (data.recordedAt !== undefined) up.recordedAt = data.recordedAt;
    if (data.recordedByName !== undefined) up.recordedByName = data.recordedByName;
    if (data.remarks !== undefined) up.remarks = data.remarks;

    const raw = await prisma.workOrderOutput.update({
      where: { id: outputId },
      data: up,
      select: outputSelect,
    });
    return toOutputDto(raw);
  }

  async findOutputById(outputId: number): Promise<WorkOrderOutputDto | null> {
    const raw = await prisma.workOrderOutput.findUnique({
      where: { id: outputId },
      select: outputSelect,
    });
    return raw !== null ? toOutputDto(raw) : null;
  }

  async findOutputsByWorkOrder(f: OutputFilters): Promise<OutputListResult> {
    const { workOrderId, fromDate, toDate, sortOrder = 'desc', page = 1, pageSize = 20 } = f;

    const where: Prisma.WorkOrderOutputWhereInput = {};
    if (workOrderId !== undefined) where.workOrderId = workOrderId;
    if (fromDate !== undefined || toDate !== undefined) {
      where.recordedAt = {};
      if (fromDate) where.recordedAt.gte = fromDate;
      if (toDate) where.recordedAt.lte = toDate;
    }

    const [raws, total] = await prisma.$transaction([
      prisma.workOrderOutput.findMany({
        where,
        select: outputSelect,
        orderBy: { recordedAt: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.workOrderOutput.count({ where }),
    ]);
    return { data: raws.map(toOutputDto), total };
  }

  async deleteOutput(outputId: number): Promise<void> {
    await prisma.workOrderOutput.delete({ where: { id: outputId } });
  }

  // ══ KPIs ═════════════════════════════════════════════════════════════════

  async getKPIs(departmentId?: number, fromDate?: Date, toDate?: Date): Promise<ProductionKPIs> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const baseWhere: Prisma.WorkOrderWhereInput = {
      deletedAt: null,
      ...(departmentId ? { departmentId } : {}),
    };

    const periodWhere: Prisma.WorkOrderWhereInput = {
      ...baseWhere,
      createdAt: {
        gte: fromDate ?? startOfMonth,
        ...(toDate ? { lte: toDate } : {}),
      },
    };

    const [
      totalWorkOrders,
      activeWorkOrders,
      completedThisMonth,
      overdueWorkOrders,
      statusCounts,
      priorityCounts,
      outputAgg,
      targetAgg,
    ] = await prisma.$transaction([
      prisma.workOrder.count({ where: baseWhere }),
      prisma.workOrder.count({
        where: { ...baseWhere, status: { in: ['RELEASED', 'IN_PROGRESS'] } },
      }),
      prisma.workOrder.count({ where: { ...periodWhere, status: 'COMPLETED' } }),
      prisma.workOrder.count({
        where: {
          ...baseWhere,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          scheduledEnd: { lt: now },
        },
      }),
      prisma.workOrder.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { id: true },
        orderBy: { status: 'asc' },
      }),
      prisma.workOrder.groupBy({
        by: ['priority'],
        where: baseWhere,
        _count: { id: true },
        orderBy: { priority: 'asc' },
      }),
      prisma.workOrderOutput.aggregate({
        where: {
          workOrder: { ...periodWhere },
        },
        _sum: { goodQty: true, rejectedQty: true, scrapQty: true },
      }),
      prisma.workOrder.aggregate({
        where: periodWhere,
        _sum: { targetQuantity: true },
      }),
    ]);

    const produced = outputAgg._sum.goodQty?.toNumber() ?? 0;
    const rejected = outputAgg._sum.rejectedQty?.toNumber() ?? 0;
    const scrap = outputAgg._sum.scrapQty?.toNumber() ?? 0;
    const target = targetAgg._sum.targetQuantity?.toNumber() ?? 0;

    const overallCompletionRate =
      target > 0 ? ((produced / target) * 100).toFixed(1) + '%' : '0.0%';
    const rejectionRate =
      produced + rejected > 0
        ? ((rejected / (produced + rejected)) * 100).toFixed(1) + '%'
        : '0.0%';

    return {
      totalWorkOrders,
      activeWorkOrders,
      completedThisMonth,
      overdueWorkOrders,
      totalTargetQty: target.toFixed(3),
      totalProducedQty: produced.toFixed(3),
      totalRejectedQty: rejected.toFixed(3),
      totalScrapQty: scrap.toFixed(3),
      overallCompletionRate,
      rejectionRate,
      byStatus: statusCounts.map((r) => ({
        status: r.status as WorkOrderStatus,
        count: (r._count as { id?: number } | undefined)?.id ?? 0,
      })),
      byPriority: priorityCounts.map((r) => ({
        priority: r.priority as WorkOrderPriority,
        count: (r._count as { id?: number } | undefined)?.id ?? 0,
      })),
    };
  }

  // ══ TREND ════════════════════════════════════════════════════════════════

  async getProductionTrend(days: number, departmentId?: number): Promise<ProductionTrendEntry[]> {
    const trend: ProductionTrendEntry[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);

      const agg = await prisma.workOrderOutput.aggregate({
        where: {
          recordedAt: { gte: d, lt: next },
          ...(departmentId
            ? { workOrder: { departmentId, deletedAt: null } }
            : { workOrder: { deletedAt: null } }),
        },
        _sum: { goodQty: true, rejectedQty: true, scrapQty: true },
      });

      trend.push({
        date: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        produced: agg._sum.goodQty?.toNumber() ?? 0,
        rejected: agg._sum.rejectedQty?.toNumber() ?? 0,
        scrap: agg._sum.scrapQty?.toNumber() ?? 0,
      });
    }

    return trend;
  }

  // ══ MONTHLY TARGETS ══════════════════════════════════════════════════════

  async findTarget(periodStart: Date): Promise<ProductionTargetDto | null> {
    const raw = await prisma.productionMonthlyTarget.findUnique({ where: { periodStart } });
    return raw ? toTargetDto(raw) : null;
  }

  async findTargetsBetween(from: Date, to: Date): Promise<ProductionTargetDto[]> {
    const rows = await prisma.productionMonthlyTarget.findMany({
      where: { periodStart: { gte: from, lt: to } },
      orderBy: { periodStart: 'asc' },
    });
    return rows.map(toTargetDto);
  }

  async createTarget(
    periodStart: Date,
    data: SaveProductionTargetData,
  ): Promise<ProductionTargetDto> {
    const raw = await prisma.productionMonthlyTarget.create({ data: { periodStart, ...data } });
    return toTargetDto(raw);
  }

  async updateTarget(id: number, data: SaveProductionTargetData): Promise<ProductionTargetDto> {
    const raw = await prisma.productionMonthlyTarget.update({ where: { id }, data });
    return toTargetDto(raw);
  }

  async deleteTarget(id: number): Promise<void> {
    await prisma.productionMonthlyTarget.delete({ where: { id } });
  }

  /** Output recorded during the month (by recordedAt), on work orders that are not deleted. */
  async getMonthOutputTotals(periodStart: Date): Promise<MonthOutputTotals> {
    const agg = await prisma.workOrderOutput.aggregate({
      where: {
        recordedAt: { gte: periodStart, lt: nextMonthStart(periodStart) },
        workOrder: { deletedAt: null },
      },
      _sum: { goodQty: true, rejectedQty: true, scrapQty: true },
      _count: { _all: true },
    });
    return {
      goodQty: agg._sum.goodQty?.toNumber() ?? 0,
      rejectedQty: agg._sum.rejectedQty?.toNumber() ?? 0,
      scrapQty: agg._sum.scrapQty?.toNumber() ?? 0,
      outputRecords: agg._count._all,
    };
  }
}

type PrismaTarget = Prisma.ProductionMonthlyTargetGetPayload<object>;

function toTargetDto(r: PrismaTarget): ProductionTargetDto {
  const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
  return {
    id: r.id,
    month: monthKey(r.periodStart),
    periodStart: r.periodStart,
    outputTarget: r.outputTarget.toNumber(),
    unit: r.unit,
    targetCompletionRate: num(r.targetCompletionRate),
    maxRejectionRate: num(r.maxRejectionRate),
    targetEmployeeEfficiency: num(r.targetEmployeeEfficiency),
    notes: r.notes,
    updatedById: r.updatedById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
