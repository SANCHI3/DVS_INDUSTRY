// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as CsvModule from "../../../../lib/csv";
import type * as RechartsModule from "recharts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../../../lib/auth", () => ({ getStoredBackendRole: vi.fn() }));
vi.mock("../../../../lib/csv", async (orig) => ({ ...(await orig<typeof CsvModule>()), downloadCSV: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof RechartsModule>();
  // jsdom has no layout, so give charts a fixed size
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 400, height: 200 }}>{children}</div> };
});
vi.mock("../../../../lib/services/employees.service", () => ({ getEmployees: vi.fn() }));
vi.mock("../../../../lib/services/departments.service", () => ({ getDepartments: vi.fn() }));
vi.mock("../../../../lib/services/production.service", () => ({
  getProductionKPIs: vi.fn(), getProductionTrend: vi.fn(), getWorkOrders: vi.fn(),
  getMonthlyPerformance: vi.fn(), saveProductionTarget: vi.fn(), deleteProductionTarget: vi.fn(),
  transitionStatus: vi.fn(), createWorkOrder: vi.fn(), addOutput: vi.fn(),
}));
vi.mock("../../../../lib/services/workforce.service", () => ({
  getAttendance: vi.fn(), getAttendanceSummary: vi.fn(), getAttendanceTrend: vi.fn(), createAttendance: vi.fn(),
  updateAttendance: vi.fn(), deleteAttendance: vi.fn(), getEmployeeOutputSummary: vi.fn(), getShifts: vi.fn(),
  getEmployeeOutputs: vi.fn(),
}));

import { getStoredBackendRole } from "../../../../lib/auth";
import { downloadCSV } from "../../../../lib/csv";
import { getEmployees, type EmployeeDto } from "../../../../lib/services/employees.service";
import { getDepartments } from "../../../../lib/services/departments.service";
import { getMonthlyPerformance, getProductionKPIs, getProductionTrend, getWorkOrders } from "../../../../lib/services/production.service";
import {
  createAttendance, getAttendance, getAttendanceSummary, getAttendanceTrend, getEmployeeOutputSummary, type AttendanceDto,
} from "../../../../lib/services/workforce.service";
import { AttendancePanel } from "../workforce/AttendancePanel";
import { ProductionPage } from "../ProductionPage";

const meta = (total: number, pageSize = 25, page = 1) => ({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
const ref = { id: 1, employeeCode: "EMP-001", firstName: "Ananya", lastName: "Iyer", designation: "CNC Operator", department: { id: 2, name: "Machining" }, shift: { id: 3, name: "General" } };
const record: AttendanceDto = {
  id: 5, employeeId: 1, employee: ref, date: "2026-10-20T00:00:00.000Z", clockIn: "2026-10-20T03:30:00.000Z", clockOut: null,
  workingHours: null, status: "LEAVE", remarks: null, createdAt: "", updatedAt: "",
};
const summary = {
  date: "2026-10-20", totalEmployees: 4, present: 2, absent: 1, halfDay: 0, late: 0, onLeave: 1, weekOff: 0, attendanceRate: "50.0%",
  byDepartment: [{ departmentId: 2, departmentName: "Machining", present: 2, attended: 2, weekOff: 0, total: 4 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStoredBackendRole).mockReturnValue("ADMIN");
  vi.mocked(getDepartments).mockResolvedValue([]);
  vi.mocked(getAttendance).mockResolvedValue({ data: [record], meta: meta(1) });
  vi.mocked(getAttendanceSummary).mockResolvedValue(summary);
  vi.mocked(getAttendanceTrend).mockResolvedValue([]);
});

afterEach(cleanup);

describe("Attendance tab", () => {
  it("shows real records, the shift and the department rate", async () => {
    render(<AttendancePanel />);
    const row = (await screen.findByText("Ananya Iyer")).closest("tr")!;
    expect(within(row).getByText("On Leave")).toBeTruthy();
    expect(within(row).getByText("General")).toBeTruthy();
    expect(screen.getByText("50.0%")).toBeTruthy(); // Machining 2 of 4
    expect(screen.getByText("No attendance has been recorded in this period.")).toBeTruthy();
  });

  it("tells a production user that attendance is restricted and makes no requests", () => {
    vi.mocked(getStoredBackendRole).mockReturnValue("PRODUCTION");
    render(<AttendancePanel />);
    expect(screen.getByText("Attendance is restricted for your role")).toBeTruthy();
    expect(getAttendance).not.toHaveBeenCalled();
    expect(getAttendanceSummary).not.toHaveBeenCalled();
  });

  it("filters by a date range", async () => {
    vi.mocked(getAttendance).mockResolvedValue({ data: [record], meta: meta(1) });
    render(<AttendancePanel />);
    await screen.findByText("Ananya Iyer");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-20" } });
    await waitFor(() => expect(getAttendance).toHaveBeenLastCalledWith(expect.objectContaining({ fromDate: "2026-10-01", toDate: "2026-10-20", page: 1 })));
    await screen.findByText("Ananya Iyer");
  });

  it("offers Upload Excel instead of Export CSV, next to Record Attendance", async () => {
    vi.mocked(getAttendance).mockResolvedValue({ data: [record], meta: meta(1) });
    render(<AttendancePanel />);
    await screen.findByText("Ananya Iyer");
    expect(screen.queryByRole("button", { name: /Export CSV/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Upload Excel/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Record Attendance/ })).toBeTruthy();
    expect(downloadCSV).not.toHaveBeenCalled();
  });

  it("does not offer Upload Excel to a manager, who can view but not record attendance", async () => {
    vi.mocked(getStoredBackendRole).mockReturnValue("MANAGER");
    vi.mocked(getAttendance).mockResolvedValue({ data: [record], meta: meta(1) });
    render(<AttendancePanel />);
    await screen.findByText("Ananya Iyer");
    expect(screen.queryByRole("button", { name: /Upload Excel/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Record Attendance/ })).toBeNull();
  });

  it("offers the existing record instead of overwriting it", async () => {
    const emp = { id: 1, employeeCode: "EMP-001", firstName: "Ananya", lastName: "Iyer", designation: "CNC Operator", department: null } as unknown as EmployeeDto;
    vi.mocked(getEmployees).mockResolvedValue({ data: [emp], meta: meta(1, 100) });
    vi.mocked(createAttendance).mockRejectedValue({ status: 409, code: "CONFLICT", message: "Attendance for EMP-001 on 2026-10-20 already exists (LEAVE). Edit the existing record instead." });
    render(<AttendancePanel />);
    await screen.findByText("Ananya Iyer");

    fireEvent.click(screen.getByRole("button", { name: /Record Attendance/ }));
    const dialog = screen.getByRole("dialog", { name: "Record Attendance" });
    await waitFor(() => expect(getEmployees).toHaveBeenCalled());
    fireEvent.change(within(dialog).getByLabelText(/^Employee/), { target: { value: "EMP-001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record Attendance/ }));

    fireEvent.click(await within(dialog).findByRole("button", { name: /Open the existing record \(On Leave\)/ }));
    expect(screen.getByRole("dialog", { name: "Edit Attendance" })).toBeTruthy();
  });
});

describe("Production page", () => {
  beforeEach(() => {
    vi.mocked(getProductionTrend).mockResolvedValue([]);
    vi.mocked(getWorkOrders).mockResolvedValue({ data: [], meta: meta(0, 20) });
    vi.mocked(getEmployeeOutputSummary).mockResolvedValue({ fromDate: "", toDate: "", employeesRecorded: 0, records: 0, totalExpectedParts: 0, totalProducedParts: 0, totalOperations: 0, efficiency: null });
    vi.mocked(getMonthlyPerformance).mockResolvedValue({
      month: "2026-10", target: null,
      actual: { goodQty: 0, rejectedQty: 0, scrapQty: 0, outputRecords: 0, rejectionRate: null, employeeEfficiency: null, employeeRecords: 0 },
      progress: { daysInMonth: 31, daysElapsed: 26, progressPct: null, expectedToDate: null, pace: null },
      checks: { rejection: null, employeeEfficiency: null },
    });
  });

  it("keeps working sections visible when one request fails, and says why it failed", async () => {
    vi.mocked(getProductionKPIs).mockRejectedValue({ status: 500, code: "INTERNAL_ERROR", message: "Database unavailable" });
    render(<ProductionPage />);
    expect(await screen.findByText(/Could not load production KPIs: Database unavailable/)).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBe(4);
    expect(await screen.findByText("No work orders have been created yet.")).toBeTruthy();
    expect(screen.getByText("No work-order output has been recorded in the last 7 days.")).toBeTruthy();
    expect(screen.getByText(/No employee output has been recorded for today/)).toBeTruthy();
  });

  it("waits for a sleeping server and then shows the data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.mocked(getProductionKPIs)
      .mockRejectedValueOnce({ status: 0, code: "NETWORK_ERROR", message: "timeout of 15000ms exceeded" })
      .mockResolvedValue({
        totalWorkOrders: 3, activeWorkOrders: 2, completedThisMonth: 1, overdueWorkOrders: 0, totalTargetQty: "1000.000",
        totalProducedQty: "500.000", totalRejectedQty: "20.000", totalScrapQty: "5.000", overallCompletionRate: "50.0%",
        rejectionRate: "3.8%", byStatus: [], byPriority: [],
      });
    render(<ProductionPage />);
    expect(await screen.findByText("50.0%")).toBeTruthy();
    expect(screen.getByText("Work-order targets 1,000")).toBeTruthy();
    expect(getProductionKPIs).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
