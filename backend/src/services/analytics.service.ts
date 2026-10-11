import { prisma } from '../lib/prismaClient';
import { logger } from '../logger';
import { NotFoundError } from '../errors';
import {
  buildInventoryIntelligence,
  buildMaterialForecast,
  buildPlantHealth,
  buildProductionPerformance,
  utcMidnight,
} from '../analytics/engine';
import type {
  AttendanceRow,
  IncidentRow,
  MaterialRow,
  TransactionRow,
  WorkOrderRow,
} from '../analytics/engine';
import type {
  AnalyticsQuery,
  InventoryIntelligence,
  MaterialForecast,
  PlantHealth,
  ProductionPerformance,
} from '../interfaces/analytics.interface';

type DecimalLike = { toNumber(): number } | number | null | undefined;

function num(v: DecimalLike): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : v.toNumber();
}

function numOrNull(v: DecimalLike): number | null {
  return v === null || v === undefined ? null : num(v);
}

export const DEFAULT_ANALYTICS_QUERY: AnalyticsQuery = {
  historyDays: 90,
  horizonDays: 30,
  serviceLevel: 0.95,
  defaultLeadTimeDays: 7,
  orderCost: 500,
  holdingRate: 0.2,
};

const materialSelect = {
  id: true,
  code: true,
  name: true,
  unit: true,
  category: true,
  currentStock: true,
  minStockLevel: true,
  maxStockLevel: true,
  costPerUnit: true,
} as const;

function toMaterialRow(m: {
  id: number;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  currentStock: DecimalLike;
  minStockLevel: DecimalLike;
  maxStockLevel: DecimalLike;
  costPerUnit: DecimalLike;
}): MaterialRow {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    unit: m.unit,
    category: m.category,
    currentStock: num(m.currentStock),
    minStockLevel: num(m.minStockLevel),
    maxStockLevel: numOrNull(m.maxStockLevel),
    costPerUnit: numOrNull(m.costPerUnit),
  };
}

function sinceDays(now: Date, days: number): Date {
  return new Date(utcMidnight(now).getTime() - days * 86_400_000);
}

/**
 * Smart Analytics: demand forecasting, dynamic reorder policy, ABC-XYZ,
 * stock-movement anomaly detection, OEE-style production performance with SPC,
 * and a composite Plant Health Index. All maths lives in src/analytics/.
 */
export class AnalyticsService {
  private async loadTransactions(since: Date, materialId?: number): Promise<TransactionRow[]> {
    const rows = await prisma.stockTransaction.findMany({
      where: {
        createdAt: { gte: since },
        ...(materialId !== undefined ? { materialId } : {}),
      },
      select: {
        id: true,
        materialId: true,
        type: true,
        quantity: true,
        createdAt: true,
        performedByName: true,
        departmentName: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((t) => ({
      id: t.id,
      materialId: t.materialId,
      type: t.type,
      quantity: num(t.quantity),
      createdAt: t.createdAt,
      performedByName: t.performedByName,
      departmentName: t.departmentName,
    }));
  }

  private loadSuppliers() {
    return prisma.supplier.findMany({
      where: { deletedAt: null, isActive: true },
      select: { leadTimeDays: true, materials: true },
    });
  }

  async getInventoryIntelligence(
    params: AnalyticsQuery = DEFAULT_ANALYTICS_QUERY,
    now: Date = new Date(),
  ): Promise<InventoryIntelligence> {
    logger.info('Building inventory intelligence', params);
    const since = sinceDays(now, params.historyDays);
    const [materials, transactions, suppliers, openPurchaseOrders] = await Promise.all([
      prisma.material.findMany({
        where: { deletedAt: null, isActive: true },
        select: materialSelect,
      }),
      this.loadTransactions(since),
      this.loadSuppliers(),
      prisma.purchaseOrder.findMany({
        where: { status: { in: ['PENDING', 'CONFIRMED', 'IN_TRANSIT'] } },
        select: { material: true, quantity: true },
      }),
    ]);
    return buildInventoryIntelligence({
      materials: materials.map(toMaterialRow),
      transactions,
      suppliers,
      openPurchaseOrders,
      params,
      now,
    });
  }

  async getMaterialForecast(
    materialId: number,
    params: AnalyticsQuery = DEFAULT_ANALYTICS_QUERY,
    now: Date = new Date(),
  ): Promise<MaterialForecast> {
    const material = await prisma.material.findFirst({
      where: { id: materialId, deletedAt: null },
      select: materialSelect,
    });
    if (material === null) throw new NotFoundError(`Material with id ${materialId} not found`);
    const [transactions, suppliers] = await Promise.all([
      this.loadTransactions(sinceDays(now, params.historyDays), materialId),
      this.loadSuppliers(),
    ]);
    return buildMaterialForecast({
      material: toMaterialRow(material),
      transactions,
      suppliers,
      params,
      now,
    });
  }

  private async loadWorkOrders(since: Date, department?: string): Promise<WorkOrderRow[]> {
    const rows = await prisma.workOrder.findMany({
      where: {
        deletedAt: null,
        ...(department !== undefined ? { departmentName: department } : {}),
        OR: [{ createdAt: { gte: since } }, { outputs: { some: { recordedAt: { gte: since } } } }],
      },
      select: {
        id: true,
        status: true,
        departmentName: true,
        targetQuantity: true,
        scheduledEnd: true,
        actualEnd: true,
        updatedAt: true,
        outputs: {
          where: { recordedAt: { gte: since } },
          select: { goodQty: true, rejectedQty: true, scrapQty: true, recordedAt: true },
        },
      },
    });
    return rows.map((wo) => ({
      id: wo.id,
      status: wo.status,
      departmentName: wo.departmentName,
      targetQuantity: num(wo.targetQuantity),
      scheduledEnd: wo.scheduledEnd,
      actualEnd: wo.actualEnd,
      updatedAt: wo.updatedAt,
      outputs: wo.outputs.map((o) => ({
        goodQty: num(o.goodQty),
        rejectedQty: num(o.rejectedQty),
        scrapQty: num(o.scrapQty),
        recordedAt: o.recordedAt,
      })),
    }));
  }

  async getProductionPerformance(
    historyDays = DEFAULT_ANALYTICS_QUERY.historyDays,
    department?: string,
    now: Date = new Date(),
  ): Promise<ProductionPerformance> {
    logger.info('Building production performance', { historyDays, department });
    const workOrders = await this.loadWorkOrders(sinceDays(now, historyDays), department);
    return buildProductionPerformance({ workOrders, historyDays, now });
  }

  async getPlantHealth(
    params: AnalyticsQuery = DEFAULT_ANALYTICS_QUERY,
    now: Date = new Date(),
  ): Promise<PlantHealth> {
    logger.info('Building plant health index');
    const since30 = sinceDays(now, 30);
    const [inventory, production, incidents, attendance] = await Promise.all([
      this.getInventoryIntelligence(params, now),
      this.getProductionPerformance(params.historyDays, undefined, now),
      prisma.securityIncident.findMany({
        where: { deletedAt: null, occurredAt: { gte: sinceDays(now, params.historyDays) } },
        select: { type: true, severity: true, departmentName: true, occurredAt: true },
      }),
      prisma.attendance.findMany({
        where: { date: { gte: since30 } },
        select: { status: true },
      }),
    ]);
    return buildPlantHealth({
      inventory,
      production,
      incidents: incidents as IncidentRow[],
      attendance: attendance as AttendanceRow[],
      now,
    });
  }
}
