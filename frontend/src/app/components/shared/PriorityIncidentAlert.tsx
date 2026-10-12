import { useEffect, useRef, useState } from "react";
import { AlertOctagon, ArrowRight, X } from "lucide-react";
import { subscribeSecurityStream, subscribeStreamStatus, type SecurityStreamEvent } from "../../../lib/securityStream";
import { getIncidents, type SecurityIncidentDto } from "../../../lib/services/security.service";
import { needsAttention } from "../../../lib/priorityRules";

function formatType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Short two-tone alarm; silently skipped if the browser blocks audio. */
function playAlarm() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i % 2 === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.22);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // audio is a nice-to-have
  }
}

export function PriorityIncidentAlert({ onView }: { onView: (incident: SecurityIncidentDto) => void }) {
  const [queue, setQueue] = useState<SecurityIncidentDto[]>([]);
  const shown = useRef(new Set<string>());

  useEffect(() => {
    const handle = (event: SecurityStreamEvent) => {
      const incident = needsAttention(event);
      if (!incident) return;
      const key = `${incident.id}:${incident.severity}`;
      if (shown.current.has(key)) return;
      shown.current.add(key);
      // A newer state of an incident already waiting replaces the old card.
      setQueue((current) => [...current.filter((i) => i.id !== incident.id), incident]);
      playAlarm();
    };

    // Catch-up: whenever the stream was not live (initial connect, a dropped
    // connection, a rate-limit pause), fetch what was created in that gap so
    // a priority incident is never silently missed.
    let gapStartedAt: number | null = Date.now();
    const unsubscribeStatus = subscribeStreamStatus((status) => {
      if (status !== "live") {
        gapStartedAt ??= Date.now();
        return;
      }
      if (gapStartedAt === null) return;
      // occurredAt is the detection time, which can precede the ERP record by
      // up to a minute (probable -> confirmed); `shown` prevents repeats.
      const fromDate = new Date(gapStartedAt - 60_000).toISOString();
      gapStartedAt = null;
      getIncidents({ fromDate, sortBy: "occurredAt", sortOrder: "asc", pageSize: 50 })
        .then(({ data }) => data.forEach((incident) => handle({ type: "incident.created", incident })))
        .catch(() => undefined);
    });
    const unsubscribe = subscribeSecurityStream(handle);
    return () => {
      unsubscribe();
      unsubscribeStatus();
    };
  }, []);

  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    const original = document.title;
    let flip = false;
    const timer = setInterval(() => {
      flip = !flip;
      document.title = flip ? `⚠ ${formatType(current.type)} ALERT` : original;
    }, 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQueue((q) => q.slice(1));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      document.title = original;
      window.removeEventListener("keydown", onKey);
    };
  }, [current]);

  if (!current) return null;

  const dismiss = () => setQueue((q) => q.slice(1));
  const view = () => {
    setQueue((q) => q.slice(1));
    onView(current);
  };
  const confidence = current.confidenceScore != null ? `${Math.round(current.confidenceScore * 100)}%` : "—";
  const occurred = new Date(current.occurredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="priority-alert-title"
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 1000, background: "rgba(28, 12, 10, 0.55)" }}
    >
      <div className="w-full overflow-hidden rounded-2xl" style={{ maxWidth: 460, background: "#fff", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ background: "#B71C1C", color: "#fff" }}>
          <AlertOctagon size={28} className="animate-pulse" />
          <div className="flex-1">
            <p style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.08em", opacity: 0.9 }}>PRIORITY SECURITY ALERT</p>
            <h2 id="priority-alert-title" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {formatType(current.type)} detected
            </h2>
          </div>
          <button onClick={dismiss} aria-label="Dismiss alert" style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4">
          <p style={{ fontSize: "0.875rem", color: "#302725", lineHeight: 1.55 }}>{current.description}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            {[
              ["Location", current.location ?? "Unknown"],
              ["Time", occurred],
              ["AI confidence", confidence],
              ["Severity", current.severity],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg px-3 py-2" style={{ background: "#FBF6F5" }}>
                <dt style={{ fontSize: "0.7rem", color: "#9A8A88" }}>{label}</dt>
                <dd style={{ fontSize: "0.875rem", fontWeight: 600, color: label === "Severity" && value === "CRITICAL" ? "#B71C1C" : "#1C1C1C" }}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3" style={{ fontSize: "0.72rem", color: "#9A8A88" }}>
            {current.incidentNumber}
            {queue.length > 1 && ` · ${queue.length - 1} more alert${queue.length > 2 ? "s" : ""} waiting`}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            onClick={dismiss}
            style={{ padding: "0.55rem 1.1rem", borderRadius: "0.5rem", border: "1px solid #D4BFBB", background: "#fff", color: "#4A4A4A", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}
          >
            Dismiss
          </button>
          <button
            onClick={view}
            autoFocus
            className="flex items-center gap-1.5"
            style={{ padding: "0.55rem 1.1rem", borderRadius: "0.5rem", border: "none", background: "#B71C1C", color: "#fff", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}
          >
            View incident <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
