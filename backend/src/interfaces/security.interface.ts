// ── Security domain interfaces ────────────────────────────────────────────────
// Pure domain objects — zero Prisma imports.

export type IncidentType =
  | 'FIRE'
  | 'THEFT'
  | 'INJURY'
  | 'PROPERTY_DAMAGE'
  | 'UNAUTHORIZED_ACCESS'
  | 'EQUIPMENT_FAILURE'
  | 'CHEMICAL_SPILL'
  | 'NEAR_MISS'
  | 'OTHER';

export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED';
export type AlertType =
  'SAFETY' | 'SECURITY' | 'MAINTENANCE' | 'FIRE' | 'INTRUSION' | 'ENVIRONMENTAL' | 'CUSTOM';
export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'EXPIRED';

// ── Incident Update ───────────────────────────────────────────────────────────

export interface IncidentUpdateDto {
  id: number;
  incidentId: number;
  comment: string;
  statusChange: IncidentStatus | null;
  updatedById: number | null;
  updatedByName: string | null;
  createdAt: Date;
}

// ── Security Incident ─────────────────────────────────────────────────────────

export interface SecurityIncidentDto {
  id: number;
  incidentNumber: string;
  title: string;
  description: string;
  aiSummary: string | null;
  type: IncidentType;
  confidenceScore: number | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  location: string | null;
  departmentId: number | null;
  departmentName: string | null;
  reportedById: number | null;
  reportedByName: string | null;
  assignedToId: number | null;
  assignedToName: string | null;
  occurredAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  rootCause: string | null;
  correctiveAction: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  _count: { updates: number; alerts: number };
}

export interface SecurityIncidentDetail extends SecurityIncidentDto {
  updates: IncidentUpdateDto[];
  alerts: SecurityAlertDto[];
}

export interface IncidentListResult {
  data: SecurityIncidentDto[];
  total: number;
}

// ── Create / Update data ──────────────────────────────────────────────────────

export interface CreateIncidentData {
  incidentNumber?: string | undefined;
  title: string;
  description: string;
  aiSummary?: string | null | undefined;
  confidenceScore?: number | null | undefined;
  type: IncidentType;
  severity?: IncidentSeverity | undefined;
  location?: string | null | undefined;
  departmentId?: number | null | undefined;
  departmentName?: string | null | undefined;
  reportedById?: number | null | undefined;
  reportedByName?: string | null | undefined;
  assignedToId?: number | null | undefined;
  assignedToName?: string | null | undefined;
  occurredAt?: Date | undefined;
}

export interface UpdateIncidentData {
  title?: string | undefined;
  description?: string | undefined;
  aiSummary?: string | null | undefined;
  type?: IncidentType | undefined;
  severity?: IncidentSeverity | undefined;
  confidenceScore?: number | null | undefined;
  status?: IncidentStatus | undefined;
  location?: string | null | undefined;
  departmentId?: number | null | undefined;
  departmentName?: string | null | undefined;
  assignedToId?: number | null | undefined;
  assignedToName?: string | null | undefined;
  occurredAt?: Date | undefined;
  resolvedAt?: Date | null | undefined;
  closedAt?: Date | null | undefined;
  rootCause?: string | null | undefined;
  correctiveAction?: string | null | undefined;
}

export interface CreateIncidentUpdateData {
  incidentId: number;
  comment: string;
  statusChange?: IncidentStatus | null | undefined;
  updatedById?: number | null | undefined;
  updatedByName?: string | null | undefined;
}

// ── Incident filters ──────────────────────────────────────────────────────────

export interface IncidentFilters {
  search?: string | undefined;
  type?: IncidentType | 'all' | undefined;
  severity?: IncidentSeverity | 'all' | undefined;
  status?: IncidentStatus | 'all' | undefined;
  departmentId?: number | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortBy?: 'occurredAt' | 'createdAt' | 'severity' | 'status' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

// ── Security Alert ────────────────────────────────────────────────────────────

export interface SecurityAlertDto {
  id: number;
  alertNumber: string;
  title: string;
  message: string;
  type: AlertType;
  severity: IncidentSeverity;
  status: AlertStatus;
  source: string | null;
  location: string | null;
  departmentId: number | null;
  departmentName: string | null;
  incidentId: number | null;
  acknowledgedById: number | null;
  acknowledgedByName: string | null;
  acknowledgedAt: Date | null;
  resolvedById: number | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  expiresAt: Date | null;
  createdById: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertListResult {
  data: SecurityAlertDto[];
  total: number;
}

export interface CreateAlertData {
  title: string;
  message: string;
  type: AlertType;
  severity?: IncidentSeverity | undefined;
  source?: string | null | undefined;
  location?: string | null | undefined;
  departmentId?: number | null | undefined;
  departmentName?: string | null | undefined;
  incidentId?: number | null | undefined;
  expiresAt?: Date | null | undefined;
  createdById?: number | null | undefined;
}

export interface UpdateAlertData {
  title?: string | undefined;
  message?: string | undefined;
  type?: AlertType | undefined;
  severity?: IncidentSeverity | undefined;
  source?: string | null | undefined;
  location?: string | null | undefined;
  departmentId?: number | null | undefined;
  departmentName?: string | null | undefined;
  incidentId?: number | null | undefined;
  expiresAt?: Date | null | undefined;
}

export interface AcknowledgeAlertData {
  acknowledgedById?: number | null | undefined;
  acknowledgedByName?: string | null | undefined;
}

export interface ResolveAlertData {
  resolvedById?: number | null | undefined;
  resolvedByName?: string | null | undefined;
}

export interface AlertFilters {
  search?: string | undefined;
  type?: AlertType | 'all' | undefined;
  severity?: IncidentSeverity | 'all' | undefined;
  status?: AlertStatus | 'all' | undefined;
  departmentId?: number | undefined;
  incidentId?: number | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortBy?: 'createdAt' | 'severity' | 'status' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

export interface SecurityKPIs {
  // Incidents
  totalIncidents: number;
  openIncidents: number;
  investigatingIncidents: number;
  resolvedThisMonth: number;
  criticalIncidents: number; // CRITICAL severity, not CLOSED

  // Alerts
  totalAlerts: number;
  activeAlerts: number;
  acknowledgedAlerts: number;
  criticalAlerts: number; // CRITICAL severity, ACTIVE

  // Breakdowns
  incidentsByType: Array<{ type: IncidentType; count: number }>;
  incidentsBySeverity: Array<{ severity: IncidentSeverity; count: number }>;
  alertsByType: Array<{ type: AlertType; count: number }>;

  // Trend — last 7 days
  incidentTrend: Array<{ date: string; count: number }>;
}
