import api, { unwrap } from '../api';

// ── Dashboard types (mirrors backend DashboardKPIs + DashboardCharts) ─────────

export interface DashboardKPIs {
  // Workforce
  totalEmployees:      number;
  activeEmployees:     number;
  // Attendance today
  attendanceTodayPresent:  number;
  attendanceTodayAbsent:   number;
  attendanceTodayLate:     number;
  attendanceTodayOnLeave:  number;
  attendanceTodayWeekOff:  number;
  attendanceTodayRecorded: number;
  /** Of those due to work today; null until attendance is entered */
  attendanceTodayRate:     string | null;
  /** Most of the workforce is on its weekly off today */
  isWeeklyOffToday:        boolean;
  // Inventory
  totalMaterials:      number;
  lowStockCount:       number;
  outOfStockCount:     number;
  totalInventoryValue: string;
  // Orders
  activeClientOrders:    number;
  pendingClientOrders:   number;
  dispatchedOrders:      number;
  pendingPurchaseOrders: number;
  orderFulfillmentRate:  string;
  // Scrap
  totalScrapThisMonth: string;
  scrapValueThisMonth: string;
  // Production
  activeWorkOrders:  number;
  overdueWorkOrders: number;
  productionMonth:   ProductionMonthSummary;
  // Departments
  totalDepartments:  number;
  activeDepartments: number;
  // Security: incidents (camera AI or staff reports) — same counts as the Security page
  openIncidents:          number;
  investigatingIncidents: number;
  criticalOpenIncidents:  number;
  highOpenIncidents:      number;
  activeAlerts:           number;
  criticalAlerts:         number;
}

/** This calendar month's production, by the date output was recorded. */
export interface ProductionMonthSummary {
  label:               string;
  outputQty:           number;
  rejectedQty:         number;
  outputRecords:       number;
  unit:                string;
  monthlyTarget:       number | null;
  attainmentRate:      string | null;
  rejectionRate:       string | null;
  completedWorkOrders: number;
  completedShort:      number;
}

export interface OrderStatusCount   { name: string; value: number; color: string }
export interface DeptScrapEntry     { dept: string; kg: number }
export interface ScrapTrendEntry    { day: string; scrap: number }
/** `present` is null for weekly offs and days not yet entered (drawn as a gap). */
export interface AttendanceTrendEntry { date: string; present: number | null; absent: number; late: number; onLeave: number; weekOff: number; nonWorkingDay: boolean }
export interface RecentOrder        { id: number; orderNumber: string; client: string; product: string; qty: number; status: string; orderDate: string }
export interface OpenIncidentSummary { id: number; incidentNumber: string; type: string; severity: string; status: string; location: string | null; occurredAt: string }

export interface DashboardCharts {
  orderStatusPie:    OrderStatusCount[];
  scrapByDepartment: DeptScrapEntry[];
  scrapTrend:        ScrapTrendEntry[];
  attendanceTrend:   AttendanceTrendEntry[];
  recentOrders:      RecentOrder[];
  openIncidents:     OpenIncidentSummary[];
}

export interface DashboardData {
  kpis:   DashboardKPIs;
  charts: DashboardCharts;
}

export async function getDashboard(): Promise<DashboardData> {
  const res = await api.get<{ success: true; data: DashboardData }>('/reports/dashboard');
  return unwrap(res);
}

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const res = await api.get<{ success: true; data: DashboardKPIs }>('/reports/dashboard/kpis');
  return unwrap(res);
}

export async function getDashboardCharts(): Promise<DashboardCharts> {
  const res = await api.get<{ success: true; data: DashboardCharts }>('/reports/dashboard/charts');
  return unwrap(res);
}
