import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  DEMO_DEPARTMENTS,
  DEMO_WORKERS,
  DEMO_WORK_ORDERS,
  resolveSeedTarget,
  seedProductionDemo,
  storedDay,
} from '../../scripts/productionDemoSeed';

// ── A small in-memory stand-in for the Prisma calls the seed makes ───────────

type Row = Record<string, unknown> & { id: number };

function fakeDb() {
  const tables: Record<string, Row[]> = {
    department: [],
    shift: [],
    employee: [],
    attendance: [],
    employeeDailyOutput: [],
    workOrder: [],
    workOrderOutput: [],
    productionMonthlyTarget: [],
  };
  let nextId = 100;
  const insert = (table: string, data: Record<string, unknown>): Row => {
    // Like Postgres: a new employee is not removed
    const row = {
      id: nextId++,
      ...(table === 'employee' ? { deletedAt: null } : {}),
      ...data,
    } as Row;
    tables[table]!.push(row);
    return row;
  };
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v instanceof Date) return (row[k] as Date)?.getTime() === v.getTime();
      if (v !== null && typeof v === 'object' && 'startsWith' in v) {
        return String(row[k] ?? '').startsWith((v as { startsWith: string }).startsWith);
      }
      if (v !== null && typeof v === 'object' && 'equals' in v) {
        return (
          String(row[k]).toLowerCase() === String((v as { equals: string }).equals).toLowerCase()
        );
      }
      return row[k] === v;
    });
  const model = (table: string, uniqueKeys: string[][] = []) => ({
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      tables[table]!.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      tables[table]!.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const { outputs, ...rest } = data as { outputs?: { create: Record<string, unknown>[] } };
      const row = insert(table, rest);
      for (const o of outputs?.create ?? [])
        insert('workOrderOutput', { ...o, workOrderId: row.id });
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const hits = tables[table]!.filter((r) => matches(r, where));
      for (const r of hits) Object.assign(r, data);
      return { count: hits.length };
    },
    createMany: async ({
      data,
      skipDuplicates,
    }: {
      data: Record<string, unknown>[];
      skipDuplicates?: boolean;
    }) => {
      let count = 0;
      for (const d of data) {
        const clash = uniqueKeys.some((keys) =>
          tables[table]!.some((r) =>
            keys.every((k) =>
              d[k] instanceof Date
                ? (r[k] as Date).getTime() === (d[k] as Date).getTime()
                : r[k] === d[k],
            ),
          ),
        );
        if (clash) {
          if (!skipDuplicates) throw new Error('unique violation');
          continue;
        }
        insert(table, d);
        count++;
      }
      return { count };
    },
  });
  const db = {
    department: model('department'),
    shift: model('shift'),
    employee: model('employee'),
    attendance: model('attendance', [['employeeId', 'date']]),
    employeeDailyOutput: model('employeeDailyOutput', [['employeeId', 'date']]),
    workOrder: model('workOrder'),
    productionMonthlyTarget: model('productionMonthlyTarget'),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db: db as unknown as PrismaClient, tables, insert };
}

const NOW = new Date(2026, 9, 27, 15, 0); // 27 Oct 2026, 15:00 local
const TODAY = storedDay(NOW);
const snapshot = (tables: Record<string, Row[]>) =>
  JSON.parse(JSON.stringify(tables)) as Record<string, Row[]>;

function withRealData() {
  const f = fakeDb();
  // Records that already exist and must be left exactly as they are
  const hr = f.insert('department', { name: 'HR', code: 'HR', description: 'Real HR department' });
  f.insert('department', {
    name: 'Quality Control',
    code: 'QUAL',
    description: 'Real — uses the code QUAL',
  });
  const real = f.insert('employee', {
    employeeCode: 'EMP-1',
    firstName: 'Real',
    lastName: 'Person',
    email: 'real@dvs.in',
    deletedAt: null,
    departmentId: hr.id,
  });
  f.insert('employee', {
    employeeCode: 'demo-emp-004',
    firstName: 'Someone',
    lastName: 'Else',
    email: 'else@dvs.in',
    deletedAt: null,
  });
  f.insert('attendance', { employeeId: real.id, date: TODAY, status: 'ABSENT', remarks: 'real' });
  f.insert('productionMonthlyTarget', {
    periodStart: new Date(Date.UTC(2026, 9, 1)),
    outputTarget: 9999,
    notes: 'real target',
  });
  return f;
}

describe('Production demo seed', () => {
  it('creates all six departments first and assigns every worker to the planned one', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    expect(tables['department']!.map((d) => d.name)).toEqual([
      'Plant Head',
      'Maintance Department',
      'Production Scrap',
      'Quality Department',
      'HR',
      'Accountant',
    ]);
    const deptName = new Map(tables['department']!.map((d) => [d.id, d.name]));
    for (const w of DEMO_WORKERS) {
      const e = tables['employee']!.find((x) => x.employeeCode === w.code)!;
      expect(deptName.get(e['departmentId'] as number)).toBe(w.department);
      expect(e['email']).toBe(`${w.code.toLowerCase()}@demo.invalid`);
    }
  });

  it('is idempotent: a second run creates nothing and changes nothing', async () => {
    const { db, tables } = fakeDb();
    const first = await seedProductionDemo(db, NOW);
    const before = snapshot(tables);
    const second = await seedProductionDemo(db, NOW);
    expect(snapshot(tables)).toEqual(before);
    expect(first.employees.created).toBe(DEMO_WORKERS.length);
    expect(second).toMatchObject({
      departments: { created: 0, existing: 6 },
      shifts: { created: 0, existing: 3 },
      employees: { created: 0, existing: DEMO_WORKERS.length },
      attendance: { created: 0 },
      dailyPerformance: { created: 0 },
      workOrders: { created: 0, existing: DEMO_WORK_ORDERS.length },
      workOrderOutputs: { created: 0 },
      monthlyTarget: 'existing',
    });
  });

  it('reuses existing departments and never modifies or deletes real records', async () => {
    const f = withRealData();
    const real = snapshot(f.tables);
    const report = await seedProductionDemo(f.db, NOW);

    const after = snapshot(f.tables);
    for (const [table, rows] of Object.entries(real)) {
      for (const row of rows) expect(after[table]!.find((r) => r.id === row.id)).toEqual(row);
    }
    expect(f.tables['department']!.filter((d) => d.name === 'HR')).toHaveLength(1);
    expect(f.tables['department']!.find((d) => d.name === 'Quality Department')!['code']).toBe(
      'DEMO-QUAL',
    );
    // DEMO-EMP-004 exists but is not a demo record: no demo activity is attached to it
    expect(report.employees.notDemo).toEqual(['DEMO-EMP-004']);
    const other = f.tables['employee']!.find((e) => e['email'] === 'else@dvs.in')!;
    expect(f.tables['attendance']!.some((a) => a['employeeId'] === other.id)).toBe(false);
    expect(report.monthlyTarget).toBe('existing');
    expect(f.tables['productionMonthlyTarget']).toHaveLength(1);
  });

  it('records attendance for today only, and performance only for workers who worked', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    const byId = new Map(tables['employee']!.map((e) => [e.id, e['employeeCode'] as string]));
    expect(
      tables['attendance']!.every((a) => (a['date'] as Date).getTime() === TODAY.getTime()),
    ).toBe(true);
    const attendanceCodes = tables['attendance']!.map((a) => byId.get(a['employeeId'] as number));
    expect(attendanceCodes.sort()).toEqual([
      'DEMO-EMP-001',
      'DEMO-EMP-004',
      'DEMO-EMP-009',
      'DEMO-EMP-013',
      'DEMO-EMP-015',
    ]);
    const statusOf = new Map(
      tables['attendance']!.map((a) => [byId.get(a['employeeId'] as number), a['status']]),
    );
    expect(statusOf.get('DEMO-EMP-015')).toBe('LATE');
    expect(statusOf.get('DEMO-EMP-001')).toBe('PRESENT');
    for (const o of tables['employeeDailyOutput']!) {
      expect(['PRESENT', 'LATE', 'HALF_DAY']).toContain(
        statusOf.get(byId.get(o['employeeId'] as number)),
      );
      expect(String(o['remarks'])).toMatch(/^\[DEMO\]/);
    }
    expect(tables['employeeDailyOutput']!.length).toBeGreaterThan(0);
  });

  it('links every work-order output to a demo work order and records no output on draft or released orders', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    const orders = new Map(tables['workOrder']!.map((w) => [w.id, w]));
    expect(tables['workOrderOutput']!.length).toBeGreaterThan(0);
    for (const o of tables['workOrderOutput']!) {
      const wo = orders.get(o['workOrderId'] as number);
      expect(wo).toBeDefined();
      expect(['IN_PROGRESS', 'ON_HOLD', 'COMPLETED']).toContain(wo!['status']);
      expect((o['recordedAt'] as Date).getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
    expect(
      tables['workOrder']!.every((w) => String(w['workOrderNumber']).startsWith('DEMO-WO-')),
    ).toBe(true);
  });

  it('keeps company output and employee output separate', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    const companyGood = tables['workOrderOutput']!.reduce((s, o) => s + Number(o['goodQty']), 0);
    const planned = DEMO_WORK_ORDERS.flatMap((w) => w.outputs).reduce((s, o) => s + o.goodQty, 0);
    expect(companyGood).toBe(planned); // all planned entries are in the past at 15:00
    const employeeProduced = tables['employeeDailyOutput']!.reduce(
      (s, o) => s + Number(o['producedParts'] ?? 0),
      0,
    );
    expect(employeeProduced).toBeGreaterThan(0);
    expect(tables['workOrderOutput']!.some((o) => 'employeeId' in o)).toBe(false);
  });
});

describe('demo daily performance', () => {
  it('gives every worker who worked today expected and produced figures, so efficiency is not N/A', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    const worked = DEMO_WORKERS.filter(
      (w) => w.today && ['PRESENT', 'LATE', 'HALF_DAY'].includes(w.today.status),
    );
    expect(tables['employeeDailyOutput']).toHaveLength(worked.length);
    for (const o of tables['employeeDailyOutput']!) {
      expect(Number(o['expectedParts'])).toBeGreaterThan(0);
      expect(o['producedParts']).not.toBeNull();
    }
  });

  it('fills missing parts only on its own demo rows and never overwrites entered values', async () => {
    const f = fakeDb();
    await seedProductionDemo(f.db, NOW);
    const rows = f.tables['employeeDailyOutput']!;
    // An older seed left one demo row without parts; a user typed values into another
    rows[0]!['expectedParts'] = null;
    rows[0]!['producedParts'] = null;
    rows[1]!['expectedParts'] = 99;
    rows[1]!['producedParts'] = 1;
    rows[1]!['remarks'] = 'typed by HR';
    const report = await seedProductionDemo(f.db, NOW);
    expect(report.dailyPerformance.filled).toBe(1);
    expect(Number(rows[0]!['expectedParts'])).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ expectedParts: 99, producedParts: 1, remarks: 'typed by HR' });
    const third = await seedProductionDemo(f.db, NOW);
    expect(third.dailyPerformance.filled).toBe(0);
  });
});

describe('demo data plan', () => {
  it('keeps five workers, one per key department, with clearly marked IDs', () => {
    expect(DEMO_DEPARTMENTS.map((d) => d.name)).toContain('Maintance Department');
    expect(DEMO_WORKERS.map((w) => w.department)).toEqual([
      'Plant Head',
      'Maintance Department',
      'Production Scrap',
      'Quality Department',
      'HR',
    ]);
    const codes = DEMO_WORKERS.map((w) => w.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^DEMO-EMP-\d{3}$/.test(c))).toBe(true);
  });
});

describe('resolveSeedTarget', () => {
  const local = 'postgresql://user:pw@localhost:5433/dvs_factory?schema=public';

  it('swaps only the database name on the local host', () => {
    const t = resolveSeedTarget(local, 'dvs_factory_preview');
    expect(t).toMatchObject({ host: 'localhost', port: '5433', database: 'dvs_factory_preview' });
    expect(t.url).toContain('localhost:5433/dvs_factory_preview?schema=public');
  });

  it.each([
    'postgresql://u:p@ep-cool-name.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    'postgresql://u:p@10.0.0.5:5432/dvs',
    'postgresql://u:p@db.example.com/dvs',
  ])('refuses a non-local database %#', (url) => {
    expect(() => resolveSeedTarget(url)).toThrow(/only written to a database on this computer/);
  });

  it('refuses production mode, a missing URL and an unsafe database name', () => {
    expect(() => resolveSeedTarget(local, undefined, 'production')).toThrow(/NODE_ENV=production/);
    expect(() => resolveSeedTarget(undefined)).toThrow(/not set/);
    expect(() => resolveSeedTarget(local, 'x;drop')).toThrow(/letters, digits/);
  });
});
