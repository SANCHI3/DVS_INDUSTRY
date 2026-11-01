import { prisma } from '../lib/prismaClient';
import { ROLES } from '../constants';

/**
 * Search box in the top bar: employees, work orders, client orders, purchase
 * orders and materials, each only for roles whose pages show them.
 */
export interface SearchResult {
  kind: 'employee' | 'work-order' | 'client-order' | 'purchase-order' | 'material';
  id: number;
  title: string;
  subtitle: string;
}

const PER_KIND = 5;

const can = (role: string, ...roles: string[]) => roles.includes(role);

export class SearchService {
  async search(role: string, raw: string): Promise<SearchResult[]> {
    const q = raw.trim();
    if (q.length < 2) return [];
    const has = { contains: q, mode: 'insensitive' as const };
    const results: SearchResult[] = [];
    const tasks: Array<Promise<void>> = [];

    if (can(role, ROLES.ADMIN, ROLES.MANAGER, ROLES.HR)) {
      tasks.push(
        prisma.employee
          .findMany({
            where: {
              deletedAt: null,
              OR: [
                { employeeCode: has },
                { firstName: has },
                { lastName: has },
                { designation: has },
              ],
            },
            take: PER_KIND,
            orderBy: { employeeCode: 'asc' },
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              designation: true,
            },
          })
          .then((rows) => {
            for (const e of rows) {
              results.push({
                kind: 'employee',
                id: e.id,
                title: `${e.firstName} ${e.lastName}`.trim(),
                subtitle: [e.employeeCode, e.designation].filter(Boolean).join(' · '),
              });
            }
          }),
      );
    }

    if (can(role, ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION)) {
      tasks.push(
        prisma.workOrder
          .findMany({
            where: { deletedAt: null, OR: [{ workOrderNumber: has }, { product: has }] },
            take: PER_KIND,
            orderBy: { createdAt: 'desc' },
            select: { id: true, workOrderNumber: true, product: true, status: true },
          })
          .then((rows) => {
            for (const w of rows) {
              results.push({
                kind: 'work-order',
                id: w.id,
                title: w.workOrderNumber,
                subtitle: `${w.product} · ${w.status.replace(/_/g, ' ').toLowerCase()}`,
              });
            }
          }),
      );
    }

    if (can(role, ROLES.ADMIN, ROLES.MANAGER, ROLES.SALES, ROLES.STORE)) {
      tasks.push(
        prisma.clientOrder
          .findMany({
            where: { OR: [{ orderNumber: has }, { product: has }, { client: { name: has } }] },
            take: PER_KIND,
            orderBy: { orderDate: 'desc' },
            select: {
              id: true,
              orderNumber: true,
              product: true,
              status: true,
              client: { select: { name: true } },
            },
          })
          .then((rows) => {
            for (const o of rows) {
              results.push({
                kind: 'client-order',
                id: o.id,
                title: o.orderNumber,
                subtitle: `${o.client.name} · ${o.product} · ${o.status.replace(/_/g, ' ').toLowerCase()}`,
              });
            }
          }),
      );
      tasks.push(
        prisma.purchaseOrder
          .findMany({
            where: { OR: [{ poNumber: has }, { material: has }, { supplier: { name: has } }] },
            take: PER_KIND,
            orderBy: { orderDate: 'desc' },
            select: {
              id: true,
              poNumber: true,
              material: true,
              status: true,
              supplier: { select: { name: true } },
            },
          })
          .then((rows) => {
            for (const p of rows) {
              results.push({
                kind: 'purchase-order',
                id: p.id,
                title: p.poNumber,
                subtitle: `${p.supplier.name} · ${p.material} · ${p.status.replace(/_/g, ' ').toLowerCase()}`,
              });
            }
          }),
      );
    }

    if (can(role, ROLES.ADMIN, ROLES.MANAGER, ROLES.STORE)) {
      tasks.push(
        prisma.material
          .findMany({
            where: { deletedAt: null, OR: [{ name: has }, { code: has }] },
            take: PER_KIND,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, code: true, currentStock: true, unit: true },
          })
          .then((rows) => {
            for (const m of rows) {
              results.push({
                kind: 'material',
                id: m.id,
                title: m.name,
                subtitle: `${m.code} · ${m.currentStock.toNumber()} ${m.unit} in stock`,
              });
            }
          }),
      );
    }

    await Promise.all(tasks);
    return results;
  }
}
