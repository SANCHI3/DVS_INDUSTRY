// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../lib/services/security.service", () => ({
  getIncidentEvidence: vi.fn(),
  getIncidentEvidenceFile: vi.fn().mockResolvedValue(new Blob(["x"], { type: "image/jpeg" })),
}));

import { getIncidentEvidence } from "../../../../lib/services/security.service";
import { IncidentEvidenceDialog } from "../IncidentEvidenceDialog";
import type { SecurityIncidentDto } from "../../../../lib/services/security.service";

const incident = {
  id: 7, incidentNumber: "INC-20261104-ABC123", title: "fire_smoke", description: "Fire seen near the press",
  aiSummary: "Flames seen near press 3.", type: "FIRE_SMOKE", confidenceScore: 0.82, severity: "CRITICAL",
  status: "OPEN", location: "Camera 03 (Press shop)", departmentName: null, reportedByName: "Perception Service",
  assignedToId: null, assignedToName: null, occurredAt: "2026-11-04T09:00:00Z", resolvedAt: null, closedAt: null,
  rootCause: null, correctiveAction: null, createdAt: "2026-11-04T09:00:00Z", _count: { updates: 0, alerts: 0 },
} as unknown as SecurityIncidentDto;

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("View evidence", () => {
  it("shows the summary at once and says plainly when there are no snapshots", async () => {
    (getIncidentEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: false, reason: "Camera snapshots are not available for this incident.",
    });
    render(<IncidentEvidenceDialog incident={incident} onClose={() => {}} />);
    expect(screen.getByText("Flames seen near press 3.")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Camera snapshots are not available for this incident.")).toBeTruthy());
  });

  it("captions the pictures from the factory PC before / at / after", async () => {
    (getIncidentEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: true, incidentId: "INC-20261104-ABC123", cameraId: "dvr-ch3", eventType: "fire_smoke", tier: "CONFIRMED",
      confidenceScore: 0.82, confidenceBasis: null, validationVersion: 2, recommendedAction: null, explanation: [],
      files: [
        { file: "db:1", kind: "keyframe", label: "before" },
        { file: "db:2", kind: "keyframe", label: "at" },
        { file: "db:3", kind: "keyframe", label: "after" },
      ],
    });
    render(<IncidentEvidenceDialog incident={incident} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("At the alert")).toBeTruthy());
    expect(screen.getByText("Before")).toBeTruthy();
    expect(screen.getByText("After")).toBeTruthy();
  });
});
