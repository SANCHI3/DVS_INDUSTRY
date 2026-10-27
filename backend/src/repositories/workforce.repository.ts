import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import type {
  ShiftDto,
  ShiftListResult,
  ShiftFilters,
  CreateShiftData,
  UpdateShiftData,
  AttendanceDto,
  AttendanceListResult,
  AttendanceFilters,
  CreateAttendanceData,
  UpdateAttendanceData,
  DailyAttendanceSummary,
  AttendanceTrendEntry,
  AttendanceStatus,
  EmployeeDailyOutputDto,
  EmployeeDailyOutputListResult,
  EmployeeDailyOutputFilters,
  CreateEmployeeDailyOutputData,
  UpdateEmployeeDailyOutputData,
  EmployeeOutputSummary,
} from '../interfaces';
import { calculateEfficiency } from '../utils/efficiency';

// ── Select shapes ─────────────────────────────────────────────────────────────

const shiftSelect = {
  id: true,
  name: true,
  startTime: true,
  endTime: true,
  isNightShift: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { employees: true } },
} as const;

const attendanceSelect = {
  id: true,
  employeeId: true,
  date: true,
  clockIn: true,
  clockOut: true,
  workingHours: true,
  status: true,
  remarks: true,
  createdAt: true,
  updatedAt: true,
  employee: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      designation: true,
      department: { select: { id: true, name: true } },
      shift: { select: { id: true, name: true } },
    },
  },
} as const;

const employeeOutputSelect = {
  id: true,
  employeeId: true,
  date: true,
  workingHours: true,
  expectedParts: true,
  producedParts: true,
  operationsCount: true,
  remarks: true,
  recordedById: true,
  createdAt: true,
  updatedAt: true,
  employee: attendanceSelect.employee,
} as const;

// ── Converters ────────────────────────────────────────────────────────────────

type PrismaShift = Prisma.ShiftGetPayload<{ select: typeof shiftSelect }>;
type PrismaAttendance = Prisma.AttendanceGetPayload<{ select: typeof attendanceSelect }>;
type PrismaEmployeeOutput = Prisma.EmployeeDailyOutputGetPayload<{
  select: typeof employeeOutputSelect;
}>;

function toShiftDto(r: PrismaShift): ShiftDto {
  return { ...r };
}

function toAttendanceDto(r: PrismaAttendance): AttendanceDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    date: r.date,
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    workingHours: r.workingHours,
    status: r.status as AttendanceStatus,
    remarks: r.remarks,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    employee: {
      id: r.employee.id,
      employeeCode: r.employee.employeeCode,
      firstName: r.employee.firstName,
      lastName: r.employee.lastName,
      designation: r.employee.designation,
      department: r.employee.department ?? null,
      shift: r.employee.shift ?? null,
    },
  };
}

function decimalToNumber(d: Prisma.Decimal | null): number | null {
  return d === null ? null : Number(d.toString());
}

function toEmployeeOutputDto(r: PrismaEmployeeOutput): EmployeeDailyOutputDto {
  const expectedParts = decimalToNumber(r.expectedParts);
  const producedParts = decimalToNumber(r.producedParts);
  return {
    id: r.id,
    employeeId: r.employeeId,
    date: r.date,
    workingHours: r.workingHours,
    expectedParts,
    producedParts,
    operationsCount: r.operationsCount,
    efficiency: calculateEfficiency(expectedParts, producedParts),
    remarks: r.remarks,
    recordedById: r.recordedById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    employee: {
      id: r.employee.id,
      employeeCode: r.employee.employeeCode,
      firstName: r.employee.firstName,
      lastName: r.employee.lastName,
      designation: r.employee.designation,
      department: r.employee.department ?? null,
      shift: r.employee.shift ?? null,
    },
  };
}

/** Employee code / first / last name match, shared by attendance and output lists. */
function employeeSearchWhere(search: string): Prisma.EmployeeWhereInput {
  const q = search.trim();
  return {
    OR: [
      { employeeCode: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
    ],
  };
}

/** Calculate working hours from clockIn to clockOut (decimal hours). */
function calcWorkingHours(clockIn: Date, clockOut: Date): number {
  const ms = clockOut.getTime() - clockIn.getTime();
  return parseFloat((ms / 3_600_000).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────

export class WorkforceRepository {
  // ══ SHIFTS ════════════════════════════════════════════════════════════════

  async createShift(data: CreateShiftData): Promise<ShiftDto> {
    const raw = await prisma.shift.create({
      data: {
        name: data.name,
        startTime: data.startTime,
        endTime: data.endTime,
        isNightShift: data.isNightShift ?? false,
        description: data.description ?? null,
      },
      select: shiftSelect,
    });
    return toShiftDto(raw);
  }

  async updateShift(id: number, data: UpdateShiftData): Promise<ShiftDto> {
    const up: Prisma.ShiftUpdateInput = {};
    if (data.name !== undefined) up.name = data.name;
    if (data.startTime !== undefined) up.startTime = data.startTime;
    if (data.endTime !== undefined) up.endTime = data.endTime;
    if (data.isNightShift !== undefined) up.isNightShift = data.isNightShift;
    if (data.description !== undefined) up.description = data.description;
    const raw = await prisma.shift.update({ where: { id }, data: up, select: shiftSelect });
    return toShiftDto(raw);
  }

  async deleteShift(id: number): Promise<void> {
    await prisma.shift.delete({ where: { id } });
  }

  async findShiftById(id: number): Promise<ShiftDto | null> {
    const raw = await prisma.shift.findUnique({ where: { id }, select: shiftSelect });
    return raw ? toShiftDto(raw) : null;
  }

  async findShiftByName(name: string): Promise<ShiftDto | null> {
    const raw = await prisma.shift.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: shiftSelect,
    });
    return raw ? toShiftDto(raw) : null;
  }

  async findAllShifts(f: ShiftFilters): Promise<ShiftListResult> {
    const { search, sortBy = 'name', sortOrder = 'asc', page = 1, pageSize = 50 } = f;
    const where: Prisma.ShiftWhereInput = {};
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { description: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.ShiftOrderByWithRelationInput = { [sortBy]: sortOrder };
    const [data, total] = await prisma.$transaction([
      prisma.shift.findMany({
        where,
        select: shiftSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.shift.count({ where }),
    ]);
    return { data: data.map(toShiftDto), total };
  }

  // ══ ATTENDANCE ════════════════════════════════════════════════════════════

  async createAttendance(data: CreateAttendanceData): Promise<AttendanceDto> {
    // Normalise date to midnight UTC so the unique[employeeId, date] works correctly
    const date = this.normaliseDate(data.date);

    let workingHours: number | null = null;
    if (data.clockIn && data.clockOut) {
      workingHours = calcWorkingHours(data.clockIn, data.clockOut);
    }

    const raw = await prisma.attendance.create({
      data: {
        employeeId: data.employeeId,
        date,
        status: data.status,
        clockIn: data.clockIn ?? null,
        clockOut: data.clockOut ?? null,
        workingHours,
        remarks: data.remarks ?? null,
      },
      select: attendanceSelect,
    });
    return toAttendanceDto(raw);
  }

  /** Upsert — creates if absent, updates if already exists for the same day. */
  async upsertAttendance(data: CreateAttendanceData): Promise<AttendanceDto> {
    const date = this.normaliseDate(data.date);
    let workingHours: number | null = null;
    if (data.clockIn && data.clockOut) {
      workingHours = calcWorkingHours(data.clockIn, data.clockOut);
    }

    const raw = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: data.employeeId, date } },
      create: {
        employeeId: data.employeeId,
        date,
        status: data.status,
        clockIn: data.clockIn ?? null,
        clockOut: data.clockOut ?? null,
        workingHours,
        remarks: data.remarks ?? null,
      },
      update: {
        status: data.status,
        clockIn: data.clockIn ?? null,
        clockOut: data.clockOut ?? null,
        workingHours,
        remarks: data.remarks ?? null,
      },
      select: attendanceSelect,
    });
    return toAttendanceDto(raw);
  }

  async updateAttendance(id: number, data: UpdateAttendanceData): Promise<AttendanceDto> {
    // Re-fetch to compute working hours if needed
    const existing = await prisma.attendance.findUnique({ where: { id } });
    if (!existing) throw new Error('Attendance record not found');

    const newClockIn = data.clockIn !== undefined ? data.clockIn : existing.clockIn;
    const newClockOut = data.clockOut !== undefined ? data.clockOut : existing.clockOut;
    let workingHours: number | null = existing.workingHours;
    if (newClockIn && newClockOut) {
      workingHours = calcWorkingHours(newClockIn, newClockOut);
    }

    const up: Prisma.AttendanceUpdateInput = { workingHours };
    if (data.status !== undefined) up.status = data.status;
    if (data.clockIn !== undefined) up.clockIn = data.clockIn;
    if (data.clockOut !== undefined) up.clockOut = data.clockOut;
    if (data.remarks !== undefined) up.remarks = data.remarks;

    const raw = await prisma.attendance.update({
      where: { id },
      data: up,
      select: attendanceSelect,
    });
    return toAttendanceDto(raw);
  }

  async findAttendanceById(id: number): Promise<AttendanceDto | null> {
    const raw = await prisma.attendance.findUnique({ where: { id }, select: attendanceSelect });
    return raw ? toAttendanceDto(raw) : null;
  }

  async findAttendanceByEmployeeAndDate(
    employeeId: number,
    date: Date,
  ): Promise<AttendanceDto | null> {
    const raw = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: this.normaliseDate(date) } },
      select: attendanceSelect,
    });
    return raw ? toAttendanceDto(raw) : null;
  }

  async findAllAttendance(f: AttendanceFilters): Promise<AttendanceListResult> {
    const {
      search,
      employeeId,
      departmentId,
      status = 'all',
      date,
      fromDate,
      toDate,
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = f;

    const where: Prisma.AttendanceWhereInput = {};

    if (employeeId !== undefined) where.employeeId = employeeId;

    if (status !== 'all') where.status = status as AttendanceStatus;

    if (date !== undefined) {
      where.date = this.normaliseDate(date);
    } else if (fromDate !== undefined || toDate !== undefined) {
      where.date = {};
      if (fromDate) where.date.gte = this.normaliseDate(fromDate);
      if (toDate) where.date.lte = this.normaliseDate(toDate);
    }

    const employeeWhere: Prisma.EmployeeWhereInput = {};
    if (departmentId !== undefined) employeeWhere.departmentId = departmentId;
    if (search !== undefined && search.trim() !== '') {
      Object.assign(employeeWhere, employeeSearchWhere(search));
    }
    if (Object.keys(employeeWhere).length > 0) where.employee = employeeWhere;

    const [raws, total] = await prisma.$transaction([
      prisma.attendance.findMany({
        where,
        select: attendanceSelect,
        // id keeps the order stable across pages (exports read every page)
        orderBy: [{ date: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.attendance.count({ where }),
    ]);
    return { data: raws.map(toAttendanceDto), total };
  }

  async deleteAttendance(id: number): Promise<void> {
    await prisma.attendance.delete({ where: { id } });
  }

  // ── Bulk insert (never overwrites) ──────────────────────────────────────────

  /**
   * Inserts one record per entry; employees who already have a record for
   * the date are skipped and left unchanged. Edit those individually.
   */
  async bulkCreate(
    date: Date,
    entries: Array<{
      employeeId: number;
      status: AttendanceStatus;
      clockIn?: Date | null;
      clockOut?: Date | null;
      remarks?: string | null;
    }>,
  ): Promise<{ created: number; updated: number; skippedEmployeeIds: number[] }> {
    const normDate = this.normaliseDate(date);
    const existing = await prisma.attendance.findMany({
      where: { date: normDate, employeeId: { in: entries.map((e) => e.employeeId) } },
      select: { employeeId: true },
    });
    const taken = new Set(existing.map((r) => r.employeeId));
    const fresh = entries.filter((e) => !taken.has(e.employeeId));

    // skipDuplicates also covers a record written between the read and the insert
    const result = await prisma.attendance.createMany({
      data: fresh.map((e) => ({
        employeeId: e.employeeId,
        date: normDate,
        status: e.status,
        clockIn: e.clockIn ?? null,
        clockOut: e.clockOut ?? null,
        workingHours: e.clockIn && e.clockOut ? calcWorkingHours(e.clockIn, e.clockOut) : null,
        remarks: e.remarks ?? null,
      })),
      skipDuplicates: true,
    });

    return { created: result.count, updated: 0, skippedEmployeeIds: [...taken] };
  }

  // ── Clock-in (upserts today's record with PRESENT status) ────────────────────

  async clockIn(
    employeeId: number,
    clockIn: Date,
    remarks?: string | null,
  ): Promise<AttendanceDto> {
    const date = this.normaliseDate(clockIn);
    const raw = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: {
        employeeId,
        date,
        clockIn,
        status: 'PRESENT',
        remarks: remarks ?? null,
      },
      update: {
        clockIn,
        status: 'PRESENT',
        ...(remarks !== undefined && { remarks }),
      },
      select: attendanceSelect,
    });
    return toAttendanceDto(raw);
  }

  // ── Clock-out (updates clockOut + calculates workingHours) ────────────────────

  async clockOut(id: number, clockOut: Date, remarks?: string | null): Promise<AttendanceDto> {
    const existing = await prisma.attendance.findUnique({ where: { id } });
    if (!existing) throw new Error('Attendance record not found');

    let workingHours: number | null = null;
    if (existing.clockIn) {
      workingHours = calcWorkingHours(existing.clockIn, clockOut);
    }

    const raw = await prisma.attendance.update({
      where: { id },
      data: {
        clockOut,
        workingHours,
        ...(remarks !== undefined && { remarks }),
      },
      select: attendanceSelect,
    });
    return toAttendanceDto(raw);
  }

  // ══ SUMMARY & TREND ═══════════════════════════════════════════════════════

  async getDailySummary(date: Date, departmentId?: number): Promise<DailyAttendanceSummary> {
    const normDate = this.normaliseDate(date);
    const empWhere: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      status: 'ACTIVE',
      ...(departmentId ? { departmentId } : {}),
    };

    const [totalEmployees, records, depts] = await prisma.$transaction([
      prisma.employee.count({ where: empWhere }),
      prisma.attendance.findMany({
        where: {
          date: normDate,
          ...(departmentId ? { employee: { departmentId } } : {}),
        },
        select: { status: true, employee: { select: { departmentId: true } } },
      }),
      prisma.department.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

    const counts = { present: 0, absent: 0, halfDay: 0, late: 0, onLeave: 0, weekOff: 0 };
    const deptPresentMap = new Map<number, number>();
    const deptAttendedMap = new Map<number, number>();
    const deptWeekOffMap = new Map<number, number>();
    const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) ?? 0) + 1);

    for (const r of records) {
      if (r.status === 'PRESENT') {
        counts.present++;
      } else if (r.status === 'ABSENT') {
        counts.absent++;
      } else if (r.status === 'HALF_DAY') {
        counts.halfDay++;
      } else if (r.status === 'LATE') {
        counts.late++;
      } else if (r.status === 'LEAVE') {
        counts.onLeave++;
      } else if (r.status === 'WEEK_OFF') {
        counts.weekOff++;
      }

      const deptId = r.employee.departmentId;
      if (deptId !== null) {
        if (r.status === 'PRESENT') bump(deptPresentMap, deptId);
        if (r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'HALF_DAY') {
          bump(deptAttendedMap, deptId);
        }
        if (r.status === 'WEEK_OFF') bump(deptWeekOffMap, deptId);
      }
    }

    // Dept-level totals
    const deptEmpCounts = await prisma.employee.groupBy({
      by: ['departmentId'],
      where: { ...empWhere, departmentId: { not: null } },
      _count: { id: true },
    });
    const deptTotalMap = new Map(
      deptEmpCounts
        .filter((r) => r.departmentId !== null)
        .map((r) => [r.departmentId as number, r._count.id]),
    );
    const deptNameMap = new Map(depts.map((d) => [d.id, d.name]));

    const byDepartment = Array.from(deptTotalMap.entries()).map(([id, total]) => ({
      departmentId: id,
      departmentName: deptNameMap.get(id) ?? 'Unknown',
      present: deptPresentMap.get(id) ?? 0,
      attended: deptAttendedMap.get(id) ?? 0,
      weekOff: deptWeekOffMap.get(id) ?? 0,
      total,
    }));

    // A week-off is not a working day, so it is left out of the rate
    const attended = counts.present + counts.late + counts.halfDay;
    const workingHeadcount = totalEmployees - counts.weekOff;
    const attendanceRate =
      workingHeadcount > 0 ? ((attended / workingHeadcount) * 100).toFixed(1) + '%' : '0.0%';

    return {
      date: normDate.toISOString().split('T')[0]!,
      totalEmployees,
      present: counts.present,
      absent: counts.absent,
      halfDay: counts.halfDay,
      late: counts.late,
      onLeave: counts.onLeave,
      weekOff: counts.weekOff,
      attendanceRate,
      byDepartment,
    };
  }

  async getAttendanceTrend(
    days: number,
    departmentId?: number,
    endDate: Date = new Date(),
  ): Promise<AttendanceTrendEntry[]> {
    const end = this.normaliseDate(endDate);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const records = await prisma.attendance.findMany({
      where: {
        date: { gte: start, lte: end },
        ...(departmentId ? { employee: { departmentId } } : {}),
      },
      select: { date: true, status: true },
    });

    const byDay = new Map<string, AttendanceTrendEntry>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, {
        date: key,
        present: 0,
        absent: 0,
        late: 0,
        halfDay: 0,
        onLeave: 0,
        weekOff: 0,
      });
    }

    const field: Record<AttendanceStatus, keyof Omit<AttendanceTrendEntry, 'date'>> = {
      PRESENT: 'present',
      ABSENT: 'absent',
      LATE: 'late',
      HALF_DAY: 'halfDay',
      LEAVE: 'onLeave',
      WEEK_OFF: 'weekOff',
    };
    for (const r of records) {
      const entry = byDay.get(this.normaliseDate(r.date).toISOString().slice(0, 10));
      if (entry !== undefined) entry[field[r.status as AttendanceStatus]]++;
    }

    return [...byDay.values()];
  }

  // ══ EMPLOYEE DAILY OUTPUT ═════════════════════════════════════════════════

  async findEmployeeOutputById(id: number): Promise<EmployeeDailyOutputDto | null> {
    const raw = await prisma.employeeDailyOutput.findUnique({
      where: { id },
      select: employeeOutputSelect,
    });
    return raw ? toEmployeeOutputDto(raw) : null;
  }

  async findEmployeeOutputByEmployeeAndDate(
    employeeId: number,
    date: Date,
  ): Promise<EmployeeDailyOutputDto | null> {
    const raw = await prisma.employeeDailyOutput.findUnique({
      where: { employeeId_date: { employeeId, date: this.normaliseDate(date) } },
      select: employeeOutputSelect,
    });
    return raw ? toEmployeeOutputDto(raw) : null;
  }

  async createEmployeeOutput(data: CreateEmployeeDailyOutputData): Promise<EmployeeDailyOutputDto> {
    const raw = await prisma.employeeDailyOutput.create({
      data: {
        employeeId: data.employeeId,
        date: this.normaliseDate(data.date),
        workingHours: data.workingHours ?? null,
        expectedParts: data.expectedParts ?? null,
        producedParts: data.producedParts ?? null,
        operationsCount: data.operationsCount ?? null,
        remarks: data.remarks ?? null,
        recordedById: data.recordedById ?? null,
      },
      select: employeeOutputSelect,
    });
    return toEmployeeOutputDto(raw);
  }

  async updateEmployeeOutput(
    id: number,
    data: UpdateEmployeeDailyOutputData,
  ): Promise<EmployeeDailyOutputDto> {
    const up: Prisma.EmployeeDailyOutputUpdateInput = {};
    if (data.workingHours !== undefined) up.workingHours = data.workingHours;
    if (data.expectedParts !== undefined) up.expectedParts = data.expectedParts;
    if (data.producedParts !== undefined) up.producedParts = data.producedParts;
    if (data.operationsCount !== undefined) up.operationsCount = data.operationsCount;
    if (data.remarks !== undefined) up.remarks = data.remarks;

    const raw = await prisma.employeeDailyOutput.update({
      where: { id },
      data: up,
      select: employeeOutputSelect,
    });
    return toEmployeeOutputDto(raw);
  }

  async deleteEmployeeOutput(id: number): Promise<void> {
    await prisma.employeeDailyOutput.delete({ where: { id } });
  }

  private employeeOutputWhere(
    f: Pick<EmployeeDailyOutputFilters, 'search' | 'employeeId' | 'departmentId'>,
    from?: Date,
    to?: Date,
  ): Prisma.EmployeeDailyOutputWhereInput {
    const where: Prisma.EmployeeDailyOutputWhereInput = {};
    if (f.employeeId !== undefined) where.employeeId = f.employeeId;
    if (from !== undefined || to !== undefined) {
      where.date = {
        ...(from !== undefined ? { gte: this.normaliseDate(from) } : {}),
        ...(to !== undefined ? { lte: this.normaliseDate(to) } : {}),
      };
    }
    const employeeWhere: Prisma.EmployeeWhereInput = {};
    if (f.departmentId !== undefined) employeeWhere.departmentId = f.departmentId;
    if (f.search !== undefined && f.search.trim() !== '') {
      Object.assign(employeeWhere, employeeSearchWhere(f.search));
    }
    if (Object.keys(employeeWhere).length > 0) where.employee = employeeWhere;
    return where;
  }

  async findAllEmployeeOutputs(
    f: EmployeeDailyOutputFilters,
  ): Promise<EmployeeDailyOutputListResult> {
    const { date, fromDate, toDate, sortOrder = 'desc', page = 1, pageSize = 20 } = f;
    const where =
      date !== undefined
        ? this.employeeOutputWhere(f, date, date)
        : this.employeeOutputWhere(f, fromDate, toDate);

    const [raws, total] = await prisma.$transaction([
      prisma.employeeDailyOutput.findMany({
        where,
        select: employeeOutputSelect,
        orderBy: [{ date: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.employeeDailyOutput.count({ where }),
    ]);
    return { data: raws.map(toEmployeeOutputDto), total };
  }

  async getEmployeeOutputSummary(
    fromDate: Date,
    toDate: Date,
    departmentId?: number,
  ): Promise<EmployeeOutputSummary> {
    const where = this.employeeOutputWhere({ departmentId }, fromDate, toDate);
    const rows = await prisma.employeeDailyOutput.findMany({
      where,
      select: { employeeId: true, expectedParts: true, producedParts: true, operationsCount: true },
    });

    let totalExpectedParts = 0;
    let totalProducedParts = 0;
    let totalOperations = 0;
    // Efficiency only over rows where it can be calculated
    let ratedExpected = 0;
    let ratedProduced = 0;
    for (const r of rows) {
      const expected = decimalToNumber(r.expectedParts);
      const produced = decimalToNumber(r.producedParts);
      totalExpectedParts += expected ?? 0;
      totalProducedParts += produced ?? 0;
      totalOperations += r.operationsCount ?? 0;
      if (expected !== null && produced !== null && expected > 0) {
        ratedExpected += expected;
        ratedProduced += produced;
      }
    }

    return {
      fromDate: this.normaliseDate(fromDate).toISOString().slice(0, 10),
      toDate: this.normaliseDate(toDate).toISOString().slice(0, 10),
      employeesRecorded: new Set(rows.map((r) => r.employeeId)).size,
      records: rows.length,
      totalExpectedParts,
      totalProducedParts,
      totalOperations,
      efficiency: calculateEfficiency(ratedExpected, ratedProduced),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private normaliseDate(d: Date): Date {
    const n = new Date(d);
    n.setUTCHours(0, 0, 0, 0);
    return n;
  }
}
