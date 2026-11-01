import { prisma } from '../../lib/prismaClient';
import { logger } from '../../logger';
import type {
  DashboardKPIs,
  DashboardCharts,
  AttendanceTrendChartEntry,
  ProductionMonthSummary,
} from '../../interfaces';
import { startOfMonth, dayLabel } from './helpers';
import {
  completedShort,
  percentText,
  summariseAttendanceDay,
  usualWeekOffDays,
  type AttendanceStatusName,
} from './metrics';

const DAY_MS = 86_400_000;
// Weekly offs are learned from this many weeks of attendance sheets
const WEEK_OFF_LOOKBACK_DAYS = 56;

function utcToday(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Weekly-off context shared by today's KPIs and the 7-day trend. */
async function loadWeekOffContext(today: Date) {
  const [active, weekOffs] = await prisma.$transaction([
    prisma.employee.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    }),
    prisma.attendance.findMany({
      where: {
        status: 'WEEK_OFF',
        date: { gte: new Date(today.getTime() - WEEK_OFF_LOOKBACK_DAYS * DAY_MS), lte: today },
      },
      select: { employeeId: true, date: true },
    }),
  ]);
  return { activeEmployeeIds: active.map((e) => e.id), usualOff: usualWeekOffDays(weekOffs) };
}

/**
 * This month's production by the date output was recorded, against the
 * monthly target set on the Production page. Same basis as that page.
 */
async function getProductionMonth(now = new Date()): Promise<ProductionMonthSummary> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [target, output, completed] = await prisma.$transaction([
    prisma.productionMonthlyTarget.findUnique({ where: { periodStart: monthStart } }),
    prisma.workOrderOutput.aggregate({
      where: { recordedAt: { gte: monthStart, lt: nextMonth }, workOrder: { deletedAt: null } },
      _sum: { goodQty: true, rejectedQty: true },
      _count: { _all: true },
    }),
    prisma.workOrder.findMany({
      where: {
        deletedAt: null,
        status: 'COMPLETED',
        OR: [
          { actualEnd: { gte: monthStart, lt: nextMonth } },
          { actualEnd: null, updatedAt: { gte: monthStart, lt: nextMonth } },
        ],
      },
      select: { status: true, targetQuantity: true, outputs: { select: { goodQty: true } } },
    }),
  ]);

  const outputQty = output._sum.goodQty?.toNumber() ?? 0;
  const rejectedQty = output._sum.rejectedQty?.toNumber() ?? 0;
  const monthlyTarget = target ? target.outputTarget.toNumber() : null;
  const short = completed.filter(
    (wo) =>
      completedShort(
        wo.status,
        wo.outputs.reduce((s, o) => s + o.goodQty.toNumber(), 0),
        wo.targetQuantity.toNumber(),
      ).short,
  ).length;

  return {
    label: monthStart.toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    outputQty,
    rejectedQty,
    outputRecords: output._count._all,
    unit: target?.unit ?? 'pcs',
    monthlyTarget,
    attainmentRate:
      monthlyTarget !== null && output._count._all > 0
        ? percentText(outputQty, monthlyTarget)
        : null,
    rejectionRate: percentText(rejectedQty, outputQty + rejectedQty),
    completedWorkOrders: completed.length,
    completedShort: short,
  };
}

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  logger.info('Fetching dashboard KPIs');

  const today = utcToday();
  const openStatuses = { in: ['OPEN', 'INVESTIGATING'] as Array<'OPEN' | 'INVESTIGATING'> };

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
    woOverdue,
    openIncidents,
    investigatingIncidents,
    criticalOpenIncidents,
    highOpenIncidents,
    activeAlerts,
    criticalAlerts,
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
      select: { employeeId: true, status: true },
    }),
    prisma.workOrder.count({
      where: { deletedAt: null, status: { in: ['RELEASED', 'IN_PROGRESS'] } },
    }),
    prisma.workOrder.count({
      where: {
        deletedAt: null,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        scheduledEnd: { lt: new Date() },
      },
    }),
    // Same filters as the Security page KPI cards
    prisma.securityIncident.count({ where: { deletedAt: null, status: 'OPEN' } }),
    prisma.securityIncident.count({ where: { deletedAt: null, status: 'INVESTIGATING' } }),
    prisma.securityIncident.count({
      where: { deletedAt: null, severity: 'CRITICAL', status: openStatuses },
    }),
    prisma.securityIncident.count({
      where: { deletedAt: null, severity: 'HIGH', status: openStatuses },
    }),
    prisma.securityAlert.count({ where: { status: 'ACTIVE' } }),
    prisma.securityAlert.count({ where: { status: 'ACTIVE', severity: 'CRITICAL' } }),
  ]);

  const [weekOff, productionMonth] = await Promise.all([
    loadWeekOffContext(today),
    getProductionMonth(),
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

  const fulfillment = percentText(coDelivered, coNotCancelled) ?? '0.0%';

  const attendance = summariseAttendanceDay({
    records: todayAttendance.map((a) => ({
      employeeId: a.employeeId,
      status: a.status as AttendanceStatusName,
    })),
    activeEmployeeIds: weekOff.activeEmployeeIds,
    usualOff: weekOff.usualOff,
    weekday: today.getUTCDay(),
  });

  return {
    totalEmployees,
    activeEmployees,
    attendanceTodayPresent: attendance.present,
    attendanceTodayAbsent: attendance.absent,
    attendanceTodayLate: attendance.late,
    attendanceTodayOnLeave: attendance.onLeave,
    attendanceTodayWeekOff: attendance.weekOff,
    attendanceTodayRecorded: attendance.recorded,
    attendanceTodayRate: attendance.rate,
    isWeeklyOffToday: attendance.nonWorkingDay,
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
    overdueWorkOrders: woOverdue,
    productionMonth,
    totalDepartments: totalDepts,
    activeDepartments: activeDepts,
    openIncidents,
    investigatingIncidents,
    criticalOpenIncidents,
    highOpenIncidents,
    activeAlerts,
    criticalAlerts,
  };
}

export async function getDashboardCharts(): Promise<DashboardCharts> {
  logger.info('Fetching dashboard chart data');

  const today = utcToday();

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

  // Last 7 days of scrap and attendance
  const weekOff = await loadWeekOffContext(today);
  const scrapTrend: Array<{ day: string; scrap: number }> = [];
  const attendanceTrend: AttendanceTrendChartEntry[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const next = new Date(d.getTime() + DAY_MS);

    const [scrapAgg, attRecords] = await prisma.$transaction([
      prisma.scrapRecord.aggregate({
        where: { recordedAt: { gte: d, lt: next } },
        _sum: { quantity: true },
      }),
      prisma.attendance.findMany({
        where: { date: d },
        select: { employeeId: true, status: true },
      }),
    ]);

    scrapTrend.push({
      day: dayLabel(d),
      scrap: scrapAgg._sum.quantity?.toNumber() ?? 0,
    });

    const day = summariseAttendanceDay({
      records: attRecords.map((a) => ({
        employeeId: a.employeeId,
        status: a.status as AttendanceStatusName,
      })),
      activeEmployeeIds: weekOff.activeEmployeeIds,
      usualOff: weekOff.usualOff,
      weekday: d.getUTCDay(),
    });
    // A gap, not a drop to zero, for weekly offs and days with nothing entered yet
    const plotted = day.recorded > 0 && !day.nonWorkingDay;
    attendanceTrend.push({
      date: dayLabel(d),
      present: plotted ? day.present + day.late : null,
      absent: day.absent,
      late: day.late,
      onLeave: day.onLeave,
      weekOff: day.weekOff,
      nonWorkingDay: day.nonWorkingDay,
    });
  }

  // Latest 5 client orders by order date (the date the Orders page shows)
  const recentOrdersRaw = await prisma.clientOrder.findMany({
    take: 5,
    orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      orderNumber: true,
      product: true,
      quantity: true,
      status: true,
      orderDate: true,
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
    orderDate: o.orderDate.toISOString(),
  }));

  // Most severe open incidents first (severity enum is ordered LOW → CRITICAL)
  const openIncidentsRaw = await prisma.securityIncident.findMany({
    where: { deletedAt: null, status: { in: ['OPEN', 'INVESTIGATING'] } },
    orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
    take: 5,
    select: {
      id: true,
      incidentNumber: true,
      type: true,
      severity: true,
      status: true,
      location: true,
      occurredAt: true,
    },
  });

  const openIncidents = openIncidentsRaw.map((i) => ({
    ...i,
    occurredAt: i.occurredAt.toISOString(),
  }));

  return {
    orderStatusPie,
    scrapByDepartment,
    scrapTrend,
    attendanceTrend,
    recentOrders,
    openIncidents,
  };
}
