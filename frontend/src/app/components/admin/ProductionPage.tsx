import { useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ClipboardPlus, Edit2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, KPICard, Card, CardHeader, Btn, DataTable, TabBar } from "../shared/UI";
import { WorkforceManagement } from "./WorkforceManagement";
import { AttendancePanel } from "./workforce/AttendancePanel";
import { InlineNotice, LoadingLine } from "./workforce/formControls";
import { MonthlyTargetCard, currentMonth } from "./production/MonthlyTargetCard";
import {
  ACCEPTS_OUTPUT, CAN_DELETE, DeleteWorkOrderDialog, NEXT_STATUSES, RecordOutputDialog, STATUS_ACTION, WorkOrderDialog,
} from "./production/WorkOrderDialogs";
import { describeApiError } from "../../../lib/api";
import { getStoredBackendRole } from "../../../lib/auth";
import { useApiData } from "../../../lib/useApiData";
import { formatEfficiency, localIsoDate, productionPermissions, workforcePermissions } from "../../../lib/workforce";
import {
  getMonthlyPerformance, getProductionKPIs, getProductionTrend, getWorkOrders, transitionStatus,
  type WorkOrderDto, type WorkOrderStatus,
} from "../../../lib/services/production.service";
import { getDepartments } from "../../../lib/services/departments.service";
import { getEmployeeOutputSummary } from "../../../lib/services/workforce.service";

function formatQty(value: string | number) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : String(value);
}

export function ProductionPage() {
  const [tab, setTab] = useState("performance");
  const [addRequest, setAddRequest] = useState(0);
  const perms = useMemo(() => workforcePermissions(getStoredBackendRole()), []);
  const prod = useMemo(() => productionPermissions(getStoredBackendRole()), []);
  const today = localIsoDate();
  const thisMonth = currentMonth();
  const onPerformance = tab === "performance";
  const [targetMonth, setTargetMonth] = useState(thisMonth);
  const [targetCardKey, setTargetCardKey] = useState(0);
  const [newWorkOrder, setNewWorkOrder] = useState(false);
  const [outputFor, setOutputFor] = useState<WorkOrderDto | null>(null);
  const [editingOrder, setEditingOrder] = useState<WorkOrderDto | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<WorkOrderDto | null>(null);
  const [statusBusy, setStatusBusy] = useState<number | null>(null);

  // Each section loads, fails and retries on its own
  const kpis = useApiData(() => getProductionKPIs(), [], "load production KPIs", onPerformance);
  const trend = useApiData(() => getProductionTrend({ days: 7 }), [], "load the production trend", onPerformance);
  const workOrders = useApiData(
    () => getWorkOrders({ pageSize: 20, status: "all", sortBy: "createdAt", sortOrder: "desc" }),
    [], "load work orders", onPerformance,
  );
  const employeeOutput = useApiData(() => getEmployeeOutputSummary({ date: today }), [today], "load employee output", onPerformance);
  // This month's target and thresholds, for the KPI cards and the trend chart
  const monthTarget = useApiData(() => getMonthlyPerformance(thisMonth), [thisMonth], "load this month's target", onPerformance);
  const departments = useApiData(() => getDepartments(), [], "load departments", onPerformance && prod.createWorkOrders);

  // Everything derived from recorded output
  const reloadProduction = () => {
    kpis.reload(); trend.reload(); workOrders.reload(); monthTarget.reload();
    setTargetCardKey((n) => n + 1);
  };

  const changeStatus = async (wo: WorkOrderDto, status: WorkOrderStatus) => {
    const final = status === "COMPLETED" || status === "CANCELLED";
    if (!confirm(`${STATUS_ACTION[status]} ${wo.workOrderNumber} (${wo.product})?${final ? "\n\nThis cannot be undone." : ""}`)) return;
    setStatusBusy(wo.id);
    try {
      await transitionStatus(wo.id, status);
      toast.success(`${wo.workOrderNumber} is now ${status.replace("_", " ").toLowerCase()}.`);
      reloadProduction();
    } catch (err) {
      toast.error(describeApiError(err, `change the status of ${wo.workOrderNumber}`));
    } finally {
      setStatusBusy(null);
    }
  };

  const k = kpis.data;
  const kpiValue = (value: string | number | undefined) =>
    kpis.loading ? (kpis.waking ? "Starting…" : "Loading…") : kpis.error ? "Unavailable" : value === undefined ? "0" : String(value);
  const orders = workOrders.data?.data ?? [];
  const totalOrders = workOrders.data?.meta.total ?? 0;
  const trendData = trend.data ?? [];
  const trendHasOutput = trendData.some((t) => t.produced + t.rejected + t.scrap > 0);
  const out = employeeOutput.data;
  const target = monthTarget.data?.target ?? null;
  const completionNow = k ? parseFloat(k.overallCompletionRate) : NaN;
  const rejectionNow = k ? parseFloat(k.rejectionRate) : NaN;
  const vsTarget = (actual: number, limit: number | null | undefined, atLeast: boolean) => {
    if (limit == null || Number.isNaN(actual)) return {};
    const met = atLeast ? actual >= limit : actual <= limit;
    return { trend: `${met ? "Meets" : "Misses"} ${atLeast ? "≥" : "≤"} ${limit}%`, trendDir: met ? ("up" as const) : ("down" as const) };
  };
  const dailyTarget = target && monthTarget.data ? target.outputTarget / monthTarget.data.progress.daysInMonth : null;
  const showActions = prod.recordOutput || prod.changeWorkOrderStatus || prod.editWorkOrders || prod.deleteWorkOrders;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Production & Workforce Management"
        subtitle="Monitor output, workforce efficiency, and attendance across all departments"
        actions={
          perms.editEmployees ? (
            <Btn size="sm" onClick={() => { setTab("workforce"); setAddRequest((n) => n + 1); }}><Plus size={14} /> Add Employee</Btn>
          ) : undefined
        }
      />

      <TabBar
        tabs={[
          { id: "performance", label: "Company Performance" },
          { id: "workforce", label: "Workforce Management" },
          { id: "attendance", label: "Attendance" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {tab === "performance" && (
          <div>
            {kpis.waking && <div className="mb-3"><InlineNotice tone="info">The server is starting up after being idle. Data will appear in up to a minute.</InlineNotice></div>}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
              <KPICard label="Active Work Orders" value={kpiValue(k?.activeWorkOrders)} sub={k ? `${k.completedThisMonth} completed this month` : undefined} />
              <KPICard label="Produced (This Month)" value={kpiValue(k ? formatQty(k.totalProducedQty) : undefined)} sub={k ? `Work-order targets ${formatQty(k.totalTargetQty)}` : undefined} accent="#2E7D32" />
              <KPICard label="Completion Rate" value={kpiValue(k?.overallCompletionRate)} sub={k ? (target?.targetCompletionRate == null ? "No target set" : undefined) : undefined} accent="#1565C0" {...(k ? vsTarget(completionNow, target?.targetCompletionRate, true) : {})} />
              <KPICard label="Rejection Rate" value={kpiValue(k?.rejectionRate)} sub={k ? `${k.overdueWorkOrders} overdue WOs` : undefined} accent="#E65100" {...(k ? vsTarget(rejectionNow, target?.maxRejectionRate, false) : {})} />
            </div>
            {kpis.error && <div className="mb-5"><InlineNotice tone="error" onRetry={kpis.reload}>{kpis.error}</InlineNotice></div>}
            {!kpis.error && <div className="mb-5" />}

            <MonthlyTargetCard
              key={targetCardKey}
              month={targetMonth}
              onMonthChange={setTargetMonth}
              perms={prod}
              onSaved={() => monthTarget.reload()}
            />

            <Card className="mb-5">
              <CardHeader
                title="Employee Output Today"
                subtitle="Per-employee figures recorded in Workforce Management. Shown separately; not added to work-order totals."
              />
              <div className="p-5">
                {employeeOutput.loading ? <LoadingLine text="Loading employee output…" />
                  : employeeOutput.error ? <InlineNotice tone="error" onRetry={employeeOutput.reload}>{employeeOutput.error}</InlineNotice>
                    : !out || out.records === 0 ? (
                      <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>
                        No employee output has been recorded for today.{perms.editPerformance && " Record it from the Workforce Management tab (edit an employee)."}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                          ["Employees recorded", String(out.employeesRecorded)],
                          ["Expected parts", formatQty(out.totalExpectedParts)],
                          ["Produced parts", formatQty(out.totalProducedParts)],
                          ["Efficiency", formatEfficiency(out.efficiency)],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <p style={{ fontSize: "0.72rem", color: "#7A6C6A", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</p>
                            <p style={{ fontSize: "1.25rem", fontWeight: 700, color: "#1C1C1C" }}>{value}</p>
                          </div>
                        ))}
                      </div>
                    )}
              </div>
            </Card>

            <Card className="mb-5">
              <CardHeader
                title="Recent Work Orders"
                subtitle={workOrders.loading ? "Loading work orders…" : workOrders.error ? undefined : totalOrders > orders.length ? `Latest ${orders.length} of ${totalOrders}` : `${orders.length} work order${orders.length === 1 ? "" : "s"}`}
                actions={prod.createWorkOrders ? <Btn size="sm" onClick={() => setNewWorkOrder(true)}><Plus size={13} /> New Work Order</Btn> : undefined}
              />
              {workOrders.error ? (
                <div className="p-5"><InlineNotice tone="error" onRetry={workOrders.reload}>{workOrders.error}</InlineNotice></div>
              ) : (
                <DataTable
                  emptyMsg={workOrders.loading ? (workOrders.waking ? "The server is starting up…" : "Loading work orders…") : "No work orders have been created yet."}
                  columns={[
                    { key: "wo", label: "WO #" },
                    { key: "product", label: "Product" },
                    { key: "dept", label: "Department" },
                    { key: "target", label: "Target" },
                    { key: "produced", label: "Produced" },
                    { key: "rate", label: "Completion" },
                    { key: "priority", label: "Priority" },
                    { key: "status", label: "Status" },
                    ...(showActions ? [{ key: "actions", label: "Actions" }] : []),
                  ]}
                  rows={orders.map((wo) => ({
                    wo: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A", fontWeight: 600 }}>{wo.workOrderNumber}</span>,
                    product: <span style={{ fontWeight: 500, fontSize: "0.8rem" }}>{wo.product}</span>,
                    dept: <span style={{ fontSize: "0.8rem" }}>{wo.departmentName ?? <span style={{ color: "#9A8A88" }}>Unassigned</span>}</span>,
                    target: <span style={{ fontSize: "0.8rem" }}>{formatQty(wo.targetQuantity)} {wo.unit}</span>,
                    produced: <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{formatQty(wo.producedQty)}</span>,
                    rate: <span style={{ fontSize: "0.8rem", fontWeight: 700, color: parseFloat(wo.completionRate) >= 90 ? "#2E7D32" : "#E65100" }}>{wo.completionRate}</span>,
                    priority: <span className="px-2 py-0.5 rounded-full" style={{ fontSize: "0.68rem", fontWeight: 600, background: wo.priority === "URGENT" ? "#FFEBEE" : wo.priority === "HIGH" ? "#FFF3E0" : "#F5F5F5", color: wo.priority === "URGENT" ? "#C0392B" : wo.priority === "HIGH" ? "#E65100" : "#7A6C6A" }}>{wo.priority}</span>,
                    status: <span className="px-2 py-0.5 rounded-full" style={{ fontSize: "0.68rem", fontWeight: 600, background: wo.status === "COMPLETED" ? "#E8F5E9" : wo.status === "IN_PROGRESS" ? "#FFF3E0" : "#F5F5F5", color: wo.status === "COMPLETED" ? "#2E7D32" : wo.status === "IN_PROGRESS" ? "#E65100" : "#7A6C6A" }}>{wo.status.replace("_", " ")}</span>,
                    actions: (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {prod.recordOutput && ACCEPTS_OUTPUT.includes(wo.status) && (
                          <button type="button" onClick={() => setOutputFor(wo)} aria-label={`Record output on ${wo.workOrderNumber}`} title="Record output"
                            className="flex items-center gap-1 px-2 py-1 rounded" style={{ background: "#F5F0EF", color: "#4E342E", border: "none", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600 }}>
                            <ClipboardPlus size={12} /> Output
                          </button>
                        )}
                        {prod.changeWorkOrderStatus && NEXT_STATUSES[wo.status].length > 0 && (
                          <select aria-label={`Change status of ${wo.workOrderNumber}`} value="" disabled={statusBusy === wo.id}
                            onChange={(e) => { if (e.target.value) void changeStatus(wo, e.target.value as WorkOrderStatus); }}
                            style={{ fontSize: "0.72rem", padding: "0.2rem 0.4rem", border: "1px solid #E8E2E0", borderRadius: "0.375rem", background: "#fff" }}>
                            <option value="">{statusBusy === wo.id ? "Saving…" : "Status…"}</option>
                            {NEXT_STATUSES[wo.status].map((s) => <option key={s} value={s}>{STATUS_ACTION[s]}</option>)}
                          </select>
                        )}
                        {prod.editWorkOrders && (
                          <button type="button" onClick={() => setEditingOrder(wo)} aria-label={`Edit ${wo.workOrderNumber}`} title="Edit work order"
                            className="p-1.5 rounded" style={{ background: "#F5F0EF", color: "#4E342E", border: "none", cursor: "pointer" }}>
                            <Edit2 size={13} />
                          </button>
                        )}
                        {prod.deleteWorkOrders && (
                          <button type="button" onClick={() => setDeletingOrder(wo)} disabled={!CAN_DELETE(wo.status)}
                            aria-label={`Delete ${wo.workOrderNumber}`}
                            title={CAN_DELETE(wo.status) ? "Delete work order (administrators only)" : "Completed work orders cannot be deleted"}
                            className="p-1.5 rounded" style={{ background: "#FFEBEE", color: "#C0392B", border: "none", cursor: CAN_DELETE(wo.status) ? "pointer" : "not-allowed", opacity: CAN_DELETE(wo.status) ? 1 : 0.4 }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ),
                  }))}
                  paginate={8}
                  searchable
                />
              )}
            </Card>

            <Card className="mb-5">
              <CardHeader title="Weekly Production Trend" subtitle="Good, rejected and scrap quantities recorded against work orders, last 7 days" />
              <div className="p-5">
                {trend.loading ? <LoadingLine text={trend.waking ? "The server is starting up…" : "Loading production trend…"} />
                  : trend.error ? <InlineNotice tone="error" onRetry={trend.reload}>{trend.error}</InlineNotice>
                    : !trendHasOutput ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No work-order output has been recorded in the last 7 days.</p>
                      : (
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                            <Area id="prod-area-produced" type="monotone" dataKey="produced" stroke="#A52A2A" fill="#FDF5F5" strokeWidth={2} name="Produced" />
                            <Area id="prod-area-rejected" type="monotone" dataKey="rejected" stroke="#C0392B" fill="#FFEBEE" strokeWidth={1.5} name="Rejected" />
                            <Area id="prod-area-scrap" type="monotone" dataKey="scrap" stroke="#E65100" fill="#FFF3E0" strokeWidth={1.5} name="Scrap" />
                            {dailyTarget !== null && (
                              <ReferenceLine y={dailyTarget} stroke="#1565C0" strokeDasharray="6 4" label={{ value: `Daily target ${formatQty(Math.round(dailyTarget * 10) / 10)}`, position: "insideTopRight", fontSize: 10, fill: "#1565C0" }} />
                            )}
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
              </div>
            </Card>
          </div>
        )}

        {newWorkOrder && (
          <WorkOrderDialog
            departments={departments.data ?? []}
            onClose={() => setNewWorkOrder(false)}
            onSaved={(wo) => { toast.success(`${wo.workOrderNumber} created as a draft. Release it to start recording output.`); setNewWorkOrder(false); reloadProduction(); }}
          />
        )}
        {editingOrder && (
          <WorkOrderDialog
            key={editingOrder.id}
            departments={departments.data ?? []}
            workOrder={editingOrder}
            onClose={() => setEditingOrder(null)}
            onSaved={(wo) => { toast.success(`${wo.workOrderNumber} saved.`); setEditingOrder(null); reloadProduction(); }}
          />
        )}
        {deletingOrder && (
          <DeleteWorkOrderDialog
            key={deletingOrder.id}
            workOrder={deletingOrder}
            onCancel={() => setDeletingOrder(null)}
            onStale={reloadProduction}
            onDeleted={(message) => { toast.success(message); setDeletingOrder(null); reloadProduction(); }}
          />
        )}
        {outputFor && (
          <RecordOutputDialog
            workOrder={outputFor}
            onClose={() => setOutputFor(null)}
            onRecorded={(message) => { toast.success(message); setOutputFor(null); reloadProduction(); }}
          />
        )}

        {tab === "workforce" && <WorkforceManagement addRequest={addRequest} onAddHandled={() => setAddRequest(0)} />}

        {tab === "attendance" && <AttendancePanel />}
      </div>
    </div>
  );
}
