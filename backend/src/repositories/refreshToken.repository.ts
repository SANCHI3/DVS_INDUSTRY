import { createHash } from 'crypto';
import type { IRefreshTokenRepository } from '../interfaces';
import { prisma } from '../lib/prismaClient';

/**
 * Refresh tokens are bearer credentials, so only their SHA-256 digest is
 * persisted. A database leak therefore cannot be replayed against /auth/refresh.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(data: { token: string; userId: number; expiresAt: Date }): Promise<void> {
    await prisma.refreshToken.create({ data: { ...data, token: hashToken(data.token) } });
  }

  async findByToken(
    token: string,
  ): Promise<{ id: number; userId: number; expiresAt: Date } | null> {
    const record = await prisma.refreshToken.findUnique({
      where: { token: hashToken(token) },
      select: { id: true, userId: true, expiresAt: true },
    });
    return record ?? null;
  }

  async deleteByToken(token: string): Promise<void> {
    await prisma.refreshToken.delete({ where: { token: hashToken(token) } }).catch(() => {
      // Silently ignore if token was already deleted (idempotent logout)
    });
  }

  async deleteAllByUserId(userId: number): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }
}
