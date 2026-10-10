import { Prisma } from '@prisma/client';
import { NotFoundError, BadRequestError } from '../errors';
import { prisma } from '../lib/prismaClient';
import type {
  MaterialDto,
  StockTransactionDto,
  ScrapRecordDto,
  MaterialListResult,
  StockTransactionListResult,
  ScrapRecordListResult,
  InventoryStatistics,
  MaterialFilters,
  TransactionFilters,
  ScrapFilters,
  CreateMaterialData,
  UpdateMaterialData,
  StockAdjustmentData,
  CreateScrapRecordData,
  StockTransactionType,
} from '../interfaces';

// ── Select shapes ─────────────────────────────────────────────────────────────

const materialSelect = {
  id: true,
  name: true,
  code: true,
  description: true,
  unit: true,
  category: true,
  location: true,
  currentStock: true,
  minStockLevel: true,
  maxStockLevel: true,
  costPerUnit: true,
  currency: true,
  isActive: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const transactionSelect = {
  id: true,
  materialId: true,
  type: true,
  quantity: true,
  balanceAfter: true,
  referenceNo: true,
  reason: true,
  performedById: true,
  performedByName: true,
  departmentId: true,
  departmentName: true,
  createdAt: true,
  material: { select: { name: true, code: true } },
} as const;

const scrapSelect = {
  id: true,
  materialId: true,
  quantity: true,
  unit: true,
  departmentId: true,
  departmentName: true,
  employeeId: true,
  employeeName: true,
  reason: true,
  recoveryValue: true,
  recordedAt: true,
  createdAt: true,
  material: { select: { name: true, code: true } },
} as const;

// ── Converters ────────────────────────────────────────────────────────────────

type PrismaMaterial = Prisma.MaterialGetPayload<{ select: typeof materialSelect }>;
type PrismaTransaction = Prisma.StockTransactionGetPayload<{ select: typeof transactionSelect }>;
type PrismaScrap = Prisma.ScrapRecordGetPayload<{ select: typeof scrapSelect }>;

function toMaterialDto(r: PrismaMaterial): MaterialDto {
  return {
    ...r,
    currentStock: r.currentStock.toString(),
    minStockLevel: r.minStockLevel.toString(),
    maxStockLevel: r.maxStockLevel?.toString() ?? null,
    costPerUnit: r.costPerUnit?.toString() ?? null,
    isLowStock: r.currentStock.lessThanOrEqualTo(r.minStockLevel),
  };
}

function toTransactionDto(r: PrismaTransaction): StockTransactionDto {
  return {
    id: r.id,
    materialId: r.materialId,
    materialName: r.material.name,
    materialCode: r.material.code,
    type: r.type as StockTransactionType,
    quantity: r.quantity.toString(),
    balanceAfter: r.balanceAfter.toString(),
    referenceNo: r.referenceNo,
    reason: r.reason,
    performedById: r.performedById,
    performedByName: r.performedByName,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    createdAt: r.createdAt,
  };
}

function toScrapDto(r: PrismaScrap): ScrapRecordDto {
  return {
    id: r.id,
    materialId: r.materialId,
    materialName: r.material.name,
    materialCode: r.material.code,
    quantity: r.quantity.toString(),
    unit: r.unit,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    reason: r.reason,
    recoveryValue: r.recoveryValue?.toString() ?? null,
    recordedAt: r.recordedAt,
    createdAt: r.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

// -- Stock movement helpers ---------------------------------------------------

function scrapCreateData(data: CreateScrapRecordData): Prisma.ScrapRecordUncheckedCreateInput {
  return {
    materialId: data.materialId,
    quantity: data.quantity,
    unit: data.unit,
    departmentId: data.departmentId ?? null,
    departmentName: data.departmentName ?? null,
    employeeId: data.employeeId ?? null,
    employeeName: data.employeeName ?? null,
    reason: data.reason ?? null,
    recoveryValue: data.recoveryValue ?? null,
    recordedAt: data.recordedAt ?? new Date(),
  };
}

/** Signed change in stock for a movement. ADJUSTMENT quantities carry their own sign. */
export function stockDelta(type: StockTransactionType, quantity: string): Prisma.Decimal {
  const qty = new Prisma.Decimal(quantity);
  if (type === 'IN' || type === 'ADJUSTMENT') return qty;
  return qty.negated(); // OUT, SCRAP, RETURN (to supplier) deduct stock
}

async function applyStockMovement(tx: Prisma.TransactionClient, data: StockAdjustmentData) {
  const rows = await tx.$queryRaw<{ currentStock: string; unit: string; deletedAt: Date | null }[]>`
    SELECT "currentStock"::text AS "currentStock", "unit", "deletedAt"
      FROM "Material"
     WHERE "id" = ${data.materialId}
       FOR UPDATE`;

  const material = rows[0];
  if (material === undefined) {
    throw new NotFoundError(`Material with id ${data.materialId} not found`);
  }
  if (material.deletedAt !== null) {
    throw new BadRequestError('Cannot adjust stock of a deleted material');
  }

  const delta = stockDelta(data.type, data.quantity);
  const current = new Prisma.Decimal(material.currentStock);
  const next = current.plus(delta);
  if (next.isNegative()) {
    throw new BadRequestError(
      `Insufficient stock. Available: ${current.toString()} ${material.unit}, ` +
        `requested change: ${delta.toString()} ${material.unit}`,
    );
  }

  await tx.material.update({
    where: { id: data.materialId },
    data: { currentStock: next },
  });

  return tx.stockTransaction.create({
    data: {
      materialId: data.materialId,
      type: data.type,
      quantity: data.quantity,
      balanceAfter: next,
      referenceNo: data.referenceNo ?? null,
      reason: data.reason ?? null,
      performedById: data.performedById ?? null,
      performedByName: data.performedByName ?? null,
      departmentId: data.departmentId ?? null,
      departmentName: data.departmentName ?? null,
    },
    select: transactionSelect,
  });
}

export class InventoryRepository {
  // ══ MATERIALS ═══════════════════════════════════════════════════════════════

  async createMaterial(data: CreateMaterialData): Promise<MaterialDto> {
    const raw = await prisma.material.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description ?? null,
        unit: data.unit,
        category: data.category ?? null,
        location: data.location ?? null,
        minStockLevel: data.minStockLevel ?? '0',
        maxStockLevel: data.maxStockLevel ?? null,
        costPerUnit: data.costPerUnit ?? null,
        currency: data.currency ?? 'INR',
      },
      select: materialSelect,
    });
    return toMaterialDto(raw);
  }

  async updateMaterial(id: number, data: UpdateMaterialData): Promise<MaterialDto> {
    const update: Prisma.MaterialUpdateInput = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.unit !== undefined) update.unit = data.unit;
    if (data.category !== undefined) update.category = data.category;
    if (data.location !== undefined) update.location = data.location;
    if (data.minStockLevel !== undefined) update.minStockLevel = data.minStockLevel;
    if (data.maxStockLevel !== undefined) update.maxStockLevel = data.maxStockLevel;
    if (data.costPerUnit !== undefined) update.costPerUnit = data.costPerUnit;
    if (data.currency !== undefined) update.currency = data.currency;

    const raw = await prisma.material.update({
      where: { id },
      data: update,
      select: materialSelect,
    });
    return toMaterialDto(raw);
  }

  async findMaterialById(id: number): Promise<MaterialDto | null> {
    const raw = await prisma.material.findUnique({
      where: { id },
      select: materialSelect,
    });
    return raw !== null ? toMaterialDto(raw) : null;
  }

  async findMaterialByCode(code: string): Promise<MaterialDto | null> {
    const raw = await prisma.material.findUnique({
      where: { code },
      select: materialSelect,
    });
    return raw !== null ? toMaterialDto(raw) : null;
  }

  async findMaterialByName(name: string): Promise<MaterialDto | null> {
    const raw = await prisma.material.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: materialSelect,
    });
    return raw !== null ? toMaterialDto(raw) : null;
  }

  async findAllMaterials(filters: MaterialFilters): Promise<MaterialListResult> {
    const {
      search,
      category,
      status = 'active',
      lowStockOnly = false,
      sortBy = 'name',
      sortOrder = 'asc',
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.MaterialWhereInput = {};

    if (status === 'active') {
      where.isActive = true;
      where.deletedAt = null;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    if (category !== undefined && category.trim() !== '') {
      where.category = { equals: category.trim(), mode: 'insensitive' };
    }

    if (search !== undefined && search.trim() !== '') {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { code: { contains: search.trim(), mode: 'insensitive' } },
        { category: { contains: search.trim(), mode: 'insensitive' } },
        { location: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    // Low-stock filter: currentStock <= minStockLevel
    // Prisma supports column comparisons via raw where with Prisma's field refs
    if (lowStockOnly) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          currentStock: { lte: prisma.material.fields.minStockLevel },
        } as unknown as Prisma.MaterialWhereInput,
      ];
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;
    const orderBy: Prisma.MaterialOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [raws, total] = await prisma.$transaction([
      prisma.material.findMany({ where, select: materialSelect, orderBy, skip, take }),
      prisma.material.count({ where }),
    ]);

    // Apply lowStockOnly in JS if Prisma field ref doesn't work for this DB
    let data = raws.map(toMaterialDto);
    if (lowStockOnly) {
      data = data.filter((m) => parseFloat(m.currentStock) <= parseFloat(m.minStockLevel));
    }

    return { data, total };
  }

  async softDeleteMaterial(id: number): Promise<MaterialDto> {
    const raw = await prisma.material.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
      select: materialSelect,
    });
    return toMaterialDto(raw);
  }

  async restoreMaterial(id: number): Promise<MaterialDto> {
    const raw = await prisma.material.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
      select: materialSelect,
    });
    return toMaterialDto(raw);
  }

  // ══ STOCK TRANSACTIONS ════════════════════════════════════════════════════

  /**
   * Records a stock movement atomically:
   *  1. Locks the material row (SELECT ... FOR UPDATE) so concurrent movements
   *     on the same material are serialised - no lost updates
   *  2. Computes the new level with exact decimal arithmetic
   *  3. Rejects movements that would take stock below zero
   *  4. Updates Material.currentStock and inserts the StockTransaction
   *     (and, for scrap, the ScrapRecord) in the same DB transaction
   */
  async recordTransaction(data: StockAdjustmentData): Promise<StockTransactionDto> {
    const txn = await prisma.$transaction((tx) => applyStockMovement(tx, data));
    return toTransactionDto(txn);
  }

  /** Deducts scrap from stock and records it, all-or-nothing. */
  async recordScrapWithStock(
    data: CreateScrapRecordData,
    movement: StockAdjustmentData,
  ): Promise<ScrapRecordDto> {
    const raw = await prisma.$transaction(async (tx) => {
      await applyStockMovement(tx, movement);
      return tx.scrapRecord.create({ data: scrapCreateData(data), select: scrapSelect });
    });
    return toScrapDto(raw);
  }

  async findTransactions(filters: TransactionFilters): Promise<StockTransactionListResult> {
    const {
      materialId,
      type,
      departmentId,
      referenceNo,
      fromDate,
      toDate,
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.StockTransactionWhereInput = {};

    if (materialId !== undefined) where.materialId = materialId;
    if (type !== undefined) where.type = type;
    if (departmentId !== undefined) where.departmentId = departmentId;
    if (referenceNo !== undefined && referenceNo.trim() !== '') {
      where.referenceNo = { contains: referenceNo.trim(), mode: 'insensitive' };
    }
    if (fromDate !== undefined || toDate !== undefined) {
      where.createdAt = {};
      if (fromDate !== undefined) where.createdAt.gte = fromDate;
      if (toDate !== undefined) where.createdAt.lte = toDate;
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const [raws, total] = await prisma.$transaction([
      prisma.stockTransaction.findMany({
        where,
        select: transactionSelect,
        orderBy: { createdAt: sortOrder },
        skip,
        take,
      }),
      prisma.stockTransaction.count({ where }),
    ]);

    return { data: raws.map(toTransactionDto), total };
  }

  async findTransactionsByMaterial(materialId: number): Promise<StockTransactionDto[]> {
    const raws = await prisma.stockTransaction.findMany({
      where: { materialId },
      select: transactionSelect,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return raws.map(toTransactionDto);
  }

  // ══ SCRAP RECORDS ═════════════════════════════════════════════════════════

  async createScrapRecord(data: CreateScrapRecordData): Promise<ScrapRecordDto> {
    const raw = await prisma.scrapRecord.create({
      data: scrapCreateData(data),
      select: scrapSelect,
    });
    return toScrapDto(raw);
  }

  async findScrapRecords(filters: ScrapFilters): Promise<ScrapRecordListResult> {
    const {
      materialId,
      departmentId,
      employeeId,
      fromDate,
      toDate,
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.ScrapRecordWhereInput = {};

    if (materialId !== undefined) where.materialId = materialId;
    if (departmentId !== undefined) where.departmentId = departmentId;
    if (employeeId !== undefined) where.employeeId = employeeId;
    if (fromDate !== undefined || toDate !== undefined) {
      where.recordedAt = {};
      if (fromDate !== undefined) where.recordedAt.gte = fromDate;
      if (toDate !== undefined) where.recordedAt.lte = toDate;
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const [raws, total] = await prisma.$transaction([
      prisma.scrapRecord.findMany({
        where,
        select: scrapSelect,
        orderBy: { recordedAt: sortOrder },
        skip,
        take,
      }),
      prisma.scrapRecord.count({ where }),
    ]);

    return { data: raws.map(toScrapDto), total };
  }

  // ══ STATISTICS ═══════════════════════════════════════════════════════════

  async getStatistics(): Promise<InventoryStatistics> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [allMaterials, totalTransactionsToday, scrapThisMonth] = await prisma.$transaction([
      prisma.material.findMany({
        where: { deletedAt: null },
        select: materialSelect,
      }),
      prisma.stockTransaction.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      prisma.scrapRecord.findMany({
        where: { recordedAt: { gte: startOfMonth } },
        select: { quantity: true, recoveryValue: true },
      }),
    ]);

    const materials = allMaterials.map(toMaterialDto);
    const activeMaterials = materials.filter((m) => m.isActive);
    const lowStockMaterials = activeMaterials.filter(
      (m) => parseFloat(m.currentStock) <= parseFloat(m.minStockLevel),
    );
    const outOfStockCount = activeMaterials.filter((m) => parseFloat(m.currentStock) === 0).length;

    // Total stock value
    let totalStockValue = 0;
    for (const m of activeMaterials) {
      if (m.costPerUnit !== null) {
        totalStockValue += parseFloat(m.currentStock) * parseFloat(m.costPerUnit);
      }
    }

    // Scrap this month
    let totalScrapQty = 0;
    let totalScrapRecovery = 0;
    for (const s of scrapThisMonth) {
      totalScrapQty += s.quantity.toNumber();
      if (s.recoveryValue !== null) totalScrapRecovery += s.recoveryValue.toNumber();
    }

    // By category
    const categoryMap = new Map<string, { count: number; value: number }>();
    for (const m of activeMaterials) {
      const cat = m.category ?? 'Uncategorised';
      const entry = categoryMap.get(cat) ?? { count: 0, value: 0 };
      entry.count++;
      if (m.costPerUnit !== null) {
        entry.value += parseFloat(m.currentStock) * parseFloat(m.costPerUnit);
      }
      categoryMap.set(cat, entry);
    }
    const byCategory = Array.from(categoryMap.entries()).map(([category, v]) => ({
      category,
      count: v.count,
      stockValue: v.value.toFixed(2),
    }));

    // Recent transactions
    const recentTxnRaws = await prisma.stockTransaction.findMany({
      select: transactionSelect,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const recentTransactions = recentTxnRaws.map(toTransactionDto);

    return {
      totalMaterials: materials.length,
      activeMaterials: activeMaterials.length,
      lowStockCount: lowStockMaterials.length,
      outOfStockCount,
      totalStockValue: totalStockValue.toFixed(2),
      totalTransactionsToday,
      totalScrapThisMonth: totalScrapQty.toFixed(3),
      scrapValueThisMonth: totalScrapRecovery.toFixed(2),
      byCategory,
      recentTransactions,
      lowStockMaterials: lowStockMaterials.slice(0, 10),
    };
  }
}
