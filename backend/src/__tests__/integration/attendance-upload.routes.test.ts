/**
 * Excel attendance upload routes — roles, file checks, preview writes nothing,
 * import is insert-only.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mirrorTokenUser } from '../helpers/app';

import * as XLSX from 'xlsx';
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
    createManyAndReturn: vi.fn(),
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

function sheet(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Attendance');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const FILE = sheet([
  ['Employee ID', 'Employee Name', 'Attendance Status'],
  ['EMP-001', 'Ananya Iyer', 'P'],
  ['EMP-002', '', 'WO'],
  ['EMP-404', '', 'P'],
  ['EMP-003', '', 'OT'],
]);
const DATE = new Date().toISOString().slice(0, 10);

const staff = [
  { id: 1, employeeCode: 'EMP-001', firstName: 'Ananya', lastName: 'Iyer', status: 'ACTIVE', deletedAt: null },
  { id: 2, employeeCode: 'EMP-002', firstName: 'Ravi', lastName: '', status: 'ACTIVE', deletedAt: null },
  { id: 3, employeeCode: 'EMP-003', firstName: 'Meera', lastName: 'Iyer', status: 'ACTIVE', deletedAt: null },
];

let app: Express;
beforeAll(async () => {
  const m = await import('../../app');
  app = m.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  mirrorTokenUser(db['user']!['findUnique']!, verifyAccessToken);
  db['employee']!['findMany']!.mockResolvedValue(staff);
  db['attendance']!['findMany']!.mockResolvedValue([]);
  db['attendance']!['createManyAndReturn']!.mockImplementation(
    async ({ data }: { data: Array<{ employeeId: number }> }) => data.map((d) => ({ employeeId: d.employeeId })),
  );
});

const upload = (path: string, token: string, file = FILE, name = 'attendance.xlsx', date = DATE) =>
  request(app)
    .post(`/api/v1/workforce/attendance/import${path}`)
    .set(auth(token))
    .field('date', date)
    .attach('file', file, name);

describe('Excel attendance upload — permissions', () => {
  it('requires a login', async () => {
    const res = await request(app).post('/api/v1/workforce/attendance/import/preview').field('date', DATE);
    expect(res.status).toBe(401);
  });

  it.each(['manager-token', 'production-token', 'store-token', 'sales-token'])(
    'refuses %s on preview and import without reading the file or the database',
    async (token) => {
      useToken(token);
      for (const path of ['/preview', '']) {
        const res = await upload(path, token);
        expect(res.status).toBe(403);
      }
      expect(db['employee']!['findMany']).not.toHaveBeenCalled();
      expect(db['attendance']!['createManyAndReturn']).not.toHaveBeenCalled();
    },
  );

  it.each(['admin-token', 'hr-token'])('allows %s (the roles that record attendance)', async (token) => {
    useToken(token);
    const res = await upload('/preview', token);
    expect(res.status).toBe(200);
  });
});

describe('Excel attendance upload — preview and import', () => {
  it('previews every row with its result and writes nothing', async () => {
    useToken('admin-token');
    const res = await upload('/preview', 'admin-token');
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as Array<{
      employeeCode: string;
      result: string;
      status: string | null;
      reason: string | null;
    }>;
    expect(rows.map((r) => [r.employeeCode, r.result, r.status])).toEqual([
      ['EMP-001', 'VALID', 'PRESENT'],
      ['EMP-002', 'VALID', 'WEEK_OFF'],
      ['EMP-404', 'REJECTED', 'PRESENT'], // the sheet's mark is shown; the ID is the problem
      ['EMP-003', 'REJECTED', null],
    ]);
    expect(rows[3]!.reason).toMatch(/OT mark/);
    expect(res.body.data.summary).toMatchObject({ totalRows: 4, valid: 2, rejected: 2 });
    expect(db['attendance']!['createManyAndReturn']).not.toHaveBeenCalled();
    expect(db['employee']!['create']).not.toHaveBeenCalled();
  });

  it('imports only the valid rows, insert-only', async () => {
    useToken('hr-token');
    const res = await upload('', 'hr-token');
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(2);
    const call = db['attendance']!['createManyAndReturn']!.mock.calls[0]![0] as {
      data: Array<{ employeeId: number; status: string }>;
      skipDuplicates: boolean;
    };
    expect(call.skipDuplicates).toBe(true);
    expect(call.data.map((d) => [d.employeeId, d.status])).toEqual([
      [1, 'PRESENT'],
      [2, 'WEEK_OFF'],
    ]);
    expect(db['attendance']!['update']).not.toHaveBeenCalled();
    expect(db['attendance']!['upsert']).not.toHaveBeenCalled();
    expect(db['employee']!['create']).not.toHaveBeenCalled();
  });

  it('never overwrites an existing record for the same employee and date', async () => {
    useToken('admin-token');
    db['attendance']!['findMany']!.mockResolvedValue([{ employeeId: 1, status: 'ABSENT' }]);
    const res = await upload('', 'admin-token');
    expect(res.body.data.rows[0]).toMatchObject({
      result: 'EXISTING',
      reason: expect.stringMatching(/Already recorded as Absent/),
    });
    const call = db['attendance']!['createManyAndReturn']!.mock.calls[0]![0] as {
      data: Array<{ employeeId: number }>;
    };
    expect(call.data.map((d) => d.employeeId)).toEqual([2]);
  });

  it('rejects files that are not Excel workbooks, even when named .xlsx', async () => {
    useToken('admin-token');
    const csv = Buffer.from('Employee ID,Status\nEMP-001,P');
    let res = await upload('/preview', 'admin-token', csv, 'sheet.csv');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Only Excel workbooks/);
    res = await upload('/preview', 'admin-token', csv, 'renamed.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not an Excel workbook/);
  });

  it('rejects a file over 5 MB', async () => {
    useToken('admin-token');
    const res = await upload('/preview', 'admin-token', Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'big.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UPLOAD_ERROR');
  });

  it('explains a missing file, a missing column, and a missing or future date', async () => {
    useToken('admin-token');
    const base = () => request(app).post('/api/v1/workforce/attendance/import/preview').set(auth('admin-token'));
    let res = await base().field('date', DATE);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Choose an Excel file to upload');

    res = await upload('/preview', 'admin-token', sheet([['Employee ID', 'Name'], ['EMP-001', 'Ananya']]));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no attendance status column/);

    res = await base().attach('file', FILE, 'a.xlsx');
    expect(res.status).toBe(422);

    res = await upload('/preview', 'admin-token', FILE, 'a.xlsx', '2099-01-01');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/future date/);
  });
});
