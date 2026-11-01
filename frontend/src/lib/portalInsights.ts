/**
 * Figures the supplier and client portals derive from their own orders:
 * catalogues, on-time delivery, monthly trends and notifications.
 */
import type { ClientOrderDto, PurchaseOrderDto } from './services/orders.service';
import type { PortalMessageDto } from './services/portal.service';

const DAY_MS = 86_400_000;

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

/** The last `months` calendar months as YYYY-MM, oldest first. */
function monthsBack(months: number, today: Date): string[] {
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (months - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

// ── Supplier ──────────────────────────────────────────────────────────────────

export interface SuppliedMaterial {
  material:  string;
  unit:      string;
  orders:    number;
  quantity:  number;
  value:     number;
  /** Total cost / quantity of the most recent order, when both are known */
  lastRate:  number | null;
  lastOrder: string;
}

/** One row per material DVS has ordered from this supplier, newest first. */
export function suppliedMaterials(pos: PurchaseOrderDto[]): SuppliedMaterial[] {
  const byMaterial = new Map<string, SuppliedMaterial>();
  const newestFirst = pos.filter((po) => po.status !== 'CANCELLED')
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  for (const po of newestFirst) {
    const quantity = Number(po.quantity);
    const value = Number(po.totalCost ?? 0);
    const row = byMaterial.get(po.material);
    if (row === undefined) {
      byMaterial.set(po.material, {
        material: po.material, unit: po.unit ?? '', orders: 1, quantity, value,
        lastRate: po.totalCost !== null && quantity > 0 ? value / quantity : null,
        lastOrder: po.orderDate,
      });
    } else {
      row.orders += 1;
      row.quantity += quantity;
      row.value += value;
    }
  }
  return [...byMaterial.values()];
}

export interface DeliveryStats {
  /** Delivered orders with both an expected and an actual date */
  measured:    number;
  onTime:      number;
  /** On-time share in percent; null when nothing could be measured */
  onTimePct:   number | null;
  /** Mean days late over the late deliveries */
  avgDaysLate: number | null;
}

export function deliveryStats(pos: PurchaseOrderDto[]): DeliveryStats {
  const lateness = pos
    .filter((po) => po.status === 'DELIVERED' && po.expectedDelivery !== null && po.actualDelivery !== null)
    .map((po) => Math.round((Date.parse(po.actualDelivery!) - Date.parse(po.expectedDelivery!)) / DAY_MS));
  const late = lateness.filter((days) => days > 0);
  const onTime = lateness.length - late.length;
  return {
    measured: lateness.length,
    onTime,
    onTimePct: lateness.length ? (onTime / lateness.length) * 100 : null,
    avgDaysLate: late.length ? late.reduce((a, b) => a + b, 0) / late.length : null,
  };
}

export interface MonthPoint { month: string; orders: number; value: number; onTimePct: number | null }

/** Purchase orders per month over the last `months` months, oldest first. */
export function purchaseOrderTrend(pos: PurchaseOrderDto[], months = 6, today = new Date()): MonthPoint[] {
  return monthsBack(months, today).map((key) => {
    const inMonth = pos.filter((po) => monthKey(po.orderDate) === key && po.status !== 'CANCELLED');
    return {
      month: monthLabel(key),
      orders: inMonth.length,
      value: inMonth.reduce((sum, po) => sum + Number(po.totalCost ?? 0), 0),
      onTimePct: deliveryStats(inMonth).onTimePct,
    };
  });
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface OrderedProduct {
  product:   string;
  unit:      string;
  orders:    number;
  quantity:  number;
  /** Value / quantity of the most recent priced order */
  lastPrice: number | null;
  lastOrder: string;
}

/** The products this client has ordered from DVS, most recent first. */
export function orderedProducts(orders: ClientOrderDto[]): OrderedProduct[] {
  const byProduct = new Map<string, OrderedProduct>();
  const newestFirst = orders.filter((o) => o.status !== 'CANCELLED')
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  for (const order of newestFirst) {
    const price = order.value !== null && order.quantity > 0 ? Number(order.value) / order.quantity : null;
    const row = byProduct.get(order.product);
    if (row === undefined) {
      byProduct.set(order.product, {
        product: order.product, unit: order.unit, orders: 1, quantity: order.quantity,
        lastPrice: price, lastOrder: order.orderDate,
      });
    } else {
      row.orders += 1;
      row.quantity += order.quantity;
      row.lastPrice ??= price;
    }
  }
  return [...byProduct.values()];
}

/** Client orders per month over the last `months` months, oldest first. */
export function clientOrderTrend(orders: ClientOrderDto[], months = 6, today = new Date()): MonthPoint[] {
  return monthsBack(months, today).map((key) => {
    const inMonth = orders.filter((o) => monthKey(o.orderDate) === key && o.status !== 'CANCELLED');
    return {
      month: monthLabel(key),
      orders: inMonth.length,
      value: inMonth.reduce((sum, o) => sum + Number(o.value ?? 0), 0),
      onTimePct: null,
    };
  });
}

/** The steps an order goes through; `date` is shown where the order records it. */
export function orderTimeline(order: ClientOrderDto): { label: string; date: string | null; done: boolean }[] {
  const rank: Record<string, number> = { PENDING: 0, APPROVED: 1, IN_PRODUCTION: 2, DISPATCHED: 3, DELIVERED: 4 };
  const reached = rank[order.status] ?? -1;
  return [
    { label: 'Order placed', date: order.orderDate, done: reached >= 0 },
    { label: 'Approved', date: order.approvedAt ?? null, done: reached >= 1 },
    { label: 'In production', date: order.productionStartedAt ?? null, done: reached >= 2 },
    { label: 'Dispatched', date: order.dispatchDate, done: reached >= 3 },
    { label: 'Delivered', date: order.deliveryDate, done: reached >= 4 },
  ];
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface PortalNotification {
  id:   string;
  type: 'info' | 'success' | 'warn';
  msg:  string;
  at:   string;
}

function messageNotices(messages: PortalMessageDto[]): PortalNotification[] {
  return messages.filter((m) => m.fromDvs).map((m) => ({
    id: `msg-${m.id}`,
    type: 'info' as const,
    at: m.createdAt,
    msg: `Message from DVS: ${m.body.length > 90 ? `${m.body.slice(0, 90)}…` : m.body}`,
  }));
}

function newestFirst(list: PortalNotification[]): PortalNotification[] {
  return list.sort((a, b) => b.at.localeCompare(a.at));
}

export function clientNotifications(orders: ClientOrderDto[], messages: PortalMessageDto[]): PortalNotification[] {
  const notices = orders.map((o): PortalNotification => {
    const base = { id: `o-${o.id}` };
    switch (o.status) {
      case 'DISPATCHED':
        return { ...base, type: 'warn', at: o.dispatchDate ?? o.updatedAt,
          msg: `${o.orderNumber} (${o.product}) has been dispatched${o.challanNumber ? `, challan ${o.challanNumber}` : ''}.` };
      case 'DELIVERED':
        return { ...base, type: 'success', at: o.deliveryDate ?? o.updatedAt, msg: `${o.orderNumber} (${o.product}) was delivered.` };
      case 'CANCELLED':
        return { ...base, type: 'warn', at: o.updatedAt, msg: `${o.orderNumber} was cancelled.` };
      case 'PENDING':
        return { ...base, type: 'info', at: o.createdAt, msg: `${o.orderNumber} was received and is awaiting approval.` };
      default:
        return { ...base, type: 'info', at: o.updatedAt, msg: `${o.orderNumber} is ${o.status.toLowerCase().replace(/_/g, ' ')}.` };
    }
  });
  return newestFirst([...notices, ...messageNotices(messages)]);
}

export function supplierNotifications(
  pos: PurchaseOrderDto[], messages: PortalMessageDto[], today = new Date(),
): PortalNotification[] {
  const notices = pos.flatMap((po): PortalNotification[] => {
    const open = !['DELIVERED', 'CANCELLED'].includes(po.status);
    if (open && po.expectedDelivery !== null && Date.parse(po.expectedDelivery) < today.getTime() - DAY_MS) {
      return [{ id: `po-${po.id}`, type: 'warn', at: po.expectedDelivery,
        msg: `${po.poNumber} (${po.material}) is past its expected delivery date.` }];
    }
    if (po.status === 'PENDING') {
      return [{ id: `po-${po.id}`, type: 'info', at: po.orderDate,
        msg: `New purchase order ${po.poNumber}: ${po.quantity} ${po.unit ?? ''} ${po.material}.` }];
    }
    if (po.status === 'DELIVERED') {
      return [{ id: `po-${po.id}`, type: 'success', at: po.actualDelivery ?? po.orderDate, msg: `${po.poNumber} was received by DVS.` }];
    }
    return [];
  });
  return newestFirst([...notices, ...messageNotices(messages)]);
}
