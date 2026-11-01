import { OrdersRepository } from '../repositories/orders.repository';
import type {
  SupplierDto,
  ClientDto,
  ClientOrderDto,
  ClientOrderDetail,
  PurchaseOrderDto,
  SupplierListResult,
  ClientListResult,
  ClientOrderListResult,
  PurchaseOrderListResult,
  OrdersStatistics,
  SupplierFilters,
  ClientFilters,
  ClientOrderFilters,
  PurchaseOrderFilters,
  CreateSupplierData,
  UpdateSupplierData,
  CreateClientData,
  UpdateClientData,
  CreateClientOrderData,
  UpdateClientOrderData,
  DispatchOrderData,
  CreatePurchaseOrderData,
  UpdatePurchaseOrderData,
} from '../interfaces';
import { ConflictError, NotFoundError, BadRequestError, ValidationError } from '../errors';
import { logger } from '../logger';

/**
 * OrdersService — business rules:
 *
 * Supplier/Client:
 *  1. Name + code must be unique
 *  2. Soft-delete / restore with conflict detection
 *
 * Client Orders:
 *  3. Client must exist and be active
 *  4. Status transitions enforced:
 *     PENDING → APPROVED → IN_PRODUCTION → DISPATCHED → DELIVERED
 *     Any → CANCELLED (if not yet DELIVERED)
 *  5. Dispatch generates challan/invoice numbers if not provided
 *
 * Purchase Orders:
 *  6. Supplier must exist and be active
 *  7. Status transitions:
 *     PENDING → CONFIRMED → IN_TRANSIT → DELIVERED
 *     Any → CANCELLED (if not yet DELIVERED)
 */
/** Midnight UTC of the day `d` falls on: dates are compared by calendar day. */
function dayOf(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * A required-by or expected-delivery date cannot be before the order date
 * (e.g. PO-TEST-001: expected 15 Sept, ordered 25 Sept). Same day is fine.
 */
export function assertNotBeforeOrderDate(
  date: Date | null | undefined,
  orderDate: Date,
  field: string,
  label: string,
): void {
  if (date == null || dayOf(date) >= dayOf(orderDate)) return;
  const shown = orderDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  throw new ValidationError(`${label} cannot be before the order date`, [
    { field, message: `${label} cannot be before the order date (${shown})` },
  ]);
}

export class OrdersService {
  private readonly repo: OrdersRepository;

  constructor() {
    this.repo = new OrdersRepository();
  }

  // ══ SUPPLIERS ════════════════════════════════════════════════════════════════

  async createSupplier(data: CreateSupplierData): Promise<SupplierDto> {
    const nameConflict = await this.repo.findSupplierByName(data.name);
    if (nameConflict !== null) {
      throw new ConflictError(`Supplier "${data.name}" already exists`);
    }
    const codeConflict = await this.repo.findSupplierByCode(data.code);
    if (codeConflict !== null) {
      throw new ConflictError(`Supplier code "${data.code}" already in use`);
    }
    const supplier = await this.repo.createSupplier(data);
    logger.info('Supplier created', { id: supplier.id, code: supplier.code });
    return supplier;
  }

  async updateSupplier(id: number, data: UpdateSupplierData): Promise<SupplierDto> {
    const existing = await this.getSupplierOrThrow(id);
    if (existing.deletedAt !== null) {
      throw new BadRequestError('Cannot update a deleted supplier');
    }
    if (data.name !== undefined && data.name !== existing.name) {
      const conflict = await this.repo.findSupplierByName(data.name);
      if (conflict !== null && conflict.id !== id) {
        throw new ConflictError(`Supplier "${data.name}" already exists`);
      }
    }
    const updated = await this.repo.updateSupplier(id, data);
    logger.info('Supplier updated', { id });
    return updated;
  }

  async getSupplierById(id: number): Promise<SupplierDto> {
    return this.getSupplierOrThrow(id);
  }

  async getAllSuppliers(filters: SupplierFilters): Promise<SupplierListResult> {
    return this.repo.findAllSuppliers(filters);
  }

  async deleteSupplier(id: number): Promise<SupplierDto> {
    const existing = await this.getSupplierOrThrow(id);
    if (existing.deletedAt !== null) {
      throw new BadRequestError('Supplier is already deleted');
    }
    const deleted = await this.repo.softDeleteSupplier(id);
    logger.info('Supplier soft-deleted', { id });
    return deleted;
  }

  async restoreSupplier(id: number): Promise<SupplierDto> {
    const existing = await this.getSupplierOrThrow(id);
    if (existing.deletedAt === null) {
      throw new BadRequestError('Supplier is not deleted — nothing to restore');
    }
    const codeConflict = await this.repo.findSupplierByCode(existing.code);
    if (codeConflict !== null && codeConflict.id !== id && codeConflict.isActive) {
      throw new ConflictError(
        `Cannot restore: code "${existing.code}" is used by another active supplier`,
      );
    }
    const restored = await this.repo.restoreSupplier(id);
    logger.info('Supplier restored', { id });
    return restored;
  }

  // ══ CLIENTS ══════════════════════════════════════════════════════════════════

  async createClient(data: CreateClientData): Promise<ClientDto> {
    const nameConflict = await this.repo.findClientByName(data.name);
    if (nameConflict !== null) {
      throw new ConflictError(`Client "${data.name}" already exists`);
    }
    const codeConflict = await this.repo.findClientByCode(data.code);
    if (codeConflict !== null) {
      throw new ConflictError(`Client code "${data.code}" already in use`);
    }
    const client = await this.repo.createClient(data);
    logger.info('Client created', { id: client.id, code: client.code });
    return client;
  }

  async updateClient(id: number, data: UpdateClientData): Promise<ClientDto> {
    const existing = await this.getClientOrThrow(id);
    if (existing.deletedAt !== null) {
      throw new BadRequestError('Cannot update a deleted client');
    }
    if (data.name !== undefined && data.name !== existing.name) {
      const conflict = await this.repo.findClientByName(data.name);
      if (conflict !== null && conflict.id !== id) {
        throw new ConflictError(`Client "${data.name}" already exists`);
      }
    }
    const updated = await this.repo.updateClient(id, data);
    logger.info('Client updated', { id });
    return updated;
  }

  async getClientById(id: number): Promise<ClientDto> {
    return this.getClientOrThrow(id);
  }

  async getSupplierByEmail(email: string): Promise<SupplierDto> {
    const supplier = await this.repo.findSupplierByEmail(email);
    if (supplier === null) {
      throw new NotFoundError('No supplier profile is linked to this account');
    }
    return supplier;
  }

  /**
   * The supplier a portal login belongs to: its linked supplier, or for
   * accounts created before the link existed, the supplier with its email.
   */
  async getSupplierForAccount(account: {
    email: string;
    supplierId?: number | null | undefined;
  }): Promise<SupplierDto> {
    if (account.supplierId != null) {
      const linked = await this.repo.findSupplierById(account.supplierId);
      if (linked !== null) return linked;
    }
    return this.getSupplierByEmail(account.email);
  }

  /** The client a portal login belongs to (linked id first, email as fallback). */
  async getClientForAccount(account: {
    email: string;
    clientId?: number | null | undefined;
  }): Promise<ClientDto> {
    if (account.clientId != null) {
      const linked = await this.repo.findClientById(account.clientId);
      if (linked !== null) return linked;
    }
    return this.getClientByEmail(account.email);
  }

  async getClientByEmail(email: string): Promise<ClientDto> {
    const client = await this.repo.findClientByEmail(email);
    if (client === null) throw new NotFoundError('No client profile is linked to this account');
    return client;
  }

  async getAllClients(filters: ClientFilters): Promise<ClientListResult> {
    return this.repo.findAllClients(filters);
  }

  async deleteClient(id: number): Promise<ClientDto> {
    const existing = await this.getClientOrThrow(id);
    if (existing.deletedAt !== null) {
      throw new BadRequestError('Client is already deleted');
    }
    const deleted = await this.repo.softDeleteClient(id);
    logger.info('Client soft-deleted', { id });
    return deleted;
  }

  async restoreClient(id: number): Promise<ClientDto> {
    const existing = await this.getClientOrThrow(id);
    if (existing.deletedAt === null) {
      throw new BadRequestError('Client is not deleted — nothing to restore');
    }
    const codeConflict = await this.repo.findClientByCode(existing.code);
    if (codeConflict !== null && codeConflict.id !== id && codeConflict.isActive) {
      throw new ConflictError(
        `Cannot restore: code "${existing.code}" is used by another active client`,
      );
    }
    const restored = await this.repo.restoreClient(id);
    logger.info('Client restored', { id });
    return restored;
  }

  // ══ CLIENT ORDERS ═════════════════════════════════════════════════════════════

  async createClientOrder(data: CreateClientOrderData): Promise<ClientOrderDto> {
    // Rule 3 — client must exist and be active
    const client = await this.repo.findClientById(data.clientId);
    if (client === null) {
      throw new NotFoundError(`Client with id ${data.clientId} not found`);
    }
    if (!client.isActive) {
      throw new BadRequestError('Cannot create order for an inactive client');
    }
    assertNotBeforeOrderDate(data.requiredDate, new Date(), 'requiredDate', 'Required-by date');
    const order = await this.repo.createClientOrder(data);
    logger.info('Client order created', {
      id: order.id,
      orderNumber: order.orderNumber,
    });
    return order;
  }

  async updateClientOrder(id: number, data: UpdateClientOrderData): Promise<ClientOrderDto> {
    const existing = await this.getClientOrderOrThrow(id);
    if (['DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(existing.status)) {
      throw new BadRequestError(`Cannot edit an order with status "${existing.status}"`);
    }
    assertNotBeforeOrderDate(
      data.requiredDate,
      existing.orderDate,
      'requiredDate',
      'Required-by date',
    );
    const updated = await this.repo.updateClientOrder(id, data);
    logger.info('Client order updated', { id });
    return updated;
  }

  async getClientOrderById(id: number): Promise<ClientOrderDto> {
    return this.getClientOrderOrThrow(id);
  }

  /** The order plus its linked work orders, for dispatch readiness and tracking. */
  async getClientOrderDetail(order: ClientOrderDto): Promise<ClientOrderDetail> {
    return { ...order, workOrders: await this.repo.findLinkedWorkOrders(order.id) };
  }

  async getAllClientOrders(filters: ClientOrderFilters): Promise<ClientOrderListResult> {
    return this.repo.findAllClientOrders(filters);
  }

  async approveClientOrder(id: number): Promise<ClientOrderDto> {
    const existing = await this.getClientOrderOrThrow(id);
    this.assertTransition(existing.status, 'APPROVED', ['PENDING']);
    const updated = await this.repo.updateClientOrderStatus(id, 'APPROVED', {
      approvedAt: new Date(),
    });
    logger.info('Client order approved', { id });
    return updated;
  }

  async markInProduction(id: number): Promise<ClientOrderDto> {
    const existing = await this.getClientOrderOrThrow(id);
    this.assertTransition(existing.status, 'IN_PRODUCTION', ['APPROVED']);
    const updated = await this.repo.updateClientOrderStatus(id, 'IN_PRODUCTION', {
      productionStartedAt: new Date(),
    });
    logger.info('Client order marked in-production', { id });
    return updated;
  }

  async dispatchClientOrder(id: number, data: DispatchOrderData): Promise<ClientOrderDto> {
    const existing = await this.getClientOrderOrThrow(id);
    this.assertTransition(existing.status, 'DISPATCHED', ['APPROVED', 'IN_PRODUCTION']);

    // Auto-generate reference numbers if not supplied
    const challan = data.challanNumber ?? `DC-${Date.now().toString().slice(-6)}`;
    const invoice = data.invoiceNumber ?? `INV-DVS-${Date.now().toString().slice(-5)}`;

    const updated = await this.repo.updateClientOrderStatus(id, 'DISPATCHED', {
      dispatchDate: new Date(),
      dispatchNote: data.dispatchNote ?? null,
      challanNumber: challan,
      invoiceNumber: invoice,
    });
    logger.info('Client order dispatched', {
      id,
      challan,
      invoice,
    });
    return updated;
  }

  async deliverClientOrder(id: number): Promise<ClientOrderDto> {
    const existing = await this.getClientOrderOrThrow(id);
    this.assertTransition(existing.status, 'DELIVERED', ['DISPATCHED']);
    const updated = await this.repo.updateClientOrderStatus(id, 'DELIVERED', {
      deliveryDate: new Date(),
    });
    logger.info('Client order delivered', { id });
    return updated;
  }

  async cancelClientOrder(id: number): Promise<ClientOrderDto> {
    const existing = await this.getClientOrderOrThrow(id);
    if (existing.status === 'DELIVERED') {
      throw new BadRequestError('Cannot cancel a delivered order');
    }
    if (existing.status === 'CANCELLED') {
      throw new BadRequestError('Order is already cancelled');
    }
    const updated = await this.repo.updateClientOrderStatus(id, 'CANCELLED');
    logger.info('Client order cancelled', { id });
    return updated;
  }

  // ══ PURCHASE ORDERS ═══════════════════════════════════════════════════════════

  async createPurchaseOrder(data: CreatePurchaseOrderData): Promise<PurchaseOrderDto> {
    // Rule 6 — supplier must exist and be active
    const supplier = await this.repo.findSupplierById(data.supplierId);
    if (supplier === null) {
      throw new NotFoundError(`Supplier with id ${data.supplierId} not found`);
    }
    if (!supplier.isActive) {
      throw new BadRequestError('Cannot create PO for an inactive supplier');
    }
    assertNotBeforeOrderDate(
      data.expectedDelivery,
      new Date(),
      'expectedDelivery',
      'Expected delivery',
    );
    const po = await this.repo.createPurchaseOrder(data);
    logger.info('Purchase order created', {
      id: po.id,
      poNumber: po.poNumber,
    });
    return po;
  }

  async updatePurchaseOrder(id: number, data: UpdatePurchaseOrderData): Promise<PurchaseOrderDto> {
    const existing = await this.getPurchaseOrderOrThrow(id);
    if (['DELIVERED', 'CANCELLED'].includes(existing.status)) {
      throw new BadRequestError(`Cannot edit a PO with status "${existing.status}"`);
    }
    assertNotBeforeOrderDate(
      data.expectedDelivery,
      existing.orderDate,
      'expectedDelivery',
      'Expected delivery',
    );
    const updated = await this.repo.updatePurchaseOrder(id, data);
    logger.info('Purchase order updated', { id });
    return updated;
  }

  async getPurchaseOrderById(id: number): Promise<PurchaseOrderDto> {
    return this.getPurchaseOrderOrThrow(id);
  }

  async getAllPurchaseOrders(filters: PurchaseOrderFilters): Promise<PurchaseOrderListResult> {
    return this.repo.findAllPurchaseOrders(filters);
  }

  async confirmPurchaseOrder(id: number): Promise<PurchaseOrderDto> {
    const existing = await this.getPurchaseOrderOrThrow(id);
    this.assertPOTransition(existing.status, 'CONFIRMED', ['PENDING']);
    const updated = await this.repo.updatePurchaseOrderStatus(id, 'CONFIRMED', {
      confirmedAt: new Date(),
    });
    logger.info('Purchase order confirmed', { id });
    return updated;
  }

  /**
   * The supplier accepts its own PO from the portal, optionally with the date
   * it plans to dispatch (not before today).
   */
  async supplierConfirmPurchaseOrder(
    id: number,
    supplierId: number,
    data: { dispatchDate?: Date | null | undefined; note?: string | null | undefined },
  ): Promise<PurchaseOrderDto> {
    const existing = await this.getOwnPurchaseOrder(id, supplierId);
    this.assertPOTransition(existing.status, 'CONFIRMED', ['PENDING']);
    if (data.dispatchDate)
      assertNotBeforeOrderDate(data.dispatchDate, new Date(), 'dispatchDate', 'Dispatch date');
    const updated = await this.repo.updatePurchaseOrderStatus(id, 'CONFIRMED', {
      confirmedAt: new Date(),
      dispatchDate: data.dispatchDate ?? null,
      supplierNote: data.note ?? null,
    });
    logger.info('Purchase order confirmed by supplier', { id, supplierId });
    return updated;
  }

  /** The supplier marks its own confirmed PO dispatched; DVS store still marks it delivered. */
  async supplierDispatchPurchaseOrder(
    id: number,
    supplierId: number,
    data: { dispatchDate?: Date | null | undefined; note?: string | null | undefined },
  ): Promise<PurchaseOrderDto> {
    const existing = await this.getOwnPurchaseOrder(id, supplierId);
    this.assertPOTransition(existing.status, 'IN_TRANSIT', ['CONFIRMED']);
    const now = new Date();
    const updated = await this.repo.updatePurchaseOrderStatus(id, 'IN_TRANSIT', {
      dispatchedAt: now,
      dispatchDate: data.dispatchDate ?? now,
      ...(data.note !== undefined && { supplierNote: data.note }),
    });
    logger.info('Purchase order dispatched by supplier', { id, supplierId });
    return updated;
  }

  /** A PO that belongs to this supplier; another supplier's PO is "not found". */
  private async getOwnPurchaseOrder(id: number, supplierId: number): Promise<PurchaseOrderDto> {
    const po = await this.getPurchaseOrderOrThrow(id);
    if (po.supplierId !== supplierId) throw new NotFoundError('Purchase order not found');
    return po;
  }

  async markInTransit(id: number): Promise<PurchaseOrderDto> {
    const existing = await this.getPurchaseOrderOrThrow(id);
    this.assertPOTransition(existing.status, 'IN_TRANSIT', ['CONFIRMED']);
    const updated = await this.repo.updatePurchaseOrderStatus(id, 'IN_TRANSIT');
    logger.info('Purchase order in-transit', { id });
    return updated;
  }

  async deliverPurchaseOrder(id: number): Promise<PurchaseOrderDto> {
    const existing = await this.getPurchaseOrderOrThrow(id);
    this.assertPOTransition(existing.status, 'DELIVERED', ['CONFIRMED', 'IN_TRANSIT']);
    const updated = await this.repo.updatePurchaseOrderStatus(id, 'DELIVERED', {
      actualDelivery: new Date(),
    });
    logger.info('Purchase order delivered', { id });
    return updated;
  }

  async cancelPurchaseOrder(id: number): Promise<PurchaseOrderDto> {
    const existing = await this.getPurchaseOrderOrThrow(id);
    if (existing.status === 'DELIVERED') {
      throw new BadRequestError('Cannot cancel a delivered PO');
    }
    if (existing.status === 'CANCELLED') {
      throw new BadRequestError('PO is already cancelled');
    }
    const updated = await this.repo.updatePurchaseOrderStatus(id, 'CANCELLED');
    logger.info('Purchase order cancelled', { id });
    return updated;
  }

  // ══ STATISTICS ════════════════════════════════════════════════════════════════

  async getStatistics(): Promise<OrdersStatistics> {
    return this.repo.getStatistics();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getSupplierOrThrow(id: number): Promise<SupplierDto> {
    const s = await this.repo.findSupplierById(id);
    if (s === null) throw new NotFoundError(`Supplier with id ${id} not found`);
    return s;
  }

  private async getClientOrThrow(id: number): Promise<ClientDto> {
    const c = await this.repo.findClientById(id);
    if (c === null) throw new NotFoundError(`Client with id ${id} not found`);
    return c;
  }

  private async getClientOrderOrThrow(id: number): Promise<ClientOrderDto> {
    const o = await this.repo.findClientOrderById(id);
    if (o === null) throw new NotFoundError(`Client order with id ${id} not found`);
    return o;
  }

  private async getPurchaseOrderOrThrow(id: number): Promise<PurchaseOrderDto> {
    const p = await this.repo.findPurchaseOrderById(id);
    if (p === null) throw new NotFoundError(`Purchase order with id ${id} not found`);
    return p;
  }

  private assertTransition(current: string, target: string, allowed: string[]): void {
    if (!allowed.includes(current)) {
      throw new BadRequestError(
        `Cannot transition to "${target}" from "${current}". ` +
          `Allowed from: ${allowed.join(', ')}`,
      );
    }
  }

  private assertPOTransition(current: string, target: string, allowed: string[]): void {
    this.assertTransition(current, target, allowed);
  }
}
