// ── Production domain interfaces ─────────────────────────────────────────────
// Pure domain objects — zero Prisma imports.

export type WorkOrderStatus =
  'DRAFT' | 'RELEASED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type WorkOrderPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

// ── Work Order ────────────────────────────────────────────────────────────────

export interface WorkOrderDto {
  id: number;
  workOrderNumber: string;
  product: string;
  targetQuantity: string; // decimal string
  unit: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  departmentId: number | null;
  departmentName: string | null;
  assignedToId: number | null;
  assignedToName: string | null;
  clientOrderId: number | null;
  notes: string | null;
  createdById: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;

  // Computed from outputs
  producedQty: string; // sum of goodQty across all outputs
  rejectedQty: string; // sum of rejectedQty
  scrapQty: string; // sum of scrapQty
  completionRate: string; // e.g. "87.4%"

  _count: { outputs: number };
}

export interface CreateWorkOrderData {
  product: string;
  targetQuantity: string;
  unit?: string | undefined;
  scheduledStart?: Date | null | undefined;
  scheduledEnd?: Date | null | undefined;
  priority?: WorkOrderPriority | undefined;
  departmentId?: number | null | undefined;
  departmentName?: string | null | undefined;
  assignedToId?: number | null | undefined;
  assignedToName?: string | null | undefined;
  clientOrderId?: number | null | undefined;
  notes?: string | null | undefined;
  createdById?: number | null | undefined;
}

export interface UpdateWorkOrderData {
  product?: string | undefined;
  targetQuantity?: string | undefined;
  unit?: string | undefined;
  scheduledStart?: Date | null | undefined;
  scheduledEnd?: Date | null | undefined;
  actualStart?: Date | null | undefined;
  actualEnd?: Date | null | undefined;
  status?: WorkOrderStatus | undefined;
  priority?: WorkOrderPriority | undefined;
  departmentId?: number | null | undefined;
  departmentName?: string | null | undefined;
  assignedToId?: number | null | undefined;
  assignedToName?: string | null | undefined;
  clientOrderId?: number | null | undefined;
  notes?: string | null | undefined;
}

export interface WorkOrderFilters {
  search?: string | undefined; // product / WO number
  status?: WorkOrderStatus | 'all' | undefined;
  priority?: WorkOrderPriority | 'all' | undefined;
  departmentId?: number | undefined;
  clientOrderId?: number | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortBy?: 'workOrderNumber' | 'product' | 'scheduledStart' | 'createdAt' | 'status' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface WorkOrderListResult {
  data: WorkOrderDto[];
  total: number;
}

// ── Work Order Output ─────────────────────────────────────────────────────────

export interface WorkOrderOutputDto {
  id: number;
  workOrderId: number;
  goodQty: string;
  rejectedQty: string;
  scrapQty: string;
  recordedAt: Date;
  recordedById: number | null;
  recordedByName: string | null;
  remarks: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOutputData {
  workOrderId: number;
  goodQty: string;
  rejectedQty?: string | undefined;
  scrapQty?: string | undefined;
  recordedAt?: Date | undefined;
  recordedById?: number | null | undefined;
  recordedByName?: string | null | undefined;
  remarks?: string | null | undefined;
}

export interface UpdateOutputData {
  goodQty?: string | undefined;
  rejectedQty?: string | undefined;
  scrapQty?: string | undefined;
  recordedAt?: Date | undefined;
  recordedByName?: string | null | undefined;
  remarks?: string | null | undefined;
}

export interface OutputFilters {
  workOrderId?: number | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface OutputListResult {
  data: WorkOrderOutputDto[];
  total: number;
}

// ── Production KPIs ───────────────────────────────────────────────────────────

export interface ProductionKPIs {
  // Counts
  totalWorkOrders: number;
  activeWorkOrders: number; // RELEASED + IN_PROGRESS
  completedThisMonth: number;
  overdueWorkOrders: number; // past scheduledEnd and not COMPLETED/CANCELLED

  // Quantities (this month)
  totalTargetQty: string;
  totalProducedQty: string;
  totalRejectedQty: string;
  totalScrapQty: string;

  // Rates
  overallCompletionRate: string; // produced / target %
  rejectionRate: string; // rejected / (produced + rejected) %

  // Breakdown by status
  byStatus: Array<{ status: WorkOrderStatus; count: number }>;

  // Breakdown by priority
  byPriority: Array<{ priority: WorkOrderPriority; count: number }>;
}

// ── Production trend (daily output for last N days) ───────────────────────────

export interface ProductionTrendEntry {
  date: string; // "Mon", "12 Jun" etc.
  produced: number;
  rejected: number;
  scrap: number;
}

// ── Work Order with outputs (detail view) ─────────────────────────────────────

export interface WorkOrderDetail extends WorkOrderDto {
  outputs: WorkOrderOutputDto[];
}

// ── Monthly target & KPI thresholds (entered by management) ──────────────────

export interface ProductionTargetDto {
  id: number;
  month: string; // "2026-10"
  periodStart: Date;
  outputTarget: number;
  unit: string;
  targetCompletionRate: number | null; // %
  maxRejectionRate: number | null; // %
  targetEmployeeEfficiency: number | null; // %
  notes: string | null;
  updatedById: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveProductionTargetData {
  outputTarget: number;
  unit: string;
  targetCompletionRate: number | null;
  maxRejectionRate: number | null;
  targetEmployeeEfficiency: number | null;
  notes: string | null;
  updatedById: number | null;
}

export interface MonthOutputTotals {
  goodQty: number;
  rejectedQty: number;
  scrapQty: number;
  outputRecords: number;
}

/** A month's target next to what was actually recorded. */
export interface MonthlyPerformance {
  month: string;
  target: ProductionTargetDto | null;
  actual: MonthOutputTotals & {
    rejectionRate: number | null; // rejected / (good + rejected) %
    employeeEfficiency: number | null; // from per-employee daily output
    employeeRecords: number;
  };
  progress: {
    daysInMonth: number;
    daysElapsed: number;
    progressPct: number | null;
    expectedToDate: number | null;
    pace: 'NOT_STARTED' | 'ON_TRACK' | 'BEHIND' | 'MET' | null;
  };
  checks: {
    rejection: 'MET' | 'MISSED' | null;
    employeeEfficiency: 'MET' | 'MISSED' | null;
  };
}
