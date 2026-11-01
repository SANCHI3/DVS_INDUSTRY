// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("../../../../lib/auth", () => ({
  getStoredBackendRole: vi.fn(),
  getUser: vi.fn(() => ({ fullName: "Test User" })),
}));
// The pages themselves are tested elsewhere; here only which one opens matters
vi.mock("../AdminDashboard", () => ({ AdminDashboard: () => <p>DASHBOARD PAGE</p> }));
vi.mock("../ProductionPage", () => ({ ProductionPage: ({ section }: { section: string }) => <p>{section.toUpperCase()} PAGE</p> }));
vi.mock("../SecurityPage", () => ({ SecurityPage: () => <p>SECURITY PAGE</p> }));
vi.mock("../InventoryPage", () => ({ InventoryPage: () => <p>INVENTORY PAGE</p> }));
vi.mock("../OrdersPage", () => ({ OrdersPage: () => <p>ORDERS PAGE</p> }));
vi.mock("../ReportsPage", () => ({ ReportsPage: () => <p>REPORTS PAGE</p> }));
vi.mock("../SmartAnalyticsPage", () => ({ SmartAnalyticsPage: () => <p>ANALYTICS PAGE</p> }));
vi.mock("../UserManagementPage", () => ({ UserManagementPage: () => <p>USERS PAGE</p> }));
vi.mock("../../shared/MyProfilePage", () => ({ MyProfilePage: () => <p>PROFILE PAGE</p> }));
vi.mock("../../shared/AskDvs", () => ({ AskDvs: () => null }));
vi.mock("../../shared/PriorityIncidentAlert", () => ({
  PriorityIncidentAlert: ({ onView }: { onView: () => void }) => <button onClick={onView}>View priority incident</button>,
}));

import { getStoredBackendRole } from "../../../../lib/auth";
import { AdminApp } from "../AdminApp";

function open(role: string, hash: string) {
  vi.mocked(getStoredBackendRole).mockReturnValue(role);
  window.history.replaceState(null, "", hash);
  render(<AdminApp onLogout={vi.fn()} onSessionEnded={vi.fn()} />);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("AdminApp sections", () => {
  it("sends a typed forbidden link to the role's home page", () => {
    open("STORE", "/#users");
    expect(screen.getByText("INVENTORY PAGE")).toBeTruthy();
    expect(screen.queryByText("USERS PAGE")).toBeNull();
    expect(window.location.hash).toBe("#inventory");
  });

  it("opens an allowed sub-section link", () => {
    open("PRODUCTION", "/#security-incidents");
    expect(screen.getByText("SECURITY PAGE")).toBeTruthy();
  });

  it("gives HR a Workforce section and no security alerts", () => {
    open("HR", "/");
    expect(screen.getByText("WORKFORCE PAGE")).toBeTruthy();
    expect(screen.queryByText("View priority incident")).toBeNull();
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByText("AI Security")).toBeNull();
    expect(within(nav).getByText("Workforce")).toBeTruthy();
  });

  it("lets Production open the incident from a priority alert", () => {
    open("PRODUCTION", "/");
    screen.getByText("View priority incident").click();
    expect(window.location.hash).toBe("#security-incidents");
  });

  it("shows the real role, e.g. Plant Manager", () => {
    open("MANAGER", "/");
    expect(screen.getAllByText(/Plant Manager/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Administrator")).toBeNull();
  });
});
