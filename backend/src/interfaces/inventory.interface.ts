// ── Inventory domain interfaces ──────────────────────────────────────────────
// Pure domain objects — zero Prisma imports.

// ── Enums ─────────────────────────────────────────────────────────────────────

export type StockTransactionType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'SCRAP' | 'RETURN';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface MaterialDto {
  id: number;
  name: string;
  code: string;
  description: string | null;
  unit: string;
  category: string | null;
  location: string | null;
  currentStock: string; // Decimal → string
  minStockLevel: string;
  maxStockLevel: string | null;
  costPerUnit: string | null;
  currency: string;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isLowStock?: boolean; // computed: currentStock <= minStockLevel
}

export interface StockTransactionDto {
  id: number;
  materialId: number;
  materialName: string;
  materialCode: string;
  type: StockTransactionType;
  quantity: string;
  balanceAfter: string;
  referenceNo: string | null;
  reason: string | null;
  performedById: number | null;
  performedByName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  createdAt: Date;
}

export interface ScrapRecordDto {
  id: number;
  materialId: number;
  materialName: string;
  materialCode: string;
  quantity: string;
  unit: string;
  departmentId: number | null;
  departmentName: string | null;
  employeeId: number | null;
  employeeName: string | null;
  reason: string | null;
  recoveryValue: string | null;
  recordedAt: Date;
  createdAt: Date;
}

// ── List results ──────────────────────────────────────────────────────────────

export interface MaterialListResult {
  data: MaterialDto[];
  total: number;
}

export interface StockTransactionListResult {
  data: StockTransactionDto[];
  total: number;
}

export interface ScrapRecordListResult {
  data: ScrapRecordDto[];
  total: number;
}

// ── Statistics ────────────────────────────────────────────────────────────────

export interface InventoryStatistics {
  totalMaterials: number;
  activeMaterials: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalStockValue: string; // sum of currentStock * costPerUnit
  totalTransactionsToday: number;
  totalScrapThisMonth: string; // total kg / units scrapped
  scrapValueThisMonth: string; // estimated ₹ recovery
  byCategory: Array<{ category: string; count: number; stockValue: string }>;
  recentTransactions: StockTransactionDto[];
  lowStockMaterials: MaterialDto[];
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface MaterialFilters {
  search?: string | undefined;
  category?: string | undefined;
  status?: 'active' | 'inactive' | 'all' | undefined;
  lowStockOnly?: boolean | undefined;
  sortBy?: 'name' | 'code' | 'currentStock' | 'createdAt' | 'updatedAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface TransactionFilters {
  materialId?: number | undefined;
  type?: StockTransactionType | undefined;
  departmentId?: number | undefined;
  referenceNo?: string | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ScrapFilters {
  materialId?: number | undefined;
  departmentId?: number | undefined;
  employeeId?: number | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateMaterialData {
  name: string;
  code: string;
  description?: string | null | undefined;
  unit: string;
  category?: string | null | undefined;
  location?: string | null | undefined;
  minStockLevel?: string | undefined;
  maxStockLevel?: string | null | undefined;
  costPerUnit?: string | null | undefined;
  currency?: string | undefined;
}

export interface UpdateMaterialData {
  name?: string | undefined;
  description?: string | null | undefined;
  unit?: string | undefined;
  category?: string | null | undefined;
  location?: string | null | undefined;
  minStockLevel?: string | undefined;
  maxStockLevel?: string | null | undefined;
  costPerUnit?: string | null | undefined;
  currency?: string | undefined;
}

export interface StockAdjustmentData {
  materialId: number;
  type: StockTransactionType;
  quantity: string;
  referenceNo?: string | null | undefined;
  reason?: string | null | undefined;
  performedById?: number | null | undefined;
  performedByName?: string | null | undefined;
  departmentId?: number | null | undefined;
  departmentName?: string | null | undefined;
}

export interface CreateScrapRecordData {
  materialId: number;
  quantity: string;
  unit: string;
  departmentId?: number | null | undefined;
  departmentName?: string | null | undefined;
  employeeId?: number | null | undefined;
  employeeName?: string | null | undefined;
  reason?: string | null | undefined;
  recoveryValue?: string | null | undefined;
  recordedAt?: Date | undefined;
}

export interface PartSpecDto {
  id: number;
  partNumber: string;
  rmGrade: string;
  thicknessMm: string;
  stripSize: string;
  piecesPerStrip: number | null;
  piecesPerSheet: number | null;
  sheetSize: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartSpecData {
  partNumber: string;
  rmGrade: string;
  thicknessMm: string;
  stripSize: string;
  piecesPerStrip?: number | null | undefined;
  piecesPerSheet?: number | null | undefined;
  sheetSize: string;
  notes?: string | null | undefined;
}
