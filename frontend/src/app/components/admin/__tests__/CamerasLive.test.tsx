// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const getLivePass = vi.fn();
vi.mock("../../../../lib/services/cameras.service", () => ({
  getCameraSnapshot: vi.fn(() => Promise.resolve(new Blob())),
  getLivePass: (...args: unknown[]) => getLivePass(...args),
}));
const stopStream = vi.fn();
const playLive = vi.fn();
vi.mock("../../../../lib/liveStream", () => ({ playLive: (...args: unknown[]) => playLive(...args) }));

import { CamerasPanel } from "../security/CamerasPanel";
import type { CameraDto, CamerasOverview } from "../../../../lib/services/cameras.service";

const camera = (n: number): CameraDto => ({
  id: `dvr-ch${n}`, channel: n, name: `Camera 0${n}`, zone: null, enabled: true, status: "ONLINE",
  statusDetail: null, statusSince: null, lastHeartbeatAt: null, lastFrameAt: null, achievedFps: 2,
  inferMs: 80, hasSnapshot: false, snapshotAt: null, lastDetection: null, sources: [], duplicate: false,
});
const overview = (count: number, notice: string | null = null): CamerasOverview => ({
  cameras: Array.from({ length: count }, (_, i) => camera(i + 1)),
  monitoring: { state: "online", since: null, notice, liveEnabled: true, instances: [] },
});
const panel = (o: CamerasOverview) => render(<CamerasPanel overview={o} loading={false} error={null} onSelect={() => {}} />);

beforeEach(() => {
  vi.clearAllMocks();
  getLivePass.mockResolvedValue({ available: true, token: "t", whepUrl: "w", hlsUrl: "h", expiresAt: "" });
  playLive.mockResolvedValue(stopStream);
});

afterEach(cleanup);

describe("live view on the Cameras tab", () => {
  it("goes from Connecting to Live, and stops the video when closed", async () => {
    panel(overview(1));
    fireEvent.click(screen.getByRole("button", { name: "Watch Camera 01 live" }));
    expect(screen.getByRole("status").textContent).toBe("Connecting…");
    await waitFor(() => expect(screen.getByText("Live")).toBeTruthy());
    expect(getLivePass).toHaveBeenCalledWith("dvr-ch1", "sd");
    fireEvent.click(screen.getByRole("button", { name: "Stop live video from Camera 01" }));
    expect(stopStream).toHaveBeenCalled();
  });

  it("switches to HD on request", async () => {
    panel(overview(1));
    fireEvent.click(screen.getByRole("button", { name: "Watch Camera 01 live" }));
    await waitFor(() => expect(playLive).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "HD" }));
    await waitFor(() => expect(getLivePass).toHaveBeenCalledWith("dvr-ch1", "hd"));
  });

  it.each([
    ["monitoring-offline", "Monitoring PC offline"],
    ["camera-offline", "Camera offline"],
  ])("says so clearly: %s", async (reason, text) => {
    getLivePass.mockResolvedValue({ available: false, reason });
    panel(overview(1));
    fireEvent.click(screen.getByRole("button", { name: "Watch Camera 01 live" }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(playLive).not.toHaveBeenCalled();
  });

  it("allows 4 live tiles per viewer", async () => {
    panel(overview(5));
    for (let n = 1; n <= 5; n++) {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: `Watch Camera 0${n} live` })); });
    }
    expect(screen.getByRole("alert").textContent).toContain("up to 4 cameras");
    expect(getLivePass).toHaveBeenCalledTimes(4);
  });

  it("shows when the recorder moved to a new address", () => {
    panel(overview(1, "DVR address changed to 192.168.0.112"));
    expect(screen.getByText(/DVR address changed to 192\.168\.0\.112/)).toBeTruthy();
  });
});
