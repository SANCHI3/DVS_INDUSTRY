import { useState } from "react";
import { Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { Card, EmptyState, ErrorState, Skeleton, StatusBadge } from "../shared/UI";
import { useApiData } from "../../../lib/useApiData";
import { describeApiError } from "../../../lib/api";
import { telHref } from "../../../lib/company";
import {
  listInquiries,
  updateInquiryStatus,
  type InquiryDto,
  type InquiryStatus,
} from "../../../lib/services/inquiries.service";

const STATUS_LABEL: Record<InquiryStatus, string> = { NEW: "New", CONTACTED: "Contacted", CLOSED: "Closed" };
const STATUS_BADGE: Record<InquiryStatus, string> = { NEW: "pending", CONTACTED: "info", CLOSED: "completed" };
const FILTERS: Array<{ id: InquiryStatus | "ALL"; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "NEW", label: "New" },
  { id: "CONTACTED", label: "Contacted" },
  { id: "CLOSED", label: "Closed" },
];

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Messages sent from the website contact form, newest first. */
export function InquiriesPanel() {
  const [filter, setFilter] = useState<InquiryStatus | "ALL">("ALL");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<number, InquiryStatus>>({});
  const { data, loading, error, reload } = useApiData(
    () => listInquiries(filter === "ALL" ? undefined : filter),
    [filter],
    "load inquiries",
  );

  const changeStatus = async (inquiry: InquiryDto, status: InquiryStatus) => {
    setSavingId(inquiry.id);
    try {
      await updateInquiryStatus(inquiry.id, status);
      setOverrides((o) => ({ ...o, [inquiry.id]: status }));
      toast.success(`Marked as ${STATUS_LABEL[status].toLowerCase()}.`);
    } catch (err) {
      toast.error(describeApiError(err, "update the inquiry"));
    } finally {
      setSavingId(null);
    }
  };

  const rows = (data?.data ?? []).map((i) => ({ ...i, status: overrides[i.id] ?? i.status }));

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-4" role="group" aria-label="Filter inquiries by status">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => { setFilter(f.id); setOverrides({}); }}
            className="px-3 py-1.5 rounded-md"
            style={{ fontSize: "0.775rem", fontWeight: filter === f.id ? 600 : 400, background: filter === f.id ? "#A52A2A" : "#fff", color: filter === f.id ? "#fff" : "#4A4A4A", border: "1px solid #E8E2E0", cursor: "pointer" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Card><Skeleton lines={6} /></Card>
      ) : error ? (
        <Card><ErrorState message={error} onRetry={reload} /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState title="No inquiries yet" subtitle="Messages sent from the website's contact form appear here." /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((inq) => (
            <Card key={inq.id}>
              <div className="p-4 flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1C1C1C" }}>
                      {inq.name}{inq.company && <span style={{ fontWeight: 400, color: "#7A6C6A" }}> · {inq.company}</span>}
                    </p>
                    <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{formatWhen(inq.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={STATUS_BADGE[inq.status]} label={STATUS_LABEL[inq.status]} />
                    <label className="sr-only" htmlFor={`inq-status-${inq.id}`}>Status of inquiry from {inq.name}</label>
                    <select
                      id={`inq-status-${inq.id}`}
                      value={inq.status}
                      disabled={savingId === inq.id}
                      onChange={(e) => void changeStatus(inq, e.target.value as InquiryStatus)}
                      style={{ fontSize: "0.775rem", padding: "0.3rem 0.5rem", border: "1px solid #E8E2E0", borderRadius: "0.375rem", background: "#fff" }}
                    >
                      {(Object.keys(STATUS_LABEL) as InquiryStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </div>
                </div>
                <p style={{ fontSize: "0.8375rem", color: "#4A4A4A", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{inq.message}</p>
                <div className="flex flex-wrap gap-4" style={{ fontSize: "0.775rem" }}>
                  <a href={`mailto:${inq.email}`} className="inline-flex items-center gap-1.5" style={{ color: "#A52A2A", textDecoration: "none" }}>
                    <Mail size={13} /> {inq.email}
                  </a>
                  {inq.phone && (
                    <a href={telHref(inq.phone)} className="inline-flex items-center gap-1.5" style={{ color: "#A52A2A", textDecoration: "none" }}>
                      <Phone size={13} /> {inq.phone}
                    </a>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
