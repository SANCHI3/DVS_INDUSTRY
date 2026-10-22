import { prisma } from '../../lib/prismaClient';
import { logger } from '../../logger';
import type { OrdersReport, SupplierReport, ClientReport, ReportFilters } from '../../interfaces';
import { fmtDate, buildDateWhere, buildPeriodLabel } from './helpers';

export async function getOrdersReport(filters: ReportFilters): Promise<OrdersReport> {
  logger.info('Generating orders report', filters);

  const dateWhere = buildDateWhere(filters);

  const [clientOrders, purchaseOrders, coValue, poValue, coDelivered, coTotal] =
    await prisma.$transaction([
      prisma.clientOrder.findMany({
        where: dateWhere ? { orderDate: dateWhere } : {},
        orderBy: { orderDate: 'desc' },
        select: {
          orderNumber: true,
          product: true,
          quantity: true,
          value: true,
          orderDate: true,
          requiredDate: true,
          status: true,
          client: { select: { name: true } },
        },
      }),
      prisma.purchaseOrder.findMany({
        where: dateWhere ? { orderDate: dateWhere } : {},
        orderBy: { orderDate: 'desc' },
        select: {
          poNumber: true,
          material: true,
          quantity: true,
          totalCost: true,
          orderDate: true,
          expectedDelivery: true,
          status: true,
          supplier: { select: { name: true } },
        },
      }),
      prisma.clientOrder.aggregate({
        where: dateWhere ? { orderDate: dateWhere } : {},
        _sum: { value: true },
      }),
      prisma.purchaseOrder.aggregate({
        where: dateWhere ? { orderDate: dateWhere } : {},
        _sum: { totalCost: true },
      }),
      prisma.clientOrder.count({
        where: { status: 'DELIVERED', ...(dateWhere ? { orderDate: dateWhere } : {}) },
      }),
      prisma.clientOrder.count({
        where: { status: { not: 'CANCELLED' }, ...(dateWhere ? { orderDate: dateWhere } : {}) },
      }),
    ]);

  const fulfillment = coTotal > 0 ? ((coDelivered / coTotal) * 100).toFixed(1) + '%' : '0.0%';

  return {
    generatedAt: new Date().toISOString(),
    period: buildPeriodLabel(filters),
    summary: {
      totalClientOrders: clientOrders.length,
      totalPurchaseOrders: purchaseOrders.length,
      fulfillmentRate: fulfillment,
      totalRevenue: (coValue._sum.value?.toNumber() ?? 0).toFixed(2),
      totalProcurement: (poValue._sum.totalCost?.toNumber() ?? 0).toFixed(2),
    },
    clientOrders: clientOrders.map((o) => ({
      orderNumber: o.orderNumber,
      client: o.client.name,
      product: o.product,
      quantity: o.quantity,
      value: o.value?.toString() ?? '—',
      orderDate: fmtDate(o.orderDate),
      requiredDate: fmtDate(o.requiredDate),
      status: o.status,
    })),
    purchaseOrders: purchaseOrders.map((p) => ({
      poNumber: p.poNumber,
      supplier: p.supplier.name,
      material: p.material,
      quantity: p.quantity,
      totalCost: p.totalCost?.toString() ?? '—',
      orderDate: fmtDate(p.orderDate),
      expectedDelivery: fmtDate(p.expectedDelivery),
      status: p.status,
    })),
  };
}

export async function getSupplierReport(filters: ReportFilters): Promise<SupplierReport> {
  logger.info('Generating supplier report', filters);

  const suppliers = await prisma.supplier.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
  });

  // PO counts per supplier
  const poCounts = await prisma.purchaseOrder.groupBy({
    by: ['supplierId', 'status'],
    _count: { id: true },
  });

  const poMap = new Map<number, { total: number; delivered: number; pending: number }>();
  for (const p of poCounts) {
    const entry = poMap.get(p.supplierId) ?? { total: 0, delivered: 0, pending: 0 };
    entry.total += p._count.id;
    if (p.status === 'DELIVERED') entry.delivered += p._count.id;
    if (p.status === 'PENDING') entry.pending += p._count.id;
    poMap.set(p.supplierId, entry);
  }

  let totalRating = 0;
  let ratedCount = 0;

  const rows = suppliers.map((s) => {
    const po = poMap.get(s.id) ?? { total: 0, delivered: 0, pending: 0 };
    if (s.rating) {
      totalRating += s.rating.toNumber();
      ratedCount++;
    }
    return {
      name: s.name,
      code: s.code,
      rating: s.rating?.toString() ?? '—',
      leadTimeDays: s.leadTimeDays?.toString() ?? '—',
      reliability: s.reliability ?? '—',
      materials: s.materials ?? '—',
      totalPOs: po.total,
      deliveredPOs: po.delivered,
      pendingPOs: po.pending,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    period: `Up to ${fmtDate(new Date())}`,
    summary: {
      totalSuppliers: suppliers.length,
      activeSuppliers: suppliers.filter((s) => s.isActive).length,
      avgRating: ratedCount > 0 ? (totalRating / ratedCount).toFixed(1) : '—',
      totalPOs: poCounts.reduce((s, p) => s + p._count.id, 0),
    },
    rows,
  };
}

export async function getClientReport(filters: ReportFilters): Promise<ClientReport> {
  logger.info('Generating client report', filters);

  const clients = await prisma.client.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
  });

  const ordersByClient = await prisma.clientOrder.groupBy({
    by: ['clientId', 'status'],
    _count: { id: true },
    _sum: { value: true },
  });

  const clientMap = new Map<
    number,
    {
      total: number;
      delivered: number;
      pending: number;
      revenue: number;
    }
  >();
  for (const o of ordersByClient) {
    const entry = clientMap.get(o.clientId) ?? { total: 0, delivered: 0, pending: 0, revenue: 0 };
    entry.total += o._count.id;
    if (o.status === 'DELIVERED') {
      entry.delivered += o._count.id;
      entry.revenue += o._sum.value?.toNumber() ?? 0;
    }
    if (o.status === 'PENDING') entry.pending += o._count.id;
    clientMap.set(o.clientId, entry);
  }

  let totalRevenue = 0;
  let totalOrders = 0;

  const rows = clients.map((c) => {
    const stats = clientMap.get(c.id) ?? { total: 0, delivered: 0, pending: 0, revenue: 0 };
    totalRevenue += stats.revenue;
    totalOrders += stats.total;
    return {
      name: c.name,
      code: c.code,
      totalOrders: stats.total,
      deliveredOrders: stats.delivered,
      pendingOrders: stats.pending,
      totalRevenue: stats.revenue.toFixed(2),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    period: `Up to ${fmtDate(new Date())}`,
    summary: {
      totalClients: clients.length,
      activeClients: clients.filter((c) => c.isActive).length,
      totalRevenue: totalRevenue.toFixed(2),
      totalOrders,
    },
    rows,
  };
}
