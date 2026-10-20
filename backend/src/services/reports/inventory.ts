import { prisma } from '../../lib/prismaClient';
import { logger } from '../../logger';
import type { InventoryReport, ScrapReport, ReportFilters } from '../../interfaces';
import { fmtDate, buildDateWhere, buildPeriodLabel } from './helpers';

export async function getInventoryReport(filters: ReportFilters): Promise<InventoryReport> {
  logger.info('Generating inventory report', filters);

  const materials = await prisma.material.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
  });

  let totalValue = 0;
  let inStock = 0,
    lowStockCount = 0,
    outOfStockCount = 0;

  const rows = materials.map((m) => {
    const stock = m.currentStock.toNumber();
    const min = m.minStockLevel.toNumber();
    const cost = m.costPerUnit?.toNumber() ?? 0;
    const value = stock * cost;
    totalValue += value;

    let status = 'In Stock';
    if (stock === 0) {
      status = 'Out of Stock';
      outOfStockCount++;
    } else if (stock <= min) {
      status = 'Low Stock';
      lowStockCount++;
    } else inStock++;

    return {
      name: m.name,
      code: m.code,
      category: m.category ?? '—',
      unit: m.unit,
      currentStock: stock.toFixed(3),
      minStockLevel: min.toFixed(3),
      costPerUnit: cost > 0 ? cost.toFixed(2) : '—',
      stockValue: cost > 0 ? value.toFixed(2) : '—',
      status,
      location: m.location ?? '—',
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    period: `Up to ${fmtDate(new Date())}`,
    summary: {
      totalMaterials: materials.length,
      totalValue: totalValue.toFixed(2),
      inStock,
      lowStock: lowStockCount,
      outOfStock: outOfStockCount,
    },
    rows,
  };
}

export async function getScrapReport(filters: ReportFilters): Promise<ScrapReport> {
  logger.info('Generating scrap report', filters);

  const dateWhere = buildDateWhere(filters, 'recordedAt');
  const where = {
    ...(dateWhere ? { recordedAt: dateWhere } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
  };

  const [records, byDeptRaw, byMatRaw] = await prisma.$transaction([
    prisma.scrapRecord.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      include: { material: { select: { name: true, code: true } } },
    }),
    prisma.scrapRecord.groupBy({
      by: ['departmentName'],
      where: { ...where, departmentName: { not: null } },
      _sum: { quantity: true },
      orderBy: { departmentName: 'asc' },
    }),
    prisma.scrapRecord.groupBy({
      by: ['materialId'],
      where,
      _sum: { quantity: true },
      orderBy: { materialId: 'asc' },
    }),
  ]);

  // Enrich material names for byMaterial
  const matIds = byMatRaw.map((r) => r.materialId);
  const mats =
    matIds.length > 0
      ? await prisma.material.findMany({
          where: { id: { in: matIds } },
          select: { id: true, name: true },
        })
      : [];
  const matMap = new Map(mats.map((m) => [m.id, m.name]));

  let totalQty = 0;
  let totalRecovery = 0;
  const rows = records.map((r) => {
    totalQty += r.quantity.toNumber();
    totalRecovery += r.recoveryValue?.toNumber() ?? 0;
    return {
      material: r.material.name,
      materialCode: r.material.code,
      quantity: r.quantity.toFixed(3),
      unit: r.unit,
      department: r.departmentName ?? '—',
      employee: r.employeeName ?? '—',
      reason: r.reason ?? '—',
      recoveryValue: r.recoveryValue?.toFixed(2) ?? '—',
      recordedAt: fmtDate(r.recordedAt),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    period: buildPeriodLabel(filters),
    summary: {
      totalQuantity: totalQty.toFixed(3),
      totalRecoveryValue: totalRecovery.toFixed(2),
      byDepartment: byDeptRaw
        .map((r) => ({
          department: r.departmentName ?? 'Unknown',
          quantity: r._sum?.quantity?.toFixed(3) ?? '0.000',
        }))
        .sort((a, b) => parseFloat(b.quantity) - parseFloat(a.quantity)),
      byMaterial: byMatRaw
        .map((r) => ({
          material: matMap.get(r.materialId) ?? 'Unknown',
          quantity: r._sum?.quantity?.toFixed(3) ?? '0.000',
        }))
        .sort((a, b) => parseFloat(b.quantity) - parseFloat(a.quantity)),
    },
    rows,
  };
}
