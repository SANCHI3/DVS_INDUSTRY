import type { Response, NextFunction, RequestHandler } from 'express';
import type { AuthenticatedRequest } from '../types';
import type { RoleName } from '../constants';
import { ForbiddenError, UnauthorizedError } from '../errors';

/**
 * authorize(...roles)
 *
 * Must be used AFTER authenticate().
 * Checks that req.user.role is in the allowed roles list.
 *
 * Usage:
 *   router.post('/users', authenticate, authorize('ADMIN'), handler)
 *   router.get('/reports', authenticate, authorize('ADMIN', 'MANAGER'), handler)
 */
export function authorize(...allowedRoles: RoleName[]): RequestHandler {
  const handler = (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (req.user === undefined) {
      throw new UnauthorizedError('Not authenticated');
    }

    if (!allowedRoles.includes(req.user.role as RoleName)) {
      throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
    }

    next();
  };
  // Read by scripts/api-reference.ts to document who may call each route
  return Object.assign(handler, { allowedRoles });
}
