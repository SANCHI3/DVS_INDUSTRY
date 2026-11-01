import api, { unwrap } from '../api';

export interface ReportQuery {
  fromDate?: string;
  toDate?: string;
  departmentId?: number;
}

export interface InventoryReport {
  generatedAt: string;
  period: string;
  summary: { totalMaterials: number; totalValue: string; inStock: number; lowStock: number; outOfStock: number };
  rows: Array<{ name: string; code: string; category: string; unit: string; currentStock: string; minStockLevel: string; costPerUnit: string; stockValue: string; status: string; location: string }>;
}

export interface WorkforceReport {
  generatedAt: string;
  period: string;
  summary: { total: number; active: number; inactive: number; onLeave: number; terminated: number; byDepartment: Array<{ name: string; count: number }> };
  rows: Array<{ employeeCode: string; fullName: string; department: string; designation: string; employmentType: string; status: string; joiningDate: string }>;
}

export interface OrdersReport {
  generatedAt: string;
  period: string;
  summary: { totalClientOrders: number; totalPurchaseOrders: number; fulfillmentRate: string; totalRevenue: string; totalProcurement: string };
  clientOrders: Array<{ orderNumber: string; client: string; product: string; quantity: number; value: string; orderDate: string; requiredDate: string; status: string }>;
  purchaseOrders: Array<{ poNumber: string; supplier: string; material: string; quantity: string; totalCost: string; orderDate: string; expectedDelivery: string; status: string }>;
}

export interface ScrapReport {
  generatedAt: string;
  period: string;
  summary: { totalQuantity: string; totalRecoveryValue: string; byDepartment: Array<{ department: string; quantity: string }>; byMaterial: Array<{ material: string; quantity: string }> };
  rows: Array<{ material: string; materialCode: string; quantity: string; unit: string; department: string; employee: string; reason: string; recoveryValue: string; recordedAt: string }>;
}

export interface SupplierReport {
  generatedAt: string;
  period: string;
  summary: { totalSuppliers: number; activeSuppliers: number; avgRating: string; totalPOs: number };
  rows: Array<{ name: string; code: string; rating: string; leadTimeDays: string; reliability: string; materials: string; totalPOs: number; deliveredPOs: number; pendingPOs: number }>;
}

export interface ClientReport {
  generatedAt: string;
  period: string;
  summary: { totalClients: number; activeClients: number; totalRevenue: string; totalOrders: number };
  rows: Array<{ name: string; code: string; totalOrders: number; deliveredOrders: number; pendingOrders: number; totalRevenue: string }>;
}

export interface ProductionReport {
  generatedAt: string;
  period: string;
  summary: { totalWorkOrders: number; completed: number; inProgress: number; cancelled: number; totalTargetQty: string; totalProducedQty: string; totalRejectedQty: string; totalScrapQty: string; overallCompletionRate: string; rejectionRate: string; byDepartment: Array<{ department: string; workOrders: number; produced: string; rejected: string; completionRate: string }> };
  rows: Array<{ workOrderNumber: string; product: string; department: string; priority: string; status: string; targetQty: string; producedQty: string; rejectedQty: string; scrapQty: string; completionRate: string; scheduledStart: string; scheduledEnd: string; actualStart: string; actualEnd: string }>;
}

export interface SecurityReport {
  generatedAt: string;
  period: string;
  summary: { totalIncidents: number; open: number; investigating: number; resolved: number; closed: number; critical: number; high: number; avgResolutionHours: string; totalAlerts: number; activeAlerts: number; acknowledgedAlerts: number; byType: Array<{ type: string; incidents: number }>; byDepartment: Array<{ department: string; incidents: number; open: number; critical: number }> };
  rows: Array<{ incidentNumber: string; title: string; type: string; severity: string; status: string; department: string; location: string; reportedBy: string; assignedTo: string; occurredAt: string; resolvedAt: string; resolutionHours: string }>;
}

export interface AttendanceReport {
  generatedAt: string;
  period: string;
  summary: { totalEmployees: number; avgAttendanceRate: string; totalPresent: number; totalAbsent: number; totalHalfDay: number; totalLate: number; totalOnLeave: number; byDepartment: Array<{ department: string; present: number; absent: number; late: number; onLeave: number; total: number; rate: string }> };
  rows: Array<{ employeeCode: string; fullName: string; department: string; designation: string; totalDays: number; present: number; absent: number; halfDay: number; late: number; onLeave: number; totalWorkingHours: string; attendanceRate: string }>;
}

export async function getInventoryReport(params?: ReportQuery): Promise<InventoryReport> {
  const res = await api.get<{ success: true; data: InventoryReport }>('/reports/inventory', { params });
  return unwrap(res);
}

export async function getWorkforceReport(params?: ReportQuery): Promise<WorkforceReport> {
  const res = await api.get<{ success: true; data: WorkforceReport }>('/reports/workforce', { params });
  return unwrap(res);
}

export async function getOrdersReport(params?: ReportQuery): Promise<OrdersReport> {
  const res = await api.get<{ success: true; data: OrdersReport }>('/reports/orders', { params });
  return unwrap(res);
}

export async function getScrapReport(params?: ReportQuery): Promise<ScrapReport> {
  const res = await api.get<{ success: true; data: ScrapReport }>('/reports/scrap', { params });
  return unwrap(res);
}

export async function getSupplierReport(params?: ReportQuery): Promise<SupplierReport> {
  const res = await api.get<{ success: true; data: SupplierReport }>('/reports/suppliers', { params });
  return unwrap(res);
}

export async function getClientReport(params?: ReportQuery): Promise<ClientReport> {
  const res = await api.get<{ success: true; data: ClientReport }>('/reports/clients', { params });
  return unwrap(res);
}

export async function getAttendanceReport(params?: ReportQuery & { sortBy?: string; sortOrder?: string }): Promise<AttendanceReport> {
  const res = await api.get<{ success: true; data: AttendanceReport }>('/reports/attendance', { params });
  return unwrap(res);
}

export async function getProductionReport(params?: ReportQuery): Promise<ProductionReport> {
  const res = await api.get<{ success: true; data: ProductionReport }>('/reports/production', { params });
  return unwrap(res);
}

export async function getSecurityReport(params?: ReportQuery): Promise<SecurityReport> {
  const res = await api.get<{ success: true; data: SecurityReport }>('/reports/security', { params });
  return unwrap(res);
}
