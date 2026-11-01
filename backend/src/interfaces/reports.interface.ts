// ── Reports & KPI dashboard interfaces ──────────────────────────────────────
// Pure domain objects — no Prisma imports.

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

export interface DashboardKPIs {
  // Workforce
  totalEmployees: number;
  activeEmployees: number;

  // Attendance (today)
  attendanceTodayPresent: number;
  attendanceTodayAbsent: number;
  attendanceTodayLate: number;
  attendanceTodayOnLeave: number;
  attendanceTodayWeekOff: number; // recorded weekly offs plus people whose usual off day is today
  attendanceTodayRecorded: number; // attendance rows entered for today
  attendanceTodayRate: string | null; // e.g. "91.3%" of those due to work; null until entered
  isWeeklyOffToday: boolean; // most of the workforce is off: no attendance warning

  // Inventory
  totalMaterials: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalInventoryValue: string; // ₹

  // Orders
  activeClientOrders: number;
  pendingClientOrders: number;
  dispatchedOrders: number;
  pendingPurchaseOrders: number;
  orderFulfillmentRate: string; // e.g. "97.2%"

  // Scrap
  totalScrapThisMonth: string; // kg
  scrapValueThisMonth: string; // ₹

  // Production
  activeWorkOrders: number;
  overdueWorkOrders: number;
  productionMonth: ProductionMonthSummary;

  // Departments
  totalDepartments: number;
  activeDepartments: number;

  // Security. Incidents are what the camera AI (or a person) reported;
  // alerts are separate manual notices. Counts match the Security page.
  openIncidents: number; // status OPEN
  investigatingIncidents: number; // status INVESTIGATING
  criticalOpenIncidents: number; // CRITICAL, OPEN or INVESTIGATING
  highOpenIncidents: number; // HIGH, OPEN or INVESTIGATING
  activeAlerts: number; // alerts with status ACTIVE
  criticalAlerts: number; // ACTIVE alerts with CRITICAL severity
}

/** Production for the current calendar month, by date output was recorded. */
export interface ProductionMonthSummary {
  label: string; // "November 2026"
  outputQty: number; // good quantity recorded this month
  rejectedQty: number;
  outputRecords: number;
  unit: string;
  monthlyTarget: number | null; // from Production → monthly target, if set
  attainmentRate: string | null; // outputQty / monthlyTarget; null without target or output
  rejectionRate: string | null;
  completedWorkOrders: number; // closed this month
  completedShort: number; // of those, closed below their target
}

export interface OrderStatusCount {
  name: string; // "Pending", "In Production" etc.
  value: number;
  color: string;
}

export interface DeptScrapEntry {
  dept: string;
  kg: number;
}

export interface ScrapTrendEntry {
  day: string; // "Mon", "Tue" …
  scrap: number;
}

export interface AttendanceTrendChartEntry {
  date: string; // "Mon", "Tue" …
  present: number | null; // null = nothing recorded yet, or a weekly off (drawn as a gap)
  weekOff: number;
  nonWorkingDay: boolean;
  absent: number;
  late: number;
  onLeave: number;
}

export interface RecentOrder {
  id: number;
  orderNumber: string;
  client: string;
  product: string;
  qty: number;
  status: string;
  orderDate: string; // ISO; the same field the Orders page shows
}

export interface OpenIncidentSummary {
  id: number;
  incidentNumber: string;
  type: string;
  severity: string;
  status: string;
  location: string | null;
  occurredAt: string; // ISO
}

export interface DashboardCharts {
  orderStatusPie: OrderStatusCount[];
  scrapByDepartment: DeptScrapEntry[];
  scrapTrend: ScrapTrendEntry[]; // last 7 days
  attendanceTrend: AttendanceTrendChartEntry[]; // last 7 days
  recentOrders: RecentOrder[]; // last 5 by order date
  openIncidents: OpenIncidentSummary[]; // 5 most severe open incidents, newest first
}

// ═══════════════════════════════════════════════════════════════
// REPORT PAYLOADS
// ═══════════════════════════════════════════════════════════════

// ── Inventory report ──────────────────────────────────────────
export interface InventoryReportRow {
  name: string;
  code: string;
  category: string;
  unit: string;
  currentStock: string;
  minStockLevel: string;
  costPerUnit: string;
  stockValue: string;
  status: string; // "In Stock" | "Low Stock" | "Out of Stock"
  location: string;
}

export interface InventoryReport {
  generatedAt: string;
  period: string;
  summary: {
    totalMaterials: number;
    totalValue: string;
    inStock: number;
    lowStock: number;
    outOfStock: number;
  };
  rows: InventoryReportRow[];
}

// ── Workforce report ──────────────────────────────────────────
export interface WorkforceReportRow {
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  employmentType: string;
  status: string;
  joiningDate: string;
}

export interface WorkforceReport {
  generatedAt: string;
  period: string;
  summary: {
    total: number;
    active: number;
    inactive: number;
    onLeave: number;
    terminated: number;
    byDepartment: Array<{ name: string; count: number }>;
  };
  rows: WorkforceReportRow[];
}

// ── Orders report ─────────────────────────────────────────────
export interface OrdersReportRow {
  orderNumber: string;
  client: string;
  product: string;
  quantity: number;
  value: string;
  orderDate: string;
  requiredDate: string;
  status: string;
}

export interface POReportRow {
  poNumber: string;
  supplier: string;
  material: string;
  quantity: string;
  totalCost: string;
  orderDate: string;
  expectedDelivery: string;
  status: string;
}

export interface OrdersReport {
  generatedAt: string;
  period: string;
  summary: {
    totalClientOrders: number;
    totalPurchaseOrders: number;
    fulfillmentRate: string;
    totalRevenue: string;
    totalProcurement: string;
  };
  clientOrders: OrdersReportRow[];
  purchaseOrders: POReportRow[];
}

// ── Scrap report ──────────────────────────────────────────────
export interface ScrapReportRow {
  material: string;
  materialCode: string;
  quantity: string;
  unit: string;
  department: string;
  employee: string;
  reason: string;
  recoveryValue: string;
  recordedAt: string;
}

export interface ScrapReport {
  generatedAt: string;
  period: string;
  summary: {
    totalQuantity: string;
    totalRecoveryValue: string;
    byDepartment: Array<{ department: string; quantity: string }>;
    byMaterial: Array<{ material: string; quantity: string }>;
  };
  rows: ScrapReportRow[];
}

// ── Supplier report ───────────────────────────────────────────
export interface SupplierReportRow {
  name: string;
  code: string;
  rating: string;
  leadTimeDays: string;
  reliability: string;
  materials: string;
  totalPOs: number;
  deliveredPOs: number;
  pendingPOs: number;
}

export interface SupplierReport {
  generatedAt: string;
  period: string;
  summary: {
    totalSuppliers: number;
    activeSuppliers: number;
    avgRating: string;
    totalPOs: number;
  };
  rows: SupplierReportRow[];
}

// ── Client report ─────────────────────────────────────────────
export interface ClientReportRow {
  name: string;
  code: string;
  totalOrders: number;
  deliveredOrders: number;
  pendingOrders: number;
  totalRevenue: string;
}

export interface ClientReport {
  generatedAt: string;
  period: string;
  summary: {
    totalClients: number;
    activeClients: number;
    totalRevenue: string;
    totalOrders: number;
  };
  rows: ClientReportRow[];
}

// ── Production report ─────────────────────────────────────────
export interface ProductionReportRow {
  workOrderNumber: string;
  product: string;
  department: string;
  priority: string;
  status: string;
  targetQty: string;
  producedQty: string;
  rejectedQty: string;
  scrapQty: string;
  completionRate: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string;
  actualEnd: string;
}

export interface ProductionReport {
  generatedAt: string;
  period: string;
  summary: {
    totalWorkOrders: number;
    completed: number;
    inProgress: number;
    cancelled: number;
    totalTargetQty: string;
    totalProducedQty: string;
    totalRejectedQty: string;
    totalScrapQty: string;
    overallCompletionRate: string;
    rejectionRate: string;
    byDepartment: Array<{
      department: string;
      workOrders: number;
      produced: string;
      rejected: string;
      completionRate: string;
    }>;
  };
  rows: ProductionReportRow[];
}

// ── Security report ───────────────────────────────────────────
export interface SecurityReportRow {
  incidentNumber: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  department: string;
  location: string;
  reportedBy: string;
  assignedTo: string;
  occurredAt: string;
  resolvedAt: string;
  resolutionHours: string;
}

export interface SecurityReport {
  generatedAt: string;
  period: string;
  summary: {
    totalIncidents: number;
    open: number;
    investigating: number;
    resolved: number;
    closed: number;
    critical: number;
    high: number;
    avgResolutionHours: string;
    totalAlerts: number;
    activeAlerts: number;
    acknowledgedAlerts: number;
    byType: Array<{ type: string; incidents: number }>;
    byDepartment: Array<{ department: string; incidents: number; open: number; critical: number }>;
  };
  rows: SecurityReportRow[];
}

// ── Attendance report ─────────────────────────────────────────

export interface AttendanceReportRow {
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  totalDays: number;
  present: number;
  absent: number;
  halfDay: number;
  late: number;
  onLeave: number;
  totalWorkingHours: string;
  attendanceRate: string; // e.g. "94.7%"
}

export interface AttendanceReport {
  generatedAt: string;
  period: string;
  summary: {
    totalEmployees: number;
    avgAttendanceRate: string;
    totalPresent: number;
    totalAbsent: number;
    totalHalfDay: number;
    totalLate: number;
    totalOnLeave: number;
    byDepartment: Array<{
      department: string;
      present: number;
      absent: number;
      late: number;
      onLeave: number;
      total: number;
      rate: string;
    }>;
  };
  rows: AttendanceReportRow[];
}

// ── Report query filters ──────────────────────────────────────
export interface ReportFilters {
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  departmentId?: number | undefined;
  format?: 'json' | undefined;
}

export interface AttendanceReportFilters extends ReportFilters {
  sortBy?: 'name' | 'department' | 'attendanceRate' | 'totalDays' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}
