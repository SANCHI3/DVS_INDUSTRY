// ── Orders domain interfaces ─────────────────────────────────────────────────
// Pure domain objects — zero Prisma imports.

export type ClientOrderStatus =
  'PENDING' | 'APPROVED' | 'IN_PRODUCTION' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';

export type PurchaseOrderStatus =
  'PENDING' | 'CONFIRMED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

// ── Supplier ──────────────────────────────────────────────────────────────────

export interface SupplierDto {
  id: number;
  name: string;
  code: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  gstin: string | null;
  rating: string | null;
  leadTimeDays: number | null;
  reliability: string | null;
  materials: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface ClientDto {
  id: number;
  name: string;
  code: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  gstin: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Client Order ──────────────────────────────────────────────────────────────

export interface ClientOrderDto {
  id: number;
  orderNumber: string;
  clientId: number;
  clientName: string;
  product: string;
  quantity: number;
  unit: string;
  value: string | null;
  currency: string;
  orderDate: Date;
  requiredDate: Date | null;
  dispatchDate: Date | null;
  deliveryDate: Date | null;
  approvedAt: Date | null;
  productionStartedAt: Date | null;
  partSpecId: number | null;
  /** Linked work orders (list view): how many, and how many are completed */
  workOrderProgress?: { total: number; completed: number };
  status: ClientOrderStatus;
  notes: string | null;
  dispatchNote: string | null;
  challanNumber: string | null;
  invoiceNumber: string | null;
  createdById: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A work order producing (part of) a client order. */
export interface LinkedWorkOrder {
  id: number;
  workOrderNumber: string;
  status: string;
  targetQuantity: number;
  producedQty: number; // good output recorded so far
  unit: string;
}

/** One client order with the work orders linked to it (detail view). */
export interface ClientOrderDetail extends ClientOrderDto {
  workOrders: LinkedWorkOrder[];
}

// ── Purchase Order ────────────────────────────────────────────────────────────

export interface PurchaseOrderDto {
  id: number;
  poNumber: string;
  supplierId: number;
  supplierName: string;
  material: string;
  quantity: string;
  unit: string | null;
  totalCost: string | null;
  currency: string;
  orderDate: Date;
  expectedDelivery: Date | null;
  actualDelivery: Date | null;
  materialId: number | null; // stock material bought
  quantityValue: string | null; // ordered amount in the material's unit
  receivedQty: string; // received so far
  confirmedAt: Date | null; // supplier accepted it
  dispatchDate: Date | null; // planned, then actual, dispatch date
  dispatchedAt: Date | null;
  supplierNote: string | null;
  status: PurchaseOrderStatus;
  notes: string | null;
  createdById: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Statistics ────────────────────────────────────────────────────────────────

export interface OrdersStatistics {
  clientOrders: {
    total: number;
    pending: number;
    approved: number;
    inProduction: number;
    dispatched: number;
    delivered: number;
    cancelled: number;
    overdue: number; // past the required-by date, not delivered or cancelled
    totalValue: string;
  };
  purchaseOrders: {
    total: number;
    pending: number;
    confirmed: number;
    inTransit: number;
    delivered: number;
    cancelled: number;
    overdue: number; // past the expected delivery, not delivered or cancelled
    totalCost: string;
  };
  fulfillmentRate: string;
  activeSuppliers: number;
  activeClients: number;
}

// ── List results ──────────────────────────────────────────────────────────────

export interface SupplierListResult {
  data: SupplierDto[];
  total: number;
}
export interface ClientListResult {
  data: ClientDto[];
  total: number;
}
export interface ClientOrderListResult {
  data: ClientOrderDto[];
  total: number;
}
export interface PurchaseOrderListResult {
  data: PurchaseOrderDto[];
  total: number;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface SupplierFilters {
  search?: string | undefined;
  status?: 'active' | 'inactive' | 'all' | undefined;
  sortBy?: 'name' | 'code' | 'rating' | 'createdAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ClientFilters {
  search?: string | undefined;
  status?: 'active' | 'inactive' | 'all' | undefined;
  sortBy?: 'name' | 'code' | 'createdAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ClientOrderFilters {
  clientId?: number | undefined;
  status?: ClientOrderStatus | 'all' | undefined;
  search?: string | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortBy?: 'orderDate' | 'requiredDate' | 'value' | 'createdAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface PurchaseOrderFilters {
  supplierId?: number | undefined;
  status?: PurchaseOrderStatus | 'all' | undefined;
  search?: string | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortBy?: 'orderDate' | 'expectedDelivery' | 'totalCost' | 'createdAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateSupplierData {
  name: string;
  code: string;
  contactName?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | undefined;
  gstin?: string | null | undefined;
  rating?: string | null | undefined;
  leadTimeDays?: number | null | undefined;
  reliability?: string | null | undefined;
  materials?: string | null | undefined;
}

export interface UpdateSupplierData {
  name?: string | undefined;
  contactName?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | undefined;
  gstin?: string | null | undefined;
  rating?: string | null | undefined;
  leadTimeDays?: number | null | undefined;
  reliability?: string | null | undefined;
  materials?: string | null | undefined;
}

export interface CreateClientData {
  name: string;
  code: string;
  contactName?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | undefined;
  gstin?: string | null | undefined;
}

export interface UpdateClientData {
  name?: string | undefined;
  contactName?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | undefined;
  gstin?: string | null | undefined;
}

export interface CreateClientOrderData {
  clientId: number;
  product: string;
  quantity: number;
  unit?: string | undefined;
  value?: string | null | undefined;
  currency?: string | undefined;
  requiredDate?: Date | null | undefined;
  notes?: string | null | undefined;
  createdById?: number | null | undefined;
  partSpecId?: number | null | undefined;
}

export interface UpdateClientOrderData {
  product?: string | undefined;
  quantity?: number | undefined;
  unit?: string | undefined;
  value?: string | null | undefined;
  requiredDate?: Date | null | undefined;
  notes?: string | null | undefined;
  partSpecId?: number | null | undefined;
}

export interface DispatchOrderData {
  dispatchNote?: string | null | undefined;
  challanNumber?: string | null | undefined;
  invoiceNumber?: string | null | undefined;
}

export interface CreatePurchaseOrderData {
  supplierId: number;
  material: string;
  quantity: string;
  unit?: string | null | undefined;
  totalCost?: string | null | undefined;
  currency?: string | undefined;
  expectedDelivery?: Date | null | undefined;
  notes?: string | null | undefined;
  createdById?: number | null | undefined;
  materialId?: number | null | undefined;
  quantityValue?: string | null | undefined;
}

export interface UpdatePurchaseOrderData {
  material?: string | undefined;
  quantity?: string | undefined;
  unit?: string | null | undefined;
  totalCost?: string | null | undefined;
  expectedDelivery?: Date | null | undefined;
  notes?: string | null | undefined;
  materialId?: number | null | undefined;
  quantityValue?: string | null | undefined;
}
