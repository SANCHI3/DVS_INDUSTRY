import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import { nextDocumentNumber, withUniqueNumberRetry } from '../utils/documentNumber';
import type {
  SupplierDto,
  ClientDto,
  ClientOrderDto,
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
  CreatePurchaseOrderData,
  UpdatePurchaseOrderData,
  ClientOrderStatus,
  PurchaseOrderStatus,
} from '../interfaces';

// ── Select shapes ─────────────────────────────────────────────────────────────

const supplierSelect = {
  id: true,
  name: true,
  code: true,
  contactName: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  country: true,
  gstin: true,
  rating: true,
  leadTimeDays: true,
  reliability: true,
  materials: true,
  isActive: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const clientSelect = {
  id: true,
  name: true,
  code: true,
  contactName: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  country: true,
  gstin: true,
  isActive: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const clientOrderSelect = {
  id: true,
  orderNumber: true,
  clientId: true,
  product: true,
  quantity: true,
  unit: true,
  value: true,
  currency: true,
  orderDate: true,
  requiredDate: true,
  dispatchDate: true,
  deliveryDate: true,
  status: true,
  notes: true,
  dispatchNote: true,
  challanNumber: true,
  invoiceNumber: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { name: true } },
} as const;

const purchaseOrderSelect = {
  id: true,
  poNumber: true,
  supplierId: true,
  material: true,
  quantity: true,
  unit: true,
  totalCost: true,
  currency: true,
  orderDate: true,
  expectedDelivery: true,
  actualDelivery: true,
  status: true,
  notes: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { name: true } },
} as const;

// ── Converters ────────────────────────────────────────────────────────────────

type PrismaSupplier = Prisma.SupplierGetPayload<{ select: typeof supplierSelect }>;
type PrismaClient = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;
type PrismaClientOrder = Prisma.ClientOrderGetPayload<{ select: typeof clientOrderSelect }>;
type PrismaPurchaseOrder = Prisma.PurchaseOrderGetPayload<{ select: typeof purchaseOrderSelect }>;

function toSupplierDto(r: PrismaSupplier): SupplierDto {
  return { ...r, rating: r.rating?.toString() ?? null };
}

function toClientDto(r: PrismaClient): ClientDto {
  return { ...r };
}

function toClientOrderDto(r: PrismaClientOrder): ClientOrderDto {
  return {
    id: r.id,
    orderNumber: r.orderNumber,
    clientId: r.clientId,
    clientName: r.client.name,
    product: r.product,
    quantity: r.quantity,
    unit: r.unit,
    value: r.value?.toString() ?? null,
    currency: r.currency,
    orderDate: r.orderDate,
    requiredDate: r.requiredDate,
    dispatchDate: r.dispatchDate,
    deliveryDate: r.deliveryDate,
    status: r.status as ClientOrderStatus,
    notes: r.notes,
    dispatchNote: r.dispatchNote,
    challanNumber: r.challanNumber,
    invoiceNumber: r.invoiceNumber,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toPurchaseOrderDto(r: PrismaPurchaseOrder): PurchaseOrderDto {
  return {
    id: r.id,
    poNumber: r.poNumber,
    supplierId: r.supplierId,
    supplierName: r.supplier.name,
    material: r.material,
    quantity: r.quantity,
    unit: r.unit,
    totalCost: r.totalCost?.toString() ?? null,
    currency: r.currency,
    orderDate: r.orderDate,
    expectedDelivery: r.expectedDelivery,
    actualDelivery: r.actualDelivery,
    status: r.status as PurchaseOrderStatus,
    notes: r.notes,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ── Auto-generate order numbers ────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

export class OrdersRepository {
  // ══ SUPPLIERS ════════════════════════════════════════════════════════════════

  async createSupplier(data: CreateSupplierData): Promise<SupplierDto> {
    const raw = await prisma.supplier.create({
      data: {
        name: data.name,
        code: data.code,
        contactName: data.contactName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? 'India',
        gstin: data.gstin ?? null,
        rating: data.rating ?? null,
        leadTimeDays: data.leadTimeDays ?? null,
        reliability: data.reliability ?? null,
        materials: data.materials ?? null,
      },
      select: supplierSelect,
    });
    return toSupplierDto(raw);
  }

  async updateSupplier(id: number, data: UpdateSupplierData): Promise<SupplierDto> {
    const up: Prisma.SupplierUpdateInput = {};
    if (data.name !== undefined) up.name = data.name;
    if (data.contactName !== undefined) up.contactName = data.contactName;
    if (data.email !== undefined) up.email = data.email;
    if (data.phone !== undefined) up.phone = data.phone;
    if (data.address !== undefined) up.address = data.address;
    if (data.city !== undefined) up.city = data.city;
    if (data.state !== undefined) up.state = data.state;
    if (data.country !== undefined) up.country = data.country;
    if (data.gstin !== undefined) up.gstin = data.gstin;
    if (data.rating !== undefined) up.rating = data.rating;
    if (data.leadTimeDays !== undefined) up.leadTimeDays = data.leadTimeDays;
    if (data.reliability !== undefined) up.reliability = data.reliability;
    if (data.materials !== undefined) up.materials = data.materials;
    const raw = await prisma.supplier.update({ where: { id }, data: up, select: supplierSelect });
    return toSupplierDto(raw);
  }

  async findSupplierById(id: number): Promise<SupplierDto | null> {
    const raw = await prisma.supplier.findUnique({ where: { id }, select: supplierSelect });
    return raw ? toSupplierDto(raw) : null;
  }

  async findSupplierByName(name: string): Promise<SupplierDto | null> {
    const raw = await prisma.supplier.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: supplierSelect,
    });
    return raw ? toSupplierDto(raw) : null;
  }

  async findSupplierByCode(code: string): Promise<SupplierDto | null> {
    const raw = await prisma.supplier.findUnique({ where: { code }, select: supplierSelect });
    return raw ? toSupplierDto(raw) : null;
  }

  async findAllSuppliers(f: SupplierFilters): Promise<SupplierListResult> {
    const {
      search,
      status = 'active',
      sortBy = 'name',
      sortOrder = 'asc',
      page = 1,
      pageSize = 20,
    } = f;
    const where: Prisma.SupplierWhereInput = {};
    if (status === 'active') {
      where.isActive = true;
      where.deletedAt = null;
    } else if (status === 'inactive') {
      where.isActive = false;
    }
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { code: { contains: search.trim(), mode: 'insensitive' } },
        { materials: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.SupplierOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [data, total] = await prisma.$transaction([
      prisma.supplier.findMany({
        where,
        select: supplierSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.supplier.count({ where }),
    ]);
    return { data: data.map(toSupplierDto), total };
  }

  async softDeleteSupplier(id: number): Promise<SupplierDto> {
    const raw = await prisma.supplier.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
      select: supplierSelect,
    });
    return toSupplierDto(raw);
  }

  async restoreSupplier(id: number): Promise<SupplierDto> {
    const raw = await prisma.supplier.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
      select: supplierSelect,
    });
    return toSupplierDto(raw);
  }

  // ══ CLIENTS ══════════════════════════════════════════════════════════════════

  async createClient(data: CreateClientData): Promise<ClientDto> {
    const raw = await prisma.client.create({
      data: {
        name: data.name,
        code: data.code,
        contactName: data.contactName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? 'India',
        gstin: data.gstin ?? null,
      },
      select: clientSelect,
    });
    return toClientDto(raw);
  }

  async updateClient(id: number, data: UpdateClientData): Promise<ClientDto> {
    const up: Prisma.ClientUpdateInput = {};
    if (data.name !== undefined) up.name = data.name;
    if (data.contactName !== undefined) up.contactName = data.contactName;
    if (data.email !== undefined) up.email = data.email;
    if (data.phone !== undefined) up.phone = data.phone;
    if (data.address !== undefined) up.address = data.address;
    if (data.city !== undefined) up.city = data.city;
    if (data.state !== undefined) up.state = data.state;
    if (data.country !== undefined) up.country = data.country;
    if (data.gstin !== undefined) up.gstin = data.gstin;
    const raw = await prisma.client.update({ where: { id }, data: up, select: clientSelect });
    return toClientDto(raw);
  }

  async findClientById(id: number): Promise<ClientDto | null> {
    const raw = await prisma.client.findUnique({ where: { id }, select: clientSelect });
    return raw ? toClientDto(raw) : null;
  }

  async findSupplierByEmail(email: string): Promise<SupplierDto | null> {
    const raw = await prisma.supplier.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
      select: supplierSelect,
    });
    return raw ? toSupplierDto(raw) : null;
  }

  async findClientByEmail(email: string): Promise<ClientDto | null> {
    const raw = await prisma.client.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: clientSelect,
    });
    return raw ? toClientDto(raw) : null;
  }

  async findClientByName(name: string): Promise<ClientDto | null> {
    const raw = await prisma.client.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: clientSelect,
    });
    return raw ? toClientDto(raw) : null;
  }

  async findClientByCode(code: string): Promise<ClientDto | null> {
    const raw = await prisma.client.findUnique({ where: { code }, select: clientSelect });
    return raw ? toClientDto(raw) : null;
  }

  async findAllClients(f: ClientFilters): Promise<ClientListResult> {
    const {
      search,
      status = 'active',
      sortBy = 'name',
      sortOrder = 'asc',
      page = 1,
      pageSize = 20,
    } = f;
    const where: Prisma.ClientWhereInput = {};
    if (status === 'active') {
      where.isActive = true;
      where.deletedAt = null;
    } else if (status === 'inactive') {
      where.isActive = false;
    }
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { code: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.ClientOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [data, total] = await prisma.$transaction([
      prisma.client.findMany({
        where,
        select: clientSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.client.count({ where }),
    ]);
    return { data: data.map(toClientDto), total };
  }

  async softDeleteClient(id: number): Promise<ClientDto> {
    const raw = await prisma.client.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
      select: clientSelect,
    });
    return toClientDto(raw);
  }

  async restoreClient(id: number): Promise<ClientDto> {
    const raw = await prisma.client.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
      select: clientSelect,
    });
    return toClientDto(raw);
  }

  // ══ CLIENT ORDERS ═════════════════════════════════════════════════════════════

  async createClientOrder(data: CreateClientOrderData): Promise<ClientOrderDto> {
    return withUniqueNumberRetry(async () => {
      const orderNumber = await nextDocumentNumber('clientOrder', 'ORD-', { start: 2841 });
      const raw = await prisma.clientOrder.create({
        data: {
          orderNumber,
          clientId: data.clientId,
          product: data.product,
          quantity: data.quantity,
          unit: data.unit ?? 'pcs',
          value: data.value ?? null,
          currency: data.currency ?? 'INR',
          requiredDate: data.requiredDate ?? null,
          notes: data.notes ?? null,
          createdById: data.createdById ?? null,
        },
        select: clientOrderSelect,
      });
      return toClientOrderDto(raw);
    });
  }

  async updateClientOrder(id: number, data: UpdateClientOrderData): Promise<ClientOrderDto> {
    const up: Prisma.ClientOrderUpdateInput = {};
    if (data.product !== undefined) up.product = data.product;
    if (data.quantity !== undefined) up.quantity = data.quantity;
    if (data.unit !== undefined) up.unit = data.unit;
    if (data.value !== undefined) up.value = data.value;
    if (data.requiredDate !== undefined) up.requiredDate = data.requiredDate;
    if (data.notes !== undefined) up.notes = data.notes;
    const raw = await prisma.clientOrder.update({
      where: { id },
      data: up,
      select: clientOrderSelect,
    });
    return toClientOrderDto(raw);
  }

  async findClientOrderById(id: number): Promise<ClientOrderDto | null> {
    const raw = await prisma.clientOrder.findUnique({ where: { id }, select: clientOrderSelect });
    return raw ? toClientOrderDto(raw) : null;
  }

  async findAllClientOrders(f: ClientOrderFilters): Promise<ClientOrderListResult> {
    const {
      clientId,
      status = 'all',
      search,
      fromDate,
      toDate,
      sortBy = 'orderDate',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = f;
    const where: Prisma.ClientOrderWhereInput = {};
    if (clientId !== undefined) where.clientId = clientId;
    if (status !== 'all') where.status = status as ClientOrderStatus;
    if (fromDate !== undefined || toDate !== undefined) {
      where.orderDate = {};
      if (fromDate) where.orderDate.gte = fromDate;
      if (toDate) where.orderDate.lte = toDate;
    }
    if (search?.trim()) {
      where.OR = [
        { orderNumber: { contains: search.trim(), mode: 'insensitive' } },
        { product: { contains: search.trim(), mode: 'insensitive' } },
        { client: { name: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }
    const orderBy: Prisma.ClientOrderOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [data, total] = await prisma.$transaction([
      prisma.clientOrder.findMany({
        where,
        select: clientOrderSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.clientOrder.count({ where }),
    ]);
    return { data: data.map(toClientOrderDto), total };
  }

  async updateClientOrderStatus(
    id: number,
    status: ClientOrderStatus,
    extra?: Partial<{
      dispatchDate: Date;
      deliveryDate: Date;
      dispatchNote: string | null;
      challanNumber: string | null;
      invoiceNumber: string | null;
    }>,
  ): Promise<ClientOrderDto> {
    const raw = await prisma.clientOrder.update({
      where: { id },
      data: { status, ...extra },
      select: clientOrderSelect,
    });
    return toClientOrderDto(raw);
  }

  // ══ PURCHASE ORDERS ══════════════════════════════════════════════════════════

  async createPurchaseOrder(data: CreatePurchaseOrderData): Promise<PurchaseOrderDto> {
    return withUniqueNumberRetry(async () => {
      const poNumber = await nextDocumentNumber('purchaseOrder', 'PO-', { start: 2847 });
      const raw = await prisma.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: data.supplierId,
          material: data.material,
          quantity: data.quantity,
          unit: data.unit ?? null,
          totalCost: data.totalCost ?? null,
          currency: data.currency ?? 'INR',
          expectedDelivery: data.expectedDelivery ?? null,
          notes: data.notes ?? null,
          createdById: data.createdById ?? null,
        },
        select: purchaseOrderSelect,
      });
      return toPurchaseOrderDto(raw);
    });
  }

  async updatePurchaseOrder(id: number, data: UpdatePurchaseOrderData): Promise<PurchaseOrderDto> {
    const up: Prisma.PurchaseOrderUpdateInput = {};
    if (data.material !== undefined) up.material = data.material;
    if (data.quantity !== undefined) up.quantity = data.quantity;
    if (data.unit !== undefined) up.unit = data.unit;
    if (data.totalCost !== undefined) up.totalCost = data.totalCost;
    if (data.expectedDelivery !== undefined) up.expectedDelivery = data.expectedDelivery;
    if (data.notes !== undefined) up.notes = data.notes;
    const raw = await prisma.purchaseOrder.update({
      where: { id },
      data: up,
      select: purchaseOrderSelect,
    });
    return toPurchaseOrderDto(raw);
  }

  async findPurchaseOrderById(id: number): Promise<PurchaseOrderDto | null> {
    const raw = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: purchaseOrderSelect,
    });
    return raw ? toPurchaseOrderDto(raw) : null;
  }

  async findAllPurchaseOrders(f: PurchaseOrderFilters): Promise<PurchaseOrderListResult> {
    const {
      supplierId,
      status = 'all',
      search,
      fromDate,
      toDate,
      sortBy = 'orderDate',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = f;
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (supplierId !== undefined) where.supplierId = supplierId;
    if (status !== 'all') where.status = status as PurchaseOrderStatus;
    if (fromDate !== undefined || toDate !== undefined) {
      where.orderDate = {};
      if (fromDate) where.orderDate.gte = fromDate;
      if (toDate) where.orderDate.lte = toDate;
    }
    if (search?.trim()) {
      where.OR = [
        { poNumber: { contains: search.trim(), mode: 'insensitive' } },
        { material: { contains: search.trim(), mode: 'insensitive' } },
        { supplier: { name: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }
    const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [data, total] = await prisma.$transaction([
      prisma.purchaseOrder.findMany({
        where,
        select: purchaseOrderSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    return { data: data.map(toPurchaseOrderDto), total };
  }

  async updatePurchaseOrderStatus(
    id: number,
    status: PurchaseOrderStatus,
    extra?: Partial<{ actualDelivery: Date }>,
  ): Promise<PurchaseOrderDto> {
    const raw = await prisma.purchaseOrder.update({
      where: { id },
      data: { status, ...extra },
      select: purchaseOrderSelect,
    });
    return toPurchaseOrderDto(raw);
  }

  // ══ STATISTICS ════════════════════════════════════════════════════════════════

  async getStatistics(): Promise<OrdersStatistics> {
    const [
      coTotal,
      coPending,
      coApproved,
      coInProd,
      coDispatched,
      coDelivered,
      coCancelled,
      poTotal,
      poPending,
      poConfirmed,
      poInTransit,
      poDelivered,
      poCancelled,
      activeSuppliers,
      activeClients,
      coValueRaw,
      poValueRaw,
      deliveredCount,
      totalCount,
    ] = await prisma.$transaction([
      prisma.clientOrder.count(),
      prisma.clientOrder.count({ where: { status: 'PENDING' } }),
      prisma.clientOrder.count({ where: { status: 'APPROVED' } }),
      prisma.clientOrder.count({ where: { status: 'IN_PRODUCTION' } }),
      prisma.clientOrder.count({ where: { status: 'DISPATCHED' } }),
      prisma.clientOrder.count({ where: { status: 'DELIVERED' } }),
      prisma.clientOrder.count({ where: { status: 'CANCELLED' } }),
      prisma.purchaseOrder.count(),
      prisma.purchaseOrder.count({ where: { status: 'PENDING' } }),
      prisma.purchaseOrder.count({ where: { status: 'CONFIRMED' } }),
      prisma.purchaseOrder.count({ where: { status: 'IN_TRANSIT' } }),
      prisma.purchaseOrder.count({ where: { status: 'DELIVERED' } }),
      prisma.purchaseOrder.count({ where: { status: 'CANCELLED' } }),
      prisma.supplier.count({ where: { isActive: true, deletedAt: null } }),
      prisma.client.count({ where: { isActive: true, deletedAt: null } }),
      prisma.clientOrder.aggregate({ _sum: { value: true } }),
      prisma.purchaseOrder.aggregate({ _sum: { totalCost: true } }),
      prisma.clientOrder.count({ where: { status: 'DELIVERED' } }),
      prisma.clientOrder.count({ where: { status: { not: 'CANCELLED' } } }),
    ]);

    const totalValue = coValueRaw._sum.value?.toNumber() ?? 0;
    const totalCost = poValueRaw._sum.totalCost?.toNumber() ?? 0;
    const fulfillment = totalCount > 0 ? ((deliveredCount / totalCount) * 100).toFixed(1) : '0.0';

    return {
      clientOrders: {
        total: coTotal,
        pending: coPending,
        approved: coApproved,
        inProduction: coInProd,
        dispatched: coDispatched,
        delivered: coDelivered,
        cancelled: coCancelled,
        totalValue: totalValue.toFixed(2),
      },
      purchaseOrders: {
        total: poTotal,
        pending: poPending,
        confirmed: poConfirmed,
        inTransit: poInTransit,
        delivered: poDelivered,
        cancelled: poCancelled,
        totalCost: totalCost.toFixed(2),
      },
      fulfillmentRate: `${fulfillment}%`,
      activeSuppliers,
      activeClients,
    };
  }
}
