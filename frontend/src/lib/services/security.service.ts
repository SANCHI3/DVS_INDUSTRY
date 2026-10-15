import api, { unwrap, unwrapPaged, type PaginatedMeta } from '../api';

export type IncidentType     = 'FIRE'|'FIRE_SMOKE'|'SMOKE'|'CROWD'|'FIGHT'|'FALL'|'INTRUSION'|'LOITERING'|'THEFT'|'INJURY'|'PROPERTY_DAMAGE'|'UNAUTHORIZED_ACCESS'|'EQUIPMENT_FAILURE'|'CHEMICAL_SPILL'|'NEAR_MISS'|'OTHER';
export type IncidentSeverity = 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';
export type IncidentStatus   = 'OPEN'|'INVESTIGATING'|'RESOLVED'|'CLOSED';
export type AlertType        = 'SAFETY'|'SECURITY'|'MAINTENANCE'|'FIRE'|'INTRUSION'|'ENVIRONMENTAL'|'CUSTOM';
export type AlertStatus      = 'ACTIVE'|'ACKNOWLEDGED'|'RESOLVED'|'EXPIRED';

export interface SecurityIncidentDto {
  id:               number;
  incidentNumber:   string;
  title:            string;
  description:      string;
  aiSummary:        string | null;
  type:             IncidentType;
  confidenceScore:  number | null;
  severity:         IncidentSeverity;
  status:           IncidentStatus;
  location:         string | null;
  departmentName:   string | null;
  reportedByName:   string | null;
  assignedToId:     number | null;
  assignedToName:   string | null;
  occurredAt:       string;
  resolvedAt:       string | null;
  closedAt:         string | null;
  rootCause:        string | null;
  correctiveAction: string | null;
  createdAt:        string;
  _count:           { updates: number; alerts: number };
}

export interface SecurityAlertDto {
  id:                   number;
  alertNumber:          string;
  title:                string;
  message:              string;
  type:                 AlertType;
  severity:             IncidentSeverity;
  status:               AlertStatus;
  source:               string | null;
  location:             string | null;
  departmentName:       string | null;
  incidentId:           number | null;
  acknowledgedByName:   string | null;
  acknowledgedAt:       string | null;
  resolvedByName:       string | null;
  resolvedAt:           string | null;
  expiresAt:            string | null;
  createdAt:            string;
}

export interface SecurityKPIs {
  totalIncidents:          number;
  openIncidents:           number;
  investigatingIncidents:  number;
  resolvedThisMonth:       number;
  criticalIncidents:       number;
  totalAlerts:             number;
  activeAlerts:            number;
  acknowledgedAlerts:      number;
  criticalAlerts:          number;
  incidentsByType:         Array<{ type: IncidentType; count: number }>;
  incidentsBySeverity:     Array<{ severity: IncidentSeverity; count: number }>;
  alertsByType:            Array<{ type: AlertType; count: number }>;
  incidentTrend:           Array<{ date: string; count: number }>;
}

export interface IncidentQuery {
  page?: number; pageSize?: number;
  search?: string; type?: IncidentType | 'all';
  severity?: IncidentSeverity | 'all'; status?: IncidentStatus | 'all';
  departmentId?: number; fromDate?: string; toDate?: string;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
}

export interface AlertQuery {
  page?: number; pageSize?: number;
  search?: string; type?: AlertType | 'all';
  severity?: IncidentSeverity | 'all'; status?: AlertStatus | 'all';
  departmentId?: number; incidentId?: number;
  fromDate?: string; toDate?: string;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
}

export async function getSecurityKPIs(params?: { departmentId?: number; fromDate?: string; toDate?: string }): Promise<SecurityKPIs> {
  const res = await api.get<{ success: true; data: SecurityKPIs }>('/security/kpis', { params });
  return unwrap(res);
}

export async function getIncidents(params?: IncidentQuery) {
  const res = await api.get<{ success: true; data: SecurityIncidentDto[]; meta: PaginatedMeta }>('/security/incidents', { params });
  return unwrapPaged(res);
}

export async function createIncident(payload: Record<string, unknown>): Promise<SecurityIncidentDto> {
  const res = await api.post<{ success: true; data: SecurityIncidentDto }>('/security/incidents', payload);
  return unwrap(res);
}

export async function updateIncident(id: number, payload: Record<string, unknown>): Promise<SecurityIncidentDto> {
  const res = await api.patch<{ success: true; data: SecurityIncidentDto }>(`/security/incidents/${id}`, payload);
  return unwrap(res);
}

export async function transitionIncidentStatus(id: number, status: IncidentStatus, comment?: string): Promise<SecurityIncidentDto> {
  const res = await api.patch<{ success: true; data: SecurityIncidentDto }>(`/security/incidents/${id}/status`, { status, comment });
  return unwrap(res);
}

export async function assignIncident(id: number, assignedToId: number | null, assignedToName?: string | null): Promise<SecurityIncidentDto> {
  const res = await api.patch<{ success: true; data: SecurityIncidentDto }>(`/security/incidents/${id}/assign`, {
    assignedToId,
    assignedToName,
  });
  return unwrap(res);
}

export async function deleteIncident(id: number): Promise<void> {
  await api.delete(`/security/incidents/${id}`);
}

export async function getAlerts(params?: AlertQuery) {
  const res = await api.get<{ success: true; data: SecurityAlertDto[]; meta: PaginatedMeta }>('/security/alerts', { params });
  return unwrapPaged(res);
}

export async function createAlert(payload: Record<string, unknown>): Promise<SecurityAlertDto> {
  const res = await api.post<{ success: true; data: SecurityAlertDto }>('/security/alerts', payload);
  return unwrap(res);
}

export async function acknowledgeAlert(id: number): Promise<SecurityAlertDto> {
  const res = await api.patch<{ success: true; data: SecurityAlertDto }>(`/security/alerts/${id}/acknowledge`, {});
  return unwrap(res);
}

export async function resolveAlert(id: number): Promise<SecurityAlertDto> {
  const res = await api.patch<{ success: true; data: SecurityAlertDto }>(`/security/alerts/${id}/resolve`, {});
  return unwrap(res);
}

export async function deleteAlert(id: number): Promise<void> {
  await api.delete(`/security/alerts/${id}`);
}

// ── Camera evidence (stored by the perception service) ───────────────────────

export interface EvidenceFile {
  file: string;
  kind: 'keyframe' | 'gradcam' | 'clip_before' | 'clip_after';
}

export type IncidentEvidence =
  | {
      available: true;
      incidentId: string;
      cameraId: string | null;
      eventType: string;
      tier: string;
      confidenceScore: number | null;
      confidenceBasis: string | null;
      validationVersion: number | null;
      recommendedAction: string | null;
      explanation: { label: string; value: string }[];
      files: EvidenceFile[];
      /** Raw model output; the API returns it to administrators only. */
      technical?: Record<string, unknown>;
    }
  | { available: false; reason: string };

export async function getIncidentEvidence(id: number): Promise<IncidentEvidence> {
  return unwrap(await api.get(`/security/incidents/${id}/evidence`));
}

/** Evidence file as a Blob (the API needs the bearer token, so no plain <img src>). */
export async function getIncidentEvidenceFile(id: number, file: string): Promise<Blob> {
  const res = await api.get(`/security/incidents/${id}/evidence/file`, {
    params: { file },
    responseType: 'blob',
  });
  return res.data as Blob;
}
