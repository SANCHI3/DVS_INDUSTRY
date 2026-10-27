/**
 * Production & Workforce routes — employee form fields, pay visibility,
 * per-employee daily output and attendance that never overwrites.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mirrorTokenUser } from '../helpers/app';

vi.mock('../../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3001,
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
    JWT_EXPIRES_IN: '15m',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    REFRESH_TOKEN_EXPIRES_IN: '7d',
    BCRYPT_SALT_ROUNDS: 10,
    CORS_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: 500,
  },
}));

vi.mock('../../lib/prismaClient', () => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn(),
  });
  return {
    prisma: {
      employee: model(),
      employeeDailyOutput: model(),
      attendance: model(),
      department: model(),
      shift: model(),
      user: model(),
      workOrderOutput: model(),
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
      $transaction: vi.fn((arg: unknown) => {
        if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
        if (typeof arg === 'function') return arg({});
        return Promise.resolve([]);
      }),
    },
  };
});

vi.mock('../../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    http: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  },
}));

const ROLE_BY_TOKEN: Record<string, string> = {
  'admin-token': 'ADMIN',
  'hr-token': 'HR',
  'manager-token': 'MANAGER',
  'production-token': 'PRODUCTION',
  'store-token': 'STORE',
  'sales-token': 'SALES',
};

vi.mock('../../utils/token', () => ({
  generateAccessToken: vi.fn(),
  generateRefreshToken: vi.fn(),
  verifyAccessToken: vi.fn(),
  parseExpiresInMs: vi.fn().mockReturnValue(900000),
  generateJti: vi.fn().mockReturnValue('jti'),
  generateOpaqueToken: vi.fn().mockReturnValue('opaque'),
}));

import { prisma } from '../../lib/prismaClient';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Mock>>;

const { verifyAccessToken } = (await import('../../utils/token')) as unknown as {
  verifyAccessToken: Mock;
};

function useToken(token: string): void {
  verifyAccessToken.mockImplementation((t: string) => {
    const role = ROLE_BY_TOKEN[t];
    if (role === undefined || t !== token) throw new Error('invalid token');
    return { sub: 7, email: `${role.toLowerCase()}@test.com`, role };
  });
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const employeeRow = {
  id: 1,
  employeeCode: 'EMP-001',
  firstName: 'Ananya',
  lastName: 'Iyer',
  email: null,
  phone: null,
  gender: null,
  dateOfBirth: null,
  joiningDate: new Date('2024-04-01'),
  designation: 'CNC Operator',
  employmentType: 'FULL_TIME',
  salary: '24000.00',
  dailyWageRate: '650.00',
  status: 'ACTIVE',
  profileImage: null,
  address: null,
  city: null,
  state: null,
  country: null,
  pincode: null,
  emergencyName: null,
  emergencyPhone: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  userId: null,
  department: { id: 2, name: 'Machining', code: 'MACH' },
  shift: null,
  manager: null,
};

const employeeRef = {
  id: 1,
  employeeCode: 'EMP-001',
  firstName: 'Ananya',
  lastName: 'Iyer',
  designation: 'CNC Operator',
  department: { id: 2, name: 'Machining' },
  shift: { id: 3, name: 'General' },
};

const { Prisma } = await import('@prisma/client');

const outputRow = {
  id: 11,
  employeeId: 1,
  date: new Date('2026-10-20T00:00:00.000Z'),
  workingHours: 8,
  expectedParts: new Prisma.Decimal(200),
  producedParts: new Prisma.Decimal(180),
  operationsCount: 4,
  remarks: null,
  recordedById: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
  employee: employeeRef,
};

let app: Express;
beforeAll(async () => {
  const m = await import('../../app');
  app = m.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  mirrorTokenUser(db['user']!['findUnique']!, verifyAccessToken);
  db['employee']!['findMany']!.mockResolvedValue([]);
  db['employee']!['count']!.mockResolvedValue(0);
});

// ── Employees: pay visibility ────────────────────────────────────────────────

describe('employee pay fields', () => {
  it.each(['production-token', 'store-token', 'sales-token', 'manager-token'])(
    'hides salary and wage rate from %s in the list',
    async (token) => {
      useToken(token);
      db['employee']!['findMany']!.mockResolvedValue([employeeRow]);
      db['employee']!['count']!.mockResolvedValue(1);

      const res = await request(app).get('/api/v1/employees?status=all').set(auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data[0].employeeCode).toBe('EMP-001');
      expect(res.body.data[0].salary).toBeNull();
      expect(res.body.data[0].dailyWageRate).toBeNull();
    },
  );

  it('hides pay from a PRODUCTION user viewing one employee', async () => {
    useToken('production-token');
    db['employee']!['findUnique']!.mockResolvedValue(employeeRow);

    const res = await request(app).get('/api/v1/employees/1').set(auth('production-token'));

    expect(res.status).toBe(200);
    expect(res.body.data.dailyWageRate).toBeNull();
    expect(res.body.data.salary).toBeNull();
  });

  it.each(['admin-token', 'hr-token'])('shows pay to %s', async (token) => {
    useToken(token);
    db['employee']!['findUnique']!.mockResolvedValue(employeeRow);

    const res = await request(app).get('/api/v1/employees/1').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.dailyWageRate).toBe('650.00');
  });
});

// ── Employees: create / update validation ───────────────────────────────────

describe('POST /api/v1/employees', () => {
  const valid = {
    employeeCode: 'EMP-002',
    firstName: 'Ravi',
    designation: 'Welder',
    joiningDate: '2026-01-15',
    dailyWageRate: '700.50',
    status: 'ON_LEAVE',
  };

  it('creates an employee with a single name, wage rate and status', async () => {
    useToken('hr-token');
    db['employee']!['findFirst']!.mockResolvedValue(null); // code is free
    db['employee']!['create']!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...employeeRow, ...data, id: 2, department: null, shift: null }),
    );

    const res = await request(app).post('/api/v1/employees').set(auth('hr-token')).send(valid);

    expect(res.status).toBe(201);
    const data = db['employee']!['create']!.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data['lastName']).toBe('');
    expect(data['dailyWageRate']).toBe('700.50');
    expect(data['status']).toBe('ON_LEAVE');
  });

  it('rejects a duplicate employee code with 409', async () => {
    useToken('admin-token');
    db['employee']!['findFirst']!.mockResolvedValue(employeeRow);

    const res = await request(app)
      .post('/api/v1/employees')
      .set(auth('admin-token'))
      .send({ ...valid, employeeCode: 'EMP-001' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('EMP-001');
    expect(db['employee']!['create']).not.toHaveBeenCalled();
  });

  it('checks the code case-insensitively, so a legacy lower-case "emp-001" also blocks EMP-001', async () => {
    useToken('admin-token');
    db['employee']!['findFirst']!.mockResolvedValue({ ...employeeRow, employeeCode: 'emp-001' });

    const res = await request(app)
      .post('/api/v1/employees')
      .set(auth('admin-token'))
      .send({ ...valid, employeeCode: 'EMP-001' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('emp-001');
    const where = db['employee']!['findFirst']!.mock.calls[0]![0].where as Record<string, any>;
    expect(where['employeeCode']).toEqual({ equals: 'EMP-001', mode: 'insensitive' });
  });

  it('trims the employee ID before validating it', async () => {
    useToken('admin-token');
    db['employee']!['findFirst']!.mockResolvedValue(null);
    db['employee']!['create']!.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...employeeRow, ...data, id: 3, department: null, shift: null }),
    );

    const res = await request(app)
      .post('/api/v1/employees')
      .set(auth('admin-token'))
      .send({ ...valid, employeeCode: '  EMP-003  ', firstName: '  Ravi  ' });

    expect(res.status).toBe(201);
    const data = db['employee']!['create']!.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data['employeeCode']).toBe('EMP-003');
    expect(data['firstName']).toBe('Ravi');
  });

  it.each([
    ['an invalid joining date', { joiningDate: 'not-a-date' }, 'joiningDate'],
    ['a negative wage rate', { dailyWageRate: '-5' }, 'dailyWageRate'],
    ['a missing first name', { firstName: '' }, 'firstName'],
    ['a missing designation', { designation: '' }, 'designation'],
    ['TERMINATED as a status', { status: 'TERMINATED' }, 'status'],
    ['a lower-case code', { employeeCode: 'emp 1' }, 'employeeCode'],
  ])('rejects %s', async (_label, patch, field) => {
    useToken('admin-token');

    const res = await request(app)
      .post('/api/v1/employees')
      .set(auth('admin-token'))
      .send({ ...valid, ...patch });

    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('refuses PRODUCTION users (employee records are HR/admin data)', async () => {
    useToken('production-token');
    const res = await request(app)
      .post('/api/v1/employees')
      .set(auth('production-token'))
      .send(valid);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/v1/employees/:id', () => {
  it('refuses to change the code to one another employee already uses', async () => {
    useToken('admin-token');
    db['employee']!['findUnique']!.mockResolvedValue(employeeRow);
    db['employee']!['findFirst']!.mockResolvedValue({
      ...employeeRow,
      id: 9,
      employeeCode: 'EMP-009',
    });

    const res = await request(app)
      .patch('/api/v1/employees/1')
      .set(auth('admin-token'))
      .send({ employeeCode: 'EMP-009' });

    expect(res.status).toBe(409);
    expect(db['employee']!['update']).not.toHaveBeenCalled();
  });

  it('saves status and wage rate', async () => {
    useToken('admin-token');
    db['employee']!['findUnique']!.mockResolvedValue(employeeRow);
    db['employee']!['update']!.mockResolvedValue({ ...employeeRow, status: 'INACTIVE' });

    const res = await request(app)
      .patch('/api/v1/employees/1')
      .set(auth('admin-token'))
      .send({ status: 'INACTIVE', dailyWageRate: '720.00' });

    expect(res.status).toBe(200);
    const data = db['employee']!['update']!.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ status: 'INACTIVE', dailyWageRate: '720.00' });
  });
});

// ── Daily output ─────────────────────────────────────────────────────────────

describe('/api/v1/workforce/performance', () => {
  const body = {
    employeeId: 1,
    date: '2026-10-20',
    workingHours: 8,
    expectedParts: 200,
    producedParts: 180,
    operationsCount: 4,
  };

  it('lets a PRODUCTION supervisor record output and returns the efficiency', async () => {
    useToken('production-token');
    db['employee']!['findFirst']!.mockResolvedValue({ id: 1 });
    db['employeeDailyOutput']!['findUnique']!.mockResolvedValue(null);
    db['employeeDailyOutput']!['create']!.mockResolvedValue(outputRow);

    const res = await request(app)
      .post('/api/v1/workforce/performance')
      .set(auth('production-token'))
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.efficiency).toBe(90);
    const data = db['employeeDailyOutput']!['create']!.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect((data['date'] as Date).toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(data['recordedById']).toBe(7);
    // Work-order output (company totals) is never written by this endpoint
    expect(db['workOrderOutput']!['create']).not.toHaveBeenCalled();
  });

  it('refuses a second record for the same employee and day with 409', async () => {
    useToken('admin-token');
    db['employee']!['findFirst']!.mockResolvedValue({ id: 1 });
    db['employeeDailyOutput']!['findUnique']!.mockResolvedValue(outputRow);

    const res = await request(app)
      .post('/api/v1/workforce/performance')
      .set(auth('admin-token'))
      .send(body);

    expect(res.status).toBe(409);
    expect(db['employeeDailyOutput']!['create']).not.toHaveBeenCalled();
    expect(db['employeeDailyOutput']!['upsert']).not.toHaveBeenCalled();
  });

  it.each([
    ['negative produced parts', { producedParts: -1 }, 'producedParts'],
    ['fractional operations', { operationsCount: 1.5 }, 'operationsCount'],
    ['more than 24 hours', { workingHours: 25 }, 'workingHours'],
    ['text in expected parts', { expectedParts: 'many' }, 'expectedParts'],
    ['an invalid date', { date: '2026-13-45' }, 'date'],
  ])('rejects %s', async (_label, patch, field) => {
    useToken('admin-token');
    const res = await request(app)
      .post('/api/v1/workforce/performance')
      .set(auth('admin-token'))
      .send({ ...body, ...patch });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects a record with no measurements', async () => {
    useToken('admin-token');
    const res = await request(app)
      .post('/api/v1/workforce/performance')
      .set(auth('admin-token'))
      .send({ employeeId: 1, date: '2026-10-20' });
    expect(res.status).toBe(422);
  });

  it('rejects a future date', async () => {
    useToken('admin-token');
    db['employee']!['findFirst']!.mockResolvedValue({ id: 1 });
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const res = await request(app)
      .post('/api/v1/workforce/performance')
      .set(auth('admin-token'))
      .send({ ...body, date: future });
    expect(res.status).toBe(400);
  });

  it('shows N/A-able efficiency (null) when expected parts is zero', async () => {
    useToken('manager-token');
    db['employeeDailyOutput']!['findMany']!.mockResolvedValue([
      { ...outputRow, expectedParts: new Prisma.Decimal(0) },
      { ...outputRow, id: 12, expectedParts: null },
    ]);
    db['employeeDailyOutput']!['count']!.mockResolvedValue(2);

    const res = await request(app)
      .get('/api/v1/workforce/performance?date=2026-10-20')
      .set(auth('manager-token'));

    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { efficiency: unknown }) => r.efficiency)).toEqual([null, null]);
    expect(res.body.meta.total).toBe(2);
  });

  it.each(['store-token', 'sales-token'])('refuses %s', async (token) => {
    useToken(token);
    const res = await request(app).get('/api/v1/workforce/performance').set(auth(token));
    expect(res.status).toBe(403);
  });

  it('allows only ADMIN to delete a record', async () => {
    useToken('production-token');
    const res = await request(app)
      .delete('/api/v1/workforce/performance/11')
      .set(auth('production-token'));
    expect(res.status).toBe(403);
  });

  it('summarises totals and efficiency only over rows where it can be calculated', async () => {
    useToken('admin-token');
    db['employeeDailyOutput']!['findMany']!.mockResolvedValue([
      {
        employeeId: 1,
        expectedParts: new Prisma.Decimal(100),
        producedParts: new Prisma.Decimal(90),
        operationsCount: 2,
      },
      {
        employeeId: 2,
        expectedParts: new Prisma.Decimal(100),
        producedParts: new Prisma.Decimal(110),
        operationsCount: 3,
      },
      // No target: counted in totals but not in efficiency
      {
        employeeId: 3,
        expectedParts: null,
        producedParts: new Prisma.Decimal(40),
        operationsCount: null,
      },
    ]);

    const res = await request(app)
      .get('/api/v1/workforce/performance/summary?date=2026-10-20')
      .set(auth('admin-token'));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      employeesRecorded: 3,
      totalExpectedParts: 200,
      totalProducedParts: 240,
      totalOperations: 5,
      efficiency: 100,
    });
  });
});

// ── Attendance: never overwrite ──────────────────────────────────────────────

const attendanceRow = {
  id: 5,
  employeeId: 1,
  date: new Date('2026-10-20T00:00:00.000Z'),
  clockIn: null,
  clockOut: null,
  workingHours: null,
  status: 'LEAVE',
  remarks: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  employee: employeeRef,
};

describe('POST /api/v1/workforce/attendance', () => {
  it('returns 409 and leaves an existing day untouched', async () => {
    useToken('hr-token');
    db['employee']!['findFirst']!.mockResolvedValue({ id: 1 });
    db['attendance']!['findUnique']!.mockResolvedValue(attendanceRow);

    const res = await request(app)
      .post('/api/v1/workforce/attendance')
      .set(auth('hr-token'))
      .send({ employeeId: 1, date: '2026-10-20', status: 'PRESENT' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('LEAVE');
    expect(db['attendance']!['upsert']).not.toHaveBeenCalled();
    expect(db['attendance']!['create']).not.toHaveBeenCalled();
    expect(db['attendance']!['update']).not.toHaveBeenCalled();
  });

  it('accepts WEEK_OFF and rejects unknown statuses such as "WO"', async () => {
    useToken('hr-token');
    db['employee']!['findFirst']!.mockResolvedValue({ id: 1 });
    db['attendance']!['findUnique']!.mockResolvedValue(null);
    db['attendance']!['create']!.mockResolvedValue({ ...attendanceRow, status: 'WEEK_OFF' });

    const ok = await request(app)
      .post('/api/v1/workforce/attendance')
      .set(auth('hr-token'))
      .send({ employeeId: 1, date: '2026-10-20', status: 'WEEK_OFF' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.employee.shift).toEqual({ id: 3, name: 'General' });

    const bad = await request(app)
      .post('/api/v1/workforce/attendance')
      .set(auth('hr-token'))
      .send({ employeeId: 1, date: '2026-10-20', status: 'WO' });
    expect(bad.status).toBe(422);
  });

  it('keeps attendance reads away from PRODUCTION (unchanged access rule)', async () => {
    useToken('production-token');
    const res = await request(app)
      .get('/api/v1/workforce/attendance')
      .set(auth('production-token'));
    expect(res.status).toBe(403);
  });

  it('searches attendance by employee code or name', async () => {
    useToken('manager-token');
    db['attendance']!['findMany']!.mockResolvedValue([]);
    db['attendance']!['count']!.mockResolvedValue(0);

    const res = await request(app)
      .get(
        '/api/v1/workforce/attendance?search=ananya&departmentId=2&fromDate=2026-10-01&toDate=2026-10-20',
      )
      .set(auth('manager-token'));

    expect(res.status).toBe(200);
    const where = db['attendance']!['findMany']!.mock.calls[0]![0].where as Record<string, any>;
    expect(where['employee']['departmentId']).toBe(2);
    expect(where['employee']['OR']).toHaveLength(3);
    expect(where['date']['gte'].toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where['date']['lte'].toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});

describe('POST /api/v1/workforce/attendance/bulk', () => {
  it('creates only missing days and reports the skipped employees', async () => {
    useToken('admin-token');
    db['employee']!['findMany']!.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    db['attendance']!['findMany']!.mockResolvedValue([{ employeeId: 1 }]);
    db['attendance']!['createMany']!.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/v1/workforce/attendance/bulk')
      .set(auth('admin-token'))
      .send({
        date: '2026-10-20',
        entries: [
          { employeeId: 1, status: 'PRESENT' },
          { employeeId: 2, status: 'ABSENT' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ created: 1, updated: 0, skippedEmployeeIds: [1] });
    const args = db['attendance']!['createMany']!.mock.calls[0]![0] as {
      data: Array<{ employeeId: number }>;
      skipDuplicates: boolean;
    };
    expect(args.data.map((d) => d.employeeId)).toEqual([2]);
    expect(args.skipDuplicates).toBe(true);
    expect(db['attendance']!['upsert']).not.toHaveBeenCalled();
  });

  it('rejects the same employee twice in one request', async () => {
    useToken('admin-token');
    const res = await request(app)
      .post('/api/v1/workforce/attendance/bulk')
      .set(auth('admin-token'))
      .send({
        date: '2026-10-20',
        entries: [
          { employeeId: 1, status: 'PRESENT' },
          { employeeId: 1, status: 'ABSENT' },
        ],
      });
    expect(res.status).toBe(400);
  });
});

describe('attendance summary and trend', () => {
  it('leaves week-offs out of the attendance rate and reports attended per department', async () => {
    useToken('manager-token');
    db['employee']!['count']!.mockResolvedValue(5);
    db['attendance']!['findMany']!.mockResolvedValue([
      { status: 'PRESENT', employee: { departmentId: 2 } },
      { status: 'LATE', employee: { departmentId: 2 } },
      { status: 'HALF_DAY', employee: { departmentId: 2 } },
      { status: 'ABSENT', employee: { departmentId: 2 } },
      { status: 'WEEK_OFF', employee: { departmentId: 2 } },
    ]);
    db['department']!['findMany']!.mockResolvedValue([{ id: 2, name: 'Machining' }]);
    db['employee']!['groupBy']!.mockResolvedValue([{ departmentId: 2, _count: { id: 5 } }]);

    const res = await request(app)
      .get('/api/v1/workforce/attendance/summary?date=2026-10-20')
      .set(auth('manager-token'));

    expect(res.status).toBe(200);
    // 3 attended out of 4 working (5 minus 1 week-off)
    expect(res.body.data.attendanceRate).toBe('75.0%');
    expect(res.body.data.weekOff).toBe(1);
    expect(res.body.data.byDepartment[0]).toMatchObject({
      present: 1,
      attended: 3,
      weekOff: 1,
      total: 5,
    });
  });

  it('returns one ISO-dated row per day, oldest first, from a single query', async () => {
    useToken('admin-token');
    db['attendance']!['findMany']!.mockResolvedValue([
      { date: new Date('2026-10-20T00:00:00.000Z'), status: 'PRESENT' },
      { date: new Date('2026-10-20T00:00:00.000Z'), status: 'WEEK_OFF' },
      { date: new Date('2026-10-14T00:00:00.000Z'), status: 'ABSENT' },
    ]);

    const res = await request(app)
      .get('/api/v1/workforce/attendance/trend?days=7&endDate=2026-10-20')
      .set(auth('admin-token'));

    expect(res.status).toBe(200);
    expect(db['attendance']!['findMany']).toHaveBeenCalledTimes(1);
    const dates = res.body.data.map((r: { date: string }) => r.date);
    expect(dates).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
    ]);
    expect(res.body.data[0]).toMatchObject({ absent: 1 });
    expect(res.body.data[6]).toMatchObject({ present: 1, weekOff: 1 });
  });
});

// ── Removing a worker (soft delete, history kept) ────────────────────────────

describe('DELETE /api/v1/employees/:id', () => {
  it.each(['hr-token', 'manager-token', 'production-token', 'store-token', 'sales-token'])(
    'refuses %s and changes nothing',
    async (token) => {
      useToken(token);
      const res = await request(app).delete('/api/v1/employees/1').set(auth(token));
      expect(res.status).toBe(403);
      expect(db['employee']!['update']).not.toHaveBeenCalled();
      expect(db['employee']!['delete']).not.toHaveBeenCalled();
    },
  );

  it('lets an administrator remove a worker by marking them terminated, keeping their history', async () => {
    useToken('admin-token');
    db['employee']!['findUnique']!.mockResolvedValue(employeeRow);
    db['employee']!['update']!.mockResolvedValue({
      ...employeeRow,
      status: 'TERMINATED',
      deletedAt: new Date(),
    });

    const res = await request(app).delete('/api/v1/employees/1').set(auth('admin-token'));

    expect(res.status).toBe(204);
    const args = db['employee']!['update']!.mock.calls[0]![0] as {
      where: unknown;
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({ id: 1 });
    expect(args.data['status']).toBe('TERMINATED');
    expect(args.data['deletedAt']).toBeInstanceOf(Date);
    // No row is physically deleted, and linked history is not touched
    expect(db['employee']!['delete']).not.toHaveBeenCalled();
    for (const model of ['attendance', 'employeeDailyOutput', 'workOrderOutput']) {
      expect(db[model]!['delete']).not.toHaveBeenCalled();
      expect(db[model]!['update']).not.toHaveBeenCalled();
    }
  });

  it('returns 404 for an employee that does not exist', async () => {
    useToken('admin-token');
    db['employee']!['findUnique']!.mockResolvedValue(null);
    const res = await request(app).delete('/api/v1/employees/999').set(auth('admin-token'));
    expect(res.status).toBe(404);
    expect(db['employee']!['update']).not.toHaveBeenCalled();
  });

  it('explains when the worker was already removed (stale list)', async () => {
    useToken('admin-token');
    db['employee']!['findUnique']!.mockResolvedValue({ ...employeeRow, deletedAt: new Date() });
    const res = await request(app).delete('/api/v1/employees/1').set(auth('admin-token'));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already deleted/i);
    expect(db['employee']!['update']).not.toHaveBeenCalled();
  });
});
