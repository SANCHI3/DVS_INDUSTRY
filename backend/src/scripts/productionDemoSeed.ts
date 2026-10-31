import {
  Prisma,
  type PrismaClient,
  type AttendanceStatus,
  type EmploymentType,
} from '@prisma/client';

/**
 * Demo data for the Production module only: departments, shifts, ten press
 * operators, a week of attendance and daily performance, work orders with
 * output, and this month's target. Every demo record is marked: Employee IDs
 * DEMO-EMP-…, work orders DEMO-WO-…, and "[DEMO]" at the start of remarks,
 * notes and descriptions.
 *
 * Every write is create-if-missing. Nothing that this seed did not create is
 * ever updated or deleted:
 *  - departments and shifts are found by name and reused as they are;
 *  - demo workers are found by Employee ID; a record with that ID that this
 *    seed did not create (no @demo.invalid e-mail), or that was removed, is
 *    left alone and gets no demo activity;
 *  - attendance and performance use the (employee, date) unique keys, so an
 *    existing day is never overwritten;
 *  - work orders are found by number; their output is created only together
 *    with the work order, so a rerun adds none;
 *  - the month's target is created only when the month has none.
 *
 * `upgradeOldDemo` is the one exception, and only for records an earlier
 * version of this seed created (five workers with other names): it renames
 * them to the current plan, rewrites their [DEMO] rows in the demo week and
 * removes (soft delete, as Remove Worker does) old demo workers that are no
 * longer in the plan. Without it they are only reported.
 *
 * `dryRun` writes nothing and reports what a real run would do.
 */

export const DEMO_MARK = '[DEMO]';
export const DEMO_EMAIL_DOMAIN = 'demo.invalid'; // reserved TLD: can never be a real address
export const DEMO_DESIGNATION = 'Press Operator';
/** Attendance and performance cover this many days, ending today */
export const DEMO_PERIOD_DAYS = 7;

export const DEMO_DEPARTMENTS = [
  { name: 'Plant Head', code: 'PLANT' },
  { name: 'Maintanance Department', code: 'MAINT' }, // spelling as requested
  { name: 'Production Scrap', code: 'SCRAP' },
  { name: 'Quality Department', code: 'QUAL' },
  { name: 'HR', code: 'HR' },
  { name: 'Accountant', code: 'ACCT' },
] as const;

export type DemoDepartmentName = (typeof DEMO_DEPARTMENTS)[number]['name'];

/** Names an earlier version of this seed used, renamed by `upgradeOldDemo` */
const FORMER_DEMO_DEPARTMENT: Partial<Record<DemoDepartmentName, string>> = {
  'Maintanance Department': 'Maintance Department',
};

export const DEMO_SHIFTS = [
  { name: 'Morning Shift', startTime: '06:00', endTime: '14:00', isNightShift: false },
  { name: 'General Shift', startTime: '09:00', endTime: '17:30', isNightShift: false },
] as const;

type ShiftName = (typeof DEMO_SHIFTS)[number]['name'];

/** P present, L late, H half day, A absent, V on leave */
type DayCode = 'P' | 'L' | 'H' | 'A' | 'V';

export interface DemoWorker {
  code: string;
  firstName: string;
  lastName: string; // '' for workers known by one name
  department: DemoDepartmentName;
  shift: ShiftName;
  employmentType: EmploymentType;
  joiningDate: string;
  /** One code per day of the demo week, oldest first; Sundays are always Week Off */
  week: string;
  /** Parts a press is planned to make per hour */
  partsPerHour: number;
  /** Usual share of the planned parts produced, in percent */
  efficiency: number;
  part: string;
}

// No pay, phone, gender or other personal details: none were provided
export const DEMO_WORKERS: DemoWorker[] = [
  {
    code: 'DEMO-EMP-001',
    firstName: 'Bhiva',
    lastName: '',
    department: 'Production Scrap',
    shift: 'Morning Shift',
    employmentType: 'FULL_TIME',
    joiningDate: '2018-06-04',
    week: 'PPPPLPP',
    partsPerHour: 60,
    efficiency: 96,
    part: 'MS Bracket MB-40',
  },
  {
    code: 'DEMO-EMP-002',
    firstName: 'Bholaram',
    lastName: '',
    department: 'Production Scrap',
    shift: 'Morning Shift',
    employmentType: 'FULL_TIME',
    joiningDate: '2019-01-14',
    week: 'PPAPPPP',
    partsPerHour: 60,
    efficiency: 93,
    part: 'MS Bracket MB-40',
  },
  {
    code: 'DEMO-EMP-003',
    firstName: 'Vijay',
    lastName: 'Yadav',
    department: 'Production Scrap',
    shift: 'General Shift',
    employmentType: 'FULL_TIME',
    joiningDate: '2020-07-01',
    week: 'PLPPPPH',
    partsPerHour: 55,
    efficiency: 91,
    part: 'Flange Plate FP-120',
  },
  {
    code: 'DEMO-EMP-004',
    firstName: 'Sandeep',
    lastName: '',
    department: 'Maintanance Department',
    shift: 'General Shift',
    employmentType: 'FULL_TIME',
    joiningDate: '2021-03-15',
    week: 'PPPPPPP',
    partsPerHour: 40,
    efficiency: 88,
    part: 'Shaft Collar SC-25',
  },
  {
    code: 'DEMO-EMP-005',
    firstName: 'Abhisheak',
    lastName: 'Yadav',
    department: 'Production Scrap',
    shift: 'Morning Shift',
    employmentType: 'CONTRACT',
    joiningDate: '2022-02-07',
    week: 'VVPPPLA',
    partsPerHour: 55,
    efficiency: 89,
    part: 'Flange Plate FP-120',
  },
  {
    code: 'DEMO-EMP-006',
    firstName: 'Rajesh',
    lastName: 'Yadav',
    department: 'Quality Department',
    shift: 'General Shift',
    employmentType: 'FULL_TIME',
    joiningDate: '2019-09-23',
    week: 'PPPHPPP',
    partsPerHour: 45,
    efficiency: 95,
    part: 'Gear Blank GB-60',
  },
  {
    code: 'DEMO-EMP-007',
    firstName: 'Guddu',
    lastName: '',
    department: 'Production Scrap',
    shift: 'Morning Shift',
    employmentType: 'CONTRACT',
    joiningDate: '2023-05-08',
    week: 'PPPPPAL',
    partsPerHour: 60,
    efficiency: 86,
    part: 'MS Bracket MB-40',
  },
  {
    code: 'DEMO-EMP-008',
    firstName: 'Sampath',
    lastName: 'Revgade',
    department: 'Maintanance Department',
    shift: 'General Shift',
    employmentType: 'FULL_TIME',
    joiningDate: '2020-11-02',
    week: 'LPPPPPP',
    partsPerHour: 40,
    efficiency: 92,
    part: 'Shaft Collar SC-25',
  },
  {
    code: 'DEMO-EMP-009',
    firstName: 'Pradip',
    lastName: 'Kumar',
    department: 'Quality Department',
    shift: 'Morning Shift',
    employmentType: 'FULL_TIME',
    joiningDate: '2021-08-16',
    week: 'PPPPPPV',
    partsPerHour: 45,
    efficiency: 94,
    part: 'Gear Blank GB-60',
  },
  {
    code: 'DEMO-EMP-010',
    firstName: 'Vishwakarma',
    lastName: 'Gupta',
    department: 'Production Scrap',
    shift: 'General Shift',
    employmentType: 'CONTRACT',
    joiningDate: '2024-01-10',
    week: 'PPLPPPP',
    partsPerHour: 55,
    efficiency: 90,
    part: 'Flange Plate FP-120',
  },
];

const DAY_STATUS: Record<DayCode, AttendanceStatus> = {
  P: 'PRESENT',
  L: 'LATE',
  H: 'HALF_DAY',
  A: 'ABSENT',
  V: 'LEAVE',
};

const DAY_REMARK: Record<DayCode | 'W', string> = {
  P: 'Demo attendance',
  L: 'Late arrival',
  H: 'Half day: left after 4 hours',
  A: 'Absent',
  V: 'On leave',
  W: 'Weekly off (Sunday)',
};

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
  department: DemoDepartmentName;
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
    department: 'Production Scrap',
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
    department: 'Production Scrap',
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
    department: 'Quality Department',
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
        remarks: 'Stopped: material shortage',
      },
    ],
  },
  {
    number: 'DEMO-WO-004',
    product: 'Shaft Collar SC-25',
    targetQuantity: 1500,
    status: 'RELEASED',
    priority: 'URGENT',
    department: 'Maintanance Department',
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
    department: 'Production Scrap',
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

const addMinutes = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60_000);

/** Same rounding as attendance entered in the app */
const hoursBetween = (from: Date, to: Date): number =>
  parseFloat(((to.getTime() - from.getTime()) / 3_600_000).toFixed(2));

const isSunday = (now: Date, daysAgo: number): boolean =>
  localAt(now, -daysAgo, '00:00').getDay() === 0;

/** Work-order activity on a Sunday moves to the Saturday before, when the factory works */
const workdayAgo = (now: Date, daysAgo: number): number =>
  isSunday(now, daysAgo) ? daysAgo + 1 : daysAgo;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const demoEmail = (code: string): string => `${code.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`;

const dayKey = (employeeId: number, date: Date): string => `${employeeId}|${date.getTime()}`;

interface PlannedDay {
  attendance: {
    employeeId: number;
    date: Date;
    status: AttendanceStatus;
    clockIn: Date | null;
    clockOut: Date | null;
    workingHours: number | null;
    remarks: string;
  };
  output: {
    employeeId: number;
    date: Date;
    workingHours: number;
    operationsCount: number;
    expectedParts: Prisma.Decimal;
    producedParts: Prisma.Decimal;
    remarks: string;
  } | null;
}

/**
 * One worker's demo week. Nothing is planned in the future: a day whose shift
 * has not started yet is skipped, a shift still running has no clock-out, and
 * performance is recorded only for a finished shift.
 */
export function planWorkerWeek(
  w: DemoWorker,
  index: number,
  employeeId: number,
  shift: { startTime: string; endTime: string },
  now: Date,
): PlannedDay[] {
  const days: PlannedDay[] = [];
  for (let i = 0; i < DEMO_PERIOD_DAYS; i++) {
    const daysAgo = DEMO_PERIOD_DAYS - 1 - i;
    const date = storedDay(localAt(now, -daysAgo, '00:00'));
    const shiftStart = localAt(now, -daysAgo, shift.startTime);
    if (shiftStart > now) continue;
    let shiftEnd = localAt(now, -daysAgo, shift.endTime);
    if (shiftEnd <= shiftStart) shiftEnd = addMinutes(shiftEnd, 24 * 60); // overnight shift

    const code: DayCode | 'W' = isSunday(now, daysAgo) ? 'W' : (w.week[i] as DayCode);
    const remarks = `${DEMO_MARK} ${DAY_REMARK[code]}`;
    if (code === 'W' || code === 'A' || code === 'V') {
      const status = code === 'W' ? 'WEEK_OFF' : DAY_STATUS[code];
      days.push({
        attendance: {
          employeeId,
          date,
          status,
          clockIn: null,
          clockOut: null,
          workingHours: null,
          remarks,
        },
        output: null,
      });
      continue;
    }

    // Small, fixed variations so the week does not look copied
    const clockIn = addMinutes(
      shiftStart,
      code === 'L' ? 22 + ((index + i) % 4) * 7 : ((index * 7 + i * 3) % 9) - 6,
    );
    const plannedOut =
      code === 'H' ? addMinutes(shiftStart, 4 * 60) : addMinutes(shiftEnd, ((index + i) % 3) * 5);
    const clockOut = plannedOut <= now ? plannedOut : null;
    const workingHours = clockOut === null ? null : hoursBetween(clockIn, clockOut);
    days.push({
      attendance: {
        employeeId,
        date,
        status: DAY_STATUS[code],
        clockIn,
        clockOut,
        workingHours,
        remarks,
      },
      output: null,
    });
    if (workingHours === null) continue;

    const expected = Math.round(w.partsPerHour * (code === 'H' ? 4 : 8));
    const efficiency = Math.min(
      103,
      w.efficiency + ((index * 3 + i * 5) % 7) - 3 - (code === 'L' ? 6 : 0),
    );
    const produced = Math.round((expected * efficiency) / 100);
    days[days.length - 1]!.output = {
      employeeId,
      date,
      workingHours: Math.round(workingHours * 10) / 10,
      operationsCount: 2 + ((index + i) % 3),
      expectedParts: new Prisma.Decimal(expected),
      producedParts: new Prisma.Decimal(produced),
      remarks: `${DEMO_MARK} ${w.part}: ${produced} of ${expected} planned parts`,
    };
  }
  return days;
}

export interface SeedCounts {
  created: number;
  existing: number;
}

export interface SeedReport {
  dryRun: boolean;
  period: { from: string; to: string };
  departments: SeedCounts & { renamed: string[] };
  shifts: SeedCounts;
  employees: SeedCounts & {
    /** ID taken by a record this seed did not create: left alone */
    notDemo: string[];
    /** Demo worker removed in the app: not restored */
    removed: string[];
    /** Created by an earlier version of this seed; needs `upgradeOldDemo` */
    outdated: string[];
    upgraded: string[];
    /** Earlier demo workers no longer in the plan; removed by `upgradeOldDemo` */
    extra: string[];
    retired: string[];
  };
  attendance: SeedCounts & { rewritten: number };
  dailyPerformance: SeedCounts & { filled: number; rewritten: number };
  /** `otherThisMonth`: work orders created this month that are not demo orders */
  workOrders: SeedCounts & { otherThisMonth: number };
  workOrderOutputs: { created: number };
  monthlyTarget: 'created' | 'existing' | 'skipped';
}

export interface SeedOptions {
  /** false: workforce and attendance only, no work orders, output or target */
  workOrders?: boolean;
  upgradeOldDemo?: boolean;
  dryRun?: boolean;
}

// ── Seed ──────────────────────────────────────────────────────────────────────

export async function seedProductionDemo(
  db: PrismaClient,
  now: Date = new Date(),
  options: SeedOptions = {},
): Promise<SeedReport> {
  const withWorkOrders = options.workOrders ?? true;
  const upgrade = options.upgradeOldDemo ?? false;
  const dryRun = options.dryRun ?? false;
  const today = storedDay(now);
  const periodStart = storedDay(localAt(now, -(DEMO_PERIOD_DAYS - 1), '00:00'));
  // Stand-in ids for records a dry run would create
  let placeholderId = 0;
  const placeholder = (): number => --placeholderId;

  // Departments first, so workers can be assigned to them
  const departmentIds = new Map<string, number>();
  const departments: SeedReport['departments'] = { created: 0, existing: 0, renamed: [] };
  for (const d of DEMO_DEPARTMENTS) {
    const found = await db.department.findUnique({ where: { name: d.name } });
    if (found !== null) {
      departmentIds.set(d.name, found.id);
      departments.existing++;
      continue;
    }
    const formerName = FORMER_DEMO_DEPARTMENT[d.name];
    const former =
      upgrade && formerName !== undefined
        ? await db.department.findUnique({ where: { name: formerName } })
        : null;
    if (former !== null && (former.description ?? '').startsWith(DEMO_MARK)) {
      if (!dryRun) await db.department.update({ where: { id: former.id }, data: { name: d.name } });
      departmentIds.set(d.name, former.id);
      departments.renamed.push(`${formerName} → ${d.name}`);
      continue;
    }
    // A different department may already use the short code
    const codeTaken = (await db.department.findUnique({ where: { code: d.code } })) !== null;
    const id = dryRun
      ? placeholder()
      : (
          await db.department.create({
            data: {
              name: d.name,
              code: codeTaken ? `DEMO-${d.code}` : d.code,
              description: `${DEMO_MARK} Created by the Production demo seed`,
            },
          })
        ).id;
    departmentIds.set(d.name, id);
    departments.created++;
  }

  // Shift times come from the database when the shift already exists
  const shiftRows = new Map<string, { id: number; startTime: string; endTime: string }>();
  const shifts: SeedCounts = { created: 0, existing: 0 };
  for (const s of DEMO_SHIFTS) {
    const found = await db.shift.findUnique({ where: { name: s.name } });
    if (found !== null) {
      const usable = HHMM.test(found.startTime) && HHMM.test(found.endTime);
      shiftRows.set(s.name, {
        id: found.id,
        startTime: usable ? found.startTime : s.startTime,
        endTime: usable ? found.endTime : s.endTime,
      });
      shifts.existing++;
      continue;
    }
    const id = dryRun
      ? placeholder()
      : (
          await db.shift.create({
            data: { ...s, description: `${DEMO_MARK} Created by the Production demo seed` },
          })
        ).id;
    shiftRows.set(s.name, { id, startTime: s.startTime, endTime: s.endTime });
    shifts.created++;
  }

  // Workers: only records this seed created (demo e-mail) get demo activity
  const employees: SeedReport['employees'] = {
    created: 0,
    existing: 0,
    notDemo: [],
    removed: [],
    outdated: [],
    upgraded: [],
    extra: [],
    retired: [],
  };
  const workerIds = new Map<string, number>();
  const upgradedIds = new Set<number>();
  for (const w of DEMO_WORKERS) {
    const planned = {
      firstName: w.firstName,
      lastName: w.lastName,
      designation: DEMO_DESIGNATION,
      employmentType: w.employmentType,
      joiningDate: new Date(`${w.joiningDate}T00:00:00.000Z`),
      departmentId: departmentIds.get(w.department)!,
      shiftId: shiftRows.get(w.shift)!.id,
    };
    const found = await db.employee.findFirst({
      where: { employeeCode: { equals: w.code, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        deletedAt: true,
        firstName: true,
        lastName: true,
        designation: true,
      },
    });
    if (found === null) {
      const id = dryRun
        ? placeholder()
        : (
            await db.employee.create({
              data: {
                ...planned,
                employeeCode: w.code,
                email: demoEmail(w.code),
                status: 'ACTIVE',
              },
            })
          ).id;
      workerIds.set(w.code, id);
      employees.created++;
      continue;
    }
    employees.existing++;
    if (found.email !== demoEmail(w.code)) {
      employees.notDemo.push(w.code);
      continue;
    }
    if (found.deletedAt !== null) {
      employees.removed.push(w.code);
      continue;
    }
    // Name and designation identify the plan version; other fields may have been edited in the app
    const current =
      found.firstName === w.firstName &&
      found.lastName === w.lastName &&
      found.designation === DEMO_DESIGNATION;
    if (!current) {
      if (!upgrade) {
        employees.outdated.push(w.code);
        continue;
      }
      if (!dryRun) {
        await db.employee.update({
          where: { id: found.id },
          data: { ...planned, gender: null, salary: null, dailyWageRate: null, status: 'ACTIVE' },
        });
      }
      employees.upgraded.push(w.code);
      upgradedIds.add(found.id);
    }
    workerIds.set(w.code, found.id);
  }

  // Demo workers an earlier version created that are no longer in the plan
  const planCodes = new Set(DEMO_WORKERS.map((w) => w.code.toLowerCase()));
  const earlier = await db.employee.findMany({
    where: {
      employeeCode: { startsWith: 'DEMO-EMP-', mode: 'insensitive' },
      email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` },
      deletedAt: null,
    },
    select: { id: true, employeeCode: true, email: true },
  });
  for (const e of earlier) {
    if (planCodes.has(e.employeeCode.toLowerCase()) || e.email !== demoEmail(e.employeeCode))
      continue;
    if (!upgrade) {
      employees.extra.push(e.employeeCode);
      continue;
    }
    if (!dryRun) {
      // As Remove Worker does: history is kept
      await db.employee.update({
        where: { id: e.id },
        data: { deletedAt: now, status: 'TERMINATED' },
      });
    }
    employees.retired.push(e.employeeCode);
  }

  // The demo week, insert-only (upgraded workers: their own [DEMO] rows are rewritten)
  const planned = DEMO_WORKERS.flatMap((w, index) =>
    workerIds.has(w.code)
      ? planWorkerWeek(w, index, workerIds.get(w.code)!, shiftRows.get(w.shift)!, now)
      : [],
  );
  const ids = [...new Set(planned.map((p) => p.attendance.employeeId))].filter((id) => id > 0);
  const inPeriod = { employeeId: { in: ids }, date: { gte: periodStart, lte: today } };
  const existingAttendance = new Map(
    (
      await db.attendance.findMany({
        where: inPeriod,
        select: { employeeId: true, date: true, remarks: true },
      })
    ).map((r) => [dayKey(r.employeeId, r.date), r]),
  );
  const existingOutput = new Map(
    (
      await db.employeeDailyOutput.findMany({
        where: inPeriod,
        select: {
          employeeId: true,
          date: true,
          remarks: true,
          expectedParts: true,
          producedParts: true,
        },
      })
    ).map((r) => [dayKey(r.employeeId, r.date), r]),
  );
  const ownRow = (remarks: string | null): boolean => (remarks ?? '').startsWith(DEMO_MARK);

  const attendance: SeedReport['attendance'] = { created: 0, existing: 0, rewritten: 0 };
  const newAttendance: PlannedDay['attendance'][] = [];
  for (const { attendance: row } of planned) {
    const found = existingAttendance.get(dayKey(row.employeeId, row.date));
    if (found === undefined) {
      newAttendance.push(row);
    } else if (upgradedIds.has(row.employeeId) && ownRow(found.remarks)) {
      if (!dryRun) {
        await db.attendance.updateMany({
          where: { employeeId: row.employeeId, date: row.date, remarks: { startsWith: DEMO_MARK } },
          data: row,
        });
      }
      attendance.rewritten++;
    } else {
      attendance.existing++;
    }
  }
  attendance.created = dryRun
    ? newAttendance.length
    : (await db.attendance.createMany({ data: newAttendance, skipDuplicates: true })).count;

  const dailyPerformance: SeedReport['dailyPerformance'] = {
    created: 0,
    existing: 0,
    filled: 0,
    rewritten: 0,
  };
  const newOutput: NonNullable<PlannedDay['output']>[] = [];
  for (const { output: row } of planned) {
    if (row === null) continue;
    const found = existingOutput.get(dayKey(row.employeeId, row.date));
    if (found === undefined) {
      newOutput.push(row);
    } else if (upgradedIds.has(row.employeeId) && ownRow(found.remarks)) {
      if (!dryRun) {
        await db.employeeDailyOutput.updateMany({
          where: { employeeId: row.employeeId, date: row.date, remarks: { startsWith: DEMO_MARK } },
          data: row,
        });
      }
      dailyPerformance.rewritten++;
    } else if (
      // Demo rows from an earlier version may lack parts: fill only what is still empty
      ownRow(found.remarks) &&
      found.expectedParts === null &&
      found.producedParts === null
    ) {
      if (!dryRun) {
        await db.employeeDailyOutput.updateMany({
          where: {
            employeeId: row.employeeId,
            date: row.date,
            expectedParts: null,
            producedParts: null,
            remarks: { startsWith: DEMO_MARK },
          },
          data: { expectedParts: row.expectedParts, producedParts: row.producedParts },
        });
      }
      dailyPerformance.filled++;
    } else {
      dailyPerformance.existing++;
    }
  }
  dailyPerformance.created = dryRun
    ? newOutput.length
    : (await db.employeeDailyOutput.createMany({ data: newOutput, skipDuplicates: true })).count;

  // Earlier demo orders named an old demo worker as supervisor
  if (upgradedIds.size > 0 && !dryRun) {
    await db.workOrder.updateMany({
      where: {
        workOrderNumber: { startsWith: 'DEMO-WO-' },
        notes: { startsWith: DEMO_MARK },
        assignedToId: { in: [...upgradedIds] },
      },
      data: { assignedToId: null, assignedToName: null },
    });
  }

  // Work orders with their output, each in one transaction
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const workOrders: SeedReport['workOrders'] = {
    created: 0,
    existing: 0,
    otherThisMonth: await db.workOrder.count({
      where: {
        deletedAt: null,
        createdAt: { gte: monthStart },
        NOT: { workOrderNumber: { startsWith: 'DEMO-WO-' } },
      },
    }),
  };
  let outputsCreated = 0;
  for (const wo of withWorkOrders ? DEMO_WORK_ORDERS : []) {
    const found = await db.workOrder.findUnique({ where: { workOrderNumber: wo.number } });
    if (found !== null) {
      workOrders.existing++;
      continue;
    }
    const start = localAt(now, -workdayAgo(now, wo.startDaysAgo), '06:00');
    const started =
      wo.status === 'IN_PROGRESS' || wo.status === 'ON_HOLD' || wo.status === 'COMPLETED';
    const outputs = wo.outputs
      .map((o) => ({ ...o, at: localAt(now, -workdayAgo(now, o.daysAgo), o.time) }))
      .filter((o) => o.at <= now);
    const lastOutput = outputs.reduce<Date | null>(
      (latest, o) => (latest === null || o.at > latest ? o.at : latest),
      null,
    );
    if (!dryRun) {
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
            departmentId: departmentIds.get(wo.department) ?? null,
            departmentName: wo.department,
            notes: `${DEMO_MARK} ${wo.notes}`,
            outputs: {
              create: outputs.map((o) => ({
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
    }
    workOrders.created++;
    outputsCreated += outputs.length;
  }

  // This month's target, only when the month has none
  const targetPeriod = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const target = withWorkOrders
    ? await db.productionMonthlyTarget.findUnique({ where: { periodStart: targetPeriod } })
    : null;
  if (withWorkOrders && target === null && !dryRun) {
    await db.productionMonthlyTarget.create({
      data: {
        periodStart: targetPeriod,
        outputTarget: new Prisma.Decimal(DEMO_TARGET.outputTarget),
        unit: DEMO_TARGET.unit,
        targetCompletionRate: new Prisma.Decimal(DEMO_TARGET.targetCompletionRate),
        maxRejectionRate: new Prisma.Decimal(DEMO_TARGET.maxRejectionRate),
        targetEmployeeEfficiency: new Prisma.Decimal(DEMO_TARGET.targetEmployeeEfficiency),
        notes: `${DEMO_MARK} ${DEMO_TARGET.notes}`,
      },
    });
  }

  const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
  return {
    dryRun,
    period: { from: isoDay(periodStart), to: isoDay(today) },
    departments,
    shifts,
    employees,
    attendance,
    dailyPerformance,
    workOrders,
    workOrderOutputs: { created: outputsCreated },
    monthlyTarget: !withWorkOrders ? 'skipped' : target === null ? 'created' : 'existing',
  };
}

// ── Target database safety ────────────────────────────────────────────────────

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The database the seed will use. Refuses anything that is not PostgreSQL on
 * this computer unless `allowRemote`; a remote database is only `confirmed`
 * for writing when its exact host is typed back. `database` swaps only the
 * database name of a local URL.
 */
export function resolveSeedTarget(
  rawUrl: string | undefined,
  database?: string,
  nodeEnv?: string,
  remote: { allowRemote?: boolean; confirmHost?: string | undefined } = {},
): {
  url: string;
  host: string;
  port: string;
  database: string;
  remote: boolean;
  confirmed: boolean;
} {
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
    if (database !== undefined) throw new Error('--db cannot be used with a remote database.');
    if (remote.confirmHost !== undefined && remote.confirmHost !== url.hostname) {
      throw new Error(
        `--confirm-host ${remote.confirmHost} does not match the target ${url.hostname}. Nothing was written.`,
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
    confirmed: !isRemote || remote.confirmHost === url.hostname,
  };
}
