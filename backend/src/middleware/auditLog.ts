import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { AuditRepository } from '../repositories/audit.repository';
import type { AuditAction, CreateAuditLogData } from '../interfaces';

const repo = new AuditRepository();

/** Identity of the actor when req.user is not set (e.g. a successful login). */
export interface AuditActor {
  id: number;
  email: string;
  role: string;
}

/**
 * Endpoints that are pure session plumbing and would only add noise, or that
 * write their own, more detailed audit entry (assistant questions).
 */
const SKIPPED_PATHS = ['/auth/refresh', '/auth/me', '/assistant/ask'];

/**
 * Maps HTTP method + path + response status → AuditAction.
 * Write operations (POST/PATCH/PUT/DELETE), report exports and sign-in
 * attempts are logged; ordinary reads are not.
 */
export function resolveAction(
  method: string,
  path: string,
  statusCode: number,
): AuditAction | null {
  const m = method.toUpperCase();

  if (path.endsWith('/auth/login') && m === 'POST') {
    if (statusCode < 400) return 'LOGIN';
    // 401/403 = wrong credentials or deactivated account; 429 = throttled
    if (statusCode === 401 || statusCode === 403 || statusCode === 429) return 'LOGIN_FAILED';
    return null;
  }

  if (statusCode >= 400) return null; // other failed requests changed nothing
  if (SKIPPED_PATHS.some((p) => path.endsWith(p))) return null;
  if (path.endsWith('/auth/logout')) return 'LOGOUT';

  if (m === 'GET') {
    return path.includes('/reports/') || path.includes('/export') ? 'EXPORT' : null;
  }

  if (path.includes('/bulk')) return 'BULK_ACTION';
  if (
    /\/(status|approve|dispatch|deliver|cancel|confirm|transit|production|acknowledge|resolve|activate|deactivate|restore)$/.test(
      path,
    )
  ) {
    return 'STATUS_CHANGE';
  }

  if (m === 'POST') return 'CREATE';
  if (m === 'PATCH' || m === 'PUT') return 'UPDATE';
  if (m === 'DELETE') return 'DELETE';
  return null;
}

const ENTITY_MAP: Record<string, string> = {
  auth: 'Auth',
  employees: 'Employee',
  departments: 'Department',
  inventory: 'Inventory',
  workforce: 'Workforce',
  production: 'Production',
  'work-orders': 'WorkOrder',
  orders: 'Order',
  suppliers: 'Supplier',
  clients: 'Client',
  'client-orders': 'ClientOrder',
  'purchase-orders': 'PurchaseOrder',
  reports: 'Report',
  audit: 'AuditLog',
  security: 'Security',
  incidents: 'SecurityIncident',
  alerts: 'SecurityAlert',
  shifts: 'Shift',
  attendance: 'Attendance',
  users: 'User',
};

/**
 * Extracts the most specific entity name from the URL path.
 * e.g. /api/v1/employees/5                 → "Employee"
 *      /api/v1/orders/client-orders/3/approve → "ClientOrder"
 */
export function resolveEntity(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const versionIdx = segments.findIndex((s) => /^v\d+$/.test(s));
  const resource = segments.slice(versionIdx + 1).filter((s) => !/^\d+$/.test(s));

  // Prefer the deepest segment we recognise (sub-resources are more specific)
  for (let i = resource.length - 1; i >= 0; i--) {
    const mapped = ENTITY_MAP[resource[i] ?? ''];
    if (mapped !== undefined) return mapped;
  }
  return resource[0] ?? 'Unknown';
}

/** Extract the last numeric segment as entityId. */
function resolveEntityId(path: string): string | null {
  const segs = path.split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(segs[i] ?? '')) return segs[i] ?? null;
  }
  return null;
}

/**
 * auditLog middleware — mount ONCE at the app level, before the routers.
 *
 * It records on the response 'finish' event, by which time the route's
 * authenticate() has populated req.user. Handlers that authenticate a user
 * without req.user (login) can set res.locals.auditActor instead.
 */
export function auditLog(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Capture now: routers rewrite req.url while handling the request.
  const path = req.originalUrl.split('?')[0] ?? req.originalUrl;

  res.on('finish', () => {
    const action = resolveAction(req.method, path, res.statusCode);
    if (action === null) return;

    const actor = (res.locals['auditActor'] as AuditActor | undefined) ?? req.user;
    const body = req.body as Record<string, unknown> | undefined;
    const attemptedEmail =
      action === 'LOGIN_FAILED' && typeof body?.['email'] === 'string' ? body['email'] : null;

    const data: CreateAuditLogData = {
      userId: actor?.id ?? null,
      userEmail: actor?.email ?? attemptedEmail,
      userRole: actor?.role ?? null,
      action,
      entity: resolveEntity(path),
      entityId: resolveEntityId(path),
      method: req.method,
      path,
      statusCode: res.statusCode,
      // req.ip honours the 'trust proxy' setting, so it cannot be spoofed by
      // a client-supplied X-Forwarded-For header.
      ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };

    // Fire and forget — the repository swallows and logs its own errors
    void repo.log(data);
  });

  next();
}
