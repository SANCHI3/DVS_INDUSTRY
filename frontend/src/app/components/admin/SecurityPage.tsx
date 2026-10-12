import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Download,
  FileWarning,
  RefreshCw,
  Shield,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Card, CardHeader, StatusBadge, Btn, DataTable, TabBar, KPICard } from "../shared/UI";
import {
  getSecurityKPIs,
  getIncidents,
  getAlerts,
  transitionIncidentStatus,
  assignIncident,
  acknowledgeAlert,
  resolveAlert,
  type SecurityKPIs,
  type SecurityIncidentDto,
  type SecurityAlertDto,
} from "../../../lib/services/security.service";
import { getEligibleEmployees, type UserDto } from "../../../lib/services/users.service";
import { subscribeSecurityStream, subscribeStreamStatus, type StreamStatus } from "../../../lib/securityStream";
import { eventTypeLabel } from "../../../lib/incidentLabels";

const tabs = [
  { id: "live", label: "Live Monitoring" },
  { id: "incidents", label: "Incident Center" },
  { id: "reports", label: "Security Reports" },
];

const filters = ["all", "open", "investigating", "resolved", "closed"] as const;

type DisplayIncident = {
  id: string;
  dateTime: { date: string; time: string };
  location: string;
  type: string;
  aiSummary: string | null;
  confidence: string;
  status: string;
  severity: string;
  assigned: string;
  numericId: number;
  rawStatus: SecurityIncidentDto["status"];
  assignedToId: number | null;
};

function formatEventType(type: string) {
  return eventTypeLabel(type);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    time: date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  };
}

function kpiValue(loading: boolean, error: boolean, value: number | undefined) {
  if (loading) return "Loading...";
  if (error || value === undefined) return "Unavailable";
  return String(value);
}

function EmptyState({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl px-6 py-12 text-center" style={{ background: "#FCFAF9", border: "1px dashed #D8C9C5" }}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "#F5E9E6", color: "#A52A2A" }}>
        <Icon size={23} strokeWidth={1.7} />
      </div>
      <p className="mt-4" style={{ color: "#302725", fontSize: "0.95rem", fontWeight: 700 }}>{title}</p>
      <p className="mt-1 max-w-md" style={{ color: "#837572", fontSize: "0.78rem", lineHeight: 1.6 }}>{detail}</p>
    </div>
  );
}

const LIVE_BADGE: Record<StreamStatus, { label: string; color: string; background: string }> = {
  live: { label: "Live", color: "#2E7D32", background: "#E8F5E9" },
  connecting: { label: "Connecting…", color: "#8A6D00", background: "#FFF8E1" },
  offline: { label: "Reconnecting…", color: "#A52A2A", background: "#FBECEA" },
  forbidden: { label: "Live updates unavailable", color: "#7A6C6A", background: "#F3EFEE" },
};

function LiveBadge({ status }: { status: StreamStatus }) {
  const badge = LIVE_BADGE[status];
  return (
    <span
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
      style={{ background: badge.background, color: badge.color, fontSize: "0.75rem", fontWeight: 600 }}
      title="Incidents appear here as soon as the cameras report them"
    >
      <span
        className={status === "live" ? "animate-pulse" : undefined}
        style={{ width: 7, height: 7, borderRadius: "50%", background: badge.color }}
      />
      {badge.label}
    </span>
  );
}

export function SecurityPage() {
  const [tab, setTab] = useState("live");
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const [kpis, setKpis] = useState<SecurityKPIs | null>(null);
  const [incidents, setIncidents] = useState<SecurityIncidentDto[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlertDto[]>([]);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [kpisError, setKpisError] = useState(false);
  const [incidentsError, setIncidentsError] = useState(false);
  const [alertsError, setAlertsError] = useState(false);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [usersError, setUsersError] = useState(false);
  const [assigningIncidentId, setAssigningIncidentId] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");

  const loadAll = () => {
    setKpisLoading(true);
    setIncidentsLoading(true);
    setAlertsLoading(true);
    setKpisError(false);
    setIncidentsError(false);
    setAlertsError(false);

    Promise.allSettled([
      getSecurityKPIs(),
      getIncidents({ pageSize: 50, sortBy: "occurredAt", sortOrder: "desc" }),
      getAlerts({ pageSize: 50, sortBy: "createdAt", sortOrder: "desc" }),
      getEligibleEmployees(),
    ]).then(([kpiResult, incidentResult, alertResult, userResult]) => {
      if (kpiResult.status === "fulfilled") setKpis(kpiResult.value);
      else setKpisError(true);
      if (incidentResult.status === "fulfilled") setIncidents(incidentResult.value.data);
      else setIncidentsError(true);
      if (alertResult.status === "fulfilled") setAlerts(alertResult.value.data);
      else setAlertsError(true);
      if (userResult.status === "fulfilled") setUsers(userResult.value.filter((user) => user.isActive));
      else setUsersError(true);
      setKpisLoading(false);
      setIncidentsLoading(false);
      setAlertsLoading(false);
    });
  };

  useEffect(() => { loadAll(); }, []);

  // Live updates: incidents pushed by the backend appear immediately; KPI
  // totals are re-fetched quietly (debounced) so bursts cause one request.
  useEffect(() => {
    let kpiTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshKpis = () => {
      if (kpiTimer) clearTimeout(kpiTimer);
      kpiTimer = setTimeout(() => {
        getSecurityKPIs().then(setKpis).catch(() => undefined);
      }, 800);
    };
    const unsubscribe = subscribeSecurityStream((event) => {
      if (event.type === "incident.deleted") {
        setIncidents((current) => current.filter((incident) => incident.id !== event.incidentId));
      } else {
        const changed = event.incident;
        setIncidents((current) => {
          const exists = current.some((incident) => incident.id === changed.id);
          if (exists) return current.map((incident) => (incident.id === changed.id ? changed : incident));
          return [changed, ...current];
        });
      }
      refreshKpis();
    });
    const unsubscribeStatus = subscribeStreamStatus(setStreamStatus);
    return () => {
      unsubscribe();
      unsubscribeStatus();
      if (kpiTimer) clearTimeout(kpiTimer);
    };
  }, []);

  const displayIncidents: DisplayIncident[] = incidents.map((incident) => ({
    id: incident.incidentNumber,
    dateTime: formatDateTime(incident.occurredAt),
    location: incident.location ?? "Unavailable",
    type: formatEventType(incident.type),
    aiSummary: incident.aiSummary?.trim() || null,
    confidence: incident.confidenceScore === null ? "Unavailable" : `${Math.round(incident.confidenceScore * 100)}%`,
    status: incident.status.toLowerCase(),
    severity: incident.severity.toLowerCase(),
    assigned: incident.assignedToName ?? "Unassigned",
    numericId: incident.id,
    rawStatus: incident.status,
    assignedToId: incident.assignedToId,
  }));

  const filteredIncidents = filter === "all"
    ? displayIncidents
    : displayIncidents.filter((incident) => incident.status === filter);
  const activeAlerts = alerts.filter((alert) => alert.status === "ACTIVE");

  const handleAcknowledge = async (alertId: number) => {
    try { await acknowledgeAlert(alertId); toast.success("Alert acknowledged"); loadAll(); }
    catch { toast.error("Failed to acknowledge alert"); }
  };

  const handleResolveAlert = async (alertId: number) => {
    try { await resolveAlert(alertId); toast.success("Alert resolved"); loadAll(); }
    catch { toast.error("Failed to resolve alert"); }
  };

  // Incident actions apply the server's returned row and refresh only the KPIs
  // (the live stream keeps the rest current) -- a full reload per click would
  // spend 5 requests and could exhaust the API rate limit during triage.
  const applyIncident = (updated: SecurityIncidentDto) => {
    setIncidents((current) => current.map((incident) => (incident.id === updated.id ? updated : incident)));
    getSecurityKPIs().then(setKpis).catch(() => undefined);
  };

  const handleTransitionIncident = async (incidentId: number, status: "INVESTIGATING" | "RESOLVED" | "CLOSED") => {
    try { applyIncident(await transitionIncidentStatus(incidentId, status)); toast.success(`Incident moved to ${status}`); }
    catch { toast.error("Failed to update incident"); }
  };

  const handleAssignIncident = async (incidentId: number, userId: string) => {
    const assignedToId = userId ? Number(userId) : null;
    const selectedUser = users.find((user) => user.id === assignedToId);
    setAssigningIncidentId(incidentId);
    try {
      applyIncident(await assignIncident(incidentId, assignedToId, selectedUser?.fullName ?? null));
      toast.success(selectedUser ? `Incident assigned to ${selectedUser.fullName}` : "Incident unassigned");
    } catch { toast.error("Failed to assign incident"); }
    finally { setAssigningIncidentId(null); }
  };

  const exportIncidents = () => {
    if (filteredIncidents.length === 0) { toast.error("No incident data available to export."); return; }
    const headers = ["Incident ID", "Date & Time", "Location", "Event Type", "AI Summary", "Confidence", "Severity", "Status", "Assigned To"];
    const rows = filteredIncidents.map((incident) => [
      incident.id,
      `${incident.dateTime.date} ${incident.dateTime.time}`,
      incident.location,
      incident.type,
      incident.aiSummary ?? "",
      incident.confidence,
      incident.severity,
      incident.status,
      incident.assigned,
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, "\"\"")}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "DVS_security_incidents.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderIncidentAction = (incident: DisplayIncident) => {
    if (incident.rawStatus === "OPEN") return <Btn size="sm" variant="secondary" onClick={() => handleTransitionIncident(incident.numericId, "INVESTIGATING")}>Investigate <ArrowRight size={12} /></Btn>;
    if (incident.rawStatus === "INVESTIGATING") return <Btn size="sm" variant="success" onClick={() => handleTransitionIncident(incident.numericId, "RESOLVED")}>Resolve <ArrowRight size={12} /></Btn>;
    if (incident.rawStatus === "RESOLVED") return <Btn size="sm" variant="ghost" onClick={() => handleTransitionIncident(incident.numericId, "CLOSED")}>Close <ArrowRight size={12} /></Btn>;
    return <span style={{ color: "#9A8A88", fontSize: "0.75rem" }}>No action</span>;
  };

  const renderAssignment = (incident: DisplayIncident) => (
    <select
      value={incident.assignedToId ?? ""}
      disabled={usersError || assigningIncidentId === incident.numericId}
      onChange={(event) => handleAssignIncident(incident.numericId, event.target.value)}
      aria-label={`Assign ${incident.id}`}
      style={{ minWidth: "9rem", border: "1px solid #E7DEDA", borderRadius: "0.375rem", padding: "0.35rem 0.5rem", color: "#665956", background: "#fff", fontSize: "0.74rem" }}
    >
      <option value="">{usersError ? "Employees unavailable" : users.length === 0 ? "No eligible employees" : "Unassigned"}</option>
      {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
    </select>
  );

  return (
    <main className="min-h-full px-4 py-5 sm:px-6 lg:px-8" style={{ background: "#FAF8F7" }}>
      <div className="mx-auto max-w-[1500px]">
        <PageHeader
          title="AI Security Management"
          subtitle="AI-assisted incident monitoring, alert handling, and incident response. Live CCTV feeds are unavailable until CCTV integration is connected."
          actions={
            <>
              <LiveBadge status={streamStatus} />
              <Btn variant="secondary" size="sm" onClick={loadAll}><RefreshCw size={14} /> Refresh</Btn>
            </>
          }
        />

        <section className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KPICard label="Cameras Online" value="Unavailable" sub="CCTV integration pending" icon={Camera} accent="#A52A2A" />
          <KPICard label="Active Alerts" value={kpiValue(kpisLoading, kpisError, kpis?.activeAlerts)} sub={kpis ? `${kpis.criticalAlerts} critical` : undefined} icon={AlertTriangle} accent="#C0392B" />
          <KPICard label="Resolved This Month" value={kpiValue(kpisLoading, kpisError, kpis?.resolvedThisMonth)} icon={CheckCircle2} accent="#2E7D32" />
          <KPICard label="Total Incidents" value={kpiValue(kpisLoading, kpisError, kpis?.totalIncidents)} sub={kpis ? `${kpis.openIncidents} open` : undefined} icon={Zap} accent="#A52A2A" />
        </section>

        <div className="mb-6 flex items-end justify-between gap-4 border-b" style={{ borderColor: "#E7DEDA" }}>
          <TabBar tabs={tabs} active={tab} onChange={setTab} />
          <span className="hidden pb-2 text-right md:block" style={{ color: "#9A8A88", fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>Security workspace</span>
        </div>

        {tab === "live" && (
          <div className="space-y-5">
            <Card style={{ borderRadius: "0.75rem" }}>
              <CardHeader title="Live Camera Feeds" subtitle="Connected camera status is not available from the current APIs." actions={<StatusBadge status="neutral" label="Unavailable" />} />
              <div className="p-5 sm:p-6"><EmptyState icon={Camera} title="Live camera feeds unavailable" detail="CCTV integration pending. This space is reserved for connected RTSP camera streams when camera availability data is added to the system." /></div>
            </Card>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Card style={{ borderRadius: "0.75rem" }}>
                <CardHeader title="Active Alerts" subtitle="Alerts currently returned by the security API" actions={<StatusBadge status={activeAlerts.length ? "critical" : "neutral"} label={alertsLoading ? "Loading" : `${activeAlerts.length} active`} />} />
                <div className="p-5">
                  {alertsLoading ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading security alerts...</p> : alertsError ? <p style={{ color: "#C0392B", fontSize: "0.82rem" }}>Unable to load security alerts.</p> : activeAlerts.length === 0 ? <EmptyState icon={Shield} title="No active alerts" detail="No active security alerts were returned by the current backend." /> : (
                    <div className="space-y-2">
                      {activeAlerts.slice(0, 5).map((alert) => (
                        <div key={alert.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center" style={{ borderColor: "#EEE4E0", background: alert.severity === "CRITICAL" ? "#FFF8F7" : "#FFFCF4" }}>
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: alert.severity === "CRITICAL" ? "#FCE5E2" : "#FFF0C7", color: alert.severity === "CRITICAL" ? "#B42318" : "#9A6700" }}><AlertTriangle size={17} /></div>
                          <div className="min-w-0 flex-1"><p className="truncate" style={{ color: "#302725", fontSize: "0.84rem", fontWeight: 700 }}>{alert.alertNumber} · {alert.title}</p><p style={{ color: "#837572", fontSize: "0.73rem" }}>{alert.location ?? "Location unavailable"} · {new Date(alert.createdAt).toLocaleString("en-IN")}</p></div>
                          <StatusBadge status={alert.severity.toLowerCase()} />
                          <div className="flex gap-2"><Btn size="sm" variant="secondary" onClick={() => handleAcknowledge(alert.id)}>Acknowledge</Btn><Btn size="sm" variant="success" onClick={() => handleResolveAlert(alert.id)}>Resolve</Btn></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              <Card style={{ borderRadius: "0.75rem" }}>
                <CardHeader title="Detection Summary" subtitle="Only aggregate values available from the security KPI API" />
                <div className="space-y-4 p-5">
                  {kpisLoading ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading detection summary...</p> : kpisError || !kpis ? <EmptyState icon={FileWarning} title="Summary unavailable" detail="The security KPI data could not be loaded." /> : (
                    <>
                      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "#EEE4E0" }}><span style={{ color: "#837572", fontSize: "0.78rem" }}>Critical incidents</span><strong style={{ color: "#302725", fontSize: "1.15rem" }}>{kpis.criticalIncidents}</strong></div>
                      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "#EEE4E0" }}><span style={{ color: "#837572", fontSize: "0.78rem" }}>Investigating</span><strong style={{ color: "#302725", fontSize: "1.15rem" }}>{kpis.investigatingIncidents}</strong></div>
                      <div className="flex items-center justify-between"><span style={{ color: "#837572", fontSize: "0.78rem" }}>Total alerts</span><strong style={{ color: "#302725", fontSize: "1.15rem" }}>{kpis.totalAlerts}</strong></div>
                    </>
                  )}
                </div>
              </Card>
            </section>
          </div>
        )}

        {tab === "incidents" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center" style={{ background: "#FFFFFF", borderColor: "#E7DEDA" }}>
              <div className="flex flex-wrap gap-2">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className="rounded-md px-3 py-1.5" style={{ background: filter === item ? "#A52A2A" : "#FBF8F7", color: filter === item ? "#FFFFFF" : "#665956", border: `1px solid ${filter === item ? "#A52A2A" : "#E7DEDA"}`, cursor: "pointer", fontSize: "0.74rem", fontWeight: 600, textTransform: "capitalize" }}>{item === "all" ? "All Incidents" : item}</button>)}</div>
              <Btn variant="secondary" size="sm" className="sm:ml-auto" onClick={exportIncidents}><Download size={13} /> Export CSV</Btn>
            </div>
            <Card style={{ borderRadius: "0.75rem", overflow: "hidden" }}>
              <CardHeader title="Incident Center" subtitle="Incident records returned by the security API. Camera data remains unavailable; confidence is shown when returned." actions={<span style={{ color: "#9A8A88", fontSize: "0.72rem" }}>{filteredIncidents.length} records</span>} />
              <DataTable
                searchable
                paginate={10}
                emptyMsg={incidentsLoading ? "Loading incidents..." : incidentsError ? "Unable to load incidents." : "No incidents available."}
                columns={[{ key: "id", label: "Incident ID" }, { key: "datetime", label: "Date & Time" }, { key: "location", label: "Location" }, { key: "type", label: "Event Type" }, { key: "aiSummary", label: "AI Summary" }, { key: "confidence", label: "Confidence" }, { key: "severity", label: "Severity" }, { key: "status", label: "Status" }, { key: "assigned", label: "Assigned To" }, { key: "actions", label: "Actions" }]}
                rows={filteredIncidents.map((incident) => ({
                  id: <span style={{ color: "#A52A2A", fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem", fontWeight: 700 }}>{incident.id}</span>,
                  datetime: <div><p style={{ color: "#302725", fontSize: "0.78rem", fontWeight: 600 }}>{incident.dateTime.date}</p><p style={{ color: "#9A8A88", fontSize: "0.7rem" }}>{incident.dateTime.time}</p></div>,
                  location: <span style={{ fontSize: "0.78rem" }}>{incident.location}</span>,
                  type: <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{incident.type}</span>,
                  aiSummary: incident.aiSummary ? <span style={{ color: "#665956", display: "block", fontSize: "0.75rem", lineHeight: 1.45, maxWidth: "18rem" }}>{incident.aiSummary}</span> : <span style={{ color: "#AAA09D", fontSize: "0.74rem" }}>Unavailable</span>,
                  confidence: <span style={{ color: incident.confidence === "Unavailable" ? "#AAA09D" : "#665956", fontSize: "0.74rem", fontWeight: 600 }}>{incident.confidence}</span>,
                  severity: <StatusBadge status={incident.severity} />,
                  status: <StatusBadge status={incident.status} />,
                  assigned: renderAssignment(incident),
                  actions: renderIncidentAction(incident),
                }))}
              />
            </Card>
          </div>
        )}

        {tab === "reports" && (
          <div className="space-y-5">
            <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Card style={{ borderRadius: "0.75rem" }}>
                <CardHeader title="Incidents by Severity" subtitle="Aggregate breakdown returned by the security KPI API" />
                <div className="p-5">
                  {kpisLoading ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading report data...</p> : kpisError || !kpis ? <EmptyState icon={FileWarning} title="Report data unavailable" detail="The security KPI data could not be loaded." /> : kpis.incidentsBySeverity.length === 0 ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>No data returned.</p> : <div className="space-y-3">{kpis.incidentsBySeverity.map((item) => <div key={item.severity} className="flex items-center gap-3"><span className="w-20" style={{ color: "#665956", fontSize: "0.76rem", textTransform: "capitalize" }}>{item.severity.toLowerCase()}</span><div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "#F0E9E6" }}><div className="h-full rounded-full" style={{ background: item.severity === "CRITICAL" ? "#B42318" : item.severity === "HIGH" ? "#C75B18" : "#A52A2A", width: `${kpis.totalIncidents ? Math.min(100, item.count / kpis.totalIncidents * 100) : 0}%` }} /></div><strong style={{ color: "#302725", fontSize: "0.78rem" }}>{item.count}</strong></div>)}</div>}
                </div>
              </Card>
              <Card style={{ borderRadius: "0.75rem" }}>
                <CardHeader title="Incidents by Type" subtitle="Aggregate breakdown returned by the security KPI API" />
                <div className="p-5">
                  {kpisLoading ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading report data...</p> : kpisError || !kpis ? <EmptyState icon={FileWarning} title="Report data unavailable" detail="The security KPI data could not be loaded." /> : kpis.incidentsByType.length === 0 ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>No data returned.</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{kpis.incidentsByType.map((item) => <div key={item.type} className="flex items-center justify-between rounded-lg border px-3 py-2.5" style={{ borderColor: "#EEE4E0", background: "#FCFAF9" }}><span style={{ color: "#665956", fontSize: "0.76rem" }}>{formatEventType(item.type)}</span><strong style={{ color: "#A52A2A", fontSize: "0.85rem" }}>{item.count}</strong></div>)}</div>}
                </div>
              </Card>
            </section>
            <Card style={{ borderRadius: "0.75rem" }}>
              <CardHeader title="Report Generation" subtitle="Security report export endpoints are not available in the current backend." />
              <div className="p-5"><EmptyState icon={FileWarning} title="Security reports unavailable" detail="The aggregate data above is available from the current KPI endpoint. Dedicated PDF and scheduled report generation are not connected." /></div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
