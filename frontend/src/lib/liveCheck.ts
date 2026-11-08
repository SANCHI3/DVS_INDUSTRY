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

export interface LiveCheckPlant {
  id: string;
  source: "LIVE" | "DEV";
  online: boolean;
  lastHeartbeatAt: string;
  version: string | null;
  liveUrl: string | null;
  liveUrlAccepted: boolean;
  startedAt: string | null;
  resumedAt: string | null;
  fromDatabase: boolean;
  infoFields: string[];
}

export interface LiveCheck {
  checkedAt: string;
  websiteStartedAt: string;
  plants: LiveCheckPlant[];
  cameras: Array<{ id: string; channel: number | null; name: string; status: string; live: "available" | LiveRefusal }>;
  streamAuth: StreamAuthEntry[];
}

/** The plant PC that matters: the live one heard most recently (the list comes sorted). */
export function mainPlant(check: LiveCheck): LiveCheckPlant | null {
  return check.plants.find((p) => p.source === "LIVE") ?? null;
}

/** cctv-setup-5 does not report its version; every later release does. */
export function versionText(version: string | null): string {
  return version ?? "cctv-setup-5 (no version reported)";
}

export const LIVE_RESULT_TEXT: Record<"available" | LiveRefusal, string> = {
  available: "Available: the website gives out a live pass",
  "monitoring-offline": "Monitoring offline: the plant computer is not reporting",
  "camera-offline": "Camera offline: nothing to play",
  "not-enabled": "Not enabled: the running plant software has no live address",
};

/** The one sentence at the top: where live view stops, and what to do. */
export function liveVerdict(check: LiveCheck): string {
  const plant = mainPlant(check);
  if (!plant) {
    return "The plant computer has not reported to the website yet. Wait a minute and press Refresh; if it stays empty, check the plant computer is on and has internet.";
  }
  if (!plant.online) {
    return "The plant computer is not reporting, so there is no live view. Check that it is on and has internet.";
  }
  if (!plant.liveUrl) {
    return "Live view is not switched on in the running plant software. Restart the plant computer once.";
  }
  if (!plant.liveUrlAccepted) {
    return `The plant reports a live address the website does not accept (${plant.liveUrl}). It must look like https://name.tailnet.ts.net: check LIVE_VIEW_URL on the plant computer.`;
  }
  if (check.cameras.length > 0 && !check.cameras.some((c) => c.live === "available")) {
    return "Every camera is offline, so there is nothing to play. Check the DVR and its cables.";
  }
  return "The website gives out live passes. If Live still does not play, press Test live view to see where it stops.";
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
  return `Token refused: ${LIVE_RESULT_TEXT[reason].toLowerCase()}.`;
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
