import api, { unwrap, unwrapPaged, type PaginatedMeta } from '../api';

export type WorkOrderStatus   = 'DRAFT' | 'RELEASED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type WorkOrderPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface WorkOrderDto {
  id:              number;
  workOrderNumber: string;
  product:         string;
  targetQuantity:  string;
  unit:            string;
  scheduledStart:  string | null;
  scheduledEnd:    string | null;
  actualStart:     string | null;
  actualEnd:       string | null;
  status:          WorkOrderStatus;
  priority:        WorkOrderPriority;
  departmentId:    number | null;
  departmentName:  string | null;
  assignedToId:    number | null;
  assignedToName:  string | null;
  clientOrderId:   number | null;
  notes:           string | null;
  producedQty:     string;
  rejectedQty:     string;
  scrapQty:        string;
  completionRate:  string;
  createdAt:       string;
  updatedAt:       string;
  _count:          { outputs: number };
}

export interface WorkOrderOutputDto {
  id:             number;
  workOrderId:    number;
  goodQty:        string;
  rejectedQty:    string;
  scrapQty:       string;
  recordedAt:     string;
  recordedByName: string | null;
  remarks:        string | null;
}

export interface ProductionKPIs {
  totalWorkOrders:       number;
  activeWorkOrders:      number;
  completedThisMonth:    number;
  overdueWorkOrders:     number;
  totalTargetQty:        string;
  totalProducedQty:      string;
  totalRejectedQty:      string;
  totalScrapQty:         string;
  overallCompletionRate: string;
  rejectionRate:         string;
  byStatus:   Array<{ status: WorkOrderStatus; count: number }>;
  byPriority: Array<{ priority: WorkOrderPriority; count: number }>;
}

export interface ProductionTrendEntry { date: string; produced: number; rejected: number; scrap: number }

export interface WorkOrderQuery {
  page?: number; pageSize?: number;
  search?: string; status?: WorkOrderStatus | 'all';
  priority?: WorkOrderPriority | 'all';
  departmentId?: number;
  fromDate?: string; toDate?: string;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
}

export async function getWorkOrders(params?: WorkOrderQuery) {
  const res = await api.get<{ success: true; data: WorkOrderDto[]; meta: PaginatedMeta }>('/production/work-orders', { params });
  return unwrapPaged(res);
}

export async function getWorkOrderById(id: number): Promise<WorkOrderDto> {
  const res = await api.get<{ success: true; data: WorkOrderDto }>(`/production/work-orders/${id}`);
  return unwrap(res);
}

export async function createWorkOrder(payload: Record<string, unknown>): Promise<WorkOrderDto> {
  const res = await api.post<{ success: true; data: WorkOrderDto }>('/production/work-orders', payload);
  return unwrap(res);
}

export async function updateWorkOrder(id: number, payload: Record<string, unknown>): Promise<WorkOrderDto> {
  const res = await api.patch<{ success: true; data: WorkOrderDto }>(`/production/work-orders/${id}`, payload);
  return unwrap(res);
}

export async function transitionStatus(id: number, status: WorkOrderStatus, notes?: string | null): Promise<WorkOrderDto> {
  const res = await api.patch<{ success: true; data: WorkOrderDto }>(`/production/work-orders/${id}/status`, { status, notes });
  return unwrap(res);
}

export async function deleteWorkOrder(id: number): Promise<void> {
  await api.delete(`/production/work-orders/${id}`);
}

export async function getOutputs(workOrderId: number) {
  const res = await api.get<{ success: true; data: WorkOrderOutputDto[]; meta: PaginatedMeta }>(`/production/work-orders/${workOrderId}/outputs`);
  return unwrapPaged(res);
}

export async function addOutput(workOrderId: number, payload: { goodQty: string; rejectedQty?: string; scrapQty?: string; remarks?: string | null }): Promise<WorkOrderOutputDto> {
  const res = await api.post<{ success: true; data: WorkOrderOutputDto }>(`/production/work-orders/${workOrderId}/outputs`, payload);
  return unwrap(res);
}

export async function getProductionKPIs(params?: { departmentId?: number; fromDate?: string; toDate?: string }): Promise<ProductionKPIs> {
  const res = await api.get<{ success: true; data: ProductionKPIs }>('/production/kpis', { params });
  return unwrap(res);
}

export async function getProductionTrend(params?: { days?: number; departmentId?: number }): Promise<ProductionTrendEntry[]> {
  const res = await api.get<{ success: true; data: ProductionTrendEntry[] }>('/production/trend', { params });
  return unwrap(res);
}

// ── Monthly target & KPI thresholds ───────────────────────────────────────────
// Entered by management; actual figures always come from recorded output.

export interface ProductionTargetDto {
  id:                       number;
  month:                    string;   // "2026-10"
  periodStart:              string;
  outputTarget:             number;
  unit:                     string;
  targetCompletionRate:     number | null;
  maxRejectionRate:         number | null;
  targetEmployeeEfficiency: number | null;
  notes:                    string | null;
  updatedById:              number | null;
  createdAt:                string;
  updatedAt:                string;
}

export type TargetPace = 'NOT_STARTED' | 'ON_TRACK' | 'BEHIND' | 'MET';
export type ThresholdCheck = 'MET' | 'MISSED' | null;

export interface MonthlyPerformance {
  month: string;
  target: ProductionTargetDto | null;
  actual: {
    goodQty: number; rejectedQty: number; scrapQty: number; outputRecords: number;
    rejectionRate: number | null; employeeEfficiency: number | null; employeeRecords: number;
  };
  progress: {
    daysInMonth: number; daysElapsed: number;
    progressPct: number | null; expectedToDate: number | null; pace: TargetPace | null;
  };
  checks: { rejection: ThresholdCheck; employeeEfficiency: ThresholdCheck };
}

export interface SaveTargetPayload {
  outputTarget:             string;
  unit:                     string;
  targetCompletionRate:     number | null;
  maxRejectionRate:         number | null;
  targetEmployeeEfficiency: number | null;
  notes:                    string | null;
  /** updatedAt of the version being edited; null when creating */
  expectedUpdatedAt:        string | null;
}

export async function getMonthlyPerformance(month: string): Promise<MonthlyPerformance> {
  const res = await api.get<{ success: true; data: MonthlyPerformance }>(`/production/targets/${month}/performance`);
  return unwrap(res);
}

export async function saveProductionTarget(month: string, payload: SaveTargetPayload): Promise<ProductionTargetDto> {
  const res = await api.put<{ success: true; data: ProductionTargetDto }>(`/production/targets/${month}`, payload);
  return unwrap(res);
}

export async function deleteProductionTarget(month: string): Promise<void> {
  await api.delete(`/production/targets/${month}`);
}
