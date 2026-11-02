import { describe, it, expect } from "vitest";
import { cameraLine, liveBadgeState, monitoringBanner, shortAgo } from "../cameraStatus";
import type { CameraDto } from "../services/cameras.service";

const NOW = new Date("2026-11-04T15:00:00+05:30");

const cam = (over: Partial<CameraDto> = {}): CameraDto => ({
  id: "dvr-ch1", channel: 1, name: "Camera 01", zone: "Press shop", enabled: true,
  status: "ONLINE", statusDetail: null, statusSince: null, lastHeartbeatAt: null,
  lastFrameAt: new Date(NOW.getTime() - 20_000).toISOString(), achievedFps: 2.9, inferMs: 80,
  hasSnapshot: false, snapshotAt: null, lastDetection: null, sources: ["factory-pc"], duplicate: false, ...over,
});

describe("camera status text", () => {
  it("says how fresh the picture is", () => {
    expect(shortAgo(new Date(NOW.getTime() - 20_000).toISOString(), NOW.getTime())).toBe("20 s ago");
    expect(shortAgo(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW.getTime())).toBe("5 min ago");
    expect(shortAgo(null)).toBe("never");
    expect(cameraLine(cam(), NOW.getTime())).toBe("Last frame 20 s ago");
  });

  it("explains offline and no-video cameras", () => {
    const since = new Date("2026-11-04T14:32:00+05:30").toISOString();
    expect(cameraLine(cam({ status: "OFFLINE", statusSince: since }), NOW.getTime())).toMatch(/^Offline since \d\d:\d\d$/);
    expect(cameraLine(cam({ status: "VIDEO_LOSS", statusDetail: "Black picture" }))).toBe("Black picture");
  });
});

describe("monitoring PC", () => {
  it("shows one banner when the PC is silent, none otherwise", () => {
    const since = new Date("2026-11-04T14:32:00+05:30").toISOString();
    expect(monitoringBanner({ state: "offline", since, instances: [] }, NOW)).toMatch(/^CCTV monitoring PC is offline since \d\d:\d\d$/);
    expect(monitoringBanner({ state: "online", since: null, instances: [] }, NOW)).toBeNull();
    expect(monitoringBanner({ state: "never", since: null, instances: [] }, NOW)).toBeNull();
  });

  it("shows Live only when the cameras report and live updates are connected", () => {
    const online = { state: "online" as const, since: null, instances: [] };
    const offline = { state: "offline" as const, since: null, instances: [] };
    expect(liveBadgeState("live", online)).toBe("live");
    expect(liveBadgeState("live", offline)).toBe("cctv-offline");
    expect(liveBadgeState("offline", online)).toBe("offline");
    expect(liveBadgeState("live", null)).toBe("connecting");
  });
});
