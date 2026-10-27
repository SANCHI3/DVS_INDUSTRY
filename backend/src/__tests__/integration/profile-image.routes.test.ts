/**
 * Profile images are stored in the database (the host's disk is temporary)
 * and served back from /uploads/profiles/<name>.
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

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    employee: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    storedFile: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

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

vi.mock('../../utils/token', () => ({
  generateAccessToken: vi.fn(),
  generateRefreshToken: vi.fn(),
  verifyAccessToken: vi.fn().mockImplementation((token: string) => {
    if (token === 'admin-token') return { sub: 1, email: 'admin@test.com', role: 'ADMIN' };
    throw new Error('invalid token');
  }),
  parseExpiresInMs: vi.fn().mockReturnValue(900000),
  generateJti: vi.fn().mockReturnValue('jti'),
  generateOpaqueToken: vi.fn().mockReturnValue('opaque'),
}));

import { prisma } from '../../lib/prismaClient';
import { detectImageType } from '../../utils/upload';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  employee: { findFirst: Mock; findUnique: Mock; update: Mock };
  storedFile: { create: Mock; findUnique: Mock; deleteMany: Mock };
  user: { findUnique: Mock };
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const employee = {
  id: 7,
  employeeCode: 'EMP-007',
  firstName: 'Asha',
  lastName: 'Rao',
  email: 'asha@test.com',
  phone: null,
  gender: null,
  dateOfBirth: null,
  joiningDate: new Date('2022-01-10'),
  designation: 'Operator',
  employmentType: 'FULL_TIME',
  salary: null,
  dailyWageRate: null,
  departmentId: null,
  department: null,
  shiftId: null,
  shift: null,
  managerId: null,
  userId: null,
  status: 'ACTIVE',
  profileImage: '/uploads/profiles/old-photo.png',
  address: null,
  city: null,
  state: null,
  country: null,
  pincode: null,
  emergencyName: null,
  emergencyPhone: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

let app: Express;
beforeAll(async () => {
  app = (await import('../../app')).default;
  const { verifyAccessToken } = (await import('../../utils/token')) as unknown as {
    verifyAccessToken: Mock;
  };
  mirrorTokenUser(db.user.findUnique, verifyAccessToken);
});

beforeEach(() => {
  db.storedFile.create.mockReset().mockResolvedValue({});
  db.storedFile.findUnique.mockReset();
  db.storedFile.deleteMany.mockReset().mockResolvedValue({ count: 1 });
  db.employee.findFirst.mockReset().mockResolvedValue(employee);
  db.employee.findUnique.mockReset().mockResolvedValue(employee);
  db.employee.update
    .mockReset()
    .mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...employee, ...data }));
});

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their first bytes', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(detectImageType(PNG)?.mime).toBe('image/png');
    expect(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))?.mime).toBe('image/webp');
  });

  it('rejects anything else', () => {
    expect(detectImageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('POST /api/v1/employees/:id/profile-image', () => {
  it('stores the image in the database and removes the previous one', async () => {
    const res = await request(app)
      .post('/api/v1/employees/7/profile-image')
      .set('Authorization', 'Bearer admin-token')
      .attach('image', PNG, { filename: 'me.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    const saved = db.storedFile.create.mock.calls[0]?.[0] as {
      data: { id: string; mimeType: string; size: number };
    };
    expect(saved.data.mimeType).toBe('image/png');
    expect(saved.data.size).toBe(PNG.length);
    expect(saved.data.id).toMatch(/^\d+-[0-9a-f]{24}\.png$/);
    expect(res.body.data.profileImage).toBe(`/uploads/profiles/${saved.data.id}`);
    expect(db.storedFile.deleteMany).toHaveBeenCalledWith({ where: { id: 'old-photo.png' } });
  });

  it('rejects a file whose content is not an image, whatever its name says', async () => {
    const res = await request(app)
      .post('/api/v1/employees/7/profile-image')
      .set('Authorization', 'Bearer admin-token')
      .attach('image', Buffer.from('<html>not a photo</html>'), {
        filename: 'photo.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(db.storedFile.create).not.toHaveBeenCalled();
    expect(db.employee.update).not.toHaveBeenCalled();
  });
});

describe('GET /uploads/profiles/:name', () => {
  it('serves a stored image with its type and a long cache lifetime', async () => {
    db.storedFile.findUnique.mockResolvedValue({
      mimeType: 'image/png',
      size: PNG.length,
      data: new Uint8Array(PNG),
    });

    const res = await request(app).get('/uploads/profiles/123-abc.png');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(Buffer.from(res.body as Buffer).equals(PNG)).toBe(true);
  });

  it('returns 404 for an unknown image', async () => {
    db.storedFile.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/uploads/profiles/missing.png');
    expect(res.status).toBe(404);
  });
});
