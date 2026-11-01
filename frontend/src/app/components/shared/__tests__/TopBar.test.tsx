// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as TopbarModule from "../../../../lib/services/topbar.service";

vi.mock("../../../../lib/auth", () => ({ getStoredBackendRole: vi.fn(() => "STORE") }));
vi.mock("../AskDvs", () => ({ AskDvs: () => null }));
vi.mock("../../../../lib/services/topbar.service", async (importOriginal) => ({
  ...(await importOriginal<typeof TopbarModule>()),
  getNotifications: vi.fn(),
  markNotificationsSeen: vi.fn().mockResolvedValue(undefined),
  searchRecords: vi.fn(),
}));

import { getNotifications, markNotificationsSeen, searchRecords } from "../../../../lib/services/topbar.service";
import { AppShell } from "../AppShell";

const go = vi.fn();
function shell() {
  render(<AppShell role="admin" activeSection="inventory" onSectionChange={go} onLogout={vi.fn()}><p>page</p></AppShell>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNotifications).mockResolvedValue({
    unreadCount: 1,
    items: [{ id: "stock-4", kind: "low-stock", severity: "warn", message: "CRCA Sheet 1.6mm is low: 40 kg (minimum 200 kg)", at: "2026-11-01T08:00:00Z", section: "inventory-materials", unread: true }],
  });
  vi.mocked(searchRecords).mockResolvedValue([{ kind: "purchase-order", id: 3, title: "PO-TEST-001", subtitle: "Mahindra Accelo · CRCA · pending" }]);
});
afterEach(cleanup);

describe("Notification bell", () => {
  it("shows the role's feed with an unread count and opens the item's page", async () => {
    shell();
    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    fireEvent.click(bell);
    expect(markNotificationsSeen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /CRCA Sheet 1.6mm is low/ }));
    expect(go).toHaveBeenCalledWith("inventory-materials");
    expect(screen.queryByText(/no notification backend/i)).toBeNull();
  });
});

describe("Search box", () => {
  it("finds records, not just page names, and opens them", async () => {
    shell();
    expect(screen.getByLabelText("Search").getAttribute("placeholder")).toBe("Search pages, people, orders, materials…");
    fireEvent.focus(screen.getByLabelText("Search"));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "crca" } });
    await waitFor(() => expect(searchRecords).toHaveBeenCalledWith("crca"));
    const hit = await screen.findByText("PO-TEST-001");
    fireEvent.mouseDown(hit);
    expect(go).toHaveBeenCalledWith("orders-supplier");
  });
});
