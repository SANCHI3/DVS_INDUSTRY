/**
 * Ask DVS tools: thin, READ-ONLY wrappers around the existing services.
 *
 * Each tool lists the roles allowed to use it, copied from the GET route that
 * serves the same data (see the comment on each tool). The LLM is offered only
 * the tools the signed-in user's role may use, and executeTool() checks the
 * role again before running anything. Results are compact (max 30 rows),
 * use names instead of internal ids, and pass through stripSensitive().
 */
import { z } from 'zod';
import { ROLES, type RoleName } from '../constants';
import { ForbiddenError } from '../errors';
import { AnalyticsService } from '../services/analytics.service';
import { InventoryService } from '../services/inventory.service';
import { OrdersService } from '../services/orders.service';
import { ProductionService } from '../services/production.service';
import { SecurityService } from '../services/security.service';
import { WorkforceService } from '../services/workforce.service';
import { stripSensitive } from './sanitize';

export const MAX_ROWS = 30;

/** Staff roles that may use the assistant (supplier/client portals have their own pages). */
export const ASSISTANT_ROLES = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.HR,
  ROLES.STORE,
  ROLES.PRODUCTION,
  ROLES.SALES,
] as const satisfies readonly RoleName[];

const STAFF = ASSISTANT_ROLES;
// analytics.routes.ts
const ANALYTICS_STORE = [ROLES.ADMIN, ROLES.MANAGER, ROLES.STORE] as const;
const ANALYTICS_MANAGEMENT = [ROLES.ADMIN, ROLES.MANAGER] as const;
// production.routes.ts PROD_READ
const PROD_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION, ROLES.HR] as const;
// workforce.routes.ts HR_MGR
const HR_MGR = [ROLES.ADMIN, ROLES.MANAGER, ROLES.HR] as const;
// security.routes.ts SEC_READ
const SEC_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION] as const;

export type AssistantModule =
  'Inventory' | 'Smart Analytics' | 'Orders' | 'Production' | 'Attendance' | 'AI Security';

export interface AssistantUser {
  id: number;
  email: string;
  role: string;
}

export interface AssistantTool {
  name: string;
  description: string;
  module: AssistantModule;
  roles: readonly RoleName[];
  /** JSON schema of the arguments, sent to the LLM. */
  parameters: Record<string, unknown>;
  /** Validates the LLM's arguments before the tool runs. */
  schema: z.ZodType;
  run: (args: never, now: Date) => Promise<unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inventory = new InventoryService();
const analytics = new AnalyticsService();
const orders = new OrdersService();
const production = new ProductionService();
const workforce = new WorkforceService();
const security = new SecurityService();

function round(value: number | string | null | undefined, digits = 1): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Local calendar date as YYYY-MM-DD. */
export function day(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function startOfDay(now: Date, daysBack = 0): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
}

const PERIODS = ['today', 'week', 'month'] as const;
type Period = (typeof PERIODS)[number];

/** today = since midnight, week = the last 7 days, month = since the 1st. */
function periodRange(period: Period, now: Date): { from: Date; days: number; label: string } {
  if (period === 'today') return { from: startOfDay(now), days: 1, label: `today (${day(now)})` };
  if (period === 'week')
    return {
      from: startOfDay(now, 6),
      days: 7,
      label: `the last 7 days (${day(startOfDay(now, 6))} to ${day(now)})`,
    };
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from, days: now.getDate(), label: `this month (${day(from)} to ${day(now)})` };
}

function matches(text: string | null | undefined, query: string | undefined): boolean {
  if (!query) return true;
  return (text ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

function capped<T>(rows: T[]) {
  return {
    rows: rows.slice(0, MAX_ROWS),
    shown: Math.min(rows.length, MAX_ROWS),
    total: rows.length,
  };
}

/** Most rows a tool reads to compute its counts (10 pages of 100). */
const MAX_SCAN = 1000;

/**
 * Read every page of a list endpoint (up to MAX_SCAN rows) so counts are
 * complete, not just the first page. `complete` is false when the scan stopped
 * at MAX_SCAN.
 */
async function fetchAll<T>(
  page: (pageNumber: number) => Promise<{ data: T[]; total: number }>,
): Promise<{ rows: T[]; total: number; complete: boolean }> {
  const rows: T[] = [];
  let total = 0;
  for (let pageNumber = 1; rows.length < MAX_SCAN; pageNumber++) {
    const result = await page(pageNumber);
    rows.push(...result.data);
    total = result.total;
    if (result.data.length === 0 || rows.length >= total) break;
  }
  return { rows, total, complete: rows.length >= total };
}

const INCIDENT_LABELS: Record<string, string> = {
  FIGHT: 'possible fight',
  FALL: 'person has fallen',
  FIRE: 'fire or smoke',
  SMOKE: 'fire or smoke',
  FIRE_SMOKE: 'fire or smoke',
  CROWD: 'crowd gathering',
  OTHER: 'unusual activity',
  LOITERING: 'someone lingering',
  INTRUSION: 'person in restricted area',
};

function incidentLabel(type: string): string {
  return INCIDENT_LABELS[type] ?? type.replace(/_/g, ' ').toLowerCase();
}

const INCIDENT_TYPE_GROUPS: Record<string, string[]> = {
  fight: ['FIGHT'],
  fall: ['FALL'],
  fire_smoke: ['FIRE', 'SMOKE', 'FIRE_SMOKE'],
  crowd: ['CROWD'],
  unusual_activity: ['OTHER'],
};

const OPEN_PO = new Set(['PENDING', 'CONFIRMED', 'IN_TRANSIT']);
const OPEN_CLIENT_ORDER = new Set(['PENDING', 'APPROVED', 'IN_PRODUCTION']);
const OPEN_WORK_ORDER = new Set(['DRAFT', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD']);

function daysLate(due: Date | null, now: Date): number | null {
  if (due === null) return null;
  const late = Math.floor(
    (startOfDay(now).getTime() - startOfDay(new Date(due)).getTime()) / 86_400_000,
  );
  return late > 0 ? late : null;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const searchMaterials: AssistantTool = {
  name: 'searchMaterials',
  description:
    'Find materials by name or code and return their current stock, unit and reorder level.',
  module: 'Inventory',
  roles: STAFF, // inventory.routes.ts GET / (ALL_ROLES)
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Part of the material name or code' } },
    required: ['query'],
  },
  schema: z.object({ query: z.string().min(1).max(100) }),
  run: async ({ query }: { query: string }) => {
    const result = await inventory.getAllMaterials({
      search: query,
      pageSize: MAX_ROWS,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    return {
      matches: result.total,
      materials: result.data.map((m) => ({
        name: m.name,
        code: m.code,
        currentStock: round(m.currentStock, 2),
        unit: m.unit,
        reorderLevel: round(m.minStockLevel, 2),
        belowReorderLevel: m.isLowStock ?? Number(m.currentStock) <= Number(m.minStockLevel),
        location: m.location,
      })),
    };
  },
};

const getLowStockMaterials: AssistantTool = {
  name: 'getLowStockMaterials',
  description: 'List materials whose stock is at or below their reorder level.',
  module: 'Inventory',
  roles: STAFF, // inventory.routes.ts GET /?lowStockOnly (ALL_ROLES)
  parameters: { type: 'object', properties: {} },
  schema: z.object({}),
  run: async () => {
    const result = await fetchAll((page) =>
      inventory.getAllMaterials({
        lowStockOnly: true,
        page,
        pageSize: 100,
        sortBy: 'currentStock',
        sortOrder: 'asc',
      }),
    );
    const rows = result.rows.map((m) => ({
      name: m.name,
      currentStock: round(m.currentStock, 2),
      unit: m.unit,
      reorderLevel: round(m.minStockLevel, 2),
    }));
    const { rows: shown, total } = capped(rows);
    return { lowStockCount: total, materials: shown };
  },
};

const getStockOutForecast: AssistantTool = {
  name: 'getStockOutForecast',
  description:
    'Forecast when materials will run out (Smart Analytics). Without a material name, lists the materials at risk, soonest first. Gives the predicted stock-out date, days of stock left, whether it is critical, and the suggested order quantity.',
  module: 'Smart Analytics',
  roles: ANALYTICS_STORE, // analytics.routes.ts GET /inventory (STORE_ROLES)
  parameters: {
    type: 'object',
    properties: {
      materialName: { type: 'string', description: 'Optional part of a material name' },
    },
  },
  schema: z.object({ materialName: z.string().max(100).optional() }),
  run: async ({ materialName }: { materialName?: string }, now: Date) => {
    const intel = await analytics.getInventoryIntelligence(undefined, now);
    const selected = intel.materials
      .filter((m) =>
        materialName
          ? matches(m.name, materialName) || matches(m.code, materialName)
          : m.status === 'CRITICAL' || m.status === 'REORDER',
      )
      .sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity));
    const { rows, total } = capped(
      selected.map((m) => ({
        name: m.name,
        currentStock: round(m.currentStock, 2),
        unit: m.unit,
        daysOfStockLeft: round(m.daysOfCover),
        predictedStockOutDate: day(m.predictedStockoutDate),
        critical: m.status === 'CRITICAL',
        status: m.status.toLowerCase().replace('_', ' '),
        reorderPoint: round(m.reorderPoint, 2),
        suggestedOrderQty: round(m.suggestedOrderQty, 2),
        onOrder: round(m.onOrder, 2),
      })),
    );
    return {
      today: day(now),
      criticalCount: intel.summary.critical,
      reorderCount: intel.summary.reorder,
      matching: total,
      materials: rows,
    };
  },
};

const getPurchaseOrders: AssistantTool = {
  name: 'getPurchaseOrders',
  description:
    'List purchase orders to suppliers, optionally by status, supplier name or PO number. Marks overdue (late) open orders.',
  module: 'Orders',
  roles: STAFF, // orders.routes.ts GET /purchase-orders (SUPPLIER_ORDER_READ_ROLES, staff only here)
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['PENDING', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'OPEN', 'OVERDUE'],
        description:
          'OPEN = not yet delivered or cancelled; OVERDUE = open and past the expected delivery date',
      },
      supplierName: { type: 'string' },
      poNumber: { type: 'string', description: 'A purchase order number such as PO-0012' },
    },
  },
  schema: z.object({
    status: z
      .enum(['PENDING', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'OPEN', 'OVERDUE'])
      .optional(),
    supplierName: z.string().max(100).optional(),
    poNumber: z.string().max(50).optional(),
  }),
  run: async (
    {
      status,
      supplierName,
      poNumber,
    }: { status?: string; supplierName?: string; poNumber?: string },
    now: Date,
  ) => {
    const direct = status && status !== 'OPEN' && status !== 'OVERDUE' ? status : undefined;
    const result = await fetchAll((page) =>
      orders.getAllPurchaseOrders({
        status: direct as never,
        search: poNumber ?? supplierName,
        page,
        pageSize: 100,
        sortBy: 'expectedDelivery',
        sortOrder: 'asc',
      }),
    );
    const all = result.rows
      .filter((po) => matches(po.supplierName, supplierName) && matches(po.poNumber, poNumber))
      .filter((po) => status !== 'OPEN' || OPEN_PO.has(po.status))
      .map((po) => {
        const open = OPEN_PO.has(po.status);
        const late = open ? daysLate(po.expectedDelivery, now) : null;
        return {
          poNumber: po.poNumber,
          supplier: po.supplierName,
          material: po.material,
          quantity: round(po.quantity, 2),
          unit: po.unit,
          status: po.status.toLowerCase().replace('_', ' '),
          orderDate: day(po.orderDate),
          expectedDelivery: day(po.expectedDelivery),
          overdue: late !== null,
          daysLate: late,
        };
      })
      .filter((po) => status !== 'OVERDUE' || po.overdue);
    const { rows, total } = capped(all);
    return {
      today: day(now),
      count: total,
      overdueCount: all.filter((po) => po.overdue).length,
      purchaseOrders: rows,
    };
  },
};

const getSupplierScorecard: AssistantTool = {
  name: 'getSupplierScorecard',
  description:
    'Supplier performance over the last 180 days: grade A-D, on-time delivery percentage, late open orders and average delay.',
  module: 'Smart Analytics',
  roles: ANALYTICS_STORE, // analytics.routes.ts GET /suppliers (STORE_ROLES)
  parameters: { type: 'object', properties: { supplierName: { type: 'string' } } },
  schema: z.object({ supplierName: z.string().max(100).optional() }),
  run: async ({ supplierName }: { supplierName?: string }, now: Date) => {
    const card = await analytics.getSupplierScorecard(undefined, now);
    const { rows, total } = capped(
      card.suppliers
        .filter((s) => matches(s.name, supplierName))
        .map((s) => ({
          name: s.name,
          grade: s.grade ?? 'not enough deliveries to grade',
          onTimePercent: round(s.onTimeRate),
          purchaseOrders: s.purchaseOrders,
          delivered: s.delivered,
          lateOpenOrders: s.overdueOpen,
          averageDelayDays: round(s.averageDelayDays),
        })),
    );
    return {
      overallOnTimePercent: round(card.summary.overallOnTimeRate),
      lateOpenOrders: card.summary.overdueOpen,
      supplierCount: total,
      suppliers: rows,
    };
  },
};

const getClientOrders: AssistantTool = {
  name: 'getClientOrders',
  description:
    'List customer (client) orders, optionally by status or order number. Marks open orders past their required date as late.',
  module: 'Orders',
  roles: STAFF, // orders.routes.ts GET /client-orders (CLIENT_READ_ROLES, staff only here)
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: [
          'PENDING',
          'APPROVED',
          'IN_PRODUCTION',
          'DISPATCHED',
          'DELIVERED',
          'CANCELLED',
          'OPEN',
        ],
      },
      orderNumber: { type: 'string', description: 'A client order number such as ORD-0012' },
    },
  },
  schema: z.object({
    status: z
      .enum([
        'PENDING',
        'APPROVED',
        'IN_PRODUCTION',
        'DISPATCHED',
        'DELIVERED',
        'CANCELLED',
        'OPEN',
      ])
      .optional(),
    orderNumber: z.string().max(50).optional(),
  }),
  run: async ({ status, orderNumber }: { status?: string; orderNumber?: string }, now: Date) => {
    const result = await fetchAll((page) =>
      orders.getAllClientOrders({
        status: status && status !== 'OPEN' ? (status as never) : undefined,
        search: orderNumber,
        page,
        pageSize: 100,
        sortBy: 'requiredDate',
        sortOrder: 'asc',
      }),
    );
    const all = result.rows
      .filter((o) => (status === 'OPEN' ? OPEN_CLIENT_ORDER.has(o.status) : true))
      .filter((o) => matches(o.orderNumber, orderNumber))
      .map((o) => {
        const late = OPEN_CLIENT_ORDER.has(o.status) ? daysLate(o.requiredDate, now) : null;
        return {
          orderNumber: o.orderNumber,
          client: o.clientName,
          product: o.product,
          quantity: o.quantity,
          unit: o.unit,
          status: o.status.toLowerCase().replace('_', ' '),
          orderDate: day(o.orderDate),
          requiredDate: day(o.requiredDate),
          late: late !== null,
          daysLate: late,
        };
      });
    const { rows, total } = capped(all);
    return {
      today: day(now),
      count: total,
      lateCount: all.filter((o) => o.late).length,
      clientOrders: rows,
    };
  },
};

const getWorkOrders: AssistantTool = {
  name: 'getWorkOrders',
  description:
    'List production work orders, optionally by status, with target and produced quantities. Marks open orders past their scheduled end as overdue.',
  module: 'Production',
  roles: PROD_READ, // production.routes.ts GET /work-orders (PROD_READ)
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['DRAFT', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'OPEN'],
      },
    },
  },
  schema: z.object({
    status: z
      .enum(['DRAFT', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'OPEN'])
      .optional(),
  }),
  run: async ({ status }: { status?: string }, now: Date) => {
    const result = await fetchAll((page) =>
      production.getAllWorkOrders({
        status: status && status !== 'OPEN' ? (status as never) : undefined,
        page,
        pageSize: 100,
        sortBy: 'scheduledStart',
        sortOrder: 'asc',
      }),
    );
    const all = result.rows
      .filter((w) => (status === 'OPEN' ? OPEN_WORK_ORDER.has(w.status) : true))
      .map((w) => {
        const late = OPEN_WORK_ORDER.has(w.status) ? daysLate(w.scheduledEnd, now) : null;
        return {
          workOrder: w.workOrderNumber,
          product: w.product,
          target: round(w.targetQuantity, 2),
          produced: round(w.producedQty, 2),
          unit: w.unit,
          status: w.status.toLowerCase().replace('_', ' '),
          priority: w.priority.toLowerCase(),
          department: w.departmentName,
          scheduledEnd: day(w.scheduledEnd),
          overdue: late !== null,
          daysLate: late,
        };
      });
    const { rows, total } = capped(all);
    return {
      today: day(now),
      count: total,
      overdueCount: all.filter((w) => w.overdue).length,
      workOrders: rows,
    };
  },
};

const getProductionKpis: AssistantTool = {
  name: 'getProductionKpis',
  description:
    'Production totals for today, the last 7 days or this month: good units produced, rejected and scrapped units, plus the work orders active and overdue right now.',
  module: 'Production',
  roles: PROD_READ, // production.routes.ts GET /kpis and /trend (PROD_READ)
  parameters: {
    type: 'object',
    properties: { period: { type: 'string', enum: [...PERIODS] } },
    required: ['period'],
  },
  schema: z.object({ period: z.enum(PERIODS) }),
  run: async ({ period }: { period: Period }, now: Date) => {
    const range = periodRange(period, now);
    // Units come from outputs recorded in the period (the same numbers as the
    // production trend chart); work-order counts from the KPI endpoint.
    const [trend, kpis] = await Promise.all([
      production.getProductionTrend(range.days),
      production.getKPIs(undefined, range.from),
    ]);
    const sum = (key: 'produced' | 'rejected' | 'scrap') =>
      round(
        trend.reduce((total, d) => total + d[key], 0),
        2,
      );
    return {
      period: range.label,
      goodUnitsProduced: sum('produced'),
      rejectedUnits: sum('rejected'),
      scrapUnits: sum('scrap'),
      activeWorkOrders: kpis.activeWorkOrders,
      overdueWorkOrders: kpis.overdueWorkOrders,
    };
  },
};

const getAttendanceSummary: AssistantTool = {
  name: 'getAttendanceSummary',
  description:
    'Attendance for one day (default today): how many employees are present, absent, late, on half day or on leave, overall and by department.',
  module: 'Attendance',
  roles: HR_MGR, // workforce.routes.ts GET /attendance/summary (HR_MGR)
  parameters: {
    type: 'object',
    properties: { date: { type: 'string', description: 'Date as YYYY-MM-DD; default today' } },
  },
  schema: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  run: async ({ date }: { date?: string }, now: Date) => {
    const target = date ? new Date(`${date}T00:00:00`) : startOfDay(now);
    const s = await workforce.getDailySummary(target);
    return {
      date: day(target),
      totalEmployees: s.totalEmployees,
      present: s.present,
      absent: s.absent,
      late: s.late,
      halfDay: s.halfDay,
      onLeave: s.onLeave,
      attendanceRate: s.attendanceRate,
      byDepartment: s.byDepartment
        .slice(0, MAX_ROWS)
        .map((d) => ({ department: d.departmentName, present: d.present, total: d.total })),
    };
  },
};

// No strict enum here: the provider rejects the whole request when the model
// writes another value (e.g. "security"), so any other value means all kinds.
const INCIDENT_TYPE_PARAM = {
  type: 'string',
  description: `Optional kind of incident: ${Object.keys(INCIDENT_TYPE_GROUPS).join(', ')}. Leave it out for all kinds (security or safety incidents in general).`,
};

const getOpenIncidents: AssistantTool = {
  name: 'getOpenIncidents',
  description:
    'Security and safety incidents (AI Security) from the CCTV AI and staff that are still open or being investigated, most recent first.',
  module: 'AI Security',
  roles: SEC_READ, // security.routes.ts GET /incidents (SEC_READ)
  parameters: { type: 'object', properties: { type: INCIDENT_TYPE_PARAM } },
  schema: z.object({
    type: z
      .string()
      .optional()
      .transform((t) => (t !== undefined && t in INCIDENT_TYPE_GROUPS ? t : undefined)),
  }),
  run: async ({ type }: { type?: string }) => {
    const [open, investigating] = await Promise.all(
      (['OPEN', 'INVESTIGATING'] as const).map((status) =>
        fetchAll((page) =>
          security.getAllIncidents({
            status,
            page,
            pageSize: 100,
            sortBy: 'occurredAt',
            sortOrder: 'desc',
          }),
        ),
      ),
    );
    const allowed = type ? new Set<string>(INCIDENT_TYPE_GROUPS[type]) : null;
    const all = [...open!.rows, ...investigating!.rows]
      .filter((i) => allowed === null || allowed.has(i.type))
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .map((i) => ({
        what: incidentLabel(i.type),
        severity: i.severity.toLowerCase(),
        status: i.status.toLowerCase(),
        location: i.location,
        when: new Date(i.occurredAt).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
        assignedTo: i.assignedToName,
      }));
    const { rows, total } = capped(all);
    return {
      openCount: total,
      criticalCount: all.filter((i) => i.severity === 'critical').length,
      incidents: rows,
    };
  },
};

const getIncidentSummary: AssistantTool = {
  name: 'getIncidentSummary',
  description:
    'Count of security and safety incidents (AI Security) for today, the last 7 days or this month, by kind, severity and status.',
  module: 'AI Security',
  roles: SEC_READ, // security.routes.ts GET /incidents and /kpis (SEC_READ)
  parameters: {
    type: 'object',
    properties: { period: { type: 'string', enum: [...PERIODS] } },
    required: ['period'],
  },
  schema: z.object({ period: z.enum(PERIODS) }),
  run: async ({ period }: { period: Period }, now: Date) => {
    const range = periodRange(period, now);
    const result = await fetchAll((page) =>
      security.getAllIncidents({
        fromDate: range.from,
        page,
        pageSize: 100,
        sortBy: 'occurredAt',
        sortOrder: 'desc',
      }),
    );
    const count = (key: (i: (typeof result.rows)[number]) => string) =>
      Object.entries(
        result.rows.reduce<Record<string, number>>((acc, i) => {
          const k = key(i);
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([name, n]) => ({ name, count: n }));
    return {
      period: range.label,
      total: result.total,
      ...(result.complete ? {} : { breakdownCovers: result.rows.length }),
      byKind: count((i) => incidentLabel(i.type)),
      bySeverity: count((i) => i.severity.toLowerCase()),
      byStatus: count((i) => i.status.toLowerCase()),
    };
  },
};

const getPlantHealth: AssistantTool = {
  name: 'getPlantHealth',
  description:
    'Overall plant health score (0-100) and grade, with the score for inventory, production, quality, safety and workforce.',
  module: 'Smart Analytics',
  roles: ANALYTICS_MANAGEMENT, // analytics.routes.ts GET /plant-health (MANAGEMENT_ROLES)
  parameters: { type: 'object', properties: {} },
  schema: z.object({}),
  run: async (_args: Record<string, never>, now: Date) => {
    const health = await analytics.getPlantHealth(undefined, now);
    return {
      score: round(health.score),
      grade: health.grade,
      parts: health.components.map((c) => ({
        area: c.label,
        score: round(c.score),
        detail: c.detail,
      })),
    };
  },
};

export const TOOLS: readonly AssistantTool[] = [
  searchMaterials,
  getLowStockMaterials,
  getStockOutForecast,
  getPurchaseOrders,
  getSupplierScorecard,
  getClientOrders,
  getWorkOrders,
  getProductionKpis,
  getAttendanceSummary,
  getOpenIncidents,
  getIncidentSummary,
  getPlantHealth,
];

function allowed(tool: AssistantTool, role: string): boolean {
  return (tool.roles as readonly string[]).includes(role);
}

/** The tools this role may use; only these are offered to the LLM. */
export function toolsForRole(role: string): AssistantTool[] {
  return TOOLS.filter((tool) => allowed(tool, role));
}

/** Tool definitions in the OpenAI chat-completions format. */
export function toolSpecs(tools: readonly AssistantTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export interface ToolRun {
  name: string;
  args: Record<string, unknown>;
  module: AssistantModule;
  result: unknown;
}

/**
 * Run one tool for this user. The role is checked again here, so a tool name
 * the LLM was never offered is still rejected.
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  user: AssistantUser,
  now: Date = new Date(),
): Promise<ToolRun> {
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) throw new ForbiddenError(`Unknown assistant tool: ${name}`);
  if (!allowed(tool, user.role)) throw new ForbiddenError(`Role ${user.role} may not use ${name}`);
  const args = tool.schema.parse(rawArgs ?? {}) as Record<string, unknown>;
  const result = await tool.run(args as never, now);
  return { name, args, module: tool.module, result: stripSensitive(result) };
}
