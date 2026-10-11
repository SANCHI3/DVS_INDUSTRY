import api from '../api';

// ── Types mirror backend/src/interfaces/analytics.interface.ts ──────────────

export type StockStatus = 'CRITICAL' | 'REORDER' | 'OK' | 'OVERSTOCK' | 'NO_DEMAND';
export type ForecastMethod = 'HOLT' | 'CROSTON_SBA' | 'INSUFFICIENT_DATA';

export interface AnalyticsParams {
  historyDays?: number;
  horizonDays?: number;
  serviceLevel?: number;
  defaultLeadTimeDays?: number;
  orderCost?: number;
  holdingRate?: number;
}

export interface Insight {
  severity: 'critical' | 'warning' | 'info' | 'positive';
  title: string;
  detail: string;
}

export interface MaterialIntelligence {
  id: number;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  currentStock: number;
  onOrder: number;
  costPerUnit: number | null;
  avgDailyDemand: number;
  forecastDailyDemand: number;
  forecastHorizonDemand: number;
  forecastMethod: ForecastMethod;
  forecastError: number | null;
  daysOfCover: number | null;
  predictedStockoutDate: string | null;
  leadTimeDays: number;
  leadTimeSource: 'supplier' | 'default';
  safetyStock: number;
  reorderPoint: number;
  economicOrderQty: number;
  suggestedOrderQty: number;
  status: StockStatus;
  abc: 'A' | 'B' | 'C';
  xyz: 'X' | 'Y' | 'Z';
  demandCv: number | null;
  annualConsumptionValue: number;
}

export interface StockMovementAnomaly {
  transactionId: number;
  materialId: number;
  materialName: string;
  type: string;
  quantity: number;
  date: string;
  robustZ: number;
  reason: string;
  performedBy: string | null;
  department: string | null;
}

export interface InventoryIntelligence {
  generatedAt: string;
  parameters: Required<AnalyticsParams>;
  summary: {
    materials: number;
    critical: number;
    reorder: number;
    ok: number;
    overstock: number;
    noDemand: number;
    inventoryValue: number;
    shortageValue: number;
    excessStockValue: number;
    suggestedPurchaseValue: number;
    forecastError: number | null;
  };
  abcXyzMatrix: Array<{ abc: 'A' | 'B' | 'C'; xyz: 'X' | 'Y' | 'Z'; count: number; value: number }>;
  materials: MaterialIntelligence[];
  anomalies: StockMovementAnomaly[];
  insights: Insight[];
}

export interface MaterialForecast {
  materialId: number;
  name: string;
  unit: string;
  method: ForecastMethod;
  params: Record<string, number>;
  wape: number | null;
  totalError: number | null;
  history: Array<{ date: string; actual: number }>;
  forecast: Array<{ date: string; forecast: number; lower: number; upper: number }>;
  currentStock: number;
  reorderPoint: number;
  safetyStock: number;
  projectedStock: Array<{ date: string; stock: number }>;
}

export interface PChartPoint {
  date: string;
  inspected: number;
  defective: number;
  proportion: number;
  ucl: number;
  lcl: number;
  outOfControl: boolean;
  shift: boolean;
}

export interface DepartmentPerformance {
  department: string;
  workOrders: number;
  target: number;
  good: number;
  rejected: number;
  scrap: number;
  quality: number;
  attainment: number;
  schedule: number;
  oee: number;
  rank: number;
}

export interface ProductionPerformance {
  generatedAt: string;
  historyDays: number;
  overall: {
    workOrders: number;
    target: number;
    good: number;
    rejected: number;
    scrap: number;
    quality: number;
    attainment: number;
    schedule: number;
    oee: number;
    oeeNote: string;
  };
  departments: DepartmentPerformance[];
  weeklyTrend: Array<{ week: string; good: number; defective: number; quality: number }>;
  qualityControl: { centerLine: number; points: PChartPoint[]; outOfControlDays: number; shiftDetected: boolean };
  insights: Insight[];
}

export interface PlantHealth {
  generatedAt: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  components: Array<{ key: string; label: string; score: number; weight: number; detail: string }>;
  safetyQualityCorrelation: { r: number | null; departments: number; note: string };
  incidentsByType: Array<{ type: string; count: number }>;
  insights: Insight[];
}

export async function getInventoryIntelligence(params: AnalyticsParams = {}): Promise<InventoryIntelligence> {
  const res = await api.get<{ success: true; data: InventoryIntelligence }>('/analytics/inventory', { params });
  return res.data.data;
}

export async function getMaterialForecast(materialId: number, params: AnalyticsParams = {}): Promise<MaterialForecast> {
  const res = await api.get<{ success: true; data: MaterialForecast }>(
    `/analytics/inventory/${materialId}/forecast`,
    { params },
  );
  return res.data.data;
}

export async function getProductionPerformance(params: { historyDays?: number; department?: string } = {}): Promise<ProductionPerformance> {
  const res = await api.get<{ success: true; data: ProductionPerformance }>('/analytics/production', { params });
  return res.data.data;
}

export async function getPlantHealth(params: AnalyticsParams = {}): Promise<PlantHealth> {
  const res = await api.get<{ success: true; data: PlantHealth }>('/analytics/plant-health', { params });
  return res.data.data;
}

// ── Supplier scorecard ────────────────────────────────────────────────────────

export interface SupplierScore {
  supplierId: number;
  name: string;
  code: string;
  purchaseOrders: number;
  delivered: number;
  cancelled: number;
  open: number;
  overdueOpen: number;
  spend: number;
  onTimeRate: number | null;        // percent
  averageDelayDays: number | null;
  leadTimeMeanDays: number | null;
  leadTimeCv: number | null;
  promisedLeadTimeDays: number | null;
  leadTimeDriftDays: number | null;
  fulfilmentRate: number | null;    // percent
  rating: number | null;
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | null;
  enoughHistory: boolean;
}

export interface SupplierScorecard {
  generatedAt: string;
  historyDays: number;
  summary: {
    suppliers: number;
    purchaseOrders: number;
    delivered: number;
    overallOnTimeRate: number | null;
    overdueOpen: number;
    spend: number;
  };
  suppliers: SupplierScore[];
  insights: Insight[];
}

export async function getSupplierScorecard(params: { historyDays?: number } = {}): Promise<SupplierScorecard> {
  const res = await api.get<{ success: true; data: SupplierScorecard }>('/analytics/suppliers', { params });
  return res.data.data;
}
