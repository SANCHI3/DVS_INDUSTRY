// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  failingCameras,
  isHealthy,
  liveVerdict,
  testResultText,
  tokenRefusedText,
  versionText,
  type CameraLive,
  type LiveCheck,
  type LiveCheckPlant,
} from "../../../../lib/liveCheck";

const NOW = new Date().toISOString();
const LIVE_URL = "https://server.tail.ts.net";
const plant = (extra: Partial<LiveCheckPlant> = {}): LiveCheckPlant => ({
  source: "LIVE", online: true, lastHeartbeatAt: NOW, liveReported: false, liveUrlAccepted: false,
  fromDatabase: false, ...extra,
});
const cams = (...live: CameraLive[]) =>
  live.map((l, i) => ({ id: `dvr-ch${i + 1}`, channel: i + 1, name: `Camera 0${i + 1}`, status: "ONLINE", live: l }));
/** What a regular admin gets: no technical part */
const check = (p: LiveCheckPlant | null = plant(), cameras = cams("not-enabled", "not-enabled")): LiveCheck => ({
  checkedAt: NOW, plants: p ? [p] : [], cameras,
});
const healthy = check(plant({ liveReported: true, liveUrlAccepted: true }), cams("available", "available"));
/** What support staff get */
const withTechnical = (c: LiveCheck, streamAuth: NonNullable<LiveCheck["technical"]>["streamAuth"] = []): LiveCheck => ({
  ...c,
  plants: c.plants.map((p) => ({
    ...p,
    technical: { id: "plant-pc", version: null, liveUrl: p.liveReported ? LIVE_URL : null, startedAt: null, resumedAt: null, infoFields: ["cpuPercent", "device"] },
  })),
  technical: { websiteStartedAt: NOW, streamAuth },
});

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
    expect(liveVerdict(check(null))).toMatch(/has not reported yet/);
    expect(liveVerdict(check(plant({ online: false })))).toBe(
      "The plant computer is not reporting, so there is no live view. Check that it is on and has internet.",
    );
    expect(liveVerdict(check())).toBe(
      "Live view is not switched on in the running plant software. Restart the plant computer once.",
    );
    expect(liveVerdict(check(plant({ liveReported: true })))).toMatch(/not in the right form\. Ask support/);
    expect(liveVerdict(check(plant({ liveReported: true, liveUrlAccepted: true }), cams("available", "camera-offline")))).toMatch(/Some cameras/);
  });

  it("is healthy only with the plant reporting and every camera live", () => {
    expect(isHealthy(healthy)).toBe(true);
    expect(isHealthy(check(plant({ online: false, liveReported: true, liveUrlAccepted: true }), cams("available")))).toBe(false);
    expect(isHealthy(check(plant({ liveReported: true, liveUrlAccepted: true }), cams("available", "camera-offline")))).toBe(false);
  });

  it("lists cameras only when some work and others do not, and only the failing ones", () => {
    expect(failingCameras(check(plant({ online: false }), cams("monitoring-offline", "monitoring-offline")))).toEqual([]);
    expect(failingCameras(check(plant(), cams("available", "camera-offline", "available"))).map((c) => c.id)).toEqual(["dvr-ch2"]);
  });

  it("tells a refusal by the website from a video server that never asked", () => {
    const outcome = { result: "auth-refused" as const, detail: "HTTP 401" };
    const refused = { at: NOW, path: "dvr-ch1-sd", protocol: "hls", action: "read", allowed: false, reason: "expired" as const };
    expect(testResultText("hls", outcome, [refused])).toMatch(/asked the website and was refused \(refused: pass expired\)/);
    expect(testResultText("hls", outcome, [])).toMatch(/not calling \/cameras\/stream-auth/);
    expect(testResultText("hls", { result: "playing" }, [])).toBe("HLS: playing.");
    expect(tokenRefusedText("not-enabled")).toMatch(/^Token refused: not enabled/);
  });
});

describe("Live view check panel, regular admin", () => {
  it("shows nothing when everything works", async () => {
    getLiveCheck.mockResolvedValue(healthy);
    const { container } = render(<LiveViewCheck />);
    await waitFor(() => expect(getLiveCheck).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.innerHTML).toBe("");
  });

  it("plant offline: the banner, when it was last seen and Refresh; no camera list, no technical details", async () => {
    getLiveCheck.mockResolvedValue(check(plant({ online: false }), cams(...Array(8).fill("monitoring-offline") as CameraLive[])));
    render(<LiveViewCheck />);
    expect((await screen.findByTestId("live-verdict")).textContent).toMatch(/plant computer is not reporting/);
    expect(screen.getByTestId("last-seen").textContent).toMatch(/^Plant computer last seen: .+\(.+\)$/);
    expect(screen.getByRole("button", { name: /Refresh/ })).toBeTruthy();
    expect(screen.queryByTestId("failing-cameras")).toBeNull();
    expect(screen.queryByText(/Camera 0/)).toBeNull();
    expect(screen.queryByTestId("technical-details")).toBeNull();
    expect(screen.queryByRole("button", { name: /Test live view/ })).toBeNull();
    // No internal words for regular admins
    const text = document.body.textContent ?? "";
    for (const word of ["heartbeat", "Heartbeat", "liveUrl", "cpuPercent", "saved before the website restarted", "ts.net"]) {
      expect(text).not.toContain(word);
    }
  });

  it("lists only the failing cameras, with their reason, when others work", async () => {
    getLiveCheck.mockResolvedValue(check(plant({ liveReported: true, liveUrlAccepted: true }), cams("available", "camera-offline", "available")));
    render(<LiveViewCheck />);
    const list = await screen.findByTestId("failing-cameras");
    expect(list.textContent).toBe("Camera 02 — No picture from the recorder for this camera");
  });

  it("checks again every minute, so it appears when a problem starts", async () => {
    vi.useFakeTimers();
    try {
      getLiveCheck.mockResolvedValue(healthy);
      render(<LiveViewCheck />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.queryByTestId("live-verdict")).toBeNull();
      getLiveCheck.mockResolvedValue(check(plant({ online: false })));
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.getByTestId("live-verdict")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checking while the tab is hidden", () => {
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("pauses the once-a-minute check while hidden, and checks at once when shown again", async () => {
    vi.useFakeTimers();
    try {
      getLiveCheck.mockResolvedValue(healthy);
      render(<LiveViewCheck />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(getLiveCheck).toHaveBeenCalledTimes(1);

      await act(async () => { setVisibility("hidden"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
      expect(getLiveCheck).toHaveBeenCalledTimes(1);

      await act(async () => { setVisibility("visible"); await vi.advanceTimersByTimeAsync(0); });
      expect(getLiveCheck).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(getLiveCheck).toHaveBeenCalledTimes(3);
    } finally {
      setVisibility("visible");
      vi.useRealTimers();
    }
  });

  it("does not start the minute timer when opened in a hidden tab", async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      render(<LiveViewCheck />);
      await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000); });
      expect(getLiveCheck).toHaveBeenCalledTimes(1);
    } finally {
      setVisibility("visible");
      vi.useRealTimers();
    }
  });

  it("stops checking once the panel is closed", async () => {
    vi.useFakeTimers();
    try {
      getLiveCheck.mockResolvedValue(healthy);
      const { unmount } = render(<LiveViewCheck />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      unmount();
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(getLiveCheck).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Live view check panel, support staff", () => {
  it("folds the technical details away by default", async () => {
    getLiveCheck.mockResolvedValue(withTechnical(check(plant({ liveReported: true }))));
    render(<LiveViewCheck />);
    const details = (await screen.findByTestId("technical-details")) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(LIVE_URL);
    expect(details.textContent).toContain("cctv-setup-5 (no version reported)");
    expect(details.textContent).toContain("cpuPercent, device");
    expect(screen.getByTestId("live-verdict").textContent).toContain(LIVE_URL);
  });

  it("keeps the panel, with the live test, even when everything works", async () => {
    getLiveCheck.mockResolvedValue(withTechnical(healthy));
    render(<LiveViewCheck />);
    expect((await screen.findByTestId("live-verdict")).textContent).toMatch(/ready for every camera/);
    expect(screen.getByRole("button", { name: /Test live view/ })).toBeTruthy();
  });

  it("lists the last calls from the plant's video server", async () => {
    getLiveCheck.mockResolvedValue(withTechnical(healthy, [
      { at: NOW, path: "dvr-ch1-sd", protocol: "hls", action: "read", allowed: false, reason: "wrong-path" },
      { at: NOW, path: "dvr-ch1-sd", protocol: "webrtc", action: "read", allowed: true, reason: "allowed" },
    ]));
    render(<LiveViewCheck />);
    const log = await screen.findByTestId("stream-auth-log");
    expect(log.textContent).toMatch(/dvr-ch1-sd · hls · refused: pass is for another camera/);
    expect(log.textContent).toMatch(/dvr-ch1-sd · webrtc · allowed/);
  });

  it("stops at the token when the website gives none", async () => {
    getLiveCheck.mockResolvedValue(withTechnical(check()));
    getLivePass.mockResolvedValue({ available: false, reason: "not-enabled" });
    render(<LiveViewCheck />);
    fireEvent.click(await screen.findByRole("button", { name: /Test live view/ }));
    await waitFor(() => expect(screen.getByText(/Token refused: not enabled/)).toBeTruthy());
    expect(getLivePass).toHaveBeenCalledWith("dvr-ch1", "sd");
    expect(testLive).not.toHaveBeenCalled();
  });

  it("tests WebRTC and HLS separately on camera 1, and explains each", async () => {
    getLiveCheck.mockResolvedValue(withTechnical(healthy));
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
