/**
 * Regression tests for auth hardening: login ordering, DB-backed password
 * reset, role-change session revocation and hashed refresh tokens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../errors';

vi.mock('../../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    BCRYPT_SALT_ROUNDS: 10,
    REFRESH_TOKEN_EXPIRES_IN: '7d',
    APP_URL: 'https://erp.example.test/',
    LOG_LEVEL: 'silent',
  },
}));

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    role: { findUnique: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    passwordResetToken: {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn().mockResolvedValue('$hashed$'), compare: vi.fn() },
}));

vi.mock('../../utils/token', () => ({
  generateAccessToken: vi.fn().mockReturnValue('access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('refresh-token'),
  verifyRefreshToken: vi.fn(),
  parseExpiresInMs: vi.fn().mockReturnValue(1000),
  generateJti: vi.fn().mockReturnValue('jti'),
  generateOpaqueToken: vi.fn().mockReturnValue('raw-reset-token'),
}));

vi.mock('../../utils/mailer', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { prisma } from '../../lib/prismaClient';
import bcrypt from 'bcrypt';
import { sendPasswordResetEmail } from '../../utils/mailer';

const { AuthService } = await import('../../services/auth.service');

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

const user = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  fullName: 'Asha',
  email: 'asha@test.com',
  password: '$hashed$',
  phone: null,
  isActive: true,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  role: { id: 2, name: 'STORE' },
  ...overrides,
});

describe('AuthService hardening', () => {
  let svc: InstanceType<typeof AuthService>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new AuthService();
  });

  describe('login', () => {
    it('does not reveal a deactivated account to someone with the wrong password', async () => {
      fn(prisma.user.findUnique).mockResolvedValue(user({ isActive: false }));
      fn(bcrypt.compare).mockResolvedValue(false);
      await expect(svc.login('asha@test.com', 'wrong')).rejects.toThrow(UnauthorizedError);
    });

    it('reports deactivation only after a correct password', async () => {
      fn(prisma.user.findUnique).mockResolvedValue(user({ isActive: false }));
      fn(bcrypt.compare).mockResolvedValue(true);
      await expect(svc.login('asha@test.com', 'right')).rejects.toThrow(ForbiddenError);
    });

    it('stores only a hash of the refresh token', async () => {
      fn(prisma.user.findUnique).mockResolvedValue(user());
      fn(bcrypt.compare).mockResolvedValue(true);
      await svc.login('asha@test.com', 'right');
      const stored = fn(prisma.refreshToken.create).mock.calls[0][0].data.token;
      expect(stored).toBe(sha256('refresh-token'));
    });
  });

  describe('password reset', () => {
    it('persists a hashed token and emails a link for an active user', async () => {
      fn(prisma.user.findUnique).mockResolvedValue(user());
      await svc.forgotPassword('asha@test.com');

      const created = fn(prisma.passwordResetToken.create).mock.calls[0][0].data;
      expect(created.tokenHash).toBe(sha256('raw-reset-token'));
      expect(created.userId).toBe(5);
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(
        'asha@test.com',
        'https://erp.example.test/?resetToken=raw-reset-token',
      );
    });

    it('does nothing observable for an unknown email', async () => {
      fn(prisma.user.findUnique).mockResolvedValue(null);
      await expect(svc.forgotPassword('nobody@test.com')).resolves.toBeUndefined();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('consumes a valid token once and revokes sessions', async () => {
      fn(prisma.passwordResetToken.delete).mockResolvedValue({
        userId: 5,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await svc.resetPassword('raw-reset-token', 'NewPassword!234');

      expect(fn(prisma.passwordResetToken.delete).mock.calls[0][0].where).toEqual({
        tokenHash: sha256('raw-reset-token'),
      });
      expect(prisma.user.update).toHaveBeenCalled();
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
    });

    it('rejects an expired token', async () => {
      fn(prisma.passwordResetToken.delete).mockResolvedValue({
        userId: 5,
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(svc.resetPassword('raw-reset-token', 'NewPassword!234')).rejects.toThrow(
        BadRequestError,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown or already-used token', async () => {
      fn(prisma.passwordResetToken.delete).mockRejectedValue(new Error('not found'));
      await expect(svc.resetPassword('reused', 'NewPassword!234')).rejects.toThrow(
        BadRequestError,
      );
    });
  });

  describe('updateUser', () => {
    it('revokes the target user sessions when their role changes', async () => {
      fn(prisma.user.findUnique).mockResolvedValue(user());
      fn(prisma.role.findUnique).mockResolvedValue({ id: 3, name: 'MANAGER' });
      fn(prisma.user.update).mockResolvedValue(user({ role: { id: 3, name: 'MANAGER' } }));

      await svc.updateUser(1, 5, { roleId: 3 });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
    });

    it('prevents an admin from changing their own role', async () => {
      fn(prisma.user.findUnique).mockResolvedValue(user({ id: 1 }));
      await expect(svc.updateUser(1, 1, { roleId: 3 })).rejects.toThrow(BadRequestError);
    });
  });
});
