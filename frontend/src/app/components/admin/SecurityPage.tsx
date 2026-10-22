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
  transitionIncidentStatus,
  assignIncident,
  type SecurityKPIs,
  type SecurityIncidentDto,
} from "../../../lib/services/security.service";
import { getEligibleEmployees, type UserDto } from "../../../lib/services/users.service";
import { subscribeSecurityStream, subscribeStreamStatus, type StreamStatus } from "../../../lib/securityStream";
import { eventTypeLabel, incidentHeadline, isRetiredIncidentType } from "../../../lib/incidentLabels";
import { detectionCountsByType, sortNeedsAttention, upsertUnresolved } from "../../../lib/needsAttention";
import { IncidentEvidenceDialog } from "./IncidentEvidenceDialog";

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
  description: string;
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
  if (error || value === undefined) return "Couldn't load";
  return String(value);
}

const AI_REPORTER = "Perception Service";

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
  // Unresolved incidents, loaded separately so older open ones are not lost
  // behind the 50 newest in `incidents`.
  const [unresolved, setUnresolved] = useState<SecurityIncidentDto[]>([]);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [unresolvedLoading, setUnresolvedLoading] = useState(true);
  const [kpisError, setKpisError] = useState(false);
  const [incidentsError, setIncidentsError] = useState(false);
  const [unresolvedError, setUnresolvedError] = useState(false);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [usersError, setUsersError] = useState(false);
  const [assigningIncidentId, setAssigningIncidentId] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);

  const loadAll = () => {
    setKpisLoading(true);
    setIncidentsLoading(true);
    setUnresolvedLoading(true);
    setKpisError(false);
    setIncidentsError(false);
    setUnresolvedError(false);

    Promise.allSettled([
      getSecurityKPIs(),
      getIncidents({ pageSize: 50, sortBy: "occurredAt", sortOrder: "desc" }),
      getIncidents({ status: "OPEN", pageSize: 100, sortBy: "occurredAt", sortOrder: "desc" }),
      getIncidents({ status: "INVESTIGATING", pageSize: 100, sortBy: "occurredAt", sortOrder: "desc" }),
      getEligibleEmployees(),
    ]).then(([kpiResult, incidentResult, openResult, investigatingResult, userResult]) => {
      if (kpiResult.status === "fulfilled") setKpis(kpiResult.value);
      else setKpisError(true);
      if (incidentResult.status === "fulfilled") setIncidents(incidentResult.value.data);
      else setIncidentsError(true);
      if (openResult.status === "fulfilled" && investigatingResult.status === "fulfilled") {
        setUnresolved([...openResult.value.data, ...investigatingResult.value.data]);
      } else setUnresolvedError(true);
      if (userResult.status === "fulfilled") setUsers(userResult.value.filter((user) => user.isActive));
      else setUsersError(true);
      setKpisLoading(false);
      setIncidentsLoading(false);
      setUnresolvedLoading(false);
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
        setUnresolved((current) => current.filter((incident) => incident.id !== event.incidentId));
      } else {
        const changed = event.incident;
        setIncidents((current) => {
          const exists = current.some((incident) => incident.id === changed.id);
          if (exists) return current.map((incident) => (incident.id === changed.id ? changed : incident));
          return [changed, ...current];
        });
        setUnresolved((current) => upsertUnresolved(current, changed));
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
    location: incident.location ?? "—",
    type: formatEventType(incident.type),
    aiSummary: incident.aiSummary?.trim() || null,
    description: incident.description,
    confidence: incident.confidenceScore === null ? "—" : `${Math.round(incident.confidenceScore * 100)}%`,
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
  const needsAttention = sortNeedsAttention(unresolved.filter((incident) => incident.reportedByName === AI_REPORTER));
  const latestDetections = incidents.filter((incident) => incident.reportedByName === AI_REPORTER).slice(0, 6);
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId)
    ?? unresolved.find((incident) => incident.id === selectedIncidentId)
    ?? null;

  // Incident actions apply the server's returned row and refresh only the KPIs
  // (the live stream keeps the rest current) -- a full reload per click would
  // spend 5 requests and could exhaust the API rate limit during triage.
  const applyIncident = (updated: SecurityIncidentDto) => {
    setIncidents((current) => current.map((incident) => (incident.id === updated.id ? updated : incident)));
    setUnresolved((current) => upsertUnresolved(current, updated));
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
          subtitle="Incidents detected by the CCTV AI appear here as they happen. Open an incident to see the camera snapshots and why the AI raised it."
          actions={
            <>
              <LiveBadge status={streamStatus} />
              <Btn variant="secondary" size="sm" onClick={loadAll}><RefreshCw size={14} /> Refresh</Btn>
            </>
          }
        />

        <section className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KPICard label="Open Incidents" value={kpiValue(kpisLoading, kpisError, kpis?.openIncidents)} sub={kpis ? `${kpis.investigatingIncidents} investigating` : undefined} icon={FileWarning} accent="#A52A2A" />
          <KPICard label="Needs Attention" value={kpiValue(kpisLoading, kpisError, kpis ? kpis.openIncidents + kpis.investigatingIncidents : undefined)} sub={kpis ? `${kpis.criticalOpenIncidents} critical` : undefined} icon={AlertTriangle} accent="#C0392B" />
          <KPICard label="Resolved This Month" value={kpiValue(kpisLoading, kpisError, kpis?.resolvedThisMonth)} icon={CheckCircle2} accent="#2E7D32" />
          <KPICard label="Total Incidents" value={kpiValue(kpisLoading, kpisError, kpis?.totalIncidents)} sub={kpis ? `${kpis.criticalIncidents} critical` : undefined} icon={Zap} accent="#A52A2A" />
        </section>

        <div className="mb-6 flex items-end justify-between gap-4 border-b" style={{ borderColor: "#E7DEDA" }}>
          <TabBar tabs={tabs} active={tab} onChange={setTab} />
          <span className="hidden pb-2 text-right md:block" style={{ color: "#9A8A88", fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>Security workspace</span>
        </div>

        {tab === "live" && (
          <div className="space-y-5">
            <Card style={{ borderRadius: "0.75rem" }}>
              <CardHeader title="Latest AI Detections" subtitle="Newest incidents reported by the CCTV perception service; updates live" actions={<LiveBadge status={streamStatus} />} />
              <div className="p-5">
                {incidentsLoading ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading detections...</p> : incidentsError ? <p style={{ color: "#C0392B", fontSize: "0.82rem" }}>Unable to load incidents.</p> : latestDetections.length === 0 ? <EmptyState icon={Camera} title="No AI detections yet" detail="When the perception service (camera or demo mode) confirms an event, it appears here within seconds together with a pop-up alert." /> : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {latestDetections.map((incident) => (
                      <button key={incident.id} onClick={() => setSelectedIncidentId(incident.id)} className="rounded-lg border p-4 text-left" style={{ borderColor: "#EEE4E0", background: "#FCFAF9", cursor: "pointer" }}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span style={{ color: "#302725", fontSize: "0.84rem", fontWeight: 700 }}>{formatEventType(incident.type)}</span>
                          <StatusBadge status={incident.severity.toLowerCase()} />
                        </div>
                        <p style={{ color: "#837572", fontSize: "0.72rem" }}>{incident.location ?? "—"} · {new Date(incident.occurredAt).toLocaleString("en-IN")}</p>
                        <p className="mt-2 line-clamp-2" style={{ color: "#665956", fontSize: "0.75rem", lineHeight: 1.45 }}>{incident.aiSummary?.trim() || incident.description}</p>
                        <p className="mt-2" style={{ color: "#A52A2A", fontSize: "0.72rem", fontWeight: 600 }}>View evidence →</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Card style={{ borderRadius: "0.75rem" }}>
                <CardHeader title="Needs Attention" subtitle="Open and investigating AI incidents, most urgent first; updates live" actions={<StatusBadge status={needsAttention.length ? "critical" : "neutral"} label={unresolvedLoading ? "Loading" : `${needsAttention.length} open`} />} />
                <div className="p-5">
                  {unresolvedLoading ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading open incidents...</p> : unresolvedError ? <p style={{ color: "#C0392B", fontSize: "0.82rem" }}>Unable to load open incidents.</p> : needsAttention.length === 0 ? <EmptyState icon={Shield} title="All clear: no open incidents" detail="New AI detections that need a response appear here as soon as the cameras report them." /> : (
                    <div className="space-y-2">
                      {needsAttention.slice(0, 5).map((incident) => (
                        <div key={incident.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center" style={{ borderColor: "#EEE4E0", background: incident.severity === "CRITICAL" ? "#FFF8F7" : "#FFFCF4" }}>
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: incident.severity === "CRITICAL" ? "#FCE5E2" : "#FFF0C7", color: incident.severity === "CRITICAL" ? "#B42318" : "#9A6700" }}><AlertTriangle size={17} /></div>
                          <div className="min-w-0 flex-1"><p className="truncate" style={{ color: "#302725", fontSize: "0.84rem", fontWeight: 700 }}>{incidentHeadline(incident)}</p><p style={{ color: "#837572", fontSize: "0.73rem" }}>{incident.location ?? "Location unavailable"} · {new Date(incident.occurredAt).toLocaleString("en-IN")}</p></div>
                          <StatusBadge status={incident.severity.toLowerCase()} />
                          <Btn size="sm" variant="secondary" onClick={() => setSelectedIncidentId(incident.id)}>View evidence <ArrowRight size={12} /></Btn>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              <Card style={{ borderRadius: "0.75rem" }}>
                <CardHeader title="Detection Summary" subtitle="Incident counts from the security KPI API" />
                <div className="space-y-4 p-5">
                  {kpisLoading ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading detection summary...</p> : kpisError || !kpis ? <EmptyState icon={FileWarning} title="Summary unavailable" detail="The security KPI data could not be loaded." /> : (
                    <>
                      {[
                        { label: "Detections today", value: kpis.detectionsToday },
                        { label: "Open", value: kpis.openIncidents },
                        { label: "Investigating", value: kpis.investigatingIncidents },
                        { label: "Resolved this month", value: kpis.resolvedThisMonth },
                        { label: "Critical (open)", value: kpis.criticalOpenIncidents },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between border-b pb-3" style={{ borderColor: "#EEE4E0" }}><span style={{ color: "#837572", fontSize: "0.78rem" }}>{item.label}</span><strong style={{ color: "#302725", fontSize: "1.15rem" }}>{item.value}</strong></div>
                      ))}
                      <div>
                        <p className="mb-2" style={{ color: "#9A8A88", fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>Today by type</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {detectionCountsByType(kpis.incidentsTodayByType).map((item) => (
                            <div key={item.label} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: "#EEE4E0", background: "#FCFAF9" }}><span style={{ color: "#665956", fontSize: "0.76rem" }}>{item.label}</span><strong style={{ color: "#A52A2A", fontSize: "0.85rem" }}>{item.count}</strong></div>
                          ))}
                        </div>
                      </div>
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
              <CardHeader title="Incident Center" subtitle="Click an incident ID to see the camera evidence and the AI's explanation. Confidence is shown for AI-detected incidents." actions={<span style={{ color: "#9A8A88", fontSize: "0.72rem" }}>{filteredIncidents.length} records</span>} />
              <DataTable
                searchable
                paginate={10}
                emptyMsg={incidentsLoading ? "Loading incidents..." : incidentsError ? "Unable to load incidents." : "No incidents available."}
                columns={[{ key: "id", label: "Incident ID" }, { key: "datetime", label: "Date & Time" }, { key: "location", label: "Location" }, { key: "type", label: "Event Type" }, { key: "aiSummary", label: "AI Summary" }, { key: "confidence", label: "Confidence" }, { key: "severity", label: "Severity" }, { key: "status", label: "Status" }, { key: "assigned", label: "Assigned To" }, { key: "actions", label: "Actions" }]}
                rows={filteredIncidents.map((incident) => ({
                  id: <button onClick={() => setSelectedIncidentId(incident.numericId)} title="View evidence" style={{ color: "#A52A2A", fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem", fontWeight: 700, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" }}>{incident.id}</button>,
                  datetime: <div><p style={{ color: "#302725", fontSize: "0.78rem", fontWeight: 600 }}>{incident.dateTime.date}</p><p style={{ color: "#9A8A88", fontSize: "0.7rem" }}>{incident.dateTime.time}</p></div>,
                  location: <span style={{ fontSize: "0.78rem" }}>{incident.location}</span>,
                  type: <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{incident.type}</span>,
                  aiSummary: incident.aiSummary ? <span style={{ color: "#665956", display: "block", fontSize: "0.75rem", lineHeight: 1.45, maxWidth: "18rem" }}>{incident.aiSummary}</span> : <span title="No AI summary; showing the built-in description" style={{ color: "#9A8A88", display: "block", fontSize: "0.74rem", lineHeight: 1.45, maxWidth: "18rem" }}>{incident.description}</span>,
                  confidence: <span style={{ color: incident.confidence === "—" ? "#AAA09D" : "#665956", fontSize: "0.74rem", fontWeight: 600 }}>{incident.confidence}</span>,
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
                  {kpisLoading ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading report data...</p> : kpisError || !kpis ? <EmptyState icon={FileWarning} title="Report data unavailable" detail="The security KPI data could not be loaded." /> : kpis.incidentsByType.filter((item) => !isRetiredIncidentType(item.type)).length === 0 ? <p style={{ color: "#837572", fontSize: "0.82rem" }}>No data returned.</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{kpis.incidentsByType.filter((item) => !isRetiredIncidentType(item.type)).map((item) => <div key={item.type} className="flex items-center justify-between rounded-lg border px-3 py-2.5" style={{ borderColor: "#EEE4E0", background: "#FCFAF9" }}><span style={{ color: "#665956", fontSize: "0.76rem" }}>{formatEventType(item.type)}</span><strong style={{ color: "#A52A2A", fontSize: "0.85rem" }}>{item.count}</strong></div>)}</div>}
                </div>
              </Card>
            </section>
          </div>
        )}
      </div>
      {selectedIncident && <IncidentEvidenceDialog incident={selectedIncident} onClose={() => setSelectedIncidentId(null)} />}
    </main>
  );
}
