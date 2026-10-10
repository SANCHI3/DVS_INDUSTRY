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
  attendanceTodayRate: string; // e.g. "91.3%"

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

  // Production (this month)
  activeWorkOrders: number;
  completedWorkOrders: number;
  overdueWorkOrders: number;
  productionCompletionRate: string; // e.g. "84.2%"

  // Departments
  totalDepartments: number;
  activeDepartments: number;

  // Security
  activeAlerts: number; // alerts with status ACTIVE
  criticalAlerts: number; // ACTIVE alerts with CRITICAL severity
  criticalIncidents: number; // CRITICAL incidents still OPEN or INVESTIGATING
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
  present: number;
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
  date: string; // human-readable "12 Jun"
}

export interface DashboardCharts {
  orderStatusPie: OrderStatusCount[];
  scrapByDepartment: DeptScrapEntry[];
  scrapTrend: ScrapTrendEntry[]; // last 7 days
  attendanceTrend: AttendanceTrendChartEntry[]; // last 7 days
  recentOrders: RecentOrder[]; // last 5
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
