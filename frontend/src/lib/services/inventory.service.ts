import api, { unwrap, unwrapPaged, type PaginatedMeta } from '../api';

export interface MaterialDto {
  id:            number;
  name:          string;
  code:          string;
  description:   string | null;
  unit:          string;
  category:      string | null;
  location:      string | null;
  currentStock:  string;
  minStockLevel: string;
  maxStockLevel: string | null;
  costPerUnit:   string | null;
  currency:      string;
  isActive:      boolean;
  isLowStock?:   boolean;
  createdAt:     string;
  updatedAt:     string;
}

export interface StockTransactionDto {
  id:              number;
  materialId:      number;
  materialName:    string;
  materialCode:    string;
  type:            string;
  quantity:        string;
  balanceAfter:    string;
  referenceNo:     string | null;
  reason:          string | null;
  performedByName: string | null;
  departmentName:  string | null;
  createdAt:       string;
}

export interface ScrapRecordDto {
  id:             number;
  materialId:     number;
  materialName:   string;
  quantity:       string;
  unit:           string;
  departmentName: string | null;
  employeeName:   string | null;
  reason:         string | null;
  recoveryValue:  string | null;
  recordedAt:     string;
}

export interface PartSpecDto {
  id:             number;
  partNumber:     string;
  rmGrade:        string;
  thicknessMm:    string;
  stripSize:      string;
  piecesPerStrip: number | null;
  piecesPerSheet: number | null;
  sheetSize:      string;
  notes:          string | null;
  createdAt:      string;
  updatedAt:      string;
}

export interface InventoryStatistics {
  totalMaterials:         number;
  activeMaterials:        number;
  lowStockCount:          number;
  outOfStockCount:        number;
  totalStockValue:        string;
  totalTransactionsToday: number;
  totalScrapThisMonth:    string;
  scrapValueThisMonth:    string;
  byCategory:             Array<{ category: string; count: number; stockValue: string }>;
  recentTransactions:     StockTransactionDto[];
  lowStockMaterials:      MaterialDto[];
}

export interface MaterialQuery {
  page?: number; pageSize?: number;
  search?: string; category?: string;
  status?: 'active' | 'inactive' | 'all';
  lowStockOnly?: boolean;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
}

export async function getMaterials(params?: MaterialQuery) {
  const res = await api.get<{ success: true; data: MaterialDto[]; meta: PaginatedMeta }>('/inventory', { params });
  return unwrapPaged(res);
}

export async function getMaterialById(id: number): Promise<MaterialDto> {
  const res = await api.get<{ success: true; data: MaterialDto }>(`/inventory/${id}`);
  return unwrap(res);
}

export async function createMaterial(payload: Record<string, unknown>): Promise<MaterialDto> {
  const res = await api.post<{ success: true; data: MaterialDto }>('/inventory', payload);
  return unwrap(res);
}

export async function updateMaterial(id: number, payload: Record<string, unknown>): Promise<MaterialDto> {
  const res = await api.patch<{ success: true; data: MaterialDto }>(`/inventory/${id}`, payload);
  return unwrap(res);
}

export async function deleteMaterial(id: number): Promise<void> {
  await api.delete(`/inventory/${id}`);
}

export async function adjustStock(materialId: number, payload: {
  type: string; quantity: string;
  referenceNo?: string | null; reason?: string | null;
  performedByName?: string | null; departmentName?: string | null;
}): Promise<StockTransactionDto> {
  const res = await api.post<{ success: true; data: StockTransactionDto }>(`/inventory/${materialId}/stock`, payload);
  return unwrap(res);
}

export async function getTransactions(params?: {
  page?: number; pageSize?: number;
  materialId?: number; type?: string;
  fromDate?: string; toDate?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  const res = await api.get<{ success: true; data: StockTransactionDto[]; meta: PaginatedMeta }>('/inventory/transactions', { params });
  return unwrapPaged(res);
}

export async function getScrapRecords(params?: {
  page?: number; pageSize?: number;
  materialId?: number; departmentId?: number;
  fromDate?: string; toDate?: string;
}) {
  const res = await api.get<{ success: true; data: ScrapRecordDto[]; meta: PaginatedMeta }>('/inventory/scrap', { params });
  return unwrapPaged(res);
}

export async function createScrapRecord(payload: Record<string, unknown>): Promise<ScrapRecordDto> {
  const res = await api.post<{ success: true; data: ScrapRecordDto }>('/inventory/scrap', payload);
  return unwrap(res);
}

export async function getInventoryStats(): Promise<InventoryStatistics> {
  const res = await api.get<{ success: true; data: InventoryStatistics }>('/inventory/statistics');
  return unwrap(res);
}

export async function getPartSpecs(): Promise<PartSpecDto[]> {
  const res = await api.get<{ success: true; data: PartSpecDto[] }>('/inventory/parts');
  return unwrap(res);
}

export async function createPartSpec(payload: {
  partNumber: string; rmGrade: string; thicknessMm: string;
  stripSize: string; sheetSize: string;
  piecesPerStrip?: number | null; piecesPerSheet?: number | null;
  notes?: string | null;
}): Promise<PartSpecDto> {
  const res = await api.post<{ success: true; data: PartSpecDto }>('/inventory/parts', payload);
  return unwrap(res);
}
