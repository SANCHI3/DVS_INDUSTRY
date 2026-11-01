import api, { unwrap, unwrapPaged, type PaginatedMeta } from '../api';
import type { LinkedWorkOrder } from '../dispatchReadiness';

// ── Suppliers ─────────────────────────────────────────────────────────────────

export interface SupplierDto {
  id:           number;
  name:         string;
  code:         string;
  contactName:  string | null;
  email:        string | null;
  phone:        string | null;
  address:      string | null;
  state:        string | null;
  city:         string | null;
  country:      string;
  gstin:        string | null;
  rating:       string | null;
  leadTimeDays: number | null;
  reliability:  string | null;
  materials:    string | null;
  isActive:     boolean;
  createdAt:    string;
}

export async function getSuppliers(params?: { page?: number; pageSize?: number; search?: string; status?: string }) {
  const res = await api.get<{ success: true; data: SupplierDto[]; meta: PaginatedMeta }>('/orders/suppliers', { params });
  return unwrapPaged(res);
}

export async function createSupplier(payload: Record<string, unknown>): Promise<SupplierDto> {
  const res = await api.post<{ success: true; data: SupplierDto }>('/orders/suppliers', payload);
  return unwrap(res);
}

export async function updateSupplier(id: number, payload: Record<string, unknown>): Promise<SupplierDto> {
  const res = await api.patch<{ success: true; data: SupplierDto }>(`/orders/suppliers/${id}`, payload);
  return unwrap(res);
}

export async function deleteSupplier(id: number): Promise<void> {
  await api.delete(`/orders/suppliers/${id}`);
}

// ── Clients ───────────────────────────────────────────────────────────────────

export interface ClientDto {
  id:          number;
  name:        string;
  code:        string;
  contactName: string | null;
  email:       string | null;
  phone:       string | null;
  address:     string | null;
  city:        string | null;
  state:       string | null;
  country:     string;
  gstin:       string | null;
  isActive:    boolean;
  createdAt:   string;
}

export async function getClients(params?: { page?: number; pageSize?: number; search?: string; status?: string }) {
  const res = await api.get<{ success: true; data: ClientDto[]; meta: PaginatedMeta }>('/orders/clients', { params });
  return unwrapPaged(res);
}

export async function createClient(payload: Record<string, unknown>): Promise<ClientDto> {
  const res = await api.post<{ success: true; data: ClientDto }>('/orders/clients', payload);
  return unwrap(res);
}

export async function updateClient(id: number, payload: Record<string, unknown>): Promise<ClientDto> {
  const res = await api.patch<{ success: true; data: ClientDto }>(`/orders/clients/${id}`, payload);
  return unwrap(res);
}

// ── Client Orders ─────────────────────────────────────────────────────────────

export type ClientOrderStatus = 'PENDING'|'APPROVED'|'IN_PRODUCTION'|'DISPATCHED'|'DELIVERED'|'CANCELLED';

export interface ClientOrderDto {
  id:           number;
  orderNumber:  string;
  clientId:     number;
  clientName:   string;
  product:      string;
  quantity:     number;
  unit:         string;
  value:        string | null;
  currency:     string;
  orderDate:    string;
  requiredDate: string | null;
  dispatchDate: string | null;
  deliveryDate: string | null;
  approvedAt?: string | null;
  productionStartedAt?: string | null;
  /** Parts Master entry, when the order was made for a known part */
  partSpecId?:  number | null;
  /** Linked work orders: how many, and how many are completed */
  workOrderProgress?: { total: number; completed: number };
  status:       ClientOrderStatus;
  notes:        string | null;
  dispatchNote: string | null;
  challanNumber: string | null;
  invoiceNumber: string | null;
  createdAt:    string;
  updatedAt:    string;
}

export interface ClientOrderQuery {
  page?: number; pageSize?: number;
  search?: string; clientId?: number;
  status?: ClientOrderStatus | 'all';
  fromDate?: string; toDate?: string;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
}

/** One client order with the work orders linked to it. */
export async function getClientOrderDetail(id: number): Promise<ClientOrderDto & { workOrders: LinkedWorkOrder[] }> {
  const res = await api.get<{ success: true; data: ClientOrderDto & { workOrders: LinkedWorkOrder[] } }>(`/orders/client-orders/${id}`);
  return res.data.data;
}

export async function getClientOrders(params?: ClientOrderQuery) {
  const res = await api.get<{ success: true; data: ClientOrderDto[]; meta: PaginatedMeta }>('/orders/client-orders', { params });
  return unwrapPaged(res);
}

export async function createClientOrder(payload: Record<string, unknown>): Promise<ClientOrderDto> {
  const res = await api.post<{ success: true; data: ClientOrderDto }>('/orders/client-orders', payload);
  return unwrap(res);
}

export async function updateClientOrder(id: number, payload: Record<string, unknown>): Promise<ClientOrderDto> {
  const res = await api.patch<{ success: true; data: ClientOrderDto }>(`/orders/client-orders/${id}`, payload);
  return unwrap(res);
}

export async function approveClientOrder(id: number): Promise<ClientOrderDto> {
  const res = await api.patch<{ success: true; data: ClientOrderDto }>(`/orders/client-orders/${id}/approve`, {});
  return unwrap(res);
}

export async function dispatchClientOrder(id: number, payload: { dispatchNote?: string; challanNumber?: string; invoiceNumber?: string }): Promise<ClientOrderDto> {
  const res = await api.patch<{ success: true; data: ClientOrderDto }>(`/orders/client-orders/${id}/dispatch`, payload);
  return unwrap(res);
}

export async function deliverClientOrder(id: number): Promise<ClientOrderDto> {
  const res = await api.patch<{ success: true; data: ClientOrderDto }>(`/orders/client-orders/${id}/deliver`, {});
  return unwrap(res);
}

export async function cancelClientOrder(id: number): Promise<ClientOrderDto> {
  const res = await api.patch<{ success: true; data: ClientOrderDto }>(`/orders/client-orders/${id}/cancel`, {});
  return unwrap(res);
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

export type PurchaseOrderStatus = 'PENDING'|'CONFIRMED'|'IN_TRANSIT'|'DELIVERED'|'CANCELLED';

export interface PurchaseOrderDto {
  id:               number;
  poNumber:         string;
  supplierId:       number;
  supplierName:     string;
  material:         string;
  quantity:         string;
  unit:             string | null;
  totalCost:        string | null;
  currency:         string;
  orderDate:        string;
  expectedDelivery: string | null;
  actualDelivery:   string | null;
  /** Set by the supplier from the portal */
  confirmedAt?:     string | null;
  dispatchDate?:    string | null;
  dispatchedAt?:    string | null;
  supplierNote?:    string | null;
  /** Stock material this PO fills; receiving it adds to stock */
  materialId?:      number | null;
  quantityValue?:   string | null;
  receivedQty?:     string;
  status:           PurchaseOrderStatus;
  notes:            string | null;
  createdAt:        string;
}

export interface PurchaseOrderQuery {
  page?: number; pageSize?: number;
  search?: string; supplierId?: number;
  status?: PurchaseOrderStatus | 'all';
  fromDate?: string; toDate?: string;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
}

export async function getPurchaseOrders(params?: PurchaseOrderQuery) {
  const res = await api.get<{ success: true; data: PurchaseOrderDto[]; meta: PaginatedMeta }>('/orders/purchase-orders', { params });
  return unwrapPaged(res);
}

export async function createPurchaseOrder(payload: Record<string, unknown>): Promise<PurchaseOrderDto> {
  const res = await api.post<{ success: true; data: PurchaseOrderDto }>('/orders/purchase-orders', payload);
  return unwrap(res);
}

export async function confirmPurchaseOrder(id: number): Promise<PurchaseOrderDto> {
  const res = await api.patch<{ success: true; data: PurchaseOrderDto }>(`/orders/purchase-orders/${id}/confirm`, {});
  return unwrap(res);
}

/** Receives a PO. With a stock material, `receivedQty` goes into stock (default: all that is due). */
export async function deliverPurchaseOrder(id: number, receivedQty?: number): Promise<PurchaseOrderDto> {
  const res = await api.patch<{ success: true; data: PurchaseOrderDto }>(
    `/orders/purchase-orders/${id}/deliver`,
    receivedQty === undefined ? {} : { receivedQty },
  );
  return unwrap(res);
}

export async function cancelPurchaseOrder(id: number): Promise<PurchaseOrderDto> {
  const res = await api.patch<{ success: true; data: PurchaseOrderDto }>(`/orders/purchase-orders/${id}/cancel`, {});
  return unwrap(res);
}

// ── Statistics ────────────────────────────────────────────────────────────────

export interface OrderStatistics {
  clientOrders: {
    total: number;
    pending: number;
    approved: number;
    inProduction: number;
    dispatched: number;
    delivered: number;
    cancelled: number;
    /** Past the required-by date, not delivered or cancelled. */
    overdue: number;
    totalValue: string;
  };
  purchaseOrders: {
    total: number;
    pending: number;
    confirmed: number;
    inTransit: number;
    delivered: number;
    cancelled: number;
    /** Past the expected delivery, not delivered or cancelled. */
    overdue: number;
    totalCost: string;
  };
  fulfillmentRate: string;
  activeSuppliers: number;
  activeClients: number;
}

export async function getOrderStats(): Promise<OrderStatistics> {
  const res = await api.get<{ success: true; data: OrderStatistics }>('/orders/statistics');
  return unwrap(res);
}

// ── Supplier portal: its own purchase orders ─────────────────────────────────

/** The supplier accepts the PO, optionally with the date it plans to dispatch. */
export async function supplierConfirmPurchaseOrder(id: number, body: { dispatchDate?: string; note?: string }): Promise<PurchaseOrderDto> {
  const res = await api.patch<{ success: true; data: PurchaseOrderDto }>(`/orders/purchase-orders/${id}/supplier-confirm`, body);
  return unwrap(res);
}

/** The supplier marks the PO dispatched; DVS store marks it delivered on arrival. */
export async function supplierDispatchPurchaseOrder(id: number, body: { dispatchDate?: string; note?: string }): Promise<PurchaseOrderDto> {
  const res = await api.patch<{ success: true; data: PurchaseOrderDto }>(`/orders/purchase-orders/${id}/supplier-dispatch`, body);
  return unwrap(res);
}
