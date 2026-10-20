// Application-wide constants.
// Keep all magic strings / numbers here — never inline them.

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const API_PREFIX = '/api/v1';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ── RBAC ──────────────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  HR: 'HR',
  STORE: 'STORE',
  PRODUCTION: 'PRODUCTION',
  SALES: 'SALES',
  SUPPLIER: 'SUPPLIER',
  CLIENT: 'CLIENT',
  PERCEPTION_SERVICE: 'PERCEPTION_SERVICE',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

// ── Token cookies ─────────────────────────────────────────────────────────
export const REFRESH_TOKEN_COOKIE = 'dvs_rt';
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
} as const;
