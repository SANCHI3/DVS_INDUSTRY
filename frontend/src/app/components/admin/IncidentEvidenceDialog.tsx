import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "../shared/UI";
import {
  getIncidentEvidence,
  getIncidentEvidenceFile,
  type IncidentEvidence,
  type SecurityIncidentDto,
} from "../../../lib/services/security.service";
import { confidenceLabel, incidentHeadline } from "../../../lib/incidentLabels";
import { isAdministrator } from "../../../lib/auth";

const TIER_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed by the AI",
  PROBABLE: "Probable, awaiting confirmation",
};

const sectionTitle = { color: "#302725", fontSize: "0.8rem", fontWeight: 700, marginBottom: "0.5rem" } as const;
const muted = { color: "#837572", fontSize: "0.76rem", lineHeight: 1.55 } as const;

function EvidenceImage({ incidentId, file, alt }: { incidentId: number; file: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    getIncidentEvidenceFile(incidentId, file)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [incidentId, file]);
  return (
    <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg" style={{ background: "#F3EFEE", border: "1px solid #EEE4E0" }}>
      {url ? <img src={url} alt={alt} className="h-full w-full object-cover" /> : <span style={muted}>{failed ? "Image could not be loaded" : "Loading…"}</span>}
    </div>
  );
}

export function IncidentEvidenceDialog({ incident, onClose }: { incident: SecurityIncidentDto; onClose: () => void }) {
  const [evidence, setEvidence] = useState<IncidentEvidence | null>(null);
  const [error, setError] = useState(false);
  const admin = isAdministrator();

  useEffect(() => {
    let cancelled = false;
    setEvidence(null);
    setError(false);
    getIncidentEvidence(incident.id)
      .then((result) => !cancelled && setEvidence(result))
      .catch(() => !cancelled && setError(true));
    return () => { cancelled = true; };
  }, [incident.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const downloadClip = async (file: string) => {
    try {
      const url = URL.createObjectURL(await getIncidentEvidenceFile(incident.id, file));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.split("/").pop() ?? "clip.mp4";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Clip could not be downloaded");
    }
  };

  const ok = evidence?.available ? evidence : null;
  const keyframes = ok?.files.filter((f) => f.kind === "keyframe") ?? [];
  const gradcam = ok?.files.filter((f) => f.kind === "gradcam") ?? [];
  const clips = ok?.files.filter((f) => f.kind === "clip_before" || f.kind === "clip_after") ?? [];
  const summary = incident.aiSummary?.trim() || incident.description;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" style={{ background: "rgba(28, 20, 18, 0.45)" }} onClick={onClose} role="dialog" aria-modal="true" aria-label={`Incident ${incident.incidentNumber}`}>
      <div className="w-full max-w-4xl rounded-xl" style={{ background: "#FFFFFF", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: "#EEE4E0" }}>
          <div className="min-w-0 flex-1">
            <p style={{ color: "#A52A2A", fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem", fontWeight: 700 }}>{incident.incidentNumber}</p>
            <h2 style={{ color: "#302725", fontSize: "1.05rem", fontWeight: 700 }}>{incidentHeadline(incident)}{incident.location ? ` · ${incident.location}` : ""}</h2>
            <p style={muted}>{new Date(incident.occurredAt).toLocaleString("en-IN")}</p>
          </div>
          <StatusBadge status={incident.severity.toLowerCase()} />
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5" style={{ border: "none", background: "#F7F2F1", color: "#665956", cursor: "pointer" }}><X size={16} /></button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <section>
            <p style={sectionTitle}>{incident.aiSummary?.trim() ? "AI summary" : "Description"}</p>
            <p style={{ color: "#4A3F3D", fontSize: "0.85rem", lineHeight: 1.6 }}>{summary}</p>
            {ok?.recommendedAction && <p className="mt-2" style={{ color: "#4A3F3D", fontSize: "0.8rem" }}><strong>What to do:</strong> {ok.recommendedAction}</p>}
          </section>

          {!evidence && !error && <p style={muted}>Loading camera evidence…</p>}
          {error && <p style={{ color: "#C0392B", fontSize: "0.8rem" }}>Camera evidence could not be loaded.</p>}
          {evidence && !evidence.available && <p style={muted}>{evidence.reason}</p>}

          {ok && (
            <>
              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg p-4" style={{ background: "#FCFAF9", border: "1px solid #EEE4E0" }}>
                  <p style={sectionTitle}>How sure the AI is</p>
                  <p style={{ color: "#302725", fontSize: "0.95rem", fontWeight: 700 }}>{confidenceLabel(ok.confidenceScore)}</p>
                  <p style={muted}>{TIER_LABEL[ok.tier] ?? ok.tier}</p>
                  {admin && ok.confidenceBasis && <p className="mt-2" style={muted}><strong>Basis:</strong> {ok.confidenceBasis}</p>}
                </div>
                <div className="rounded-lg p-4" style={{ background: "#FCFAF9", border: "1px solid #EEE4E0" }}>
                  <p style={sectionTitle}>Why the AI raised it</p>
                  {ok.explanation.length === 0 ? <p style={muted}>No further explanation was recorded for this event type.</p> : (
                    <dl className="space-y-1.5">
                      {ok.explanation.map((item) => (
                        <div key={item.label} className="flex gap-2" style={{ fontSize: "0.78rem" }}>
                          <dt style={{ color: "#837572", minWidth: "9rem" }}>{item.label}</dt>
                          <dd style={{ color: "#302725", fontWeight: 600 }}>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </section>

              <section>
                <p style={sectionTitle}>Camera snapshots</p>
                {keyframes.length === 0 ? <p style={muted}>No snapshots were saved for this incident.</p> : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {keyframes.map((f, i) => <EvidenceImage key={f.file} incidentId={incident.id} file={f.file} alt={`Snapshot ${i + 1}`} />)}
                  </div>
                )}
              </section>

              {gradcam.length > 0 && (
                <section>
                  <p style={sectionTitle}>Where the fight model looked (Grad-CAM)</p>
                  <p className="mb-2" style={muted}>Red areas influenced the model's decision the most. It helps to check that the AI reacted to the people, not the background.</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {gradcam.map((f, i) => <EvidenceImage key={f.file} incidentId={incident.id} file={f.file} alt={`Grad-CAM heatmap ${i + 1}`} />)}
                  </div>
                </section>
              )}

              {clips.length > 0 && (
                <section>
                  <p style={sectionTitle}>Video clips</p>
                  <div className="flex flex-wrap gap-2">
                    {clips.map((f) => (
                      <button key={f.file} onClick={() => downloadClip(f.file)} className="flex items-center gap-1.5 rounded-md px-3 py-1.5" style={{ border: "1px solid #E7DEDA", background: "#FFFFFF", color: "#665956", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" }}>
                        <Download size={13} /> {f.kind === "clip_before" ? "5 s before the alert" : "5 s after the alert"}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {admin && ok.technical && (
                <details className="rounded-lg p-3" style={{ background: "#FAF8F7", border: "1px solid #EEE4E0" }}>
                  <summary style={{ color: "#665956", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" }}>Technical details (administrators only)</summary>
                  <pre className="mt-2 overflow-x-auto" style={{ color: "#4A3F3D", fontSize: "0.7rem", lineHeight: 1.5 }}>{JSON.stringify({ camera: ok.cameraId, tier: ok.tier, validation_version: ok.validationVersion, ...ok.technical }, null, 2)}</pre>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
