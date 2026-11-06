import { useState, type FormEvent } from "react";
import { AlertTriangle, CameraOff, Copy, Info, Pencil, Video } from "lucide-react";
import type { CameraDto, CamerasOverview } from "../../../../lib/services/cameras.service";
import { CAMERA_STATUS, cameraLine, plantOfflineBanner, shortAgo } from "../../../../lib/cameraStatus";
import { eventTypeLabel } from "../../../../lib/incidentLabels";
import { CameraSnapshot } from "./CameraSnapshot";
import { LivePlayer } from "./LivePlayer";

export const MAX_LIVE_TILES = 4;

/** Admin only: the name and area shown everywhere. Empty goes back to the plant's. */
function CameraEditForm({ camera, onSave, onClose }: {
  camera: CameraDto;
  onSave: (names: { name: string; zone: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(camera.name === camera.plantName ? "" : camera.name);
  const [zone, setZone] = useState(camera.zone === (camera.plantZone ?? null) ? "" : camera.zone ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = { borderColor: "#EEE4E0", color: "#302725", fontSize: "0.8rem" };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFailed(false);
    try {
      await onSave({ name: name.trim(), zone: zone.trim() });
      onClose();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };
  return (
    <form role="dialog" aria-label={`Edit ${camera.name}`} onSubmit={save} className="absolute inset-0 z-10 flex flex-col gap-2 overflow-auto rounded-lg p-3" style={{ background: "#FFFFFF" }}>
      <label style={{ color: "#665956", fontSize: "0.72rem", fontWeight: 600 }}>
        Camera name
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={camera.plantName ?? camera.name} className="mt-1 w-full rounded border px-2 py-1" style={field} />
      </label>
      <label style={{ color: "#665956", fontSize: "0.72rem", fontWeight: 600 }}>
        Area
        <input value={zone} maxLength={100} onChange={(e) => setZone(e.target.value)} placeholder={camera.plantZone ?? "e.g. Store aisle"} className="mt-1 w-full rounded border px-2 py-1" style={field} />
      </label>
      {failed && <p role="alert" style={{ color: "#B42318", fontSize: "0.72rem" }}>Could not save. Try again.</p>}
      <div className="mt-auto flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded px-2 py-1" style={{ color: "#665956", fontSize: "0.74rem", cursor: "pointer" }}>Cancel</button>
        <button type="submit" disabled={saving} className="rounded px-2 py-1" style={{ background: "#A52A2A", color: "#fff", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export function CameraTile({ camera, onSelect, live = false, onLive, onStopLive, onRename }: {
  camera: CameraDto;
  onSelect: (camera: CameraDto) => void;
  live?: boolean;
  onLive?: () => void;
  onStopLive?: () => void;
  onRename?: (names: { name: string; zone: string }) => Promise<void>;
}) {
  const status = CAMERA_STATUS[camera.status];
  const [editing, setEditing] = useState(false);
  return (
    <div className="hover-card relative flex flex-col rounded-lg border text-left" style={{ borderColor: "#EEE4E0", background: "#FFFFFF", opacity: camera.enabled ? 1 : 0.6 }}>
      {live && <LivePlayer camera={camera} onClose={() => onStopLive?.()} />}
      <button
        type="button"
        onClick={() => onSelect(camera)}
        aria-label={`${camera.name}: ${status.label}. Show its incidents`}
        className="flex flex-1 flex-col text-left"
        style={{ cursor: "pointer" }}
      >
      {!live && <CameraSnapshot camera={camera} />}
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
      {!live && onLive && (
        <button
          type="button"
          onClick={onLive}
          aria-label={`Watch ${camera.name} live`}
          className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded px-2 py-1"
          style={{ background: "#A52A2A", color: "#fff", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}
        >
          <Video size={12} aria-hidden="true" /> Live
        </button>
      )}
      {!live && onRename && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${camera.name}`}
          className="absolute left-1.5 top-1.5 flex items-center rounded p-1"
          style={{ background: "rgba(0,0,0,0.55)", color: "#fff", cursor: "pointer" }}
        >
          <Pencil size={12} aria-hidden="true" />
        </button>
      )}
      {editing && onRename && <CameraEditForm camera={camera} onSave={onRename} onClose={() => setEditing(false)} />}
    </div>
  );
}

export function CamerasPanel({ overview, loading, error, onSelect, onRename }: {
  overview: CamerasOverview | null;
  loading: boolean;
  error: string | null;
  onSelect: (camera: CameraDto) => void;
  /** Admins only: without it there is no Edit button */
  onRename?: (camera: CameraDto, names: { name: string; zone: string }) => Promise<void>;
}) {
  const [liveIds, setLiveIds] = useState<string[]>([]);
  const [limitHit, setLimitHit] = useState(false);
  const startLive = (id: string) => {
    if (liveIds.length >= MAX_LIVE_TILES) { setLimitHit(true); return; }
    setLiveIds([...liveIds, id]);
  };
  const stopLive = (id: string) => {
    setLimitHit(false);
    setLiveIds(liveIds.filter((other) => other !== id));
  };

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
          The factory cameras appear here once the CCTV monitoring PC is running. This page then shows a picture from each camera
          every couple of minutes, and live video on request.
        </p>
      </div>
    );
  }
  const online = overview.cameras.filter((c) => c.status === "ONLINE").length;
  const offlineBanner = plantOfflineBanner(overview.monitoring);
  const { lastSeenAt, version } = overview.monitoring;
  return (
    <div className="space-y-3">
      {offlineBanner && (
        <p role="alert" className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: "#FBECEA", color: "#8C1D18", border: "1px solid #F2C4BE", fontSize: "0.8rem", fontWeight: 600 }}>
          <AlertTriangle size={15} aria-hidden="true" /> {offlineBanner}
        </p>
      )}
      <p style={{ color: "#837572", fontSize: "0.76rem" }}>
        {online} of {overview.cameras.length} cameras online. Pictures refresh every couple of minutes.
        Press Live to watch a camera, or click a camera to see its incidents.
        {lastSeenAt ? ` Last seen ${shortAgo(lastSeenAt)}.` : ""}
        {version ? ` Plant software ${version}.` : ""}
      </p>
      {overview.monitoring.notice && (
        <p role="status" className="flex items-center gap-1.5 rounded-md px-3 py-2" style={{ background: "#FFF8E1", color: "#7A5B00", fontSize: "0.76rem" }}>
          <Info size={13} aria-hidden="true" /> {overview.monitoring.notice}
        </p>
      )}
      {limitHit && (
        <p role="alert" style={{ color: "#B42318", fontSize: "0.76rem" }}>
          You can watch up to {MAX_LIVE_TILES} cameras at once. Stop one first.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overview.cameras.map((camera) => (
          <CameraTile
            key={camera.id}
            camera={camera}
            onSelect={onSelect}
            live={liveIds.includes(camera.id)}
            onLive={() => startLive(camera.id)}
            onStopLive={() => stopLive(camera.id)}
            onRename={onRename && ((names) => onRename(camera, names))}
          />
        ))}
      </div>
    </div>
  );
}
