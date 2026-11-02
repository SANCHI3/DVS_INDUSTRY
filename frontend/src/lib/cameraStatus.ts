import type { CameraDto, CameraStatus, MonitoringDto } from "./services/cameras.service";

export const CAMERA_STATUS: Record<CameraStatus, { label: string; color: string; background: string }> = {
  ONLINE: { label: "Online", color: "#2E7D32", background: "#E8F5E9" },
  CONNECTING: { label: "Connecting", color: "#8A6D00", background: "#FFF8E1" },
  OFFLINE: { label: "Offline", color: "#B42318", background: "#FCE5E2" },
  VIDEO_LOSS: { label: "No video", color: "#7A5B00", background: "#FFF0C7" },
};

/** "20 s ago", "4 min ago", "3 h ago", "2 days ago". */
export function shortAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "14:32" today, otherwise "3 Nov, 14:32". */
export function clockTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`;
}

/** The one banner for the whole page when the monitoring PC is silent (not 8 errors). */
export function monitoringBanner(monitoring: MonitoringDto | null | undefined, now: Date = new Date()): string | null {
  if (!monitoring || monitoring.state !== "offline") return null;
  return monitoring.since
    ? `CCTV monitoring PC is offline since ${clockTime(monitoring.since, now)}`
    : "CCTV monitoring PC is offline";
}

/** Text under a tile: why it is offline / no video, or how recent the picture is. */
export function cameraLine(camera: CameraDto, now: number = Date.now()): string {
  if (camera.status === "OFFLINE") return camera.statusSince ? `Offline since ${clockTime(camera.statusSince, new Date(now))}` : "Offline";
  if (camera.status === "VIDEO_LOSS") return camera.statusDetail ?? "No picture from this camera";
  if (camera.status === "CONNECTING") return "Connecting to the camera…";
  return `Last frame ${shortAgo(camera.lastFrameAt, now)}`;
}

/** "Live" only when the cameras report AND live updates are connected. */
export function liveBadgeState(
  stream: "live" | "connecting" | "offline" | "forbidden",
  monitoring: MonitoringDto | null | undefined,
): "live" | "connecting" | "offline" | "forbidden" | "cctv-offline" {
  if (stream !== "live") return stream;
  if (monitoring === undefined) return stream; // camera status unavailable: say what we know
  if (monitoring === null) return "connecting"; // still loading
  return monitoring.state === "online" ? "live" : "cctv-offline";
}
