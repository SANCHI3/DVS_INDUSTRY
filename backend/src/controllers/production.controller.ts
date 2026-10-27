import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../types';
import { ProductionService } from '../services/production.service';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import type {
  CreateWorkOrderInput,
  UpdateWorkOrderInput,
  WorkOrderQueryInput,
  WorkOrderStatusInput,
  CreateOutputInput,
  UpdateOutputInput,
  OutputQueryInput,
  ProductionKpiQueryInput,
  ProductionTrendQueryInput,
  SaveTargetInput,
} from '../validators/production.validator';
import type {
  CreateWorkOrderData,
  UpdateWorkOrderData,
  WorkOrderFilters,
  CreateOutputData,
  UpdateOutputData,
  OutputFilters,
  WorkOrderStatus,
  WorkOrderPriority,
} from '../interfaces';

const svc = new ProductionService();

function parseId(raw: string | string[] | undefined): number {
  return parseInt(String(raw ?? '0'), 10);
}

// ══ WORK ORDERS ══════════════════════════════════════════════════════════════

export async function createWorkOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as CreateWorkOrderInput;
  const data: CreateWorkOrderData = {
    product: body.product,
    targetQuantity: body.targetQuantity,
    unit: body.unit,
    priority: body.priority as WorkOrderPriority,
    scheduledStart: body.scheduledStart ?? null,
    scheduledEnd: body.scheduledEnd ?? null,
    departmentId: body.departmentId ?? null,
    departmentName: body.departmentName ?? null,
    assignedToId: body.assignedToId ?? null,
    assignedToName: body.assignedToName ?? null,
    clientOrderId: body.clientOrderId ?? null,
    notes: body.notes ?? null,
    createdById: req.user?.id ?? null,
  };
  const wo = await svc.createWorkOrder(data);
  sendCreated(res, wo, 'Work order created successfully');
}

export async function getAllWorkOrders(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as WorkOrderQueryInput;
  const filters: WorkOrderFilters = {
    page: q.page,
    pageSize: q.pageSize,
    sortBy: q.sortBy,
    sortOrder: q.sortOrder,
    status: q.status as WorkOrderStatus | 'all',
    priority: q.priority as WorkOrderPriority | 'all',
  };
  if (q.search !== undefined) filters.search = q.search;
  if (q.departmentId !== undefined) filters.departmentId = q.departmentId;
  if (q.clientOrderId !== undefined) filters.clientOrderId = q.clientOrderId;
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await svc.getAllWorkOrders(filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getWorkOrderById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getWorkOrderById(parseId(req.params['id'])));
}

export async function getWorkOrderDetail(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getWorkOrderDetail(parseId(req.params['id'])));
}

export async function updateWorkOrder(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as UpdateWorkOrderInput;
  const data: UpdateWorkOrderData = {};
  if (body.product !== undefined) data.product = body.product;
  if (body.targetQuantity !== undefined) data.targetQuantity = body.targetQuantity;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.scheduledStart !== undefined) data.scheduledStart = body.scheduledStart;
  if (body.scheduledEnd !== undefined) data.scheduledEnd = body.scheduledEnd;
  if (body.actualStart !== undefined) data.actualStart = body.actualStart;
  if (body.actualEnd !== undefined) data.actualEnd = body.actualEnd;
  if (body.status !== undefined) data.status = body.status as WorkOrderStatus;
  if (body.priority !== undefined) data.priority = body.priority as WorkOrderPriority;
  if (body.departmentId !== undefined) data.departmentId = body.departmentId;
  if (body.departmentName !== undefined) data.departmentName = body.departmentName;
  if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId;
  if (body.assignedToName !== undefined) data.assignedToName = body.assignedToName;
  if (body.clientOrderId !== undefined) data.clientOrderId = body.clientOrderId;
  if (body.notes !== undefined) data.notes = body.notes;

  sendSuccess(res, await svc.updateWorkOrder(id, data), 200, 'Work order updated successfully');
}

export async function transitionStatus(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as WorkOrderStatusInput;
  const wo = await svc.transitionStatus(
    id,
    body.status as WorkOrderStatus,
    body.actualStart ?? null,
    body.actualEnd ?? null,
    body.notes ?? null,
  );
  sendSuccess(res, wo, 200, `Work order status updated to ${wo.status}`);
}

export async function deleteWorkOrder(req: Request, res: Response): Promise<void> {
  await svc.deleteWorkOrder(parseId(req.params['id']));
  sendNoContent(res);
}

// ══ OUTPUTS ══════════════════════════════════════════════════════════════════

export async function addOutput(req: AuthenticatedRequest, res: Response): Promise<void> {
  const workOrderId = parseId(req.params['id']);
  const body = req.body as CreateOutputInput;
  const data: Omit<CreateOutputData, 'workOrderId'> = {
    goodQty: body.goodQty,
    rejectedQty: body.rejectedQty,
    scrapQty: body.scrapQty,
    recordedAt: body.recordedAt,
    // The recorder is always the authenticated user, never a body field
    recordedById: req.user?.id ?? null,
    recordedByName: req.user?.fullName ?? body.recordedByName ?? null,
    remarks: body.remarks ?? null,
  };
  const output = await svc.addOutput(workOrderId, data);
  sendCreated(res, output, 'Output recorded successfully');
}

export async function getOutputs(req: Request, res: Response): Promise<void> {
  const workOrderId = parseId(req.params['id']);
  const q = req.query as unknown as OutputQueryInput;
  const filters: Omit<OutputFilters, 'workOrderId'> = {
    page: q.page,
    pageSize: q.pageSize,
    sortOrder: q.sortOrder,
  };
  if (q.fromDate !== undefined) filters.fromDate = q.fromDate;
  if (q.toDate !== undefined) filters.toDate = q.toDate;

  const { data, total } = await svc.getOutputsByWorkOrder(workOrderId, filters);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function updateOutput(req: Request, res: Response): Promise<void> {
  const workOrderId = parseId(req.params['id']);
  const outputId = parseId(req.params['outputId']);
  const body = req.body as UpdateOutputInput;
  const data: UpdateOutputData = {};
  if (body.goodQty !== undefined) data.goodQty = body.goodQty;
  if (body.rejectedQty !== undefined) data.rejectedQty = body.rejectedQty;
  if (body.scrapQty !== undefined) data.scrapQty = body.scrapQty;
  if (body.recordedAt !== undefined) data.recordedAt = body.recordedAt;
  if (body.recordedByName !== undefined) data.recordedByName = body.recordedByName;
  if (body.remarks !== undefined) data.remarks = body.remarks;

  sendSuccess(
    res,
    await svc.updateOutput(workOrderId, outputId, data),
    200,
    'Output updated successfully',
  );
}

export async function deleteOutput(req: Request, res: Response): Promise<void> {
  const workOrderId = parseId(req.params['id']);
  const outputId = parseId(req.params['outputId']);
  await svc.deleteOutput(workOrderId, outputId);
  sendNoContent(res);
}

// ══ KPIs & TREND ═════════════════════════════════════════════════════════════

export async function getKPIs(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ProductionKpiQueryInput;
  sendSuccess(res, await svc.getKPIs(q.departmentId, q.fromDate, q.toDate));
}

export async function getProductionTrend(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ProductionTrendQueryInput;
  sendSuccess(res, await svc.getProductionTrend(q.days ?? 7, q.departmentId));
}

// ══ MONTHLY TARGETS ══════════════════════════════════════════════════════════

export async function getTargets(req: Request, res: Response): Promise<void> {
  const { year } = req.query as unknown as { year?: number };
  sendSuccess(res, await svc.getTargetsForYear(year ?? new Date().getUTCFullYear()));
}

export async function getMonthlyPerformance(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await svc.getMonthlyPerformance(String(req.params['month'])));
}

export async function saveTarget(req: AuthenticatedRequest, res: Response): Promise<void> {
  const month = String(req.params['month']);
  const body = req.body as SaveTargetInput;
  const { target, created } = await svc.saveTarget(
    month,
    {
      outputTarget: Number(body.outputTarget),
      unit: body.unit,
      targetCompletionRate: body.targetCompletionRate ?? null,
      maxRejectionRate: body.maxRejectionRate ?? null,
      targetEmployeeEfficiency: body.targetEmployeeEfficiency ?? null,
      notes: body.notes ?? null,
      updatedById: req.user?.id ?? null,
    },
    body.expectedUpdatedAt,
  );
  if (created) sendCreated(res, target, `Target for ${month} saved`);
  else sendSuccess(res, target, 200, `Target for ${month} updated`);
}

export async function deleteTarget(req: Request, res: Response): Promise<void> {
  await svc.deleteTarget(String(req.params['month']));
  sendNoContent(res);
}
