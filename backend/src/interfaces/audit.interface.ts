// ── Audit Log domain interfaces ───────────────────────────────────────────────
// Pure domain objects — zero Prisma imports.

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'EXPORT'
  | 'STATUS_CHANGE'
  | 'BULK_ACTION';

export interface AuditLogDto {
  id: number;
  userId: number | null;
  userEmail: string | null;
  userRole: string | null;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  entityCode: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AuditLogListResult {
  data: AuditLogDto[];
  total: number;
}

// ── Input for programmatic / middleware writes ────────────────────────────────

export interface CreateAuditLogData {
  userId?: number | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  entityCode?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// ── Query filters ─────────────────────────────────────────────────────────────

export interface AuditLogFilters {
  userId?: number | undefined;
  action?: AuditAction | 'all' | undefined;
  entity?: string | undefined;
  entityId?: string | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  search?: string | undefined; // matches userEmail or path
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}
