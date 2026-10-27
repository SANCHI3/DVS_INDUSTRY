import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import type {
  IEmployeeRepository,
  EmployeeDto,
  EmployeeListResult,
  EmployeeFilters,
  EmployeeStatistics,
  CreateEmployeeData,
  UpdateEmployeeData,
  EmploymentType,
  Gender,
} from '../interfaces';

// ── Shared select shape ───────────────────────────────────────────────────────
// Used by every query — ensures consistent response shape and no missing fields.

const employeeSelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  gender: true,
  dateOfBirth: true,
  joiningDate: true,
  designation: true,
  employmentType: true,
  salary: true,
  dailyWageRate: true,
  status: true,
  profileImage: true,
  address: true,
  city: true,
  state: true,
  country: true,
  pincode: true,
  emergencyName: true,
  emergencyPhone: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  department: {
    select: { id: true, name: true, code: true },
  },
  shift: {
    select: {
      id: true,
      name: true,
      startTime: true,
      endTime: true,
      isNightShift: true,
      description: true,
    },
  },
  manager: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      designation: true,
    },
  },
} as const;

/** Convert Prisma result to plain EmployeeDto (salary Decimal → string). */
function toDto(raw: PrismaEmployeeResult): EmployeeDto {
  return {
    ...raw,
    salary: raw.salary !== null ? raw.salary.toString() : null,
    dailyWageRate: raw.dailyWageRate !== null ? raw.dailyWageRate.toString() : null,
    gender: raw.gender as Gender | null,
    employmentType: raw.employmentType as EmploymentType,
    status: raw.status as EmployeeDto['status'],
    department: raw.department ?? null,
    shift: raw.shift
      ? {
          id: raw.shift.id,
          name: raw.shift.name,
          startTime: raw.shift.startTime,
          endTime: raw.shift.endTime,
          isNightShift: raw.shift.isNightShift,
          description: raw.shift.description,
        }
      : null,
    manager: raw.manager ?? null,
  };
}

type PrismaEmployeeResult = Prisma.EmployeeGetPayload<{
  select: typeof employeeSelect;
}>;

// ─────────────────────────────────────────────────────────────────────────────

export class EmployeeRepository implements IEmployeeRepository {
  // ── Create ────────────────────────────────────────────────────────────────

  async create(data: CreateEmployeeData): Promise<EmployeeDto> {
    const raw = await prisma.employee.create({
      data: {
        employeeCode: data.employeeCode,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        gender: data.gender ?? null,
        dateOfBirth: data.dateOfBirth ?? null,
        joiningDate: data.joiningDate,
        designation: data.designation,
        employmentType: data.employmentType ?? 'FULL_TIME',
        salary: data.salary ?? null,
        dailyWageRate: data.dailyWageRate ?? null,
        status: data.status ?? 'ACTIVE',
        departmentId: data.departmentId ?? null,
        shiftId: data.shiftId ?? null,
        managerId: data.managerId ?? null,
        userId: data.userId ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? null,
        pincode: data.pincode ?? null,
        emergencyName: data.emergencyName ?? null,
        emergencyPhone: data.emergencyPhone ?? null,
        profileImage: data.profileImage ?? null,
      },
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(id: number, data: UpdateEmployeeData): Promise<EmployeeDto> {
    const updateData: Prisma.EmployeeUpdateInput = {};

    if (data.employeeCode !== undefined) updateData.employeeCode = data.employeeCode;
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.gender !== undefined) updateData.gender = data.gender;
    if (data.dateOfBirth !== undefined) updateData.dateOfBirth = data.dateOfBirth;
    if (data.joiningDate !== undefined) updateData.joiningDate = data.joiningDate;
    if (data.designation !== undefined) updateData.designation = data.designation;
    if (data.employmentType !== undefined) updateData.employmentType = data.employmentType;
    if (data.salary !== undefined) updateData.salary = data.salary;
    if (data.dailyWageRate !== undefined) updateData.dailyWageRate = data.dailyWageRate;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.pincode !== undefined) updateData.pincode = data.pincode;
    if (data.emergencyName !== undefined) updateData.emergencyName = data.emergencyName;
    if (data.emergencyPhone !== undefined) updateData.emergencyPhone = data.emergencyPhone;
    if (data.profileImage !== undefined) updateData.profileImage = data.profileImage;

    const raw = await prisma.employee.update({
      where: { id },
      data: updateData,
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Find by ID ────────────────────────────────────────────────────────────

  async findById(id: number): Promise<EmployeeDto | null> {
    const raw = await prisma.employee.findUnique({
      where: { id },
      select: employeeSelect,
    });
    return raw !== null ? toDto(raw) : null;
  }

  // ── Find by Employee Code ─────────────────────────────────────────────────

  async findByEmployeeCode(code: string): Promise<EmployeeDto | null> {
    const raw = await prisma.employee.findUnique({
      where: { employeeCode: code },
      select: employeeSelect,
    });
    return raw !== null ? toDto(raw) : null;
  }

  /** Any employee (incl. deleted) whose code matches ignoring case, e.g. legacy "emp-1". */
  async findByEmployeeCodeInsensitive(code: string): Promise<EmployeeDto | null> {
    const raw = await prisma.employee.findFirst({
      where: { employeeCode: { equals: code, mode: 'insensitive' } },
      select: employeeSelect,
    });
    return raw !== null ? toDto(raw) : null;
  }

  // ── Find by Email ─────────────────────────────────────────────────────────

  async findByEmail(email: string): Promise<EmployeeDto | null> {
    const raw = await prisma.employee.findUnique({
      where: { email },
      select: employeeSelect,
    });
    return raw !== null ? toDto(raw) : null;
  }

  // ── Find All ──────────────────────────────────────────────────────────────

  async findAll(filters: EmployeeFilters): Promise<EmployeeListResult> {
    const {
      search,
      departmentId,
      designation,
      status = 'ACTIVE',
      employmentType,
      shiftId,
      managerId,
      includeDeleted = false,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.EmployeeWhereInput = {};

    // Soft-delete filter
    if (!includeDeleted) {
      where.deletedAt = null;
    }

    // Status filter
    if (status !== 'all') {
      where.status = status as Prisma.EnumEmployeeStatusFilter;
    }

    // Department filter
    if (departmentId !== undefined) {
      where.departmentId = departmentId;
    }

    // Designation filter (case-insensitive contains)
    if (designation !== undefined && designation.trim() !== '') {
      where.designation = { contains: designation.trim(), mode: 'insensitive' };
    }

    // Employment type filter
    if (employmentType !== undefined) {
      where.employmentType = employmentType;
    }

    // Shift filter
    if (shiftId !== undefined) {
      where.shiftId = shiftId;
    }

    // Manager filter
    if (managerId !== undefined) {
      where.managerId = managerId;
    }

    // Full-text search across code, firstName, lastName, email, designation
    if (search !== undefined && search.trim() !== '') {
      const q = search.trim();
      where.OR = [
        { employeeCode: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { designation: { contains: q, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;
    const orderBy: Prisma.EmployeeOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [raws, total] = await prisma.$transaction([
      prisma.employee.findMany({ where, select: employeeSelect, orderBy, skip, take }),
      prisma.employee.count({ where }),
    ]);

    return { data: raws.map(toDto), total };
  }

  // ── Soft Delete ───────────────────────────────────────────────────────────

  async softDelete(id: number): Promise<EmployeeDto> {
    const raw = await prisma.employee.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'TERMINATED' },
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Restore ───────────────────────────────────────────────────────────────

  async restore(id: number): Promise<EmployeeDto> {
    const raw = await prisma.employee.update({
      where: { id },
      data: { deletedAt: null, status: 'ACTIVE' },
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Activate ──────────────────────────────────────────────────────────────

  async activate(id: number): Promise<EmployeeDto> {
    const raw = await prisma.employee.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Deactivate ────────────────────────────────────────────────────────────

  async deactivate(id: number): Promise<EmployeeDto> {
    const raw = await prisma.employee.update({
      where: { id },
      data: { status: 'INACTIVE' },
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Assign Department ─────────────────────────────────────────────────────

  async assignDepartment(id: number, departmentId: number | null): Promise<EmployeeDto> {
    const raw = await prisma.employee.update({
      where: { id },
      data: { departmentId },
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Assign Manager ────────────────────────────────────────────────────────

  async assignManager(id: number, managerId: number | null): Promise<EmployeeDto> {
    const raw = await prisma.employee.update({
      where: { id },
      data: { managerId },
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Assign Shift ──────────────────────────────────────────────────────────

  async assignShift(id: number, shiftId: number | null): Promise<EmployeeDto> {
    const raw = await prisma.employee.update({
      where: { id },
      data: { shiftId },
      select: employeeSelect,
    });
    return toDto(raw);
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  async statistics(): Promise<EmployeeStatistics> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      total,
      active,
      inactive,
      onLeave,
      terminated,
      newThisMonth,
      byDeptRaw,
      byTypeRaw,
      byGenderRaw,
    ] = await prisma.$transaction([
      prisma.employee.count({ where: { deletedAt: null } }),
      prisma.employee.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.employee.count({ where: { deletedAt: null, status: 'INACTIVE' } }),
      prisma.employee.count({ where: { deletedAt: null, status: 'ON_LEAVE' } }),
      prisma.employee.count({ where: { deletedAt: null, status: 'TERMINATED' } }),
      prisma.employee.count({
        where: { deletedAt: null, createdAt: { gte: startOfMonth } },
      }),
      prisma.employee.groupBy({
        by: ['departmentId'],
        where: { deletedAt: null, departmentId: { not: null } },
        _count: { id: true },
        orderBy: { departmentId: 'asc' },
      }),
      prisma.employee.groupBy({
        by: ['employmentType'],
        where: { deletedAt: null },
        _count: { id: true },
        orderBy: { employmentType: 'asc' },
      }),
      prisma.employee.groupBy({
        by: ['gender'],
        where: { deletedAt: null },
        _count: { id: true },
        orderBy: { gender: 'asc' },
      }),
    ]);

    // Enrich department stats with names
    const deptIds = byDeptRaw.map((r) => r.departmentId).filter((id): id is number => id !== null);

    const departments =
      deptIds.length > 0
        ? await prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
          })
        : [];

    const deptNameMap = new Map(departments.map((d) => [d.id, d.name]));

    const byDepartment = byDeptRaw
      .filter((r): r is typeof r & { departmentId: number } => r.departmentId !== null)
      .map((r) => ({
        departmentId: r.departmentId,
        name: deptNameMap.get(r.departmentId) ?? 'Unknown',
        count: (r._count as { id?: number } | undefined)?.id ?? 0,
      }));

    const byEmploymentType = byTypeRaw.map((r) => ({
      type: r.employmentType as EmploymentType,
      count: (r._count as { id?: number } | undefined)?.id ?? 0,
    }));

    const byGender = byGenderRaw.map((r) => ({
      gender: r.gender as Gender | null,
      count: (r._count as { id?: number } | undefined)?.id ?? 0,
    }));

    return {
      total,
      active,
      inactive,
      onLeave,
      terminated,
      newThisMonth,
      byDepartment,
      byEmploymentType,
      byGender,
    };
  }
}
