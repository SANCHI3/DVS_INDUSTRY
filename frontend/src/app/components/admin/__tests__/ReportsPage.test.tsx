// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as ReportsModule from "../../../../lib/services/reports.service";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../../lib/auth", () => ({ getStoredBackendRole: vi.fn(() => "ADMIN") }));
vi.mock("../../../../lib/services/departments.service", () => ({
  getDepartments: vi.fn().mockResolvedValue([{ id: 4, name: "Press Shop" }, { id: 7, name: "Welding" }]),
}));
vi.mock("../../../../lib/services/reports.service", async (importOriginal) => ({
  ...(await importOriginal<typeof ReportsModule>()),
  getProductionReport: vi.fn(),
}));

import { getProductionReport } from "../../../../lib/services/reports.service";
import { ReportsPage } from "../ReportsPage";

const report = {
  generatedAt: "2026-11-01T10:00:00.000Z", period: "01 Nov 2026 – 30 Nov 2026",
  summary: { totalWorkOrders: 2, completed: 1 },
  rows: Array.from({ length: 30 }, (_, i) => ({ workOrderNumber: `WO-${i + 1}`, product: "Bracket" })),
};

beforeEach(() => {
  vi.mocked(getProductionReport).mockResolvedValue(report as never);
  window.print = vi.fn();
});
afterEach(() => { cleanup(); document.body.classList.remove("printing-report"); });

describe("Reports Center", () => {
  it("filters by a department chosen by name, not a raw id", async () => {
    render(<ReportsPage />);
    const select = screen.getByLabelText(/Department/);
    await screen.findByRole("option", { name: "Welding" });
    fireEvent.change(select, { target: { value: "7" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Load Report" })[0]!);
    await waitFor(() => expect(getProductionReport).toHaveBeenCalledWith(expect.objectContaining({ departmentId: 7 })));
  });

  it("prints only the report, with a DVS header, the period and every row", async () => {
    render(<ReportsPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Load Report" })[0]!);
    await waitFor(() => expect(getProductionReport).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: /Print Report/ }));

    expect(window.print).toHaveBeenCalled();
    expect(document.body.classList.contains("printing-report")).toBe(true);
    const printed = document.querySelector(".report-print")!;
    expect(printed.textContent).toContain("DVS INDUSTRIES");
    expect(printed.textContent).toContain("Period: 01 Nov 2026 – 30 Nov 2026");
    expect(printed.querySelectorAll("tbody tr").length).toBeGreaterThanOrEqual(30);
  });
});
