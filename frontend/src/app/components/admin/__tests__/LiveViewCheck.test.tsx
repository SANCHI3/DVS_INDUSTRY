// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const getLiveCheck = vi.fn();
const getLivePass = vi.fn();
vi.mock("../../../../lib/services/cameras.service", () => ({
  getLiveCheck: (...args: unknown[]) => getLiveCheck(...args),
  getLivePass: (...args: unknown[]) => getLivePass(...args),
}));
const testLive = vi.fn();
vi.mock("../../../../lib/liveStream", () => ({ testLive: (...args: unknown[]) => testLive(...args) }));

import { LiveViewCheck } from "../security/LiveViewCheck";
import {
  liveVerdict,
  testResultText,
  tokenRefusedText,
  versionText,
  type LiveCheck,
  type LiveCheckPlant,
} from "../../../../lib/liveCheck";

const NOW = new Date().toISOString();
const plant = (extra: Partial<LiveCheckPlant> = {}): LiveCheckPlant => ({
  id: "plant-pc", source: "LIVE", online: true, lastHeartbeatAt: NOW, version: null, liveUrl: null,
  liveUrlAccepted: false, startedAt: null, resumedAt: null, fromDatabase: false, infoFields: ["device"], ...extra,
});
const check = (p: LiveCheckPlant | null = plant(), live: "available" | "not-enabled" = "not-enabled"): LiveCheck => ({
  checkedAt: NOW,
  websiteStartedAt: NOW,
  plants: p ? [p] : [],
  cameras: [
    { id: "dvr-ch2", channel: 2, name: "Camera 02", status: "ONLINE", live },
    { id: "dvr-ch1", channel: 1, name: "Camera 01", status: "ONLINE", live },
  ],
  streamAuth: [],
});
const ready = check(plant({ liveUrl: "https://server.tail.ts.net", liveUrlAccepted: true }), "available");

beforeEach(() => {
  vi.clearAllMocks();
  getLiveCheck.mockResolvedValue(check());
});
afterEach(cleanup);

describe("what the check says", () => {
  it("names cctv-setup-5 when the plant reports no version", () => {
    expect(versionText(null)).toBe("cctv-setup-5 (no version reported)");
    expect(versionText("cctv-setup-10")).toBe("cctv-setup-10");
  });

  it("points at the first place live view stops", () => {
    expect(liveVerdict(check(null))).toMatch(/has not reported/);
    expect(liveVerdict(check(plant({ online: false })))).toMatch(/not reporting/);
    expect(liveVerdict(check())).toBe(
      "Live view is not switched on in the running plant software. Restart the plant computer once.",
    );
    expect(liveVerdict(check(plant({ liveUrl: "http://10.0.0.1:8889" })))).toMatch(/does not accept/);
    expect(liveVerdict(ready)).toMatch(/press Test live view/);
  });

  it("tells a refusal by the website from a video server that never asked", () => {
    const outcome = { result: "auth-refused" as const, detail: "HTTP 401" };
    const refused = { at: NOW, path: "dvr-ch1-sd", protocol: "hls", action: "read", allowed: false, reason: "expired" as const };
    expect(testResultText("hls", outcome, [refused])).toMatch(/asked the website and was refused \(refused: pass expired\)/);
    expect(testResultText("hls", outcome, [])).toMatch(/not calling \/cameras\/stream-auth/);
    expect(testResultText("webrtc", { result: "unreachable", detail: "network or CORS" }, [])).toMatch(/^WebRTC: server not reachable/);
    expect(testResultText("webrtc", { result: "no-video", detail: "x" }, [])).toMatch(/no video within 10 s/);
    expect(testResultText("hls", { result: "playing" }, [])).toBe("HLS: playing.");
    expect(tokenRefusedText("not-enabled")).toMatch(/^Token refused: not enabled/);
  });
});

describe("Live view check panel", () => {
  it("shows the facts from the last heartbeat", async () => {
    render(<LiveViewCheck />);
    await waitFor(() => expect(screen.getByTestId("live-verdict")).toBeTruthy());
    expect(screen.getByText("cctv-setup-5 (no version reported)")).toBeTruthy();
    expect(screen.getByText("No: the running software reported none")).toBeTruthy();
    expect(screen.getByText(/Not reported by this version/)).toBeTruthy();
    expect(screen.getAllByText(/Not enabled: the running plant software has no live address/)).toHaveLength(2);
    expect(screen.getByText(/None since/)).toBeTruthy();
  });

  it("lists the last stream-auth calls", async () => {
    getLiveCheck.mockResolvedValue({
      ...ready,
      streamAuth: [
        { at: NOW, path: "dvr-ch1-sd", protocol: "hls", action: "read", allowed: false, reason: "wrong-path" },
        { at: NOW, path: "dvr-ch1-sd", protocol: "webrtc", action: "read", allowed: true, reason: "allowed" },
      ],
    });
    render(<LiveViewCheck />);
    const log = await screen.findByTestId("stream-auth-log");
    expect(log.textContent).toMatch(/dvr-ch1-sd · hls · refused: pass is for another camera/);
    expect(log.textContent).toMatch(/dvr-ch1-sd · webrtc · allowed/);
  });

  it("stops at the token when the website gives none", async () => {
    getLivePass.mockResolvedValue({ available: false, reason: "not-enabled" });
    render(<LiveViewCheck />);
    fireEvent.click(await screen.findByRole("button", { name: /Test live view/ }));
    await waitFor(() => expect(screen.getByText(/Token refused: not enabled/)).toBeTruthy());
    expect(getLivePass).toHaveBeenCalledWith("dvr-ch1", "sd");
    expect(testLive).not.toHaveBeenCalled();
  });

  it("tests WebRTC and HLS separately on camera 1, and explains each", async () => {
    getLiveCheck.mockResolvedValue(ready);
    getLivePass.mockResolvedValue({ available: true, token: "t", whepUrl: "w", hlsUrl: "h", expiresAt: "" });
    testLive
      .mockResolvedValueOnce({ result: "no-video", detail: "WebRTC did not connect" })
      .mockResolvedValueOnce({ result: "playing" });
    render(<LiveViewCheck />);
    fireEvent.click(await screen.findByRole("button", { name: /Test live view/ }));
    await waitFor(() => expect(screen.getByText(/HLS: playing\./)).toBeTruthy());
    expect(screen.getByText(/WebRTC: connected, but no video within 10 s/)).toBeTruthy();
    expect(testLive.mock.calls.map((c) => c[0])).toEqual(["webrtc", "hls"]);
  });
});
