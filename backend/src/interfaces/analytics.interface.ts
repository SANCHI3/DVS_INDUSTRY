// ── Smart Analytics DTOs ─────────────────────────────────────────────────────

import type { AbcClass, XyzClass } from '../analytics/inventoryMath';
import type { ForecastMethod } from '../analytics/forecasting';
import type { PChart } from '../analytics/productionMath';

export interface AnalyticsQuery {
  historyDays: number;
  horizonDays: number;
  serviceLevel: number;
  defaultLeadTimeDays: number;
  orderCost: number;
  holdingRate: number;
}

export type StockStatus = 'CRITICAL' | 'REORDER' | 'OK' | 'OVERSTOCK' | 'NO_DEMAND';

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
  /** Relative error of total demand over a 14-day hold-out the model did not see. */
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
  abc: AbcClass;
  xyz: XyzClass;
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

export interface Insight {
  severity: 'critical' | 'warning' | 'info' | 'positive';
  title: string;
  detail: string;
}

export interface InventoryIntelligence {
  generatedAt: string;
  parameters: AnalyticsQuery;
  summary: {
    materials: number;
    critical: number;
    reorder: number;
    ok: number;
    overstock: number;
    noDemand: number;
    inventoryValue: number;
    /** Value of forecast demand that current stock + open POs cannot cover within the lead time. */
    shortageValue: number;
    /** Value of stock held above max level / 90 days of forecast need. */
    excessStockValue: number;
    suggestedPurchaseValue: number;
    /** Demand-weighted mean of per-material hold-out errors. */
    forecastError: number | null;
  };
  abcXyzMatrix: Array<{ abc: AbcClass; xyz: XyzClass; count: number; value: number }>;
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
  qualityControl: PChart;
  insights: Insight[];
}

export interface PlantHealthComponent {
  key: 'inventory' | 'production' | 'quality' | 'safety' | 'workforce';
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface PlantHealth {
  generatedAt: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  components: PlantHealthComponent[];
  safetyQualityCorrelation: { r: number | null; departments: number; note: string };
  incidentsByType: Array<{ type: string; count: number }>;
  insights: Insight[];
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
  /** Open POs whose expected delivery date has passed. */
  overdueOpen: number;
  spend: number;
  /** % of delivered POs (with a promised date) delivered on time (+1 day grace). */
  onTimeRate: number | null;
  /** Mean lateness of late deliveries, in days. */
  averageDelayDays: number | null;
  leadTimeMeanDays: number | null;
  /** Coefficient of variation of actual lead time (lower = more predictable). */
  leadTimeCv: number | null;
  promisedLeadTimeDays: number | null;
  /** Actual mean lead time minus the promised lead time. */
  leadTimeDriftDays: number | null;
  /** % of finished POs that were delivered rather than cancelled. */
  fulfilmentRate: number | null;
  rating: number | null;
  score: number | null;
  /** Null until the supplier has enough deliveries to be graded fairly. */
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
