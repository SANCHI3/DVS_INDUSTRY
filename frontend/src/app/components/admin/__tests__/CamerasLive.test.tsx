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
import { getCameraSnapshot, type CameraDto, type CamerasOverview } from "../../../../lib/services/cameras.service";

const camera = (n: number): CameraDto => ({
  id: `dvr-ch${n}`, channel: n, name: `Camera 0${n}`, zone: null, enabled: true, status: "ONLINE",
  statusDetail: null, statusSince: null, lastHeartbeatAt: null, lastFrameAt: null, achievedFps: 2,
  inferMs: 80, hasSnapshot: false, snapshotAt: null, lastDetection: null, sources: [], duplicate: false,
});
const getSnapshot = vi.mocked(getCameraSnapshot);
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

describe("when live view cannot start", () => {
  const watch = () => fireEvent.click(screen.getByRole("button", { name: "Watch Camera 01 live" }));

  it.each([
    ["monitoring-offline", "Monitoring PC offline"],
    ["not-enabled", "Live view starts after the plant computer restarts"],
    ["camera-offline", "Camera offline"],
  ])("says so plainly for %s", async (reason, text) => {
    getLivePass.mockResolvedValue({ available: false, reason });
    panel(overview(1));
    watch();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(text));
  });

  it("keeps the latest picture on screen and can try again", async () => {
    URL.createObjectURL = vi.fn(() => "blob:picture");
    URL.revokeObjectURL = vi.fn();
    playLive.mockRejectedValueOnce(new Error("no video"));
    const o = overview(1);
    o.cameras[0] = { ...o.cameras[0]!, hasSnapshot: true, snapshotAt: new Date().toISOString() };
    panel(o);
    watch();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Could not start, try again"));
    await waitFor(() => expect(screen.getByAltText("Latest picture from Camera 01")).toBeTruthy());
    expect(getSnapshot).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(playLive).toHaveBeenCalledTimes(2));
  });
});

describe("plant computer offline", () => {
  const offline = (offlineAlert: boolean): CamerasOverview => ({
    ...overview(1),
    monitoring: { state: "offline", since: "2026-11-06T13:12:00Z", lastSeenAt: "2026-11-06T13:12:00Z", offlineAlert, instances: [] },
  });

  it("shows the red banner once the alert is raised", () => {
    panel(offline(true));
    expect(screen.getByRole("alert").textContent).toMatch(/Plant computer offline since .*Check that it is on and has internet\./);
  });

  it("stays quiet before 10 minutes, but still says when it was last seen", () => {
    panel(offline(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Last seen/)).toBeTruthy();
  });
});

describe("plant software line", () => {
  const withMonitoring = (extra: Partial<CamerasOverview["monitoring"]>): CamerasOverview => ({
    ...overview(1),
    monitoring: { state: "online", since: null, instances: [], ...extra },
  });

  it("shows the version, the last check and a waiting update", () => {
    panel(withMonitoring({ version: "cctv-setup-9", lastUpdateCheck: new Date().toISOString(), updateWaiting: "cctv-setup-10" }));
    const line = screen.getByText(/Plant software: cctv-setup-9/).textContent;
    expect(line).toContain("Last update check");
    expect(line).toContain("Update waiting: cctv-setup-10 (installs tonight)");
  });

  it("works with plant software that sends only its version", () => {
    panel(withMonitoring({ version: "cctv-setup-7" }));
    expect(screen.getByText("Plant software: cctv-setup-7")).toBeTruthy();
  });

  it("says when updates are off, and shows nothing with no version", () => {
    panel(withMonitoring({ version: "cctv-setup-9", updatesOff: true }));
    expect(screen.getByText(/Automatic updates are off/)).toBeTruthy();
    cleanup();
    panel(withMonitoring({}));
    expect(screen.queryByText(/Plant software/)).toBeNull();
  });
});

describe("renaming a camera", () => {
  it("has no Edit button without permission", () => {
    panel(overview(1));
    expect(screen.queryByRole("button", { name: "Edit Camera 01" })).toBeNull();
  });

  it("saves the name and area", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<CamerasPanel overview={overview(1)} loading={false} error={null} onSelect={() => {}} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Camera 01" }));
    fireEvent.change(screen.getByLabelText("Camera name"), { target: { value: "Store aisle" } });
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "Warehouse" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "dvr-ch1" }), { name: "Store aisle", zone: "Warehouse" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says so when saving fails, and keeps what was typed", async () => {
    const onRename = vi.fn().mockRejectedValue(new Error("no"));
    render(<CamerasPanel overview={overview(1)} loading={false} error={null} onSelect={() => {}} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Camera 01" }));
    fireEvent.change(screen.getByLabelText("Camera name"), { target: { value: "Store aisle" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not save. Try again."));
    expect((screen.getByLabelText("Camera name") as HTMLInputElement).value).toBe("Store aisle");
  });
});
