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
  attendanceTodayRate:     string;
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
  activeWorkOrders:          number;
  completedWorkOrders:       number;
  overdueWorkOrders:         number;
  productionCompletionRate:  string;
  // Departments
  totalDepartments:  number;
  activeDepartments: number;
  // Security
  activeAlerts:      number;
  criticalAlerts:    number;
  criticalIncidents: number;
}

export interface OrderStatusCount   { name: string; value: number; color: string }
export interface DeptScrapEntry     { dept: string; kg: number }
export interface ScrapTrendEntry    { day: string; scrap: number }
export interface AttendanceTrendEntry { date: string; present: number; absent: number; late: number; onLeave: number }
export interface RecentOrder        { id: number; orderNumber: string; client: string; product: string; qty: number; status: string; date: string }

export interface DashboardCharts {
  orderStatusPie:    OrderStatusCount[];
  scrapByDepartment: DeptScrapEntry[];
  scrapTrend:        ScrapTrendEntry[];
  attendanceTrend:   AttendanceTrendEntry[];
  recentOrders:      RecentOrder[];
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
