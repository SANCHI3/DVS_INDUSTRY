import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { verifyAccessToken } from '../utils/token';
import { UnauthorizedError } from '../errors';
import { prisma } from '../lib/prismaClient';

/**
 * authenticate()
 *
 * Validates the Bearer access token in the Authorization header, then
 * confirms the account still exists and is active. The role attached to
 * `req.user` is read from the database, not the token, so deactivations and
 * role changes take effect immediately instead of when the token expires.
 *
 * On failure it throws an UnauthorizedError which the global error
 * handler converts to a 401 response.
 *
 * Usage:
 *   router.get('/me', authenticate, handler)
 */
export async function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('No access token provided');
  }

  const token = authHeader.split(' ')[1];

  if (token === undefined || token.trim() === '') {
    throw new UnauthorizedError('Malformed authorization header');
  }

  let userId: number;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    throw new UnauthorizedError('Access token is invalid or has expired');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      role: { select: { name: true } },
    },
  });

  if (user === null || user === undefined || !user.isActive) {
    throw new UnauthorizedError('Account not found or deactivated');
  }

  req.user = { id: user.id, email: user.email, fullName: user.fullName, role: user.role.name };
  next();
}
