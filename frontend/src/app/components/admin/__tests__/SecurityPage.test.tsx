// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as SecurityModule from "../../../../lib/services/security.service";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../../lib/auth", () => ({ getStoredBackendRole: vi.fn(), isAdministrator: vi.fn(() => true) }));
vi.mock("../../../../lib/securityStream", () => ({
  subscribeSecurityStream: vi.fn(() => () => {}),
  subscribeStreamStatus: vi.fn((listener: (s: string) => void) => { listener("live"); return () => {}; }),
}));
vi.mock("../../../../lib/services/users.service", () => ({ getEligibleEmployees: vi.fn().mockResolvedValue([{ id: 7, fullName: "Ravi Patil", isActive: true }]) }));
vi.mock("../../../../lib/csv", () => ({ downloadCSV: vi.fn() }));
vi.mock("../../../../lib/services/security.service", async (importOriginal) => ({
  ...(await importOriginal<typeof SecurityModule>()),
  getSecurityKPIs: vi.fn(),
  getIncidents: vi.fn(),
  bulkIncidentAction: vi.fn(),
}));

import { getStoredBackendRole } from "../../../../lib/auth";
import { downloadCSV } from "../../../../lib/csv";
import { bulkIncidentAction, getIncidents, getSecurityKPIs, type SecurityIncidentDto } from "../../../../lib/services/security.service";
import { SecurityPage, timeAgo } from "../SecurityPage";

const incident = (id: number, overrides: Partial<SecurityIncidentDto> = {}): SecurityIncidentDto => ({
  id, incidentNumber: `INC-${id}`, title: "fall", description: "A person fell", aiSummary: "=HYPERLINK(\"x\")",
  type: "FALL", confidenceScore: 0.8, severity: "HIGH", status: "OPEN", location: "Press shop",
  departmentId: null, departmentName: null, reportedById: 4, reportedByName: "Perception Service",
  assignedToId: null, assignedToName: null, occurredAt: "2026-10-17T09:41:35.000Z", resolvedAt: null, closedAt: null,
  rootCause: null, correctiveAction: null, createdAt: "", updatedAt: "", deletedAt: null, _count: { updates: 0, alerts: 0 },
  ...overrides,
} as SecurityIncidentDto);

const list = [
  incident(1),
  incident(2, { severity: "CRITICAL", type: "FIRE_SMOKE" }),
  incident(3, { status: "RESOLVED", falseAlarm: true, falseAlarmReason: "reflection" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/#security-incidents");
  vi.mocked(getStoredBackendRole).mockReturnValue("ADMIN");
  vi.mocked(getSecurityKPIs).mockResolvedValue({ totalIncidents: 3, openIncidents: 2, investigatingIncidents: 0, resolvedThisMonth: 1, criticalIncidents: 1, criticalOpenIncidents: 1, detectionsToday: 0, incidentsByType: [], incidentsBySeverity: [], incidentsTodayByType: [] } as never);
  vi.mocked(getIncidents).mockImplementation((params) => Promise.resolve({
    data: params?.status ? list.filter((i) => i.status === params.status) : list,
    meta: { page: 1, pageSize: 100, total: 3, totalPages: 1 },
  }));
  vi.mocked(bulkIncidentAction).mockResolvedValue({ done: [1, 2], skipped: [] });
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("Incident Center", () => {
  it("resolves several incidents at once", async () => {
    render(<SecurityPage />);
    fireEvent.click(await screen.findByLabelText("Select INC-1"));
    fireEvent.click(screen.getByLabelText("Select INC-2"));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("2 selected")).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(bulkIncidentAction).toHaveBeenCalledWith([1, 2], "resolve", {}));
  });

  it("asks for a reason before marking false alarms", async () => {
    render(<SecurityPage />);
    fireEvent.click(await screen.findByLabelText("Select INC-1"));
    fireEvent.click(screen.getByRole("button", { name: "Mark as false alarm" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Why is it a false alarm/), { target: { value: "Worker bending down" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as false alarm" }));
    await waitFor(() => expect(bulkIncidentAction).toHaveBeenCalledWith([1], "false_alarm", { reason: "Worker bending down" }));
  });

  it("filters by severity and shows false alarms as such", async () => {
    render(<SecurityPage />);
    expect(await screen.findByText("False alarm")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Severity/), { target: { value: "critical" } });
    expect(screen.queryByLabelText("Select INC-1")).toBeNull();
    expect(screen.getByLabelText("Select INC-2")).toBeTruthy();
  });

  it("exports through the CSV helper that guards against spreadsheet formulas", async () => {
    render(<SecurityPage />);
    await screen.findByLabelText("Select INC-1");
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(downloadCSV).toHaveBeenCalledWith("DVS_security_incidents.csv", expect.arrayContaining([expect.arrayContaining(["INC-1"])]));
  });

  it("is read-only for Production: no checkboxes or bulk actions", async () => {
    vi.mocked(getStoredBackendRole).mockReturnValue("PRODUCTION");
    render(<SecurityPage />);
    await screen.findByText("INC-1");
    expect(screen.queryByLabelText("Select INC-1")).toBeNull();
  });
});

describe("timeAgo", () => {
  it("says how long since the last detection", () => {
    const now = new Date("2026-11-01T10:00:00Z").getTime();
    expect(timeAgo("2026-10-17T09:41:35Z", now)).toBe("2 weeks ago");
    expect(timeAgo("2026-11-01T09:30:00Z", now)).toBe("30 minutes ago");
    expect(timeAgo("2026-10-31T10:00:00Z", now)).toBe("1 day ago");
  });
});
