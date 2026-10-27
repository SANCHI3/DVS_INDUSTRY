import {
  Prisma,
  type PrismaClient,
  type AttendanceStatus,
  type EmploymentType,
  type EmployeeStatus,
} from '@prisma/client';

/**
 * Demo data for the Production module only: departments, shifts, five workers,
 * today's attendance and daily performance, work orders with output, and this
 * month's target.
 *
 * Every write is create-if-missing. Nothing existing is updated or deleted:
 *  - departments and shifts are found by name and reused as they are;
 *  - demo workers are found by Employee ID (DEMO-EMP-…); a record with that ID
 *    that this seed did not create, or that was removed, is left alone and
 *    gets no demo attendance or performance;
 *  - attendance and performance use the (employee, date) unique keys with
 *    skipDuplicates, so an existing day is never overwritten;
 *  - work orders are found by number (DEMO-WO-…); their output is created
 *    only together with the work order, so a rerun adds none;
 *  - the month's target is created only when the month has none.
 */

export const DEMO_MARK = '[DEMO]';
export const DEMO_EMAIL_DOMAIN = 'demo.invalid'; // reserved TLD: can never be a real address

export const DEMO_DEPARTMENTS = [
  { name: 'Plant Head', code: 'PLANT' },
  { name: 'Maintance Department', code: 'MAINT' }, // spelling as requested
  { name: 'Production Scrap', code: 'SCRAP' },
  { name: 'Quality Department', code: 'QUAL' },
  { name: 'HR', code: 'HR' },
  { name: 'Accountant', code: 'ACCT' },
] as const;

export type DemoDepartmentName = (typeof DEMO_DEPARTMENTS)[number]['name'];

export const DEMO_SHIFTS = [
  { name: 'General Shift', startTime: '09:00', endTime: '17:30', isNightShift: false },
  { name: 'Morning Shift', startTime: '06:00', endTime: '14:00', isNightShift: false },
  { name: 'Night Shift', startTime: '22:00', endTime: '06:00', isNightShift: true },
] as const;

type ShiftName = (typeof DEMO_SHIFTS)[number]['name'];

interface DemoToday {
  status: AttendanceStatus;
  clockIn?: string;
  remarks?: string;
  /** Daily performance; omitted for roles that do not produce parts */
  output?: {
    workingHours: number;
    operationsCount?: number;
    expectedParts?: number;
    producedParts?: number;
    remarks?: string;
  };
}

export interface DemoWorker {
  code: string;
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE';
  designation: string;
  department: DemoDepartmentName;
  shift: ShiftName;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joiningDate: string;
  salary: number | null;
  dailyWageRate: number | null;
  /** null: no attendance recorded today (e.g. an inactive worker) */
  today: DemoToday | null;
}

export const DEMO_WORKERS: DemoWorker[] = [
  {
    code: 'DEMO-EMP-001',
    firstName: 'Rajesh',
    lastName: 'Kulkarni',
    gender: 'MALE',
    designation: 'Plant Head',
    department: 'Plant Head',
    shift: 'General Shift',
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    joiningDate: '2016-04-01',
    salary: 145000,
    dailyWageRate: null,
    today: {
      status: 'PRESENT',
      clockIn: '08:52',
      output: {
        workingHours: 9,
        operationsCount: 6,
        expectedParts: 12,
        producedParts: 11,
        remarks: 'Line audits: 11 of 12 planned completed',
      },
    },
  },
  {
    code: 'DEMO-EMP-004',
    firstName: 'Prakash',
    lastName: 'Shinde',
    gender: 'MALE',
    designation: 'Maintenance Supervisor',
    department: 'Maintance Department',
    shift: 'Morning Shift',
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    joiningDate: '2017-11-20',
    salary: 54000,
    dailyWageRate: null,
    today: {
      status: 'PRESENT',
      clockIn: '05:55',
      output: {
        workingHours: 8,
        operationsCount: 5,
        expectedParts: 6,
        producedParts: 5,
        remarks: 'Maintenance jobs: 5 of 6 closed (press lines 2 and 3)',
      },
    },
  },
  {
    code: 'DEMO-EMP-009',
    firstName: 'Mahesh',
    lastName: 'Pawar',
    gender: 'MALE',
    designation: 'CNC Machine Operator',
    department: 'Production Scrap',
    shift: 'Morning Shift',
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    joiningDate: '2019-08-05',
    salary: null,
    dailyWageRate: 780,
    today: {
      status: 'PRESENT',
      clockIn: '05:57',
      output: {
        workingHours: 8,
        operationsCount: 4,
        expectedParts: 240,
        producedParts: 228,
        remarks: 'Flange Plate FP-120',
      },
    },
  },
  {
    code: 'DEMO-EMP-013',
    firstName: 'Kiran',
    lastName: 'Bhosale',
    gender: 'MALE',
    designation: 'QC Inspector',
    department: 'Quality Department',
    shift: 'Morning Shift',
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    joiningDate: '2022-04-11',
    salary: null,
    dailyWageRate: 760,
    today: {
      status: 'PRESENT',
      clockIn: '06:00',
      output: {
        workingHours: 8,
        operationsCount: 1,
        expectedParts: 400,
        producedParts: 372,
        remarks: 'Parts inspected; gauge recalibrated mid-shift',
      },
    },
  },
  {
    code: 'DEMO-EMP-015',
    firstName: 'Anjali',
    lastName: 'Kale',
    gender: 'FEMALE',
    designation: 'HR Executive',
    department: 'HR',
    shift: 'General Shift',
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    joiningDate: '2018-02-19',
    salary: 52000,
    dailyWageRate: null,
    today: {
      status: 'LATE',
      clockIn: '09:35',
      remarks: 'Bus delayed',
      output: {
        workingHours: 7.5,
        operationsCount: 4,
        expectedParts: 10,
        producedParts: 9,
        remarks: 'Onboarding and leave files processed: 9 of 10',
      },
    },
  },
];

interface DemoOutput {
  daysAgo: number;
  time: string;
  goodQty: number;
  rejectedQty: number;
  scrapQty: number;
  remarks: string;
}

export interface DemoWorkOrder {
  number: string;
  product: string;
  targetQuantity: number;
  status: 'DRAFT' | 'RELEASED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  startDaysAgo: number;
  durationDays: number;
  notes: string;
  outputs: DemoOutput[];
}

export const DEMO_WORK_ORDERS: DemoWorkOrder[] = [
  {
    number: 'DEMO-WO-001',
    product: 'MS Bracket MB-40',
    targetQuantity: 1200,
    status: 'COMPLETED',
    priority: 'HIGH',
    startDaysAgo: 6,
    durationDays: 4,
    notes: 'Customer batch for conveyor frames',
    outputs: [
      {
        daysAgo: 6,
        time: '13:30',
        goodQty: 380,
        rejectedQty: 12,
        scrapQty: 3,
        remarks: 'First shift run',
      },
      {
        daysAgo: 5,
        time: '13:30',
        goodQty: 410,
        rejectedQty: 9,
        scrapQty: 2,
        remarks: 'Die re-shimmed before run',
      },
      {
        daysAgo: 3,
        time: '13:30',
        goodQty: 395,
        rejectedQty: 8,
        scrapQty: 3,
        remarks: 'Batch closed',
      },
    ],
  },
  {
    number: 'DEMO-WO-002',
    product: 'Flange Plate FP-120',
    targetQuantity: 900,
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    startDaysAgo: 2,
    durationDays: 4,
    notes: 'Pump housing flanges',
    outputs: [
      {
        daysAgo: 2,
        time: '13:45',
        goodQty: 225,
        rejectedQty: 7,
        scrapQty: 1,
        remarks: 'Setup + first run',
      },
      {
        daysAgo: 1,
        time: '13:45',
        goodQty: 236,
        rejectedQty: 5,
        scrapQty: 2,
        remarks: 'Steady run',
      },
      {
        daysAgo: 0,
        time: '11:00',
        goodQty: 118,
        rejectedQty: 3,
        scrapQty: 0,
        remarks: 'Morning half',
      },
    ],
  },
  {
    number: 'DEMO-WO-003',
    product: 'Gear Blank GB-60',
    targetQuantity: 600,
    status: 'ON_HOLD',
    priority: 'NORMAL',
    startDaysAgo: 4,
    durationDays: 5,
    notes: 'On hold: awaiting EN8 bar stock',
    outputs: [
      {
        daysAgo: 4,
        time: '15:00',
        goodQty: 150,
        rejectedQty: 9,
        scrapQty: 4,
        remarks: 'Stopped — material shortage',
      },
    ],
  },
  {
    number: 'DEMO-WO-004',
    product: 'Shaft Collar SC-25',
    targetQuantity: 1500,
    status: 'RELEASED',
    priority: 'URGENT',
    startDaysAgo: 0,
    durationDays: 3,
    notes: 'Released after first-article approval',
    outputs: [],
  },
  {
    number: 'DEMO-WO-005',
    product: 'Hinge Pin HP-08',
    targetQuantity: 2000,
    status: 'DRAFT',
    priority: 'LOW',
    startDaysAgo: -2,
    durationDays: 4,
    notes: 'Planned for next week',
    outputs: [],
  },
];

export const DEMO_TARGET = {
  outputTarget: 6000,
  unit: 'pcs',
  targetCompletionRate: 90,
  maxRejectionRate: 3,
  targetEmployeeEfficiency: 90,
  notes: 'Demo target from the Production demo seed',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Local calendar date → midnight UTC, the way attendance dates are stored */
export function storedDay(localDay: Date): Date {
  return new Date(Date.UTC(localDay.getFullYear(), localDay.getMonth(), localDay.getDate()));
}

function localAt(day: Date, daysOffset: number, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + daysOffset, h, m);
}

const demoEmail = (code: string): string => `${code.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`;

export interface SeedCounts {
  created: number;
  existing: number;
}

export interface SeedReport {
  departments: SeedCounts;
  shifts: SeedCounts;
  employees: SeedCounts & { notDemo: string[]; removed: string[] };
  attendance: SeedCounts;
  dailyPerformance: SeedCounts & { filled: number };
  workOrders: SeedCounts;
  workOrderOutputs: { created: number };
  monthlyTarget: 'created' | 'existing' | 'skipped';
}

// ── Seed ──────────────────────────────────────────────────────────────────────

/**
 * `workOrders: false` seeds workforce and attendance only: no demo work
 * orders, output or monthly target, so company totals stay real.
 */
export async function seedProductionDemo(
  db: PrismaClient,
  now: Date = new Date(),
  options: { workOrders?: boolean } = {},
): Promise<SeedReport> {
  const withWorkOrders = options.workOrders ?? true;
  const today = storedDay(now);

  // Departments first, so workers can be assigned to them
  const departmentIds = new Map<string, number>();
  const departments: SeedCounts = { created: 0, existing: 0 };
  for (const d of DEMO_DEPARTMENTS) {
    const found = await db.department.findUnique({ where: { name: d.name } });
    if (found !== null) {
      departmentIds.set(d.name, found.id);
      departments.existing++;
      continue;
    }
    // A different department may already use the short code
    const codeTaken = (await db.department.findUnique({ where: { code: d.code } })) !== null;
    const created = await db.department.create({
      data: {
        name: d.name,
        code: codeTaken ? `DEMO-${d.code}` : d.code,
        description: `${DEMO_MARK} Created by the Production demo seed`,
      },
    });
    departmentIds.set(d.name, created.id);
    departments.created++;
  }

  const shiftIds = new Map<string, number>();
  const shifts: SeedCounts = { created: 0, existing: 0 };
  for (const s of DEMO_SHIFTS) {
    const found = await db.shift.findUnique({ where: { name: s.name } });
    if (found !== null) {
      shiftIds.set(s.name, found.id);
      shifts.existing++;
      continue;
    }
    const created = await db.shift.create({
      data: { ...s, description: `${DEMO_MARK} Created by the Production demo seed` },
    });
    shiftIds.set(s.name, created.id);
    shifts.created++;
  }

  // Workers: only records this seed created (demo e-mail) get demo activity
  const employees: SeedReport['employees'] = { created: 0, existing: 0, notDemo: [], removed: [] };
  const workerIds = new Map<string, number>();
  for (const w of DEMO_WORKERS) {
    const found = await db.employee.findFirst({
      where: { employeeCode: { equals: w.code, mode: 'insensitive' } },
      select: { id: true, email: true, deletedAt: true },
    });
    if (found !== null) {
      employees.existing++;
      if (found.email !== demoEmail(w.code)) employees.notDemo.push(w.code);
      else if (found.deletedAt !== null) employees.removed.push(w.code);
      else workerIds.set(w.code, found.id);
      continue;
    }
    const created = await db.employee.create({
      data: {
        employeeCode: w.code,
        firstName: w.firstName,
        lastName: w.lastName,
        email: demoEmail(w.code),
        gender: w.gender,
        designation: w.designation,
        employmentType: w.employmentType,
        status: w.status,
        joiningDate: new Date(`${w.joiningDate}T00:00:00.000Z`),
        salary: w.salary === null ? null : new Prisma.Decimal(w.salary),
        dailyWageRate: w.dailyWageRate === null ? null : new Prisma.Decimal(w.dailyWageRate),
        departmentId: departmentIds.get(w.department)!,
        shiftId: shiftIds.get(w.shift)!,
      },
    });
    workerIds.set(w.code, created.id);
    employees.created++;
  }

  // Today's attendance and performance — insert-only
  const attending = DEMO_WORKERS.filter((w) => w.today !== null && workerIds.has(w.code));
  const attendanceRows = attending.map((w) => {
    const clockIn = w.today!.clockIn ? localAt(now, 0, w.today!.clockIn) : null;
    return {
      employeeId: workerIds.get(w.code)!,
      date: today,
      status: w.today!.status,
      clockIn: clockIn !== null && clockIn <= now ? clockIn : null,
      remarks: `${DEMO_MARK} ${w.today!.remarks ?? 'Demo attendance'}`,
    };
  });
  const attendanceCreated = (
    await db.attendance.createMany({ data: attendanceRows, skipDuplicates: true })
  ).count;

  const outputRows = attending
    .filter((w) => w.today!.output !== undefined)
    .map((w) => {
      const o = w.today!.output!;
      return {
        employeeId: workerIds.get(w.code)!,
        date: today,
        workingHours: o.workingHours,
        operationsCount: o.operationsCount ?? null,
        expectedParts: o.expectedParts === undefined ? null : new Prisma.Decimal(o.expectedParts),
        producedParts: o.producedParts === undefined ? null : new Prisma.Decimal(o.producedParts),
        remarks: `${DEMO_MARK} ${o.remarks ?? 'Demo performance'}`,
      };
    });
  const outputCreated = (
    await db.employeeDailyOutput.createMany({ data: outputRows, skipDuplicates: true })
  ).count;

  // Demo rows from an earlier version of this seed may lack parts. Fill only
  // values that are still empty on the seed's own rows; nothing is overwritten.
  let outputFilled = 0;
  for (const row of outputRows) {
    if (row.expectedParts === null || row.producedParts === null) continue;
    const filled = await db.employeeDailyOutput.updateMany({
      where: {
        employeeId: row.employeeId,
        date: today,
        expectedParts: null,
        producedParts: null,
        remarks: { startsWith: DEMO_MARK },
      },
      data: { expectedParts: row.expectedParts, producedParts: row.producedParts },
    });
    outputFilled += filled.count;
  }

  // Work orders with their output, each in one transaction
  const scrapDept = DEMO_DEPARTMENTS.find((d) => d.code === 'SCRAP')!.name;
  const supervisor = DEMO_WORKERS.find((w) => w.code === 'DEMO-EMP-001')!;
  const workOrders: SeedCounts = { created: 0, existing: 0 };
  let outputsCreated = 0;
  for (const wo of withWorkOrders ? DEMO_WORK_ORDERS : []) {
    const found = await db.workOrder.findUnique({ where: { workOrderNumber: wo.number } });
    if (found !== null) {
      workOrders.existing++;
      continue;
    }
    const start = localAt(now, -wo.startDaysAgo, '06:00');
    const started =
      wo.status === 'IN_PROGRESS' || wo.status === 'ON_HOLD' || wo.status === 'COMPLETED';
    const lastOutput = wo.outputs.reduce<Date | null>((latest, o) => {
      const at = localAt(now, -o.daysAgo, o.time);
      return latest === null || at > latest ? at : latest;
    }, null);
    await db.$transaction(async (tx) => {
      await tx.workOrder.create({
        data: {
          workOrderNumber: wo.number,
          product: wo.product,
          targetQuantity: new Prisma.Decimal(wo.targetQuantity),
          unit: 'pcs',
          status: wo.status,
          priority: wo.priority,
          scheduledStart: start,
          scheduledEnd: localAt(now, -wo.startDaysAgo + wo.durationDays, '14:00'),
          actualStart: started ? start : null,
          actualEnd: wo.status === 'COMPLETED' ? lastOutput : null,
          departmentId: departmentIds.get(scrapDept) ?? null,
          departmentName: scrapDept,
          assignedToId: workerIds.get(supervisor.code) ?? null,
          assignedToName: workerIds.has(supervisor.code)
            ? `${supervisor.firstName} ${supervisor.lastName}`
            : null,
          notes: `${DEMO_MARK} ${wo.notes}`,
          outputs: {
            create: wo.outputs
              .map((o) => ({ ...o, at: localAt(now, -o.daysAgo, o.time) }))
              .filter((o) => o.at <= now)
              .map((o) => ({
                goodQty: new Prisma.Decimal(o.goodQty),
                rejectedQty: new Prisma.Decimal(o.rejectedQty),
                scrapQty: new Prisma.Decimal(o.scrapQty),
                recordedAt: o.at,
                recordedByName: 'Demo seed',
                remarks: `${DEMO_MARK} ${o.remarks}`,
              })),
          },
        },
      });
    });
    workOrders.created++;
    outputsCreated += wo.outputs.filter((o) => localAt(now, -o.daysAgo, o.time) <= now).length;
  }

  // This month's target, only when the month has none
  const periodStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const target = withWorkOrders
    ? await db.productionMonthlyTarget.findUnique({ where: { periodStart } })
    : null;
  if (withWorkOrders && target === null) {
    await db.productionMonthlyTarget.create({
      data: {
        periodStart,
        outputTarget: new Prisma.Decimal(DEMO_TARGET.outputTarget),
        unit: DEMO_TARGET.unit,
        targetCompletionRate: new Prisma.Decimal(DEMO_TARGET.targetCompletionRate),
        maxRejectionRate: new Prisma.Decimal(DEMO_TARGET.maxRejectionRate),
        targetEmployeeEfficiency: new Prisma.Decimal(DEMO_TARGET.targetEmployeeEfficiency),
        notes: `${DEMO_MARK} ${DEMO_TARGET.notes}`,
      },
    });
  }

  return {
    departments,
    shifts,
    employees,
    attendance: { created: attendanceCreated, existing: attendanceRows.length - attendanceCreated },
    dailyPerformance: {
      created: outputCreated,
      existing: outputRows.length - outputCreated,
      filled: outputFilled,
    },
    workOrders,
    workOrderOutputs: { created: outputsCreated },
    monthlyTarget: !withWorkOrders ? 'skipped' : target === null ? 'created' : 'existing',
  };
}

// ── Target database safety ────────────────────────────────────────────────────

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The database the seed will write to. Refuses anything that is not a
 * PostgreSQL database on this computer. `database` swaps only the database
 * name, keeping the local host and credentials.
 */
export function resolveSeedTarget(
  rawUrl: string | undefined,
  database?: string,
  nodeEnv?: string,
  remote: { allowRemote?: boolean; confirmHost?: string | undefined } = {},
): { url: string; host: string; port: string; database: string; remote: boolean } {
  const allowRemote = remote.allowRemote === true;
  if (nodeEnv === 'production' && !allowRemote)
    throw new Error('Refusing to seed demo data with NODE_ENV=production.');
  if (!rawUrl) throw new Error('DATABASE_URL is not set.');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol))
    throw new Error('DATABASE_URL is not a PostgreSQL URL.');
  const isRemote = !LOCAL_HOSTS.has(url.hostname);
  if (isRemote && !allowRemote) {
    throw new Error(
      `Refusing to seed "${url.hostname}": demo data is only written to a database on this computer.`,
    );
  }
  if (isRemote) {
    // A remote write needs the exact host typed back, so it cannot happen by accident
    if (database !== undefined) throw new Error('--db cannot be used with a remote database.');
    if (remote.confirmHost !== url.hostname) {
      throw new Error(
        `Target is the REMOTE database ${url.hostname}${url.pathname}. Nothing was written. ` +
          `To add the demo workforce data there, run again with --confirm-host ${url.hostname}`,
      );
    }
  }
  if (database !== undefined) {
    if (!/^[A-Za-z0-9_]+$/.test(database))
      throw new Error('Database name may contain only letters, digits and _.');
    url.pathname = `/${database}`;
  }
  return {
    url: url.toString(),
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.slice(1),
    remote: isRemote,
  };
}
