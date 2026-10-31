import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  DEMO_DEPARTMENTS,
  DEMO_PERIOD_DAYS,
  DEMO_WORKERS,
  DEMO_WORK_ORDERS,
  resolveSeedTarget,
  seedProductionDemo,
  storedDay,
} from '../../scripts/productionDemoSeed';

// ── A small in-memory stand-in for the Prisma calls the seed makes ───────────

type Row = Record<string, unknown> & { id: number };

const comparable = (v: unknown): unknown => (v instanceof Date ? v.getTime() : v);

function fits(value: unknown, cond: unknown): boolean {
  if (cond instanceof Date) return comparable(value) === cond.getTime();
  if (cond === null || typeof cond !== 'object') return value === cond;
  const c = cond as Record<string, unknown>;
  const norm = (x: unknown): string =>
    c['mode'] === 'insensitive' ? String(x ?? '').toLowerCase() : String(x ?? '');
  if ('equals' in c && norm(value) !== norm(c['equals'])) return false;
  if ('startsWith' in c && !norm(value).startsWith(norm(c['startsWith']))) return false;
  if ('endsWith' in c && !norm(value).endsWith(norm(c['endsWith']))) return false;
  if ('in' in c && !(c['in'] as unknown[]).includes(value)) return false;
  if (
    'gte' in c &&
    (value == null || (comparable(value) as number) < (comparable(c['gte']) as number))
  )
    return false;
  if (
    'lte' in c &&
    (value == null || (comparable(value) as number) > (comparable(c['lte']) as number))
  )
    return false;
  return true;
}

const matches = (row: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([k, v]) =>
    k === 'NOT' ? !matches(row, v as Record<string, unknown>) : fits(row[k], v),
  );

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
  let writes = 0;
  const insert = (table: string, data: Record<string, unknown>): Row => {
    // Like Postgres: a new employee or work order is not removed
    const row = {
      id: nextId++,
      ...(table === 'employee' || table === 'workOrder' ? { deletedAt: null } : {}),
      ...data,
    } as Row;
    tables[table]!.push(row);
    return row;
  };
  const model = (table: string, uniqueKeys: string[][] = []) => ({
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      tables[table]!.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      tables[table]!.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      tables[table]!.filter((r) => matches(r, where)),
    count: async ({ where }: { where: Record<string, unknown> }) =>
      tables[table]!.filter((r) => matches(r, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      writes++;
      const { outputs, ...rest } = data as { outputs?: { create: Record<string, unknown>[] } };
      const row = insert(table, rest);
      for (const o of outputs?.create ?? [])
        insert('workOrderOutput', { ...o, workOrderId: row.id });
      return row;
    },
    update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      writes++;
      const row = tables[table]!.find((r) => r.id === where.id)!;
      return Object.assign(row, data);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      writes++;
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
      writes++;
      let count = 0;
      for (const d of data) {
        const clash = uniqueKeys.some((keys) =>
          tables[table]!.some((r) => keys.every((k) => comparable(r[k]) === comparable(d[k]))),
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
  return { db: db as unknown as PrismaClient, tables, insert, writes: () => writes };
}

const NOW = new Date(2026, 9, 27, 15, 0); // Tue 27 Oct 2026, 15:00 local
const TODAY = storedDay(NOW);
const SUNDAY = storedDay(new Date(2026, 9, 25));
const PERIOD_START = storedDay(new Date(2026, 9, 21));
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

const codeById = (tables: Record<string, Row[]>) =>
  new Map(tables['employee']!.map((e) => [e.id, e['employeeCode'] as string]));

describe('Production demo seed', () => {
  it('creates all six departments first and assigns every worker to the planned one', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    expect(tables['department']!.map((d) => d.name)).toEqual([
      'Plant Head',
      'Maintanance Department',
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
      expect(e['designation']).toBe('Press Operator');
      expect(e['status']).toBe('ACTIVE');
    }
  });

  it('records no pay, phone, gender or other personal details', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    for (const e of tables['employee']!) {
      for (const field of ['salary', 'dailyWageRate', 'phone', 'gender', 'dateOfBirth', 'address'])
        expect(e[field] ?? null).toBeNull();
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
      shifts: { created: 0, existing: 2 },
      employees: { created: 0, existing: DEMO_WORKERS.length },
      attendance: { created: 0, existing: first.attendance.created, rewritten: 0 },
      dailyPerformance: { created: 0, existing: first.dailyPerformance.created },
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

  it('never overwrites a day that already has attendance or performance', async () => {
    const f = fakeDb();
    await seedProductionDemo(f.db, NOW, { workOrders: false });
    const bhiva = f.tables['employee']!.find((e) => e['employeeCode'] === 'DEMO-EMP-001')!;
    // HR corrects one demo day in the app, then the seed runs again
    const row = f.tables['attendance']!.find(
      (a) => a['employeeId'] === bhiva.id && (a['date'] as Date).getTime() === TODAY.getTime(),
    )!;
    Object.assign(row, { status: 'HALF_DAY', remarks: 'corrected by HR' });
    const report = await seedProductionDemo(f.db, NOW, { workOrders: false });
    expect(row).toMatchObject({ status: 'HALF_DAY', remarks: 'corrected by HR' });
    expect(report.attendance.created).toBe(0);
  });
});

describe('demo attendance week', () => {
  it('covers the seven days to today, one record per worker and day, all for demo workers', async () => {
    const { db, tables } = fakeDb();
    const report = await seedProductionDemo(db, NOW);
    expect(report.period).toEqual({ from: '2026-10-21', to: '2026-10-27' });
    const byId = codeById(tables);
    const keys = tables['attendance']!.map(
      (a) => `${a['employeeId']}|${(a['date'] as Date).getTime()}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(tables['attendance']).toHaveLength(DEMO_WORKERS.length * DEMO_PERIOD_DAYS);
    for (const a of tables['attendance']!) {
      expect(byId.get(a['employeeId'] as number)).toMatch(/^DEMO-EMP-0(0[1-9]|10)$/);
      const day = (a['date'] as Date).getTime();
      expect(day).toBeGreaterThanOrEqual(PERIOD_START.getTime());
      expect(day).toBeLessThanOrEqual(TODAY.getTime());
      expect(String(a['remarks'])).toMatch(/^\[DEMO\] /);
    }
  });

  it('uses every supported status, and Sunday is a week off for everyone', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    const statuses = new Set(tables['attendance']!.map((a) => a['status']));
    expect([...statuses].sort()).toEqual(
      ['ABSENT', 'HALF_DAY', 'LATE', 'LEAVE', 'PRESENT', 'WEEK_OFF'].sort(),
    );
    const sunday = tables['attendance']!.filter(
      (a) => (a['date'] as Date).getTime() === SUNDAY.getTime(),
    );
    expect(sunday).toHaveLength(DEMO_WORKERS.length);
    expect(sunday.every((a) => a['status'] === 'WEEK_OFF' && a['clockIn'] === null)).toBe(true);
    const today = new Map(
      tables['attendance']!.filter((a) => (a['date'] as Date).getTime() === TODAY.getTime()).map(
        (a) => [codeById(tables).get(a['employeeId'] as number), a['status']],
      ),
    );
    expect(today.get('DEMO-EMP-005')).toBe('ABSENT');
    expect(today.get('DEMO-EMP-009')).toBe('LEAVE');
    expect(today.get('DEMO-EMP-007')).toBe('LATE');
  });

  it('records nothing in the future: open shifts have no clock-out and no performance yet', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    for (const a of tables['attendance']!) {
      if (a['clockIn'] !== null)
        expect((a['clockIn'] as Date).getTime()).toBeLessThanOrEqual(NOW.getTime());
      if (a['clockOut'] !== null) {
        expect((a['clockOut'] as Date).getTime()).toBeLessThanOrEqual(NOW.getTime());
        expect((a['clockOut'] as Date) > (a['clockIn'] as Date)).toBe(true);
        expect(a['workingHours']).toBeGreaterThan(0);
      }
    }
    // General Shift (09:00–17:30) is still running at 15:00 today
    const generalToday = tables['attendance']!.find(
      (a) =>
        codeById(tables).get(a['employeeId'] as number) === 'DEMO-EMP-010' &&
        (a['date'] as Date).getTime() === TODAY.getTime(),
    )!;
    expect(generalToday).toMatchObject({ status: 'PRESENT', clockOut: null, workingHours: null });
    // Before any shift starts, today has no records at all
    const early = fakeDb();
    await seedProductionDemo(early.db, new Date(2026, 9, 27, 5, 0));
    expect(
      early.tables['attendance']!.some((a) => (a['date'] as Date).getTime() === TODAY.getTime()),
    ).toBe(false);
  });

  it('records performance only for finished shifts of workers who worked', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    const attendanceOf = new Map(
      tables['attendance']!.map((a) => [`${a['employeeId']}|${(a['date'] as Date).getTime()}`, a]),
    );
    expect(tables['employeeDailyOutput']!.length).toBeGreaterThan(30);
    for (const o of tables['employeeDailyOutput']!) {
      const a = attendanceOf.get(`${o['employeeId']}|${(o['date'] as Date).getTime()}`)!;
      expect(['PRESENT', 'LATE', 'HALF_DAY']).toContain(a['status']);
      expect(a['clockOut']).not.toBeNull();
      const expected = Number(o['expectedParts']);
      const produced = Number(o['producedParts']);
      expect(expected).toBeGreaterThan(0);
      expect(produced).toBeGreaterThan(0);
      expect(produced / expected).toBeLessThanOrEqual(1.03);
      expect(String(o['remarks'])).toMatch(/^\[DEMO\]/);
    }
  });
});

describe('demo work orders', () => {
  it('links every output to a started demo order, never in the future or on a Sunday', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    const orders = new Map(tables['workOrder']!.map((w) => [w.id, w]));
    expect(tables['workOrderOutput']!.length).toBeGreaterThan(0);
    for (const o of tables['workOrderOutput']!) {
      const wo = orders.get(o['workOrderId'] as number);
      expect(wo).toBeDefined();
      expect(['IN_PROGRESS', 'ON_HOLD', 'COMPLETED']).toContain(wo!['status']);
      const at = o['recordedAt'] as Date;
      expect(at.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(at.getDay()).not.toBe(0);
    }
    expect(
      tables['workOrder']!.every((w) => String(w['workOrderNumber']).startsWith('DEMO-WO-')),
    ).toBe(true);
    expect(tables['workOrder']!.every((w) => String(w['notes']).startsWith('[DEMO] '))).toBe(true);
  });

  it('keeps quantities consistent and uses only planned departments', async () => {
    const allowed = DEMO_DEPARTMENTS.map((d) => d.name) as string[];
    for (const wo of DEMO_WORK_ORDERS) {
      expect(allowed).toContain(wo.department);
      const good = wo.outputs.reduce((s, o) => s + o.goodQty, 0);
      expect(good).toBeLessThanOrEqual(wo.targetQuantity);
      for (const o of wo.outputs) {
        expect(o.rejectedQty + o.scrapQty).toBeLessThan(o.goodQty + o.rejectedQty + o.scrapQty);
        expect(Math.min(o.goodQty, o.rejectedQty, o.scrapQty)).toBeGreaterThanOrEqual(0);
      }
      if (wo.status === 'DRAFT' || wo.status === 'RELEASED') expect(wo.outputs).toHaveLength(0);
    }
  });

  it('keeps company output and employee output separate', async () => {
    const { db, tables } = fakeDb();
    await seedProductionDemo(db, NOW);
    const companyGood = tables['workOrderOutput']!.reduce((s, o) => s + Number(o['goodQty']), 0);
    const planned = DEMO_WORK_ORDERS.flatMap((w) => w.outputs).reduce((s, o) => s + o.goodQty, 0);
    expect(companyGood).toBe(planned); // all planned entries are in the past at 15:00
    expect(tables['employeeDailyOutput']!.length).toBeGreaterThan(0);
    expect(tables['workOrderOutput']!.some((o) => 'employeeId' in o)).toBe(false);
  });

  it('reports non-demo work orders created this month, without touching them', async () => {
    const f = fakeDb();
    const real = f.insert('workOrder', {
      workOrderNumber: 'WO-0042',
      createdAt: new Date(2026, 9, 3),
      notes: 'real order',
    });
    const before = snapshot(f.tables);
    const report = await seedProductionDemo(f.db, NOW);
    expect(report.workOrders.otherThisMonth).toBe(1);
    expect(snapshot(f.tables)['workOrder']!.find((w) => w.id === real.id)).toEqual(
      before['workOrder']![0],
    );
  });
});

describe('demo daily performance', () => {
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
  it('has the ten named press operators with IDs DEMO-EMP-001 to 010', () => {
    expect(
      DEMO_WORKERS.map((w) => (w.lastName ? `${w.firstName} ${w.lastName}` : w.firstName)),
    ).toEqual([
      'Bhiva',
      'Bholaram',
      'Vijay Yadav',
      'Sandeep',
      'Abhisheak Yadav',
      'Rajesh Yadav',
      'Guddu',
      'Sampath Revgade',
      'Pradip Kumar',
      'Vishwakarma Gupta',
    ]);
    expect(DEMO_WORKERS.map((w) => w.code)).toEqual(
      Array.from({ length: 10 }, (_, i) => `DEMO-EMP-${String(i + 1).padStart(3, '0')}`),
    );
    const allowed = DEMO_DEPARTMENTS.map((d) => d.name) as string[];
    expect(allowed).toContain('Maintanance Department');
    for (const w of DEMO_WORKERS) {
      expect(allowed).toContain(w.department);
      expect(w.week).toMatch(new RegExp(`^[PLHAV]{${DEMO_PERIOD_DAYS}}$`));
      expect(Number.isNaN(Date.parse(w.joiningDate))).toBe(false);
    }
  });
});

describe('workforce-only seeding (remote databases)', () => {
  it('creates workers, attendance and performance but no work orders, output or target', async () => {
    const { db, tables } = fakeDb();
    const report = await seedProductionDemo(db, NOW, { workOrders: false });
    expect(tables['employee']).toHaveLength(DEMO_WORKERS.length);
    expect(tables['attendance']!.length).toBeGreaterThan(0);
    expect(tables['employeeDailyOutput']!.length).toBeGreaterThan(0);
    expect(tables['workOrder']).toHaveLength(0);
    expect(tables['workOrderOutput']).toHaveLength(0);
    expect(tables['productionMonthlyTarget']).toHaveLength(0);
    expect(report).toMatchObject({
      workOrders: { created: 0, existing: 0 },
      monthlyTarget: 'skipped',
    });
  });
});

describe('dry run', () => {
  it('writes nothing and reports what a real run would do', async () => {
    const f = withRealData();
    const before = snapshot(f.tables);
    const writesBefore = f.writes();
    const plan = await seedProductionDemo(f.db, NOW, { dryRun: true });
    expect(f.writes()).toBe(writesBefore);
    expect(snapshot(f.tables)).toEqual(before);

    const real = await seedProductionDemo(f.db, NOW);
    expect({ ...plan, dryRun: false }).toEqual(real);
  });
});

describe('demo records from an earlier version of the seed', () => {
  function withOldDemo() {
    const f = fakeDb();
    const maint = f.insert('department', {
      name: 'Maintance Department',
      code: 'MAINT',
      description: '[DEMO] Created by the Production demo seed',
    });
    const rajesh = f.insert('employee', {
      employeeCode: 'DEMO-EMP-001',
      firstName: 'Rajesh',
      lastName: 'Kulkarni',
      email: 'demo-emp-001@demo.invalid',
      designation: 'Plant Head',
      salary: 145000,
      gender: 'MALE',
      departmentId: maint.id,
    });
    const kiran = f.insert('employee', {
      employeeCode: 'DEMO-EMP-013',
      firstName: 'Kiran',
      lastName: 'Bhosale',
      email: 'demo-emp-013@demo.invalid',
      designation: 'QC Inspector',
    });
    const yesterday = storedDay(new Date(2026, 9, 26));
    f.insert('attendance', {
      employeeId: rajesh.id,
      date: TODAY,
      status: 'PRESENT',
      remarks: '[DEMO] Demo attendance',
    });
    f.insert('attendance', {
      employeeId: rajesh.id,
      date: yesterday,
      status: 'ABSENT',
      remarks: 'typed by HR',
    });
    f.insert('employeeDailyOutput', {
      employeeId: rajesh.id,
      date: TODAY,
      expectedParts: 12,
      producedParts: 11,
      remarks: '[DEMO] Line audits: 11 of 12 planned completed',
    });
    f.insert('workOrder', {
      workOrderNumber: 'DEMO-WO-001',
      notes: '[DEMO] Customer batch',
      assignedToId: rajesh.id,
      assignedToName: 'Rajesh Kulkarni',
    });
    return { ...f, rajesh, kiran, yesterday };
  }

  it('without --upgrade-old-demo: reports them and gives them no new demo activity', async () => {
    const f = withOldDemo();
    const before = snapshot(f.tables);
    const report = await seedProductionDemo(f.db, NOW);
    expect(report.employees).toMatchObject({ outdated: ['DEMO-EMP-001'], extra: ['DEMO-EMP-013'] });
    const after = snapshot(f.tables);
    for (const row of before['employee']!)
      expect(after['employee']!.find((r) => r.id === row.id)).toEqual(row);
    expect(f.tables['attendance']!.filter((a) => a['employeeId'] === f.rajesh.id)).toHaveLength(2);
    expect(f.tables['department']!.find((d) => d.name === 'Maintanance Department')!['code']).toBe(
      'DEMO-MAINT',
    );
  });

  it('with --upgrade-old-demo: updates only the records the seed created', async () => {
    const f = withOldDemo();
    const report = await seedProductionDemo(f.db, NOW, { upgradeOldDemo: true });
    expect(report.departments.renamed).toEqual(['Maintance Department → Maintanance Department']);
    expect(report.employees).toMatchObject({
      upgraded: ['DEMO-EMP-001'],
      retired: ['DEMO-EMP-013'],
    });
    expect(f.rajesh).toMatchObject({
      firstName: 'Bhiva',
      lastName: '',
      designation: 'Press Operator',
      salary: null,
      gender: null,
    });
    expect(f.kiran['deletedAt']).toEqual(NOW);
    expect(f.kiran['status']).toBe('TERMINATED');
    // The seed's own row today is rewritten; the row HR typed is not
    const mine = f.tables['attendance']!.filter((a) => a['employeeId'] === f.rajesh.id);
    expect(mine).toHaveLength(DEMO_PERIOD_DAYS);
    expect(mine.find((a) => (a['date'] as Date).getTime() === f.yesterday.getTime())).toMatchObject(
      {
        status: 'ABSENT',
        remarks: 'typed by HR',
      },
    );
    const output = f.tables['employeeDailyOutput']!.find(
      (o) => o['employeeId'] === f.rajesh.id && (o['date'] as Date).getTime() === TODAY.getTime(),
    )!;
    expect(String(output['remarks'])).toMatch(/^\[DEMO\] MS Bracket MB-40/);
    expect(report.attendance.rewritten).toBe(1);
    expect(report.dailyPerformance.rewritten).toBe(1);
    expect(f.tables['workOrder']![0]).toMatchObject({ assignedToId: null, assignedToName: null });
    expect(f.tables['department'].filter((d) => /Maint/.test(String(d['name'])))).toHaveLength(1);
  });
});

describe('resolveSeedTarget', () => {
  const local = 'postgresql://user:pw@localhost:5433/dvs_factory?schema=public';

  it('swaps only the database name on the local host', () => {
    const t = resolveSeedTarget(local, 'dvs_factory_preview');
    expect(t).toMatchObject({
      host: 'localhost',
      port: '5433',
      database: 'dvs_factory_preview',
      confirmed: true,
    });
    expect(t.url).toContain('localhost:5433/dvs_factory_preview?schema=public');
  });

  it.each([
    'postgresql://u:p@ep-cool-name.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    'postgresql://u:p@10.0.0.5:5432/dvs',
    'postgresql://u:p@db.example.com/dvs',
  ])('refuses a non-local database %#', (url) => {
    expect(() => resolveSeedTarget(url)).toThrow(/only written to a database on this computer/);
  });

  it('reads a remote database without confirmation, and writes only with the exact host typed back', () => {
    const neon =
      'postgresql://u:p@ep-cool-name-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
    const host = 'ep-cool-name-pooler.ap-southeast-1.aws.neon.tech';
    expect(() => resolveSeedTarget(neon, undefined, 'production')).toThrow(/NODE_ENV=production/);
    expect(resolveSeedTarget(neon, undefined, 'production', { allowRemote: true })).toMatchObject({
      host,
      database: 'neondb',
      remote: true,
      confirmed: false,
    });
    expect(() =>
      resolveSeedTarget(neon, undefined, 'production', {
        allowRemote: true,
        confirmHost: 'ep-cool-name.aws.neon.tech',
      }),
    ).toThrow(/does not match.*Nothing was written/);
    expect(() =>
      resolveSeedTarget(neon, 'other', 'production', { allowRemote: true, confirmHost: host }),
    ).toThrow(/--db cannot be used/);
    expect(
      resolveSeedTarget(neon, undefined, 'production', { allowRemote: true, confirmHost: host }),
    ).toMatchObject({ host, database: 'neondb', remote: true, confirmed: true });
    expect(resolveSeedTarget('postgresql://u:p@localhost:5433/x').remote).toBe(false);
  });

  it('refuses production mode, a missing URL and an unsafe database name', () => {
    expect(() => resolveSeedTarget(local, undefined, 'production')).toThrow(/NODE_ENV=production/);
    expect(() => resolveSeedTarget(undefined)).toThrow(/not set/);
    expect(() => resolveSeedTarget(local, 'x;drop')).toThrow(/letters, digits/);
  });
});
