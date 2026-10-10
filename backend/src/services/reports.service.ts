import { prisma } from '../lib/prismaClient';
import { logger } from '../logger';
import type {
  DashboardKPIs,
  DashboardCharts,
  InventoryReport,
  WorkforceReport,
  OrdersReport,
  ScrapReport,
  SupplierReport,
  ClientReport,
  AttendanceReport,
  AttendanceReportFilters,
  ProductionReport,
  ProductionReportRow,
  ReportFilters,
} from '../interfaces';

// ── Date helpers ───────────────────────────────────────────────────────────────

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(d: Date | null | undefined): string {
  if (d == null) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'short' });
}

// ─────────────────────────────────────────────────────────────────────────────

export class ReportsService {
  // ══ DASHBOARD KPIs ════════════════════════════════════════════════════════

  async getDashboardKPIs(): Promise<DashboardKPIs> {
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

  // ══ DASHBOARD CHARTS ══════════════════════════════════════════════════════

  async getDashboardCharts(): Promise<DashboardCharts> {
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

  // ══ INVENTORY REPORT ══════════════════════════════════════════════════════

  async getInventoryReport(filters: ReportFilters): Promise<InventoryReport> {
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

  // ══ WORKFORCE REPORT ══════════════════════════════════════════════════════

  async getWorkforceReport(filters: ReportFilters): Promise<WorkforceReport> {
    logger.info('Generating workforce report', filters);

    const where = {
      deletedAt: null,
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    };

    const [employees, byDeptRaw] = await prisma.$transaction([
      prisma.employee.findMany({
        where,
        orderBy: [{ department: { name: 'asc' } }, { firstName: 'asc' }],
        select: {
          employeeCode: true,
          firstName: true,
          lastName: true,
          designation: true,
          employmentType: true,
          status: true,
          joiningDate: true,
          department: { select: { name: true } },
        },
      }),
      prisma.employee.groupBy({
        by: ['departmentId'],
        where: { deletedAt: null, departmentId: { not: null } },
        _count: { id: true },
        orderBy: { departmentId: 'asc' },
      }),
    ]);

    // Enrich department counts
    const deptIds = byDeptRaw.map((r) => r.departmentId).filter((id): id is number => id !== null);
    const depts =
      deptIds.length > 0
        ? await prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
          })
        : [];
    const deptMap = new Map(depts.map((d) => [d.id, d.name]));

    const byDepartment = byDeptRaw
      .filter((r) => r.departmentId !== null)
      .map((r) => ({
        name: deptMap.get(r.departmentId as number) ?? 'Unknown',
        count: (r._count as { id?: number } | undefined)?.id ?? 0,
      }))
      .sort((a, b) => b.count - a.count);

    const statusCounts = { active: 0, inactive: 0, onLeave: 0, terminated: 0 };
    const rows = employees.map((e) => {
      if (e.status === 'ACTIVE') statusCounts.active++;
      else if (e.status === 'INACTIVE') statusCounts.inactive++;
      else if (e.status === 'ON_LEAVE') statusCounts.onLeave++;
      else if (e.status === 'TERMINATED') statusCounts.terminated++;

      return {
        employeeCode: e.employeeCode,
        fullName: `${e.firstName} ${e.lastName}`,
        department: e.department?.name ?? '—',
        designation: e.designation,
        employmentType: e.employmentType,
        status: e.status,
        joiningDate: fmtDate(e.joiningDate),
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      period: `Up to ${fmtDate(new Date())}`,
      summary: {
        total: employees.length,
        ...statusCounts,
        byDepartment,
      },
      rows,
    };
  }

  // ══ ORDERS REPORT ═════════════════════════════════════════════════════════

  async getOrdersReport(filters: ReportFilters): Promise<OrdersReport> {
    logger.info('Generating orders report', filters);

    const dateWhere = this.buildDateWhere(filters);

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
      period: this.buildPeriodLabel(filters),
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

  // ══ SCRAP REPORT ══════════════════════════════════════════════════════════

  async getScrapReport(filters: ReportFilters): Promise<ScrapReport> {
    logger.info('Generating scrap report', filters);

    const dateWhere = this.buildDateWhere(filters, 'recordedAt');
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
      period: this.buildPeriodLabel(filters),
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

  // ══ SUPPLIER REPORT ═══════════════════════════════════════════════════════

  async getSupplierReport(filters: ReportFilters): Promise<SupplierReport> {
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

  // ══ CLIENT REPORT ═════════════════════════════════════════════════════════

  async getClientReport(filters: ReportFilters): Promise<ClientReport> {
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

  // ══ ATTENDANCE REPORT ════════════════════════════════════════════════════

  async getAttendanceReport(filters: AttendanceReportFilters): Promise<AttendanceReport> {
    logger.info('Generating attendance report', filters);

    const dateWhere = this.buildDateWhere(filters, 'date');

    // All active employees (optionally scoped to one department)
    const empWhere = {
      deletedAt: null,
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    };

    const [employees, attendanceRecords, departments] = await prisma.$transaction([
      prisma.employee.findMany({
        where: empWhere,
        orderBy: [{ department: { name: 'asc' } }, { firstName: 'asc' }],
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          designation: true,
          departmentId: true,
          department: { select: { id: true, name: true } },
        },
      }),
      prisma.attendance.findMany({
        where: {
          ...(dateWhere ? { date: dateWhere } : {}),
          ...(filters.departmentId ? { employee: { departmentId: filters.departmentId } } : {}),
        },
        select: {
          employeeId: true,
          status: true,
          workingHours: true,
        },
      }),
      prisma.department.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

    // Index attendance records by employeeId
    type AttCounts = {
      present: number;
      absent: number;
      halfDay: number;
      late: number;
      onLeave: number;
      workingHours: number;
    };
    const attMap = new Map<number, AttCounts>();
    for (const a of attendanceRecords) {
      const entry = attMap.get(a.employeeId) ?? {
        present: 0,
        absent: 0,
        halfDay: 0,
        late: 0,
        onLeave: 0,
        workingHours: 0,
      };
      if (a.status === 'PRESENT') entry.present++;
      else if (a.status === 'ABSENT') entry.absent++;
      else if (a.status === 'HALF_DAY') entry.halfDay++;
      else if (a.status === 'LATE') entry.late++;
      else if (a.status === 'LEAVE') entry.onLeave++;
      entry.workingHours += a.workingHours ?? 0;
      attMap.set(a.employeeId, entry);
    }

    // Per-department aggregation
    const deptMap = new Map(departments.map((d) => [d.id, d.name]));
    type DeptAgg = {
      department: string;
      present: number;
      absent: number;
      late: number;
      onLeave: number;
      total: number;
    };
    const deptAgg = new Map<number, DeptAgg>();

    // Summary totals
    let totalPresent = 0,
      totalAbsent = 0,
      totalHalfDay = 0;
    let totalLate = 0,
      totalOnLeave = 0;
    let sumRates = 0;

    const rows = employees.map((e) => {
      const att = attMap.get(e.id) ?? {
        present: 0,
        absent: 0,
        halfDay: 0,
        late: 0,
        onLeave: 0,
        workingHours: 0,
      };
      const totalDays = att.present + att.absent + att.halfDay + att.late + att.onLeave;
      const attended = att.present + att.late + att.halfDay;
      const rate = totalDays > 0 ? parseFloat(((attended / totalDays) * 100).toFixed(1)) : 0;

      totalPresent += att.present;
      totalAbsent += att.absent;
      totalHalfDay += att.halfDay;
      totalLate += att.late;
      totalOnLeave += att.onLeave;
      sumRates += rate;

      // Department aggregation
      if (e.departmentId !== null) {
        const da = deptAgg.get(e.departmentId) ?? {
          department: deptMap.get(e.departmentId) ?? 'Unknown',
          present: 0,
          absent: 0,
          late: 0,
          onLeave: 0,
          total: 0,
        };
        da.present += att.present + att.halfDay;
        da.absent += att.absent;
        da.late += att.late;
        da.onLeave += att.onLeave;
        da.total += totalDays;
        deptAgg.set(e.departmentId, da);
      }

      return {
        employeeCode: e.employeeCode,
        fullName: `${e.firstName} ${e.lastName}`,
        department: e.department?.name ?? '—',
        designation: e.designation,
        totalDays,
        present: att.present,
        absent: att.absent,
        halfDay: att.halfDay,
        late: att.late,
        onLeave: att.onLeave,
        totalWorkingHours: att.workingHours.toFixed(1),
        attendanceRate: `${rate.toFixed(1)}%`,
      };
    });

    const avgRate = employees.length > 0 ? `${(sumRates / employees.length).toFixed(1)}%` : '0.0%';

    const byDepartment = Array.from(deptAgg.values())
      .map((da) => ({
        department: da.department,
        present: da.present,
        absent: da.absent,
        late: da.late,
        onLeave: da.onLeave,
        total: da.total,
        rate: da.total > 0 ? `${(((da.present + da.late) / da.total) * 100).toFixed(1)}%` : '0.0%',
      }))
      .sort((a, b) => b.present - a.present);

    // Apply sort
    const { sortBy = 'department', sortOrder = 'asc' } = filters;
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.fullName.localeCompare(b.fullName);
      else if (sortBy === 'department') cmp = a.department.localeCompare(b.department);
      else if (sortBy === 'totalDays') cmp = a.totalDays - b.totalDays;
      else if (sortBy === 'attendanceRate')
        cmp = parseFloat(a.attendanceRate) - parseFloat(b.attendanceRate);
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return {
      generatedAt: new Date().toISOString(),
      period: this.buildPeriodLabel(filters),
      summary: {
        totalEmployees: employees.length,
        avgAttendanceRate: avgRate,
        totalPresent,
        totalAbsent,
        totalHalfDay,
        totalLate,
        totalOnLeave,
        byDepartment,
      },
      rows,
    };
  }

  // ══ PRODUCTION REPORT ════════════════════════════════════════════════════

  async getProductionReport(filters: ReportFilters): Promise<ProductionReport> {
    logger.info('Generating production report', filters);

    const dateWhere = this.buildDateWhere(filters, 'createdAt');
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
      period: this.buildPeriodLabel(filters),
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

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildDateWhere(
    filters: ReportFilters,
    _field = 'createdAt',
  ): { gte?: Date; lte?: Date } | null {
    if (!filters.fromDate && !filters.toDate) return null;
    const w: { gte?: Date; lte?: Date } = {};
    if (filters.fromDate) w.gte = filters.fromDate;
    if (filters.toDate) w.lte = filters.toDate;
    return w;
  }

  private buildPeriodLabel(filters: ReportFilters): string {
    if (filters.fromDate && filters.toDate) {
      return `${fmtDate(filters.fromDate)} – ${fmtDate(filters.toDate)}`;
    }
    if (filters.fromDate) return `From ${fmtDate(filters.fromDate)}`;
    if (filters.toDate) return `Up to ${fmtDate(filters.toDate)}`;
    return 'All time';
  }
}
