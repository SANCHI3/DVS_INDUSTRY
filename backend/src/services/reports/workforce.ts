import { prisma } from '../../lib/prismaClient';
import { logger } from '../../logger';
import type {
  WorkforceReport,
  AttendanceReport,
  AttendanceReportFilters,
  ReportFilters,
} from '../../interfaces';
import { fmtDate, buildDateWhere, buildPeriodLabel } from './helpers';

export async function getWorkforceReport(filters: ReportFilters): Promise<WorkforceReport> {
  logger.info('Generating workforce report', filters);

  const where = {
    deletedAt: null,
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
  };

  const [employees, byDeptRaw] = await prisma.$transaction([
    prisma.employee.findMany({
      where,
      orderBy: [{ department: { name: 'asc' } }, { firstName: 'asc' }],
      select: {
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: true,
        employmentType: true,
        status: true,
        joiningDate: true,
        department: { select: { name: true } },
      },
    }),
    prisma.employee.groupBy({
      by: ['departmentId'],
      where: { deletedAt: null, departmentId: { not: null } },
      _count: { id: true },
      orderBy: { departmentId: 'asc' },
    }),
  ]);

  // Enrich department counts
  const deptIds = byDeptRaw.map((r) => r.departmentId).filter((id): id is number => id !== null);
  const depts =
    deptIds.length > 0
      ? await prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : [];
  const deptMap = new Map(depts.map((d) => [d.id, d.name]));

  const byDepartment = byDeptRaw
    .filter((r) => r.departmentId !== null)
    .map((r) => ({
      name: deptMap.get(r.departmentId as number) ?? 'Unknown',
      count: (r._count as { id?: number } | undefined)?.id ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  const statusCounts = { active: 0, inactive: 0, onLeave: 0, terminated: 0 };
  const rows = employees.map((e) => {
    if (e.status === 'ACTIVE') statusCounts.active++;
    else if (e.status === 'INACTIVE') statusCounts.inactive++;
    else if (e.status === 'ON_LEAVE') statusCounts.onLeave++;
    else if (e.status === 'TERMINATED') statusCounts.terminated++;

    return {
      employeeCode: e.employeeCode,
      fullName: `${e.firstName} ${e.lastName}`,
      department: e.department?.name ?? '—',
      designation: e.designation,
      employmentType: e.employmentType,
      status: e.status,
      joiningDate: fmtDate(e.joiningDate),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    period: `Up to ${fmtDate(new Date())}`,
    summary: {
      total: employees.length,
      ...statusCounts,
      byDepartment,
    },
    rows,
  };
}

export async function getAttendanceReport(
  filters: AttendanceReportFilters,
): Promise<AttendanceReport> {
  logger.info('Generating attendance report', filters);

  const dateWhere = buildDateWhere(filters, 'date');

  // All active employees (optionally scoped to one department)
  const empWhere = {
    deletedAt: null,
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
  };

  const [employees, attendanceRecords, departments] = await prisma.$transaction([
    prisma.employee.findMany({
      where: empWhere,
      orderBy: [{ department: { name: 'asc' } }, { firstName: 'asc' }],
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: true,
        departmentId: true,
        department: { select: { id: true, name: true } },
      },
    }),
    prisma.attendance.findMany({
      where: {
        ...(dateWhere ? { date: dateWhere } : {}),
        ...(filters.departmentId ? { employee: { departmentId: filters.departmentId } } : {}),
      },
      select: {
        employeeId: true,
        status: true,
        workingHours: true,
      },
    }),
    prisma.department.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
    }),
  ]);

  // Index attendance records by employeeId
  type AttCounts = {
    present: number;
    absent: number;
    halfDay: number;
    late: number;
    onLeave: number;
    workingHours: number;
  };
  const attMap = new Map<number, AttCounts>();
  for (const a of attendanceRecords) {
    const entry = attMap.get(a.employeeId) ?? {
      present: 0,
      absent: 0,
      halfDay: 0,
      late: 0,
      onLeave: 0,
      workingHours: 0,
    };
    if (a.status === 'PRESENT') entry.present++;
    else if (a.status === 'ABSENT') entry.absent++;
    else if (a.status === 'HALF_DAY') entry.halfDay++;
    else if (a.status === 'LATE') entry.late++;
    else if (a.status === 'LEAVE') entry.onLeave++;
    entry.workingHours += a.workingHours ?? 0;
    attMap.set(a.employeeId, entry);
  }

  // Per-department aggregation
  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  type DeptAgg = {
    department: string;
    present: number;
    absent: number;
    late: number;
    onLeave: number;
    total: number;
  };
  const deptAgg = new Map<number, DeptAgg>();

  // Summary totals
  let totalPresent = 0,
    totalAbsent = 0,
    totalHalfDay = 0;
  let totalLate = 0,
    totalOnLeave = 0;
  let sumRates = 0;

  const rows = employees.map((e) => {
    const att = attMap.get(e.id) ?? {
      present: 0,
      absent: 0,
      halfDay: 0,
      late: 0,
      onLeave: 0,
      workingHours: 0,
    };
    const totalDays = att.present + att.absent + att.halfDay + att.late + att.onLeave;
    const attended = att.present + att.late + att.halfDay;
    const rate = totalDays > 0 ? parseFloat(((attended / totalDays) * 100).toFixed(1)) : 0;

    totalPresent += att.present;
    totalAbsent += att.absent;
    totalHalfDay += att.halfDay;
    totalLate += att.late;
    totalOnLeave += att.onLeave;
    sumRates += rate;

    // Department aggregation
    if (e.departmentId !== null) {
      const da = deptAgg.get(e.departmentId) ?? {
        department: deptMap.get(e.departmentId) ?? 'Unknown',
        present: 0,
        absent: 0,
        late: 0,
        onLeave: 0,
        total: 0,
      };
      da.present += att.present + att.halfDay;
      da.absent += att.absent;
      da.late += att.late;
      da.onLeave += att.onLeave;
      da.total += totalDays;
      deptAgg.set(e.departmentId, da);
    }

    return {
      employeeCode: e.employeeCode,
      fullName: `${e.firstName} ${e.lastName}`,
      department: e.department?.name ?? '—',
      designation: e.designation,
      totalDays,
      present: att.present,
      absent: att.absent,
      halfDay: att.halfDay,
      late: att.late,
      onLeave: att.onLeave,
      totalWorkingHours: att.workingHours.toFixed(1),
      attendanceRate: `${rate.toFixed(1)}%`,
    };
  });

  const avgRate = employees.length > 0 ? `${(sumRates / employees.length).toFixed(1)}%` : '0.0%';

  const byDepartment = Array.from(deptAgg.values())
    .map((da) => ({
      department: da.department,
      present: da.present,
      absent: da.absent,
      late: da.late,
      onLeave: da.onLeave,
      total: da.total,
      rate: da.total > 0 ? `${(((da.present + da.late) / da.total) * 100).toFixed(1)}%` : '0.0%',
    }))
    .sort((a, b) => b.present - a.present);

  // Apply sort
  const { sortBy = 'department', sortOrder = 'asc' } = filters;
  rows.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') cmp = a.fullName.localeCompare(b.fullName);
    else if (sortBy === 'department') cmp = a.department.localeCompare(b.department);
    else if (sortBy === 'totalDays') cmp = a.totalDays - b.totalDays;
    else if (sortBy === 'attendanceRate')
      cmp = parseFloat(a.attendanceRate) - parseFloat(b.attendanceRate);
    return sortOrder === 'desc' ? -cmp : cmp;
  });

  return {
    generatedAt: new Date().toISOString(),
    period: buildPeriodLabel(filters),
    summary: {
      totalEmployees: employees.length,
      avgAttendanceRate: avgRate,
      totalPresent,
      totalAbsent,
      totalHalfDay,
      totalLate,
      totalOnLeave,
      byDepartment,
    },
    rows,
  };
}
