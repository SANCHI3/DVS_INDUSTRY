import { InventoryRepository } from '../repositories/inventory.repository';
import type {
  MaterialDto,
  MaterialListResult,
  StockTransactionDto,
  StockTransactionListResult,
  ScrapRecordDto,
  ScrapRecordListResult,
  InventoryStatistics,
  MaterialFilters,
  TransactionFilters,
  ScrapFilters,
  CreateMaterialData,
  UpdateMaterialData,
  StockAdjustmentData,
  CreateScrapRecordData,
  PartSpecDto,
  CreatePartSpecData,
} from '../interfaces';
import { ConflictError, NotFoundError, BadRequestError } from '../errors';
import { logger } from '../logger';

/**
 * InventoryService — business rules:
 *  1. Material name must be unique (case-insensitive)
 *  2. Material code must be unique (uppercase)
 *  3. OUT / SCRAP transactions cannot exceed current stock
 *  4. Cannot modify deleted materials
 *  5. Soft-delete only — no hard deletes
 *  6. Scrap recording also creates a SCRAP stock transaction (stock deducted)
 */
export class InventoryService {
  private readonly repo: InventoryRepository;

  constructor() {
    this.repo = new InventoryRepository();
  }

  // ══ MATERIALS ═══════════════════════════════════════════════════════════════

  async createMaterial(data: CreateMaterialData): Promise<MaterialDto> {
    // Rule 1 — unique name
    const nameConflict = await this.repo.findMaterialByName(data.name);
    if (nameConflict !== null) {
      throw new ConflictError(`A material named "${data.name}" already exists`);
    }

    // Rule 2 — unique code
    const codeConflict = await this.repo.findMaterialByCode(data.code);
    if (codeConflict !== null) {
      throw new ConflictError(`A material with code "${data.code}" already exists`);
    }

    const material = await this.repo.createMaterial(data);
    logger.info('Material created', { id: material.id, code: material.code });
    return material;
  }

  async updateMaterial(id: number, data: UpdateMaterialData): Promise<MaterialDto> {
    const existing = await this.getByIdOrThrow(id);

    if (existing.deletedAt !== null) {
      throw new BadRequestError('Cannot update a deleted material. Restore it first.');
    }

    // Name uniqueness check
    if (data.name !== undefined && data.name !== existing.name) {
      const conflict = await this.repo.findMaterialByName(data.name);
      if (conflict !== null && conflict.id !== id) {
        throw new ConflictError(`A material named "${data.name}" already exists`);
      }
    }

    const updated = await this.repo.updateMaterial(id, data);
    logger.info('Material updated', { id });
    return updated;
  }

  async getMaterialById(id: number): Promise<MaterialDto> {
    return this.getByIdOrThrow(id);
  }

  async getAllMaterials(filters: MaterialFilters): Promise<MaterialListResult> {
    return this.repo.findAllMaterials(filters);
  }

  async softDeleteMaterial(id: number): Promise<MaterialDto> {
    const existing = await this.getByIdOrThrow(id);
    if (existing.deletedAt !== null) {
      throw new BadRequestError('Material is already deleted');
    }
    const deleted = await this.repo.softDeleteMaterial(id);
    logger.info('Material soft-deleted', { id });
    return deleted;
  }

  async restoreMaterial(id: number): Promise<MaterialDto> {
    const existing = await this.getByIdOrThrow(id);
    if (existing.deletedAt === null) {
      throw new BadRequestError('Material is not deleted — nothing to restore');
    }

    // Check code conflict before restore
    const codeConflict = await this.repo.findMaterialByCode(existing.code);
    if (codeConflict !== null && codeConflict.id !== id && codeConflict.isActive) {
      throw new ConflictError(
        `Cannot restore: another active material already uses code "${existing.code}"`,
      );
    }

    const restored = await this.repo.restoreMaterial(id);
    logger.info('Material restored', { id });
    return restored;
  }

  // ══ STOCK TRANSACTIONS ════════════════════════════════════════════════════

  async adjustStock(data: StockAdjustmentData): Promise<StockTransactionDto> {
    // Existence, deletion and sufficient-stock checks happen inside the
    // repository transaction while the material row is locked, so two
    // concurrent withdrawals can never both pass a stale check.
    const txn = await this.repo.recordTransaction(data);
    logger.info('Stock transaction recorded', {
      materialId: data.materialId,
      type: data.type,
      qty: data.quantity,
    });
    return txn;
  }

  async getTransactions(filters: TransactionFilters): Promise<StockTransactionListResult> {
    return this.repo.findTransactions(filters);
  }

  async getMaterialTransactions(materialId: number): Promise<StockTransactionDto[]> {
    await this.getByIdOrThrow(materialId);
    return this.repo.findTransactionsByMaterial(materialId);
  }

  // ══ SCRAP RECORDS ═════════════════════════════════════════════════════════

  /**
   * Records scrap AND deducts stock in one operation.
   * Creates:  1 ScrapRecord  +  1 StockTransaction (type=SCRAP)
   */
  async recordScrap(data: CreateScrapRecordData): Promise<ScrapRecordDto> {
    // Stock deduction and scrap record are written in one transaction
    const scrap = await this.repo.recordScrapWithStock(data, {
      materialId: data.materialId,
      type: 'SCRAP',
      quantity: data.quantity,
      reason: data.reason ?? 'Scrap recorded',
      departmentId: data.departmentId ?? null,
      departmentName: data.departmentName ?? null,
      performedById: data.employeeId ?? null,
      performedByName: data.employeeName ?? null,
    });
    logger.info('Scrap recorded', {
      materialId: data.materialId,
      qty: data.quantity,
      dept: data.departmentName,
    });
    return scrap;
  }

  async getScrapRecords(filters: ScrapFilters): Promise<ScrapRecordListResult> {
    return this.repo.findScrapRecords(filters);
  }

  // ══ STATISTICS ═══════════════════════════════════════════════════════════

  async getStatistics(): Promise<InventoryStatistics> {
    return this.repo.getStatistics();
  }

  // ══ PART SPECS ═══════════════════════════════════════════════════════════

  async getPartSpecs(): Promise<PartSpecDto[]> {
    return this.repo.findPartSpecs();
  }

  async createPartSpec(data: CreatePartSpecData): Promise<PartSpecDto> {
    const conflict = await this.repo.findPartSpecByNumber(data.partNumber);
    if (conflict !== null) {
      throw new ConflictError(`Part "${data.partNumber}" already exists`);
    }
    const part = await this.repo.createPartSpec(data);
    logger.info('Part spec created', { id: part.id, partNumber: part.partNumber });
    return part;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getByIdOrThrow(id: number): Promise<MaterialDto> {
    const material = await this.repo.findMaterialById(id);
    if (material === null) {
      throw new NotFoundError(`Material with id ${id} not found`);
    }
    return material;
  }
}
