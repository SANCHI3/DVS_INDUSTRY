import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../types';
import { OrdersService } from '../services/orders.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { ForbiddenError } from '../errors';
import type {
  CreateSupplierInput,
  UpdateSupplierInput,
  SupplierQueryInput,
  CreateClientInput,
  UpdateClientInput,
  ClientQueryInput,
  CreateClientOrderInput,
  UpdateClientOrderInput,
  ClientOrderQueryInput,
  DispatchOrderInput,
  CreatePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  PurchaseOrderQueryInput,
} from '../validators/orders.validator';
import type {
  SupplierFilters,
  ClientFilters,
  ClientOrderFilters,
  PurchaseOrderFilters,
  UpdateSupplierData,
  UpdateClientData,
  UpdateClientOrderData,
  UpdatePurchaseOrderData,
} from '../interfaces';

const svc = new OrdersService();

function isClientRequest(req: AuthenticatedRequest): boolean {
  return req.user?.role === 'CLIENT';
}

async function getRequestClient(req: AuthenticatedRequest) {
  if (req.user === undefined) throw new ForbiddenError('Authenticated client context is required');
  return svc.getClientByEmail(req.user.email);
}

function isSupplierRequest(req: AuthenticatedRequest): boolean {
  return req.user?.role === 'SUPPLIER';
}

async function getRequestSupplier(req: AuthenticatedRequest) {
  if (req.user === undefined)
    throw new ForbiddenError('Authenticated supplier context is required');
  return svc.getSupplierByEmail(req.user.email);
}

async function assertClientOrderAccess(req: AuthenticatedRequest, id: number) {
  const order = await svc.getClientOrderById(id);
  if (!isClientRequest(req)) return order;

  const client = await getRequestClient(req);
  if (order.clientId !== client.id) {
    throw new ForbiddenError('Access denied for this client order');
  }
  return order;
}

function parseId(raw: string | string[] | undefined): number {
  return parseInt(String(raw ?? '0'), 10);
}

// ══ STATISTICS ════════════════════════════════════════════════════════════════

export async function getStatistics(_req: Request, res: Response): Promise<void> {
  const stats = await svc.getStatistics();
  sendSuccess(res, stats);
}

// ══ SUPPLIERS ═════════════════════════════════════════════════════════════════

export async function createSupplier(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateSupplierInput;
  const supplier = await svc.createSupplier({
    name: body.name,
    code: body.code,
    contactName: body.contactName ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    address: body.address ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    country: body.country,
    gstin: body.gstin ?? null,
    rating: body.rating ?? null,
    leadTimeDays: body.leadTimeDays ?? null,
    reliability: body.reliability ?? null,
    materials: body.materials ?? null,
  });
  sendCreated(res, supplier, 'Supplier created successfully');
}

export async function getAllSuppliers(req: AuthenticatedRequest, res: Response): Promise<void> {
  // Suppliers only ever see their own profile — never other vendors
  if (isSupplierRequest(req)) {
    const supplier = await getRequestSupplier(req);
    sendSuccess(res, [supplier], 200, undefined, {
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    return;
  }

  const q = req.query as unknown as SupplierQueryInput;
  const filters: SupplierFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
    status: q.status,
  };
  if (q.search !== undefined) filters.search = q.search;

  const { data, total } = await svc.getAllSuppliers(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getSupplierById(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  if (isSupplierRequest(req)) {
    const supplier = await getRequestSupplier(req);
    if (supplier.id !== id) throw new ForbiddenError('Access denied for this supplier profile');
  }
  sendSuccess(res, await svc.getSupplierById(id));
}

export async function updateSupplier(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateSupplierInput;
  const data: UpdateSupplierData = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.contactName !== undefined) data.contactName = body.contactName;
  if (body.email !== undefined) data.email = body.email;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.address !== undefined) data.address = body.address;
  if (body.city !== undefined) data.city = body.city;
  if (body.state !== undefined) data.state = body.state;
  if (body.country !== undefined) data.country = body.country;
  if (body.gstin !== undefined) data.gstin = body.gstin;
  if (body.rating !== undefined) data.rating = body.rating;
  if (body.leadTimeDays !== undefined) data.leadTimeDays = body.leadTimeDays;
  if (body.reliability !== undefined) data.reliability = body.reliability;
  if (body.materials !== undefined) data.materials = body.materials;

  sendSuccess(
    res,
    await svc.updateSupplier(parseId(req.params['id']), data),
    200,
    'Supplier updated',
  );
}

export async function deleteSupplier(req: Request, res: Response): Promise<void> {
  await svc.deleteSupplier(parseId(req.params['id']));
  sendNoContent(res);
}

export async function restoreSupplier(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.restoreSupplier(parseId(req.params['id'])), 200, 'Supplier restored');
}

// ══ CLIENTS ═══════════════════════════════════════════════════════════════════

export async function createClient(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateClientInput;
  const client = await svc.createClient({
    name: body.name,
    code: body.code,
    contactName: body.contactName ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    address: body.address ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    country: body.country,
    gstin: body.gstin ?? null,
  });
  sendCreated(res, client, 'Client created successfully');
}

export async function getAllClients(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (isClientRequest(req)) {
    const client = await getRequestClient(req);
    sendSuccess(res, [client], 200, undefined, {
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    return;
  }

  const q = req.query as unknown as ClientQueryInput;
  const filters: ClientFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
    status: q.status,
  };
  if (q.search !== undefined) filters.search = q.search;

  const { data, total } = await svc.getAllClients(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getClientById(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  if (isClientRequest(req)) {
    const client = await getRequestClient(req);
    if (client.id !== id) throw new ForbiddenError('Access denied for this client profile');
  }
  sendSuccess(res, await svc.getClientById(id));
}

export async function updateClient(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateClientInput;
  const data: UpdateClientData = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.contactName !== undefined) data.contactName = body.contactName;
  if (body.email !== undefined) data.email = body.email;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.address !== undefined) data.address = body.address;
  if (body.city !== undefined) data.city = body.city;
  if (body.state !== undefined) data.state = body.state;
  if (body.country !== undefined) data.country = body.country;
  if (body.gstin !== undefined) data.gstin = body.gstin;

  sendSuccess(res, await svc.updateClient(parseId(req.params['id']), data), 200, 'Client updated');
}

export async function deleteClient(req: Request, res: Response): Promise<void> {
  await svc.deleteClient(parseId(req.params['id']));
  sendNoContent(res);
}

export async function restoreClient(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.restoreClient(parseId(req.params['id'])), 200, 'Client restored');
}

// ══ CLIENT ORDERS ══════════════════════════════════════════════════════════════

export async function createClientOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as CreateClientOrderInput;
  const clientId = isClientRequest(req) ? (await getRequestClient(req)).id : body.clientId;
  const order = await svc.createClientOrder({
    clientId,
    product: body.product,
    quantity: body.quantity,
    unit: body.unit,
    value: body.value ?? null,
    currency: body.currency,
    requiredDate: body.requiredDate ?? null,
    notes: body.notes ?? null,
    createdById: req.user?.id ?? null,
  });
  sendCreated(res, order, 'Client order created successfully');
}

export async function getAllClientOrders(req: AuthenticatedRequest, res: Response): Promise<void> {
  const q = req.query as unknown as ClientOrderQueryInput;
  const filters: ClientOrderFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
    status: q.status,
  };
  if (isClientRequest(req)) {
    filters.clientId = (await getRequestClient(req)).id;
  } else if (q.clientId !== undefined) {
    filters.clientId = Number(q.clientId);
  }
  if (q.search !== undefined) filters.search = q.search;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await svc.getAllClientOrders(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getClientOrderById(req: AuthenticatedRequest, res: Response): Promise<void> {
  sendSuccess(res, await assertClientOrderAccess(req, parseId(req.params['id'])));
}

export async function updateClientOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  await assertClientOrderAccess(req, id);
  const body = req.body as UpdateClientOrderInput;
  const data: UpdateClientOrderData = {};
  if (body.product !== undefined) data.product = body.product;
  if (body.quantity !== undefined) data.quantity = body.quantity;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.value !== undefined) data.value = body.value;
  if (body.requiredDate !== undefined) data.requiredDate = body.requiredDate;
  if (body.notes !== undefined) data.notes = body.notes;

  sendSuccess(res, await svc.updateClientOrder(id, data), 200, 'Order updated');
}

export async function approveClientOrder(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.approveClientOrder(parseId(req.params['id'])), 200, 'Order approved');
}

export async function markClientOrderInProduction(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await svc.markInProduction(parseId(req.params['id'])),
    200,
    'Order marked in-production',
  );
}

export async function dispatchClientOrder(req: Request, res: Response): Promise<void> {
  const body = req.body as DispatchOrderInput;
  const order = await svc.dispatchClientOrder(parseId(req.params['id']), {
    dispatchNote: body.dispatchNote ?? null,
    challanNumber: body.challanNumber ?? null,
    invoiceNumber: body.invoiceNumber ?? null,
  });
  sendSuccess(res, order, 200, 'Order dispatched successfully');
}

export async function deliverClientOrder(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await svc.deliverClientOrder(parseId(req.params['id'])),
    200,
    'Order marked as delivered',
  );
}

export async function cancelClientOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  await assertClientOrderAccess(req, id);
  sendSuccess(res, await svc.cancelClientOrder(id), 200, 'Order cancelled');
}

// ══ PURCHASE ORDERS ═══════════════════════════════════════════════════════════

export async function createPurchaseOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as CreatePurchaseOrderInput;
  const po = await svc.createPurchaseOrder({
    supplierId: body.supplierId,
    material: body.material,
    quantity: body.quantity,
    unit: body.unit ?? null,
    totalCost: body.totalCost ?? null,
    currency: body.currency,
    expectedDelivery: body.expectedDelivery ?? null,
    notes: body.notes ?? null,
    createdById: req.user?.id ?? null,
  });
  sendCreated(res, po, 'Purchase order created successfully');
}

export async function getAllPurchaseOrders(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const q = req.query as unknown as PurchaseOrderQueryInput;
  const filters: PurchaseOrderFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
    status: q.status,
  };
  if (q.supplierId !== undefined) filters.supplierId = Number(q.supplierId);
  // Suppliers are always restricted to their own purchase orders
  if (isSupplierRequest(req)) filters.supplierId = (await getRequestSupplier(req)).id;
  if (q.search !== undefined) filters.search = q.search;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await svc.getAllPurchaseOrders(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getPurchaseOrderById(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const po = await svc.getPurchaseOrderById(parseId(req.params['id']));
  if (isSupplierRequest(req) && po.supplierId !== (await getRequestSupplier(req)).id) {
    throw new ForbiddenError('Access denied for this purchase order');
  }
  sendSuccess(res, po);
}

export async function updatePurchaseOrder(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdatePurchaseOrderInput;
  const data: UpdatePurchaseOrderData = {};
  if (body.material !== undefined) data.material = body.material;
  if (body.quantity !== undefined) data.quantity = body.quantity;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.totalCost !== undefined) data.totalCost = body.totalCost;
  if (body.expectedDelivery !== undefined) data.expectedDelivery = body.expectedDelivery;
  if (body.notes !== undefined) data.notes = body.notes;

  sendSuccess(
    res,
    await svc.updatePurchaseOrder(parseId(req.params['id']), data),
    200,
    'Purchase order updated',
  );
}

export async function confirmPurchaseOrder(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await svc.confirmPurchaseOrder(parseId(req.params['id'])),
    200,
    'Purchase order confirmed',
  );
}

export async function markPOInTransit(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await svc.markInTransit(parseId(req.params['id'])),
    200,
    'Purchase order marked in-transit',
  );
}

export async function deliverPurchaseOrder(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await svc.deliverPurchaseOrder(parseId(req.params['id'])),
    200,
    'Purchase order delivered',
  );
}

export async function cancelPurchaseOrder(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await svc.cancelPurchaseOrder(parseId(req.params['id'])),
    200,
    'Purchase order cancelled',
  );
}
