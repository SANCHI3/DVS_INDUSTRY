/**
 * Plain words for the admin Live view check: what the website knows about the
 * plant's live video, and what each test result means you should do.
 */
import type { LiveProtocol, LiveTestOutcome } from "./liveStream";

export type LiveRefusal = "monitoring-offline" | "camera-offline" | "not-enabled";
export type StreamAuthReason = "allowed" | "no-pass" | "expired" | "invalid" | "wrong-path" | "not-viewing";

export interface StreamAuthEntry {
  at: string;
  path: string;
  protocol: string;
  action: string;
  allowed: boolean;
  reason: StreamAuthReason;
}

/** Technical facts about one plant PC: only sent to support staff (DIAGNOSTICS_EMAILS). */
export interface LiveCheckPlantTechnical {
  id: string;
  version: string | null;
  /** The plant's internal live address: the server never sends it to other users */
  liveUrl: string | null;
  startedAt: string | null;
  resumedAt: string | null;
  infoFields: string[];
}

export interface LiveCheckPlant {
  source: "LIVE" | "DEV";
  online: boolean;
  lastHeartbeatAt: string;
  /** The running plant software reports a live address */
  liveReported: boolean;
  liveUrlAccepted: boolean;
  fromDatabase: boolean;
  technical?: LiveCheckPlantTechnical;
}

export type CameraLive = "available" | LiveRefusal;

export interface LiveCheck {
  checkedAt: string;
  plants: LiveCheckPlant[];
  cameras: Array<{ id: string; channel: number | null; name: string; status: string; live: CameraLive }>;
  /** Present only for support staff: the panel then shows "Technical details" */
  technical?: { websiteStartedAt: string; streamAuth: StreamAuthEntry[] };
}

/** The plant PC that matters: the live one heard most recently (the list comes sorted). */
export function mainPlant(check: LiveCheck): LiveCheckPlant | null {
  return check.plants.find((p) => p.source === "LIVE") ?? null;
}

/** cctv-setup-5 does not report its version; every later release does. */
export function versionText(version: string | null): string {
  return version ?? "cctv-setup-5 (no version reported)";
}

/** Plain words for why one camera cannot be watched live. */
export const LIVE_RESULT_TEXT: Record<CameraLive, string> = {
  available: "Live view works",
  "monitoring-offline": "The plant computer that serves this camera is not reporting",
  "camera-offline": "No picture from the recorder for this camera",
  "not-enabled": "Live view is not switched on for this camera",
};

/** Plant reporting, live view switched on and every camera live: nothing to show. */
export function isHealthy(check: LiveCheck): boolean {
  const plant = mainPlant(check);
  return (
    plant !== null && plant.online && plant.liveReported && plant.liveUrlAccepted &&
    check.cameras.length > 0 && check.cameras.every((c) => c.live === "available")
  );
}

/**
 * Cameras to list one by one: only when some work and some do not. When they
 * all share one problem the banner already says it.
 */
export function failingCameras(check: LiveCheck): LiveCheck["cameras"] {
  const failing = check.cameras.filter((c) => c.live !== "available");
  return failing.length > 0 && failing.length < check.cameras.length ? failing : [];
}

/** The one sentence at the top: where live view stops, and what to do. */
export function liveVerdict(check: LiveCheck): string {
  const plant = mainPlant(check);
  if (!plant) {
    return "The plant computer has not reported yet. Wait a minute and press Refresh; if nothing changes, check that it is on and has internet.";
  }
  if (!plant.online) {
    return "The plant computer is not reporting, so there is no live view. Check that it is on and has internet.";
  }
  if (!plant.liveReported) {
    return "Live view is not switched on in the running plant software. Restart the plant computer once.";
  }
  if (!plant.liveUrlAccepted) {
    const address = plant.technical?.liveUrl ? ` (${plant.technical.liveUrl})` : "";
    return `The plant computer's live view setting is not in the right form${address}. Ask support to check it on the plant computer.`;
  }
  if (check.cameras.length > 0 && !check.cameras.some((c) => c.live === "available")) {
    return "Every camera is offline, so there is nothing to play. Check the recorder (DVR) and its cables.";
  }
  if (failingCameras(check).length > 0) {
    return "Some cameras cannot be watched live. The ones below need attention.";
  }
  return "Live view is ready for every camera. If it still does not play, press Test live view to see where it stops.";
}

export const STREAM_AUTH_REASON_TEXT: Record<StreamAuthReason, string> = {
  allowed: "allowed",
  "no-pass": "refused: no pass sent",
  expired: "refused: pass expired",
  invalid: "refused: pass not valid",
  "wrong-path": "refused: pass is for another camera or quality",
  "not-viewing": "refused: not a request to watch",
};

/** The website's own answer before any video: no pass means the test cannot start. */
export function tokenRefusedText(reason: LiveRefusal): string {
  return `Token refused: ${reason.replace("-", " ")}. ${LIVE_RESULT_TEXT[reason]}.`;
}

/**
 * One protocol's test result. `calls` are the stream-auth calls the website got
 * for this protocol during the test: they tell "refused by us" from "never asked".
 */
export function testResultText(protocol: LiveProtocol, outcome: LiveTestOutcome, calls: StreamAuthEntry[]): string {
  const name = protocol === "webrtc" ? "WebRTC" : "HLS";
  switch (outcome.result) {
    case "playing":
      return `${name}: playing.`;
    case "unreachable":
      return `${name}: server not reachable (${outcome.detail}). Your browser could not reach the plant's video server: Tailscale Funnel may be off, the video server may not be running, or the browser blocked it (CORS).`;
    case "auth-refused": {
      const refused = calls.find((c) => !c.allowed);
      if (refused) {
        return `${name}: auth refused. The plant's video server asked the website and was refused (${STREAM_AUTH_REASON_TEXT[refused.reason]}).`;
      }
      if (calls.length > 0) {
        return `${name}: auth refused, although the website allowed it. The video server refused for another reason; check its log on the plant computer.`;
      }
      return `${name}: auth refused without asking the website. The plant's video server is not calling /cameras/stream-auth: it is running with old settings. Restart the plant computer once.`;
    }
    case "server-error":
      return `${name}: the video server answered with an error (${outcome.detail}). ${outcome.detail.includes("404") ? "It does not know this camera, or it is not the plant's video server." : "Check that the video server runs on the plant computer."}`;
    case "no-video":
      return `${name}: connected, but no video within 10 s (${outcome.detail}). ${protocol === "webrtc" ? "This network may block WebRTC; HLS should still work. " : ""}If both fail this way, the plant computer may not be getting the picture from the DVR.`;
  }
}
