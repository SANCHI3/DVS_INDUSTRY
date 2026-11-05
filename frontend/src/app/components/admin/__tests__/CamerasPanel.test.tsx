// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../../lib/services/cameras.service", () => ({
  getCameraSnapshot: vi.fn().mockResolvedValue(new Blob(["x"], { type: "image/jpeg" })),
}));

import { CamerasPanel } from "../security/CamerasPanel";
import type { CameraDto, CamerasOverview } from "../../../../lib/services/cameras.service";

afterEach(cleanup);

const cam = (n: number, over: Partial<CameraDto> = {}): CameraDto => ({
  id: `dvr-ch${n}`, channel: n, name: `Camera 0${n}`, zone: n === 1 ? "Press shop" : null, enabled: true,
  status: "ONLINE", statusDetail: null, statusSince: null, lastHeartbeatAt: null,
  lastFrameAt: new Date().toISOString(), achievedFps: 3, inferMs: 90, hasSnapshot: false, snapshotAt: null,
  lastDetection: null, sources: ["factory-pc"], duplicate: false, ...over,
});

const overview = (cameras: CameraDto[]): CamerasOverview => ({
  cameras, monitoring: { state: "online", since: null, instances: [] },
});

describe("Cameras tab", () => {
  it("explains that live video stays in the EZVIZ app before any camera reports", () => {
    render(<CamerasPanel overview={overview([])} loading={false} error={null} onSelect={() => {}} />);
    expect(screen.getByText("No cameras connected yet")).toBeTruthy();
    expect(screen.getByText(/live video on request/)).toBeTruthy();
  });

  it("shows each camera's status and opens its incidents on click", () => {
    const onSelect = vi.fn();
    render(
      <CamerasPanel
        overview={overview([
          cam(1),
          cam(2, { status: "VIDEO_LOSS", statusDetail: "Black picture" }),
          cam(3, { status: "OFFLINE", duplicate: true, sources: ["factory-pc", "dev-laptop"] }),
        ])}
        loading={false}
        error={null}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("1 of 3 cameras online.", { exact: false })).toBeTruthy();
    expect(screen.getByText("No video")).toBeTruthy();
    expect(screen.getByText("Black picture")).toBeTruthy();
    expect(screen.getByText(/Also watched by dev-laptop/)).toBeTruthy();
    expect(screen.getByText(/Press shop · Channel 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Camera 02: No video/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "dvr-ch2" }));
  });

  it("says plainly when the cameras could not be loaded", () => {
    render(<CamerasPanel overview={null} loading={false} error="Could not load the cameras: no connection." onSelect={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load the cameras");
  });
});
