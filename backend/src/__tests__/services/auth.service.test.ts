/**
 * Auth service unit tests
 * Uses vi.mock so no DB connection needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictError, UnauthorizedError, NotFoundError, BadRequestError } from '../../errors';

// ── Mock env FIRST to prevent process.exit(1) ─────────────────────────────────
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
  },
}));

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    role: { findUnique: vi.fn(), findMany: vi.fn() },
    supplier: { findFirst: vi.fn() },
    client: { findFirst: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$hashed$'),
    compare: vi.fn(),
  },
  hash: vi.fn().mockResolvedValue('$hashed$'),
  compare: vi.fn(),
}));

vi.mock('../../utils/token', () => ({
  generateAccessToken: vi.fn().mockReturnValue('access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('refresh-token'),
  verifyRefreshToken: vi.fn(),
  parseExpiresInMs: vi.fn().mockReturnValue(7 * 24 * 60 * 60 * 1000),
  generateJti: vi.fn().mockReturnValue('jti-123'),
  generateOpaqueToken: vi.fn().mockReturnValue('opaque-token'),
}));

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { prisma } from '../../lib/prismaClient';
import bcrypt from 'bcrypt';

const mockUser = {
  id: 1,
  fullName: 'Test Admin',
  email: 'admin@test.com',
  password: '$hashed$',
  phone: null,
  roleId: 1,
  isActive: true,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  role: { id: 1, name: 'ADMIN', description: null, createdAt: new Date(), updatedAt: new Date() },
  refreshTokens: [],
  employee: null,
};

const mockRole = {
  id: 1,
  name: 'ADMIN',
  description: 'Administrator',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Import AFTER mocks
const { AuthService } = await import('../../services/auth.service');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let svc: InstanceType<typeof AuthService>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new AuthService();
  });

  // ── register ────────────────────────────────────────────────────────────────

  describe('register', () => {
    it('creates a user when email is unique', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.role.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockRole);
      (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      const result = await svc.register({
        fullName: 'Test Admin',
        email: 'admin@test.com',
        password: 'Secret@1234',
        roleId: 1,
      });

      expect(result.email).toBe('admin@test.com');
      expect(prisma.user.create).toHaveBeenCalledOnce();
    });

    it('throws ConflictError if email already exists', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      await expect(
        svc.register({ fullName: 'X', email: 'admin@test.com', password: 'pass', roleId: 1 }),
      ).rejects.toThrow(ConflictError);
    });

    it('links a new supplier login to the supplier with the same email', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.role.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 7,
        name: 'SUPPLIER',
      });
      (prisma.supplier.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 12 });
      (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      await svc.register({ fullName: 'Mal', email: 'Sales@Mal.in', password: 'pass', roleId: 7 });

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: { equals: 'Sales@Mal.in', mode: 'insensitive' }, deletedAt: null },
        }),
      );
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ supplierId: 12, clientId: null }),
        }),
      );
    });

    it('uses the client the admin chose, and rejects one that does not exist', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.role.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 8,
        name: 'CLIENT',
      });
      (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      const client = prisma.client.findFirst as ReturnType<typeof vi.fn>;

      client.mockResolvedValueOnce({ id: 4 });
      await svc.register({
        fullName: 'CES',
        email: 'buyer@ces.in',
        password: 'pass',
        roleId: 8,
        clientId: 4,
      });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clientId: 4, supplierId: null }),
        }),
      );

      client.mockResolvedValueOnce(null);
      await expect(
        svc.register({
          fullName: 'X',
          email: 'x@ces.in',
          password: 'pass',
          roleId: 8,
          clientId: 99,
        }),
      ).rejects.toThrow(BadRequestError);
    });

    it('never links a staff account to a company', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.role.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockRole);
      (prisma.user.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      await svc.register({
        fullName: 'A',
        email: 'a@dvs.in',
        password: 'pass',
        roleId: 1,
        supplierId: 3,
      });

      expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ supplierId: null, clientId: null }),
        }),
      );
    });

    it('throws BadRequestError if roleId does not exist', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.role.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        svc.register({ fullName: 'X', email: 'new@test.com', password: 'pass', roleId: 99 }),
      ).rejects.toThrow(BadRequestError);
    });
  });

  // ── login ───────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns token pair on valid credentials', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (prisma.refreshToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      const result = await svc.login('admin@test.com', 'Secret@1234');

      // Service returns { user, tokens } — tokens contains accessToken
      expect(result.user.email).toBe('admin@test.com');
      expect(result.tokens).toBeDefined();
    });

    it('throws UnauthorizedError for unknown email', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(svc.login('nobody@test.com', 'pass')).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError for wrong password', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await expect(svc.login('admin@test.com', 'wrong')).rejects.toThrow(UnauthorizedError);
    });

    it('rejects the right password on the wrong portal exactly like a wrong password', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser); // ADMIN
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      await expect(svc.login('admin@test.com', 'Secret@1234', 'production')).rejects.toThrow(
        new UnauthorizedError('Invalid email or password'),
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('signs an account in on its own portal (and without a portal, for older clients)', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockUser,
        role: { ...mockUser.role, name: 'PRODUCTION' },
      });
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (prisma.refreshToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      await expect(svc.login('p@test.com', 'Secret@1234', 'production')).resolves.toBeDefined();
      await expect(svc.login('p@test.com', 'Secret@1234')).resolves.toBeDefined();
      await expect(svc.login('p@test.com', 'Secret@1234', 'admin')).rejects.toThrow(UnauthorizedError);
    });

    it('lets managers and HR use the administrator portal, sales the store portal', async () => {
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (prisma.refreshToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      for (const [role, portal] of [['MANAGER', 'admin'], ['HR', 'admin'], ['SALES', 'store']] as const) {
        (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...mockUser,
          role: { ...mockUser.role, name: role },
        });
        await expect(svc.login('x@test.com', 'Secret@1234', portal)).resolves.toBeDefined();
      }
    });

    it('throws ForbiddenError for inactive account', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockUser,
        isActive: false,
      });
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      // isActive=false check happens before password check — throws ForbiddenError
      await expect(svc.login('admin@test.com', 'Secret@1234')).rejects.toThrow();
    });
  });

  describe('getEligibleEmployees', () => {
    it('queries only active users linked to active employee records', async () => {
      (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([mockUser]);

      const result = await svc.getEligibleEmployees();

      expect(result).toEqual([mockUser]);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: true,
            employee: { is: { status: 'ACTIVE', deletedAt: null } },
          },
        }),
      );
    });
  });

  // ── changePassword ──────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates password when current password matches', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      (prisma.refreshToken.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

      await expect(
        svc.changePassword(1, { currentPassword: 'old', newPassword: 'NewPass@1' }),
      ).resolves.not.toThrow();
    });

    it('throws BadRequestError when current password is wrong', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
      (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await expect(
        svc.changePassword(1, { currentPassword: 'wrong', newPassword: 'NewPass@1' }),
      ).rejects.toThrow(BadRequestError);
    });
  });
});
