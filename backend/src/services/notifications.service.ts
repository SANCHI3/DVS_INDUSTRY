import { prisma } from '../lib/prismaClient';
import { ROLES } from '../constants';
import { CameraService } from './camera.service';

/**
 * The notification bell for staff: computed from current data, filtered by
 * what each role may read (the same role lists as the routes). Unread means
 * newer than the user's notificationsSeenAt.
 */
export interface NotificationItem {
  id: string;
  kind: 'incident' | 'camera' | 'low-stock' | 'overdue-po' | 'overdue-order' | 'inquiry';
  severity: 'critical' | 'warn' | 'info';
  message: string;
  at: string; // ISO; when it became worth knowing
  section: string; // where the item lives in the app (#hash)
  unread: boolean;
}

const DAY_MS = 86_400_000;
const INCIDENT_WINDOW_DAYS = 14;
const MAX_ITEMS = 30;

const SEC_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION];
const STOCK_READ = [ROLES.ADMIN, ROLES.MANAGER, ROLES.STORE];
const PO_TRACK = [ROLES.ADMIN, ROLES.MANAGER, ROLES.STORE];
const ORDER_TRACK = [ROLES.ADMIN, ROLES.MANAGER, ROLES.SALES, ROLES.STORE];

const INCIDENT_LABELS: Record<string, string> = {
  FIGHT: 'Possible fight',
  FALL: 'Person has fallen',
  FIRE: 'Fire seen',
  SMOKE: 'Smoke seen',
  FIRE_SMOKE: 'Fire or smoke seen',
  CROWD: 'Crowd gathering',
  INTRUSION: 'Intrusion',
  LOITERING: 'Loitering',
  OTHER: 'Unusual activity',
};

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Overdue from the start of the day after the due date. */
function overdueSince(due: Date): Date {
  return new Date(utcDay(due) + DAY_MS);
}

function daysLate(due: Date, now: Date): number {
  return Math.max(1, Math.round((utcDay(now) - utcDay(due)) / DAY_MS));
}

/**
 * Camera problems, not security incidents (they never count as incidents).
 * When the whole monitoring PC is silent, one item instead of one per camera.
 */
export async function cameraNotifications(
  now: Date,
  cameras = new CameraService(),
): Promise<Array<Omit<NotificationItem, 'unread'>>> {
  const { cameras: list, monitoring } = await cameras.list(now);
  if (monitoring.state === 'offline') {
    if (!monitoring.offlineAlert) return [];
    return [
      {
        id: 'cctv-pc-offline',
        kind: 'camera',
        severity: 'critical',
        message: 'Plant computer is offline. Check that it is on and has internet.',
        at: monitoring.since ?? now.toISOString(),
        section: 'security-cameras',
      },
    ];
  }
  if (monitoring.state === 'never') return [];
  return list
    .filter((c) => c.enabled && (c.status === 'OFFLINE' || c.status === 'VIDEO_LOSS'))
    .map((c) => ({
      id: `camera-${c.id}-${c.status}`,
      kind: 'camera' as const,
      severity: 'warn' as const,
      message:
        c.status === 'OFFLINE'
          ? `${c.name}${c.zone ? ` (${c.zone})` : ''} is offline`
          : `${c.name}${c.zone ? ` (${c.zone})` : ''} shows no picture`,
      at: c.statusSince ?? now.toISOString(),
      section: 'security-cameras',
    }));
}

export class NotificationsService {
  async list(
    user: { id: number; role: string },
    now: Date = new Date(),
  ): Promise<{ items: NotificationItem[]; unreadCount: number }> {
    const role = user.role;
    const today = new Date(utcDay(now));
    const items: Array<Omit<NotificationItem, 'unread'>> = [];

    if (SEC_READ.includes(role as never)) {
      const incidents = await prisma.securityIncident.findMany({
        where: {
          deletedAt: null,
          source: 'LIVE',
          status: { in: ['OPEN', 'INVESTIGATING'] },
          severity: { in: ['CRITICAL', 'HIGH'] },
          occurredAt: { gte: new Date(now.getTime() - INCIDENT_WINDOW_DAYS * DAY_MS) },
        },
        orderBy: { occurredAt: 'desc' },
        take: 10,
        select: { id: true, type: true, severity: true, location: true, occurredAt: true },
      });
      for (const i of incidents) {
        items.push({
          id: `incident-${i.id}`,
          kind: 'incident',
          severity: i.severity === 'CRITICAL' ? 'critical' : 'warn',
          message: `${INCIDENT_LABELS[i.type] ?? 'Security incident'}${i.location ? ` at ${i.location}` : ''} (${i.severity.toLowerCase()})`,
          at: i.occurredAt.toISOString(),
          section: 'security-incidents',
        });
      }
      items.push(...(await cameraNotifications(now)));
    }

    if (STOCK_READ.includes(role as never)) {
      const materials = await prisma.material.findMany({
        where: { deletedAt: null, isActive: true, minStockLevel: { gt: 0 } },
        select: {
          id: true,
          name: true,
          unit: true,
          currentStock: true,
          minStockLevel: true,
          updatedAt: true,
        },
      });
      for (const m of materials) {
        const stock = m.currentStock.toNumber();
        const min = m.minStockLevel.toNumber();
        if (stock > min) continue;
        items.push({
          id: `stock-${m.id}`,
          kind: 'low-stock',
          severity: stock === 0 ? 'critical' : 'warn',
          message: `${m.name} is ${stock === 0 ? 'out of stock' : `low: ${stock} ${m.unit}`} (minimum ${min} ${m.unit})`,
          at: m.updatedAt.toISOString(),
          section: 'inventory-materials',
        });
      }
    }

    if (PO_TRACK.includes(role as never)) {
      const pos = await prisma.purchaseOrder.findMany({
        where: {
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
          expectedDelivery: { lt: today },
        },
        orderBy: { expectedDelivery: 'asc' },
        take: 10,
        select: {
          id: true,
          poNumber: true,
          expectedDelivery: true,
          supplier: { select: { name: true } },
        },
      });
      for (const po of pos) {
        const due = po.expectedDelivery!;
        const late = daysLate(due, now);
        items.push({
          id: `po-${po.id}`,
          kind: 'overdue-po',
          severity: 'warn',
          message: `${po.poNumber} from ${po.supplier.name} is ${late} day${late === 1 ? '' : 's'} late`,
          at: overdueSince(due).toISOString(),
          section: 'orders-supplier',
        });
      }
    }

    if (ORDER_TRACK.includes(role as never)) {
      const orders = await prisma.clientOrder.findMany({
        where: {
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
          requiredDate: { lt: today },
        },
        orderBy: { requiredDate: 'asc' },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          requiredDate: true,
          client: { select: { name: true } },
        },
      });
      for (const o of orders) {
        const due = o.requiredDate!;
        const late = daysLate(due, now);
        items.push({
          id: `order-${o.id}`,
          kind: 'overdue-order',
          severity: 'warn',
          message: `${o.orderNumber} for ${o.client.name} is ${late} day${late === 1 ? '' : 's'} past its required date`,
          at: overdueSince(due).toISOString(),
          section: 'orders-client',
        });
      }
    }

    if (role === ROLES.ADMIN) {
      const inquiries = await prisma.inquiry.findMany({
        where: { status: 'NEW' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, name: true, company: true, createdAt: true },
      });
      for (const q of inquiries) {
        items.push({
          id: `inquiry-${q.id}`,
          kind: 'inquiry',
          severity: 'info',
          message: `New website inquiry from ${q.name}${q.company ? ` (${q.company})` : ''}`,
          at: q.createdAt.toISOString(),
          section: 'users-inquiries',
        });
      }
    }

    const seen = await prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationsSeenAt: true },
    });
    const seenAt = seen?.notificationsSeenAt?.getTime() ?? 0;
    const sorted = items
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_ITEMS)
      .map((item) => ({ ...item, unread: new Date(item.at).getTime() > seenAt }));
    return { items: sorted, unreadCount: sorted.filter((i) => i.unread).length };
  }

  async markSeen(userId: number, now: Date = new Date()): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { notificationsSeenAt: now } });
  }
}
