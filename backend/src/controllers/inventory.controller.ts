import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../types';
import { InventoryService } from '../services/inventory.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import type {
  CreateMaterialInput,
  UpdateMaterialInput,
  MaterialQueryInput,
  StockAdjustmentInput,
  TransactionQueryInput,
  CreateScrapRecordInput,
  ScrapQueryInput,
} from '../validators/inventory.validator';
import type {
  MaterialFilters,
  UpdateMaterialData,
  TransactionFilters,
  ScrapFilters,
} from '../interfaces';

const inventoryService = new InventoryService();

function parseId(raw: string | string[] | undefined): number {
  return parseInt(String(raw ?? '0'), 10);
}

// ══ MATERIALS ═════════════════════════════════════════════════════════════════

export async function createMaterial(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateMaterialInput;
  const material = await inventoryService.createMaterial({
    name: body.name,
    code: body.code,
    description: body.description ?? null,
    unit: body.unit,
    category: body.category ?? null,
    location: body.location ?? null,
    minStockLevel: body.minStockLevel,
    maxStockLevel: body.maxStockLevel ?? null,
    costPerUnit: body.costPerUnit ?? null,
    currency: body.currency,
  });
  sendCreated(res, material, 'Material created successfully');
}

export async function getAllMaterials(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as MaterialQueryInput;

  const filters: MaterialFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
    status: q.status,
    lowStockOnly: q.lowStockOnly,
  };
  if (q.search !== undefined) filters.search = q.search;
  if (q.category !== undefined) filters.category = q.category;

  const { data, total } = await inventoryService.getAllMaterials(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;

  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getMaterialById(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const material = await inventoryService.getMaterialById(id);
  sendSuccess(res, material);
}

export async function updateMaterial(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as UpdateMaterialInput;

  const data: UpdateMaterialData = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.category !== undefined) data.category = body.category;
  if (body.location !== undefined) data.location = body.location;
  if (body.minStockLevel !== undefined) data.minStockLevel = body.minStockLevel;
  if (body.maxStockLevel !== undefined) data.maxStockLevel = body.maxStockLevel;
  if (body.costPerUnit !== undefined) data.costPerUnit = body.costPerUnit;
  if (body.currency !== undefined) data.currency = body.currency;

  const material = await inventoryService.updateMaterial(id, data);
  sendSuccess(res, material, 200, 'Material updated successfully');
}

export async function deleteMaterial(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  await inventoryService.softDeleteMaterial(id);
  sendNoContent(res);
}

export async function restoreMaterial(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const material = await inventoryService.restoreMaterial(id);
  sendSuccess(res, material, 200, 'Material restored successfully');
}

// ══ STOCK TRANSACTIONS ════════════════════════════════════════════════════════

export async function adjustStock(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as StockAdjustmentInput;

  const txn = await inventoryService.adjustStock({
    materialId: id,
    type: body.type,
    quantity: body.quantity,
    referenceNo: body.referenceNo ?? null,
    reason: body.reason ?? null,
    performedById: req.user?.id ?? null,
    performedByName: req.user?.fullName ?? body.performedByName ?? null,
    departmentId: body.departmentId ?? null,
    departmentName: body.departmentName ?? null,
  });
  sendCreated(res, txn, 'Stock transaction recorded successfully');
}

export async function getMaterialTransactions(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const transactions = await inventoryService.getMaterialTransactions(id);
  sendSuccess(res, transactions);
}

export async function getAllTransactions(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as TransactionQueryInput;

  const filters: TransactionFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortOrder: q.sortOrder,
  };
  if (q.materialId !== undefined) filters.materialId = q.materialId;
  if (q.type !== undefined) filters.type = q.type;
  if (q.departmentId !== undefined) filters.departmentId = q.departmentId;
  if (q.referenceNo !== undefined) filters.referenceNo = q.referenceNo;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await inventoryService.getTransactions(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;

  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

// ══ SCRAP RECORDS ══════════════════════════════════════════════════════════════

export async function recordScrap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as CreateScrapRecordInput;

  const scrap = await inventoryService.recordScrap({
    materialId: body.materialId,
    quantity: body.quantity,
    unit: body.unit,
    departmentId: body.departmentId ?? null,
    departmentName: body.departmentName ?? null,
    employeeId: body.employeeId ?? null,
    employeeName: body.employeeName ?? null,
    reason: body.reason ?? null,
    recoveryValue: body.recoveryValue ?? null,
    recordedAt: body.recordedAt,
  });
  sendCreated(res, scrap, 'Scrap recorded successfully');
}

export async function getScrapRecords(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ScrapQueryInput;

  const filters: ScrapFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortOrder: q.sortOrder,
  };
  if (q.materialId !== undefined) filters.materialId = q.materialId;
  if (q.departmentId !== undefined) filters.departmentId = q.departmentId;
  if (q.employeeId !== undefined) filters.employeeId = q.employeeId;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await inventoryService.getScrapRecords(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;

  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

// ══ STATISTICS ══════════════════════════════════════════════════════════════════

export async function getStatistics(_req: Request, res: Response): Promise<void> {
  const stats = await inventoryService.getStatistics();
  sendSuccess(res, stats);
}
