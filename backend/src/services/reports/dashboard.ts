import { prisma } from '../../lib/prismaClient';
import { logger } from '../../logger';
import type { DashboardKPIs, DashboardCharts } from '../../interfaces';
import { startOfMonth, dayLabel } from './helpers';

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  logger.info('Fetching dashboard KPIs');

  // Normalise today to UTC midnight for attendance lookup
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [
    totalEmployees,
    activeEmployees,
    materials,
    totalScrapMonth,
    coActive,
    coPending,
    coDispatched,
    poPending,
    coDelivered,
    coNotCancelled,
    totalDepts,
    activeDepts,
    todayAttendance,
    woActive,
    woCompleted,
    woOverdue,
    woOutputAgg,
    woTargetAgg,
    activeAlerts,
    criticalAlerts,
    criticalIncidents,
  ] = await prisma.$transaction([
    prisma.employee.count({ where: { deletedAt: null } }),
    prisma.employee.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.material.findMany({
      where: { deletedAt: null },
      select: { currentStock: true, minStockLevel: true, costPerUnit: true },
    }),
    prisma.scrapRecord.findMany({
      where: { recordedAt: { gte: startOfMonth() } },
      select: { quantity: true, recoveryValue: true },
    }),
    prisma.clientOrder.count({
      where: { status: { notIn: ['DELIVERED', 'CANCELLED'] } },
    }),
    prisma.clientOrder.count({ where: { status: 'PENDING' } }),
    prisma.clientOrder.count({ where: { status: 'DISPATCHED' } }),
    prisma.purchaseOrder.count({ where: { status: 'PENDING' } }),
    prisma.clientOrder.count({ where: { status: 'DELIVERED' } }),
    prisma.clientOrder.count({ where: { status: { not: 'CANCELLED' } } }),
    prisma.department.count({ where: { deletedAt: null } }),
    prisma.department.count({ where: { deletedAt: null, isActive: true } }),
    prisma.attendance.findMany({
      where: { date: today },
      select: { status: true },
    }),
    // Production
    prisma.workOrder.count({
      where: { deletedAt: null, status: { in: ['RELEASED', 'IN_PROGRESS'] } },
    }),
    prisma.workOrder.count({
      where: { deletedAt: null, status: 'COMPLETED', updatedAt: { gte: startOfMonth() } },
    }),
    prisma.workOrder.count({
      where: {
        deletedAt: null,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        scheduledEnd: { lt: new Date() },
      },
    }),
    prisma.workOrderOutput.aggregate({
      where: { workOrder: { deletedAt: null, createdAt: { gte: startOfMonth() } } },
      _sum: { goodQty: true, rejectedQty: true },
    }),
    prisma.workOrder.aggregate({
      where: { deletedAt: null, createdAt: { gte: startOfMonth() } },
      _sum: { targetQuantity: true },
    }),
    // Security
    prisma.securityAlert.count({ where: { status: 'ACTIVE' } }),
    prisma.securityAlert.count({ where: { status: 'ACTIVE', severity: 'CRITICAL' } }),
    prisma.securityIncident.count({
      where: { deletedAt: null, severity: 'CRITICAL', status: { in: ['OPEN', 'INVESTIGATING'] } },
    }),
  ]);

  // Inventory value
  let inventoryValue = 0;
  let lowStock = 0;
  let outOfStock = 0;
  for (const m of materials) {
    const stock = m.currentStock.toNumber();
    const min = m.minStockLevel.toNumber();
    if (m.costPerUnit) inventoryValue += stock * m.costPerUnit.toNumber();
    if (stock === 0) outOfStock++;
    else if (stock <= min) lowStock++;
  }

  // Scrap this month
  let scrapQty = 0;
  let scrapVal = 0;
  for (const s of totalScrapMonth) {
    scrapQty += s.quantity.toNumber();
    scrapVal += s.recoveryValue?.toNumber() ?? 0;
  }

  // Fulfilment rate
  const fulfillment =
    coNotCancelled > 0 ? ((coDelivered / coNotCancelled) * 100).toFixed(1) + '%' : '0.0%';

  // Today's attendance KPIs
  const attCounts = { present: 0, absent: 0, late: 0, onLeave: 0 };
  for (const a of todayAttendance) {
    if (a.status === 'PRESENT') attCounts.present++;
    else if (a.status === 'ABSENT') attCounts.absent++;
    else if (a.status === 'LATE') attCounts.late++;
    else if (a.status === 'LEAVE') attCounts.onLeave++;
    else if (a.status === 'HALF_DAY') attCounts.present++; // half-day counts as attended
  }
  const attTotal = todayAttendance.length;
  const attRate =
    attTotal > 0
      ? (((attCounts.present + attCounts.late) / attTotal) * 100).toFixed(1) + '%'
      : '0.0%';

  // Production KPIs
  const woProd = woOutputAgg._sum.goodQty?.toNumber() ?? 0;
  const woTgt = woTargetAgg._sum.targetQuantity?.toNumber() ?? 0;
  const prodRate = woTgt > 0 ? ((woProd / woTgt) * 100).toFixed(1) + '%' : '0.0%';

  return {
    totalEmployees,
    activeEmployees,
    attendanceTodayPresent: attCounts.present,
    attendanceTodayAbsent: attCounts.absent,
    attendanceTodayLate: attCounts.late,
    attendanceTodayOnLeave: attCounts.onLeave,
    attendanceTodayRate: attRate,
    totalMaterials: materials.length,
    lowStockCount: lowStock,
    outOfStockCount: outOfStock,
    totalInventoryValue: inventoryValue.toFixed(2),
    activeClientOrders: coActive,
    pendingClientOrders: coPending,
    dispatchedOrders: coDispatched,
    pendingPurchaseOrders: poPending,
    orderFulfillmentRate: fulfillment,
    totalScrapThisMonth: scrapQty.toFixed(3),
    scrapValueThisMonth: scrapVal.toFixed(2),
    activeWorkOrders: woActive,
    completedWorkOrders: woCompleted,
    overdueWorkOrders: woOverdue,
    productionCompletionRate: prodRate,
    totalDepartments: totalDepts,
    activeDepartments: activeDepts,
    activeAlerts,
    criticalAlerts,
    criticalIncidents,
  };
}

export async function getDashboardCharts(): Promise<DashboardCharts> {
  logger.info('Fetching dashboard chart data');

  // Order status pie
  const [coPending, coApproved, coInProd, coDispatched, coDelivered] = await prisma.$transaction([
    prisma.clientOrder.count({ where: { status: 'PENDING' } }),
    prisma.clientOrder.count({ where: { status: 'APPROVED' } }),
    prisma.clientOrder.count({ where: { status: 'IN_PRODUCTION' } }),
    prisma.clientOrder.count({ where: { status: 'DISPATCHED' } }),
    prisma.clientOrder.count({ where: { status: 'DELIVERED' } }),
  ]);

  const orderStatusPie = [
    { name: 'Pending', value: coPending, color: '#E65100' },
    { name: 'Approved', value: coApproved, color: '#F57F17' },
    { name: 'In Production', value: coInProd, color: '#A52A2A' },
    { name: 'Dispatched', value: coDispatched, color: '#1565C0' },
    { name: 'Delivered', value: coDelivered, color: '#2E7D32' },
  ].filter((o) => o.value > 0);

  // Scrap by department (this month)
  const scrapByDeptRaw = await prisma.scrapRecord.groupBy({
    by: ['departmentName'],
    where: {
      recordedAt: { gte: startOfMonth() },
      departmentName: { not: null },
    },
    _sum: { quantity: true },
  });

  const scrapByDepartment = scrapByDeptRaw
    .map((r) => ({
      dept: r.departmentName ?? 'Unknown',
      kg: r._sum.quantity?.toNumber() ?? 0,
    }))
    .sort((a, b) => b.kg - a.kg)
    .slice(0, 6);

  // Scrap trend — last 7 days
  const scrapTrend: Array<{ day: string; scrap: number }> = [];
  // Attendance trend — last 7 days
  const attendanceTrend: Array<{
    date: string;
    present: number;
    absent: number;
    late: number;
    onLeave: number;
  }> = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setUTCHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);

    const [scrapAgg, attRecords] = await prisma.$transaction([
      prisma.scrapRecord.aggregate({
        where: { recordedAt: { gte: d, lt: next } },
        _sum: { quantity: true },
      }),
      prisma.attendance.findMany({
        where: { date: d },
        select: { status: true },
      }),
    ]);

    scrapTrend.push({
      day: dayLabel(d),
      scrap: scrapAgg._sum.quantity?.toNumber() ?? 0,
    });

    const attCounts = { present: 0, absent: 0, late: 0, onLeave: 0 };
    for (const a of attRecords) {
      if (a.status === 'PRESENT' || a.status === 'HALF_DAY') attCounts.present++;
      else if (a.status === 'ABSENT') attCounts.absent++;
      else if (a.status === 'LATE') attCounts.late++;
      else if (a.status === 'LEAVE') attCounts.onLeave++;
    }
    attendanceTrend.push({ date: dayLabel(d), ...attCounts });
  }

  // Recent 5 client orders
  const recentOrdersRaw = await prisma.clientOrder.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      product: true,
      quantity: true,
      status: true,
      createdAt: true,
      client: { select: { name: true } },
    },
  });

  const recentOrders = recentOrdersRaw.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    client: o.client.name,
    product: o.product,
    qty: o.quantity,
    status: o.status.toLowerCase().replace('_', '-'),
    date: o.createdAt.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    }),
  }));

  return { orderStatusPie, scrapByDepartment, scrapTrend, attendanceTrend, recentOrders };
}
