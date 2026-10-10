import { createHash } from 'crypto';
import { prisma } from '../lib/prismaClient';

export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export class PasswordResetTokenRepository {
  /** Stores a new token, replacing any outstanding ones for the same user. */
  async replaceForUser(userId: number, rawToken: string, expiresAt: Date): Promise<void> {
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
      prisma.passwordResetToken.create({
        data: { userId, tokenHash: hashResetToken(rawToken), expiresAt },
      }),
    ]);
  }

  /**
   * Atomically consumes a token: deletes it and returns its owner, or null if
   * it does not exist / has expired. Deleting first makes it strictly single-use
   * even under concurrent requests.
   */
  async consume(rawToken: string): Promise<number | null> {
    const tokenHash = hashResetToken(rawToken);
    const record = await prisma.passwordResetToken
      .delete({ where: { tokenHash }, select: { userId: true, expiresAt: true } })
      .catch(() => null);

    if (record === null || record.expiresAt < new Date()) return null;
    return record.userId;
  }

  async deleteExpired(): Promise<void> {
    await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
