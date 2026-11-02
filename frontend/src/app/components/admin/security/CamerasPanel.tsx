import { useEffect, useState } from "react";
import { Camera, CameraOff, Copy } from "lucide-react";
import { getCameraSnapshot, type CameraDto, type CamerasOverview } from "../../../../lib/services/cameras.service";
import { CAMERA_STATUS, cameraLine, shortAgo } from "../../../../lib/cameraStatus";
import { eventTypeLabel } from "../../../../lib/incidentLabels";

/** The latest picture of one camera, fetched with the sign-in token. */
function Snapshot({ camera }: { camera: CameraDto }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!camera.hasSnapshot) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    getCameraSnapshot(camera.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setFailed(false);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // A new picture arrives every ~2 minutes: refetch when its time changes
  }, [camera.id, camera.hasSnapshot, camera.snapshotAt]);

  const dim = camera.status !== "ONLINE";
  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-t-lg" style={{ aspectRatio: "16 / 10", background: "#1F1A19" }}>
      {url && !failed ? (
        <img src={url} alt={`Latest picture from ${camera.name}`} className="h-full w-full object-cover" style={{ opacity: dim ? 0.45 : 1 }} />
      ) : (
        <span className="flex flex-col items-center gap-1" style={{ color: "#BFB3B0", fontSize: "0.72rem" }}>
          {camera.status === "ONLINE" ? <Camera size={22} aria-hidden="true" /> : <CameraOff size={22} aria-hidden="true" />}
          {camera.hasSnapshot ? (failed ? "Picture could not be loaded" : "Loading picture…") : "No picture yet"}
        </span>
      )}
      {camera.snapshotAt && url && (
        <span className="absolute bottom-1.5 right-1.5 rounded px-1.5 py-0.5" style={{ background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: "0.62rem" }}>
          Picture {shortAgo(camera.snapshotAt)}
        </span>
      )}
    </div>
  );
}

export function CameraTile({ camera, onSelect }: { camera: CameraDto; onSelect: (camera: CameraDto) => void }) {
  const status = CAMERA_STATUS[camera.status];
  return (
    <button
      type="button"
      onClick={() => onSelect(camera)}
      aria-label={`${camera.name}: ${status.label}. Show its incidents`}
      className="hover-card flex flex-col rounded-lg border text-left"
      style={{ borderColor: "#EEE4E0", background: "#FFFFFF", cursor: "pointer", opacity: camera.enabled ? 1 : 0.6 }}
    >
      <Snapshot camera={camera} />
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate" style={{ color: "#302725", fontSize: "0.85rem", fontWeight: 700 }}>{camera.name}</span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: status.background, color: status.color, fontSize: "0.68rem", fontWeight: 700 }}>
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: status.color }} />
            {status.label}
          </span>
        </div>
        <span style={{ color: "#837572", fontSize: "0.72rem" }}>
          {[camera.zone || "Area not set", camera.channel ? `Channel ${camera.channel}` : null].filter(Boolean).join(" · ")}
        </span>
        <span style={{ color: camera.status === "ONLINE" ? "#665956" : status.color, fontSize: "0.72rem" }}>
          {cameraLine(camera)}
          {camera.status === "ONLINE" && camera.achievedFps !== null ? ` · ${camera.achievedFps.toFixed(1)} fps` : ""}
        </span>
        <span style={{ color: "#9A8A88", fontSize: "0.7rem" }}>
          {camera.lastDetection
            ? `Last detection: ${eventTypeLabel(camera.lastDetection.type)} · ${shortAgo(camera.lastDetection.occurredAt)}`
            : "No detections yet"}
        </span>
        {camera.duplicate && (
          <span className="flex items-center gap-1" style={{ color: "#8A6D00", fontSize: "0.68rem" }} title={camera.sources.join(", ")}>
            <Copy size={11} aria-hidden="true" /> Also watched by {camera.sources.slice(1).join(", ")} (not counted twice)
          </span>
        )}
      </div>
    </button>
  );
}

export function CamerasPanel({ overview, loading, error, onSelect }: {
  overview: CamerasOverview | null;
  loading: boolean;
  error: string | null;
  onSelect: (camera: CameraDto) => void;
}) {
  if (!overview) {
    if (loading) return <p style={{ color: "#837572", fontSize: "0.82rem" }}>Loading cameras…</p>;
    return <p role="alert" style={{ color: "#C0392B", fontSize: "0.82rem" }}>{error ?? "Cameras could not be loaded."}</p>;
  }
  if (overview.cameras.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-lg border px-6 py-12 text-center" style={{ borderColor: "#EEE4E0", background: "#FCFAF9" }}>
        <CameraOff size={28} color="#A52A2A" aria-hidden="true" />
        <p className="mt-3" style={{ color: "#302725", fontSize: "0.95rem", fontWeight: 700 }}>No cameras connected yet</p>
        <p className="mt-1 max-w-md" style={{ color: "#837572", fontSize: "0.78rem", lineHeight: 1.6 }}>
          The factory cameras appear here once the CCTV monitoring PC is running. Live video stays in the EZVIZ app and on the recorder's monitor;
          this page shows a picture from each camera every couple of minutes.
        </p>
      </div>
    );
  }
  const online = overview.cameras.filter((c) => c.status === "ONLINE").length;
  return (
    <div className="space-y-3">
      <p style={{ color: "#837572", fontSize: "0.76rem" }}>
        {online} of {overview.cameras.length} cameras online. Pictures refresh every couple of minutes; live video stays in the EZVIZ app.
        Click a camera to see its incidents.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overview.cameras.map((camera) => <CameraTile key={camera.id} camera={camera} onSelect={onSelect} />)}
      </div>
    </div>
  );
}
