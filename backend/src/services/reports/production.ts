import { prisma } from '../../lib/prismaClient';
import { logger } from '../../logger';
import type { ProductionReport, ProductionReportRow, ReportFilters } from '../../interfaces';
import { fmtDate, buildDateWhere, buildPeriodLabel } from './helpers';

export async function getProductionReport(filters: ReportFilters): Promise<ProductionReport> {
  logger.info('Generating production report', filters);

  const dateWhere = buildDateWhere(filters, 'createdAt');
  const baseWhere = {
    deletedAt: null,
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(dateWhere ? { createdAt: dateWhere } : {}),
  };

  const workOrders = await prisma.workOrder.findMany({
    where: baseWhere,
    orderBy: [{ departmentName: 'asc' }, { createdAt: 'desc' }],
    include: {
      outputs: {
        select: { goodQty: true, rejectedQty: true, scrapQty: true },
      },
    },
  });

  let totalTarget = 0,
    totalProduced = 0;
  let totalRejected = 0,
    totalScrap = 0;
  let completed = 0,
    inProgress = 0,
    cancelled = 0;

  // Per-department aggregation
  type DeptAgg = { workOrders: number; produced: number; rejected: number; target: number };
  const deptAgg = new Map<string, DeptAgg>();

  const rows: ProductionReportRow[] = workOrders.map((wo) => {
    let produced = 0,
      rejected = 0,
      scrap = 0;
    for (const o of wo.outputs) {
      produced += o.goodQty.toNumber();
      rejected += o.rejectedQty.toNumber();
      scrap += o.scrapQty.toNumber();
    }
    const target = wo.targetQuantity.toNumber();
    const rate = target > 0 ? ((produced / target) * 100).toFixed(1) + '%' : '0.0%';

    totalTarget += target;
    totalProduced += produced;
    totalRejected += rejected;
    totalScrap += scrap;

    if (wo.status === 'COMPLETED') completed++;
    else if (wo.status === 'IN_PROGRESS' || wo.status === 'RELEASED') inProgress++;
    else if (wo.status === 'CANCELLED') cancelled++;

    const deptKey = wo.departmentName ?? '—';
    const da = deptAgg.get(deptKey) ?? { workOrders: 0, produced: 0, rejected: 0, target: 0 };
    da.workOrders++;
    da.produced += produced;
    da.rejected += rejected;
    da.target += target;
    deptAgg.set(deptKey, da);

    return {
      workOrderNumber: wo.workOrderNumber,
      product: wo.product,
      department: wo.departmentName ?? '—',
      priority: wo.priority,
      status: wo.status,
      targetQty: target.toFixed(3),
      producedQty: produced.toFixed(3),
      rejectedQty: rejected.toFixed(3),
      scrapQty: scrap.toFixed(3),
      completionRate: rate,
      scheduledStart: fmtDate(wo.scheduledStart),
      scheduledEnd: fmtDate(wo.scheduledEnd),
      actualStart: fmtDate(wo.actualStart),
      actualEnd: fmtDate(wo.actualEnd),
    };
  });

  const overallCompletionRate =
    totalTarget > 0 ? ((totalProduced / totalTarget) * 100).toFixed(1) + '%' : '0.0%';
  const rejectionRate =
    totalProduced + totalRejected > 0
      ? ((totalRejected / (totalProduced + totalRejected)) * 100).toFixed(1) + '%'
      : '0.0%';

  const byDepartment = Array.from(deptAgg.entries())
    .map(([department, da]) => ({
      department,
      workOrders: da.workOrders,
      produced: da.produced.toFixed(3),
      rejected: da.rejected.toFixed(3),
      completionRate: da.target > 0 ? ((da.produced / da.target) * 100).toFixed(1) + '%' : '0.0%',
    }))
    .sort((a, b) => b.workOrders - a.workOrders);

  return {
    generatedAt: new Date().toISOString(),
    period: buildPeriodLabel(filters),
    summary: {
      totalWorkOrders: workOrders.length,
      completed,
      inProgress,
      cancelled,
      totalTargetQty: totalTarget.toFixed(3),
      totalProducedQty: totalProduced.toFixed(3),
      totalRejectedQty: totalRejected.toFixed(3),
      totalScrapQty: totalScrap.toFixed(3),
      overallCompletionRate,
      rejectionRate,
      byDepartment,
    },
    rows,
  };
}
