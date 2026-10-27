// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as RechartsModule from "recharts";

vi.mock("../../../../lib/auth", () => ({ getStoredBackendRole: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof RechartsModule>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 400, height: 200 }}>{children}</div> };
});
vi.mock("../../../../lib/services/departments.service", () => ({ getDepartments: vi.fn() }));
vi.mock("../../../../lib/services/production.service", () => ({
  getProductionKPIs: vi.fn(), getProductionTrend: vi.fn(), getWorkOrders: vi.fn(), getMonthlyPerformance: vi.fn(),
  saveProductionTarget: vi.fn(), deleteProductionTarget: vi.fn(), transitionStatus: vi.fn(), createWorkOrder: vi.fn(), addOutput: vi.fn(),
  updateWorkOrder: vi.fn(), deleteWorkOrder: vi.fn(),
}));
vi.mock("../../../../lib/services/workforce.service", () => ({ getEmployeeOutputSummary: vi.fn() }));

import { toast } from "sonner";
import { getStoredBackendRole } from "../../../../lib/auth";
import { getDepartments } from "../../../../lib/services/departments.service";
import {
  addOutput, createWorkOrder, deleteWorkOrder, updateWorkOrder, getMonthlyPerformance, getProductionKPIs, getProductionTrend, getWorkOrders, saveProductionTarget,
  transitionStatus, type MonthlyPerformance, type ProductionTargetDto, type WorkOrderDto,
} from "../../../../lib/services/production.service";
import { getEmployeeOutputSummary } from "../../../../lib/services/workforce.service";
import { ProductionPage } from "../ProductionPage";
import { currentMonth } from "../production/MonthlyTargetCard";

const month = currentMonth();
const target: ProductionTargetDto = {
  id: 3, month, periodStart: `${month}-01T00:00:00.000Z`, outputTarget: 3100, unit: "pcs", targetCompletionRate: 90,
  maxRejectionRate: 5, targetEmployeeEfficiency: null, notes: null, updatedById: 1, createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z",
};
const perf = (t: ProductionTargetDto | null): MonthlyPerformance => ({
  month, target: t,
  actual: { goodQty: 950, rejectedQty: 50, scrapQty: 5, outputRecords: 12, rejectionRate: 5, employeeEfficiency: null, employeeRecords: 0 },
  progress: { daysInMonth: 31, daysElapsed: 10, progressPct: t ? 30.6 : null, expectedToDate: t ? 1000 : null, pace: t ? "BEHIND" : null },
  checks: { rejection: t ? "MET" : null, employeeEfficiency: null },
});
const wo = (status: WorkOrderDto["status"]): WorkOrderDto => ({
  id: 7, workOrderNumber: "WO-0007", product: "Bracket", targetQuantity: "500.000", unit: "pcs", scheduledStart: null, scheduledEnd: null,
  actualStart: null, actualEnd: null, status, priority: "NORMAL", departmentId: null, departmentName: null, assignedToId: null,
  assignedToName: null, clientOrderId: null, notes: null, producedQty: "100.000", rejectedQty: "0.000", scrapQty: "0.000",
  completionRate: "20.0%", createdAt: "", updatedAt: "", _count: { outputs: 1 },
});

function role(r: string) { vi.mocked(getStoredBackendRole).mockReturnValue(r); }

beforeEach(() => {
  vi.clearAllMocks();
  role("ADMIN");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(getProductionKPIs).mockResolvedValue({
    totalWorkOrders: 1, activeWorkOrders: 1, completedThisMonth: 0, overdueWorkOrders: 0, totalTargetQty: "500.000", totalProducedQty: "100.000",
    totalRejectedQty: "0.000", totalScrapQty: "0.000", overallCompletionRate: "92.0%", rejectionRate: "6.0%", byStatus: [], byPriority: [],
  });
  vi.mocked(getProductionTrend).mockResolvedValue([]);
  vi.mocked(getWorkOrders).mockResolvedValue({ data: [wo("RELEASED")], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
  vi.mocked(getEmployeeOutputSummary).mockResolvedValue({ fromDate: "", toDate: "", employeesRecorded: 0, records: 0, totalExpectedParts: 0, totalProducedParts: 0, totalOperations: 0, efficiency: null });
  vi.mocked(getMonthlyPerformance).mockResolvedValue(perf(target));
  vi.mocked(getDepartments).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Monthly target", () => {
  it("compares the saved target with recorded output and the KPI thresholds", async () => {
    render(<ProductionPage />);
    expect(await screen.findByText("3,100 pcs")).toBeTruthy();
    expect(screen.getByText("950 pcs")).toBeTruthy();
    expect(screen.getByText("30.6%")).toBeTruthy();
    expect(screen.getByText("Behind pace")).toBeTruthy();
    // Thresholds drive the KPI cards: 92% completion meets ≥90%, 6% rejection misses ≤5%
    expect(await screen.findByText("Meets ≥ 90%")).toBeTruthy();
    expect(screen.getByText("Misses ≤ 5%")).toBeTruthy();
  });

  it("says when no target is set instead of inventing one", async () => {
    vi.mocked(getMonthlyPerformance).mockResolvedValue(perf(null));
    render(<ProductionPage />);
    expect(await screen.findByText(/No target has been set for/)).toBeTruthy();
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
    expect(screen.getByText("No target set")).toBeTruthy(); // Completion Rate card
  });

  it("creates a target with validation, and saves it to the API", async () => {
    vi.mocked(getMonthlyPerformance).mockResolvedValue(perf(null));
    vi.mocked(saveProductionTarget).mockResolvedValue(target);
    render(<ProductionPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Set target/ }));
    const dialog = screen.getByRole("dialog", { name: /Set Target/ });

    fireEvent.change(within(dialog).getByLabelText(/^Monthly output target/), { target: { value: "0" } });
    fireEvent.change(within(dialog).getByLabelText(/^Maximum rejection rate/), { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Target/ }));
    expect(await within(dialog).findByText("The target must be greater than 0.")).toBeTruthy();
    expect(within(dialog).getByText("Enter a percentage from 0 to 100.")).toBeTruthy();
    expect(saveProductionTarget).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^Monthly output target/), { target: { value: "3100" } });
    fireEvent.change(within(dialog).getByLabelText(/^Maximum rejection rate/), { target: { value: "5" } });
    fireEvent.change(within(dialog).getByLabelText(/^Target completion rate/), { target: { value: "90" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Target/ }));

    await waitFor(() => expect(saveProductionTarget).toHaveBeenCalledWith(month, {
      outputTarget: "3100", unit: "pcs", targetCompletionRate: 90, maxRejectionRate: 5, targetEmployeeEfficiency: null, notes: null, expectedUpdatedAt: null,
    }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Target for .* saved\.$/)));
  });

  it("edits the loaded version and explains a conflicting change instead of overwriting it", async () => {
    vi.mocked(saveProductionTarget).mockRejectedValue({ status: 409, code: "CONFLICT", message: "The target was changed after you opened it" });
    render(<ProductionPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit target/ }));
    const dialog = screen.getByRole("dialog", { name: /Edit Target/ });
    expect((within(dialog).getByLabelText(/^Monthly output target/) as HTMLInputElement).value).toBe("3100");
    fireEvent.change(within(dialog).getByLabelText(/^Monthly output target/), { target: { value: "3500" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Target/ }));
    expect(await within(dialog).findByText(/Close this dialog to load the latest values/)).toBeTruthy();
    expect(vi.mocked(saveProductionTarget).mock.calls[0]![1].expectedUpdatedAt).toBe(target.updatedAt);
  });

  it.each(["PRODUCTION", "HR"])("lets %s view but not edit targets", async (r) => {
    role(r);
    render(<ProductionPage />);
    expect(await screen.findByText("3,100 pcs")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit target|Set target/ })).toBeNull();
  });
});

describe("Work orders", () => {
  it("creates a work order after validating it", async () => {
    vi.mocked(createWorkOrder).mockResolvedValue({ ...wo("DRAFT"), workOrderNumber: "WO-0008" });
    render(<ProductionPage />);
    fireEvent.click(await screen.findByRole("button", { name: /New Work Order/ }));
    const dialog = screen.getByRole("dialog", { name: "New Work Order" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Work Order/ }));
    expect(await within(dialog).findByText("Product is required.")).toBeTruthy();
    expect(within(dialog).getByText("Target quantity is required.")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/^Product/), { target: { value: "Hinge" } });
    fireEvent.change(within(dialog).getByLabelText(/^Target quantity/), { target: { value: "250" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create Work Order/ }));
    await waitFor(() => expect(createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({ product: "Hinge", targetQuantity: "250", unit: "pcs", priority: "NORMAL" })));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("WO-0008 created as a draft")));
  });

  it("records output on a released work order and refreshes the KPIs", async () => {
    vi.mocked(addOutput).mockResolvedValue({ id: 1, workOrderId: 7, goodQty: "40.000", rejectedQty: "2.000", scrapQty: "0.000", recordedAt: "", recordedByName: null, remarks: null });
    render(<ProductionPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Record output on WO-0007" }));
    const dialog = screen.getByRole("dialog", { name: /Record Output/ });
    fireEvent.change(within(dialog).getByLabelText(/^Good/), { target: { value: "40" } });
    fireEvent.change(within(dialog).getByLabelText(/^Rejected/), { target: { value: "2" } });
    const kpiCalls = vi.mocked(getProductionKPIs).mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /Record Output/ }));
    await waitFor(() => expect(addOutput).toHaveBeenCalledWith(7, { goodQty: "40", rejectedQty: "2", scrapQty: "0", remarks: null }));
    await waitFor(() => expect(vi.mocked(getProductionKPIs).mock.calls.length).toBeGreaterThan(kpiCalls));
  });

  it("offers only the allowed next statuses, and no output button on a draft", async () => {
    vi.mocked(getWorkOrders).mockResolvedValue({ data: [wo("DRAFT")], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    vi.mocked(transitionStatus).mockResolvedValue(wo("RELEASED"));
    render(<ProductionPage />);
    const select = await screen.findByLabelText("Change status of WO-0007");
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", "RELEASED", "CANCELLED"]);
    expect(screen.queryByRole("button", { name: "Record output on WO-0007" })).toBeNull();
    fireEvent.change(select, { target: { value: "RELEASED" } });
    await waitFor(() => expect(transitionStatus).toHaveBeenCalledWith(7, "RELEASED"));
  });

  it("hides work-order editing from HR", async () => {
    role("HR");
    render(<ProductionPage />);
    await screen.findByText("WO-0007");
    expect(screen.queryByRole("button", { name: /New Work Order/ })).toBeNull();
    expect(screen.queryByLabelText("Change status of WO-0007")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit WO-0007" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete WO-0007" })).toBeNull();
  });

  it("edits a work order with its saved values and sends only the changes", async () => {
    vi.mocked(getWorkOrders).mockResolvedValue({
      data: [{ ...wo("IN_PROGRESS"), priority: "HIGH", notes: "Rush", scheduledStart: "2026-10-20T00:30:00.000Z" }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(updateWorkOrder).mockResolvedValue({ ...wo("IN_PROGRESS"), targetQuantity: "650.000" });
    render(<ProductionPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit WO-0007" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Work Order" });
    const value = (l: RegExp) => (within(dialog).getByLabelText(l) as HTMLInputElement).value;
    expect(value(/^Product/)).toBe("Bracket");
    expect(value(/^Target quantity/)).toBe("500");
    expect(value(/^Priority/)).toBe("HIGH");
    expect(value(/^Scheduled start/)).toBe("2026-10-20");
    expect(value(/^Notes/)).toBe("Rush");

    fireEvent.change(within(dialog).getByLabelText(/^Target quantity/), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Changes/ }));
    expect(await within(dialog).findByText("Target quantity must be greater than 0.")).toBeTruthy();
    expect(updateWorkOrder).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^Target quantity/), { target: { value: "650" } });
    const listCalls = vi.mocked(getWorkOrders).mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Changes/ }));
    await waitFor(() => expect(updateWorkOrder).toHaveBeenCalledWith(7, { targetQuantity: "650" }));
    expect(createWorkOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("WO-0007 saved."));
    await waitFor(() => expect(vi.mocked(getWorkOrders).mock.calls.length).toBeGreaterThan(listCalls));
  });

  it("deletes after confirmation, warning that recorded output stops counting", async () => {
    vi.mocked(deleteWorkOrder).mockResolvedValue(undefined);
    render(<ProductionPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete WO-0007" }));
    let dialog = screen.getByRole("dialog", { name: "Delete Work Order?" });
    expect(within(dialog).getByText(/1 output record \(100 pcs good\)/)).toBeTruthy();
    expect(within(dialog).getByText(/no longer count in Company Performance totals/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteWorkOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete WO-0007" }));
    dialog = screen.getByRole("dialog", { name: "Delete Work Order?" });
    const button = within(dialog).getByRole("button", { name: /Delete Work Order/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("WO-0007 was deleted."));
    expect(deleteWorkOrder).toHaveBeenCalledTimes(1);
    expect(deleteWorkOrder).toHaveBeenCalledWith(7);
  });

  it("keeps the dialog open with the server's reason when deletion fails", async () => {
    vi.mocked(deleteWorkOrder).mockRejectedValue({ status: 403, code: "FORBIDDEN", message: "Access denied" });
    render(<ProductionPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete WO-0007" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Work Order?" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Delete Work Order/ }));
    expect(await within(dialog).findByText(/Could not delete WO-0007/)).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("cannot delete a completed work order, and only administrators see Delete", async () => {
    vi.mocked(getWorkOrders).mockResolvedValue({ data: [wo("COMPLETED")], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    render(<ProductionPage />);
    const del = (await screen.findByRole("button", { name: "Delete WO-0007" })) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe("Completed work orders cannot be deleted");
    cleanup();
    role("PRODUCTION");
    render(<ProductionPage />);
    expect(await screen.findByRole("button", { name: "Edit WO-0007" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete WO-0007" })).toBeNull();
  });
});
