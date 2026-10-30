// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as RechartsModule from "recharts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../../../lib/auth", () => ({ getStoredBackendRole: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof RechartsModule>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 400, height: 200 }}>{children}</div> };
});
vi.mock("../../../../lib/services/employees.service", () => ({ getEmployees: vi.fn() }));
vi.mock("../../../../lib/services/departments.service", () => ({ getDepartments: vi.fn() }));
vi.mock("../../../../lib/services/workforce.service", () => ({
  getAttendance: vi.fn(), getAttendanceSummary: vi.fn(), getAttendanceTrend: vi.fn(), createAttendance: vi.fn(),
  updateAttendance: vi.fn(), deleteAttendance: vi.fn(),
  previewAttendanceImport: vi.fn(), importAttendanceSheet: vi.fn(), registerSheetEmployees: vi.fn(), getShifts: vi.fn(),
}));

import { toast } from "sonner";
import { getStoredBackendRole } from "../../../../lib/auth";
import { getDepartments } from "../../../../lib/services/departments.service";
import {
  getAttendance, getAttendanceSummary, getAttendanceTrend, getShifts, importAttendanceSheet, previewAttendanceImport,
  registerSheetEmployees, type AttendanceImportReport,
} from "../../../../lib/services/workforce.service";
import { localIsoDate } from "../../../../lib/workforce";
import { checkSheetFile } from "../workforce/AttendanceImportDialog";
import { AttendancePanel } from "../workforce/AttendancePanel";

const TODAY = localIsoDate();
const meta = (total: number) => ({ page: 1, pageSize: 25, total, totalPages: 1 });
const xlsx = (name = "oct27.xlsx", size = 2048) => new File([new Uint8Array(size)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

const noTimes = { clockIn: null, clockOut: null, overtime: null, note: null, sourceName: "", sourceShift: "" };
const preview: AttendanceImportReport = {
  kind: "table", date: TODAY, fileName: "oct27.xlsx", sheetName: "Attendance",
  rows: [
    { row: 2, employeeCode: "DEMO-EMP-001", employeeName: "Rajesh Kulkarni", employeeId: 1, date: TODAY, rawStatus: "P", status: "PRESENT", result: "VALID", reason: null, ...noTimes },
    { row: 3, employeeCode: "DEMO-EMP-006", employeeName: "Ganesh More", employeeId: 6, date: TODAY, rawStatus: "WO", status: "WEEK_OFF", result: "VALID", reason: null, ...noTimes },
    { row: 4, employeeCode: "DEMO-EMP-009", employeeName: "Mahesh Pawar", employeeId: 9, date: TODAY, rawStatus: "P", status: "PRESENT", result: "EXISTING", reason: "Already recorded as Present. Left unchanged.", ...noTimes },
    { row: 5, employeeCode: "DEMO-EMP-001", employeeName: "Rajesh Kulkarni", employeeId: 1, date: TODAY, rawStatus: "P", status: "PRESENT", result: "DUPLICATE", reason: "Repeats row 2 for DEMO-EMP-001. Imported once.", ...noTimes },
    { row: 6, employeeCode: "DEMO-EMP-010", employeeName: "Nitin Sawant", employeeId: 10, date: TODAY, rawStatus: "OT", status: null, result: "REJECTED", reason: "Overtime (OT) cannot be imported: attendance records have no overtime field.", ...noTimes },
    { row: 7, employeeCode: "NOPE-1", employeeName: "", employeeId: null, date: TODAY, rawStatus: "P", status: "PRESENT", result: "REJECTED", reason: "No employee has the ID NOPE-1.", ...noTimes },
  ],
  summary: { totalRows: 6, valid: 2, existing: 1, duplicate: 1, rejected: 2, blankRows: 0 },
  unregistered: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStoredBackendRole).mockReturnValue("HR");
  vi.mocked(getDepartments).mockResolvedValue([]);
  vi.mocked(getAttendance).mockResolvedValue({ data: [], meta: meta(0) });
  vi.mocked(getAttendanceSummary).mockResolvedValue({ date: TODAY, totalEmployees: 0, present: 0, absent: 0, late: 0, halfDay: 0, onLeave: 0, weekOff: 0, attendanceRate: "0%", byDepartment: [] } as never);
  vi.mocked(getAttendanceTrend).mockResolvedValue([]);
  vi.mocked(previewAttendanceImport).mockResolvedValue(preview);
  vi.mocked(getShifts).mockResolvedValue({
    data: [
      { id: 1, name: "General Shift", startTime: "08:00", endTime: "16:00" },
      { id: 2, name: "Night Shift", startTime: "20:00", endTime: "04:00" },
    ],
    meta: meta(2),
  } as never);
});
afterEach(cleanup);

async function openUpload() {
  render(<AttendancePanel />);
  await screen.findByText("No attendance records found");
  fireEvent.click(screen.getByRole("button", { name: /Upload Excel/ }));
  return screen.getByRole("dialog", { name: "Upload Attendance from Excel" });
}

const choose = (dialog: HTMLElement, file: File) =>
  fireEvent.change(within(dialog).getByLabelText("Excel attendance file"), { target: { files: [file] } });

describe("checkSheetFile", () => {
  it("accepts .xlsx and .xls, rejects other types, empty and oversized files", () => {
    expect(checkSheetFile(xlsx("a.xlsx"))).toBeNull();
    expect(checkSheetFile(xlsx("a.XLS"))).toBeNull();
    expect(checkSheetFile(xlsx("a.csv"))).toMatch(/not an Excel workbook/);
    expect(checkSheetFile(xlsx("a.xlsx", 0))).toMatch(/is empty/);
    expect(checkSheetFile(xlsx("a.xlsx", 5 * 1024 * 1024 + 1))).toMatch(/larger than 5 MB/);
  });
});

describe("Attendance → Upload Excel", () => {
  it("explains the accepted columns and defaults to the selected attendance date", async () => {
    const dialog = await openUpload();
    expect(within(dialog).getByText(/Daily Attendance/)).toBeTruthy();
    expect((within(dialog).getByLabelText("Attendance date") as HTMLInputElement).value).toBe(TODAY);
  });

  it("refuses a non-Excel file without contacting the server", async () => {
    const dialog = await openUpload();
    choose(dialog, xlsx("attendance.csv"));
    expect(await within(dialog).findByText(/"attendance.csv" is not an Excel workbook/)).toBeTruthy();
    expect(previewAttendanceImport).not.toHaveBeenCalled();
  });

  it("previews every row with its result and reason, and saves nothing until confirmed", async () => {
    const dialog = await openUpload();
    const file = xlsx();
    choose(dialog, file);
    await waitFor(() => expect(previewAttendanceImport).toHaveBeenCalledWith(file, TODAY));
    const table = await within(dialog).findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(7); // header + 6
    expect(within(table).getByText("NOPE-1")).toBeTruthy();
    expect(within(table).getByText(/Overtime \(OT\) cannot be imported/)).toBeTruthy();
    expect(within(table).getByText("Already recorded as Present. Left unchanged.")).toBeTruthy();
    expect(within(table).getByText("Week Off")).toBeTruthy();
    expect(within(dialog).getByLabelText("Import summary").textContent).toMatch(/2Ready to import1Skipped \(already recorded\)1Duplicate rows2Rejected/);
    expect(importAttendanceSheet).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByLabelText("Show only rows that will not be imported"));
    expect(within(table).getAllByRole("row")).toHaveLength(5);
  });

  it("imports once on confirm, shows the final summary and reloads from the database", async () => {
    let resolve!: (r: AttendanceImportReport) => void;
    vi.mocked(importAttendanceSheet).mockImplementation(() => new Promise((r) => { resolve = r; }));
    const dialog = await openUpload();
    const file = xlsx();
    choose(dialog, file);
    const confirm = await within(dialog).findByRole("button", { name: /Confirm import of 2 records/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await within(dialog).findByRole("button", { name: /Importing…/ })).toBeTruthy();
    expect(importAttendanceSheet).toHaveBeenCalledTimes(1);
    expect(importAttendanceSheet).toHaveBeenCalledWith(file, TODAY);

    const listCalls = vi.mocked(getAttendance).mock.calls.length;
    resolve({ ...preview, imported: 2 });
    const summary = await screen.findByRole("dialog", { name: "Attendance Import Summary" });
    expect(within(summary).getByText(/2 attendance records were saved/)).toBeTruthy();
    expect(within(summary).getByLabelText("Import summary").textContent).toMatch(/^2Imported/);
    expect(within(summary).getAllByText("Imported").length).toBeGreaterThan(1);
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Imported 2 attendance records/));
    await waitFor(() => expect(vi.mocked(getAttendance).mock.calls.length).toBeGreaterThan(listCalls));

    fireEvent.click(within(summary).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cannot import when no row is valid", async () => {
    vi.mocked(previewAttendanceImport).mockResolvedValue({
      ...preview, rows: preview.rows.slice(4), summary: { totalRows: 2, valid: 0, existing: 0, duplicate: 0, rejected: 2, blankRows: 0 },
    });
    const dialog = await openUpload();
    choose(dialog, xlsx());
    const button = await within(dialog).findByRole("button", { name: /Nothing to import/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server's reason for a bad workbook and retries", async () => {
    vi.mocked(previewAttendanceImport)
      .mockRejectedValueOnce({ status: 400, code: "BAD_REQUEST", message: 'No worksheet has an "Employee ID" column.' })
      .mockResolvedValueOnce(preview);
    const dialog = await openUpload();
    choose(dialog, xlsx());
    expect(await within(dialog).findByText(/No worksheet has an "Employee ID" column/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Retry/ }));
    expect(await within(dialog).findByRole("button", { name: /Confirm import of 2 records/ })).toBeTruthy();
    expect(previewAttendanceImport).toHaveBeenCalledTimes(2);
  });

  it("keeps the preview after a failed import so it can be retried safely", async () => {
    vi.mocked(importAttendanceSheet)
      .mockRejectedValueOnce({ status: 0, code: "NETWORK_ERROR", message: "Network Error" })
      .mockResolvedValueOnce({ ...preview, imported: 2 });
    const dialog = await openUpload();
    choose(dialog, xlsx());
    fireEvent.click(await within(dialog).findByRole("button", { name: /Confirm import of 2 records/ }));
    expect(await within(dialog).findByRole("button", { name: /Retry/ })).toBeTruthy();
    expect(within(dialog).getByRole("table")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("dialog", { name: "Attendance Import Summary" })).toBeTruthy();
  });

  it("checks the file again when the date changes", async () => {
    const dialog = await openUpload();
    const file = xlsx();
    choose(dialog, file);
    await within(dialog).findByRole("table");
    fireEvent.change(within(dialog).getByLabelText("Attendance date"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(previewAttendanceImport).toHaveBeenLastCalledWith(file, "2026-10-01"));
  });

  it("offers the sheet's own date when the file is for another day", async () => {
    vi.mocked(previewAttendanceImport)
      .mockRejectedValueOnce({
        status: 400, code: "SHEET_DATE_MISMATCH",
        message: "This sheet is the attendance for 23 Sep 2026 (2026-09-23), but the selected date is 27 Oct 2026. Select 23 Sep 2026 to import it.",
      })
      .mockResolvedValueOnce({ ...preview, date: "2026-09-23" });
    const dialog = await openUpload();
    const file = xlsx("23-9-2026.xls");
    choose(dialog, file);
    expect(await within(dialog).findByText(/This sheet is the attendance for 23 Sep 2026/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Use 23 Sept? 2026$/ }));
    await waitFor(() => expect(previewAttendanceImport).toHaveBeenLastCalledWith(file, "2026-09-23"));
    expect((within(dialog).getByLabelText("Attendance date") as HTMLInputElement).value).toBe("2026-09-23");
    expect(importAttendanceSheet).not.toHaveBeenCalled();
  });

  it("shows punch times and overtime, and says where overtime is saved", async () => {
    vi.mocked(previewAttendanceImport).mockResolvedValue({
      ...preview,
      rows: [{
        ...preview.rows[0]!, clockIn: "09:11", clockOut: "20:44", overtime: "3:33",
        note: "Overtime 3:33 is saved in the remarks and included in the hours worked (attendance has no overtime field).",
      }],
      summary: { totalRows: 1, valid: 1, existing: 0, duplicate: 0, rejected: 0, blankRows: 0 },
    });
    const dialog = await openUpload();
    choose(dialog, xlsx());
    const table = await within(dialog).findByRole("table");
    for (const h of ["In", "Out", "OT"]) expect(within(table).getByRole("columnheader", { name: h })).toBeTruthy();
    expect(within(table).getByText("09:11")).toBeTruthy();
    expect(within(table).getByText("3:33")).toBeTruthy();
    expect(within(table).getByText(/Overtime 3:33 is saved in the remarks/)).toBeTruthy();
  });

  it("Cancel closes without importing", async () => {
    const dialog = await openUpload();
    choose(dialog, xlsx());
    await within(dialog).findByRole("table");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(importAttendanceSheet).not.toHaveBeenCalled();
  });
});

describe("Attendance → Upload Excel → employees not yet registered", () => {
  const unknownRow = (row: number, code: string, name: string, shift: string) => ({
    row, employeeCode: code, employeeName: name, sourceName: name, sourceShift: shift, employeeId: null, date: TODAY,
    rawStatus: "Present", status: "PRESENT" as const, result: "REJECTED" as const,
    reason: `No employee has the ID ${code}. Register the worker first.`, clockIn: null, clockOut: null, overtime: null, note: null,
  });
  const withNewcomers: AttendanceImportReport = {
    ...preview,
    rows: [unknownRow(5, "1", "ASHA PATIL", "GS"), unknownRow(6, "2", "RAVI", "NS"), unknownRow(7, "x 9", "ODD ID", "GS")],
    summary: { totalRows: 3, valid: 0, existing: 0, duplicate: 0, rejected: 3, blankRows: 0 },
    unregistered: [
      { employeeCode: "1", name: "ASHA PATIL", shift: "GS", rows: [5], problem: null },
      { employeeCode: "2", name: "RAVI", shift: "NS", rows: [6], problem: null },
      { employeeCode: "x 9", name: "ODD ID", shift: "GS", rows: [7], problem: '"x 9" cannot be registered as written.' },
    ],
  };

  async function openReview() {
    vi.mocked(previewAttendanceImport).mockResolvedValue(withNewcomers);
    const dialog = await openUpload();
    const file = xlsx("23-9-2026.xls");
    choose(dialog, file);
    expect(await within(dialog).findByText(/3 Employee IDs in this sheet are not registered/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review 3 new employees" }));
    await within(dialog).findByLabelText("Register employees from the sheet");
    await within(dialog).findByLabelText("Shift for 1");
    return { dialog, file };
  }

  it("shows the sheet's ID and name read-only and leaves what the sheet lacks blank", async () => {
    const { dialog } = await openReview();
    expect(within(dialog).getByText("ASHA PATIL")).toBeTruthy();
    expect((within(dialog).getByLabelText("First name for 1") as HTMLInputElement).value).toBe("ASHA");
    expect((within(dialog).getByLabelText("Last name for 1") as HTMLInputElement).value).toBe("PATIL");
    expect((within(dialog).getByLabelText("Designation for 1") as HTMLInputElement).value).toBe("");
    expect((within(dialog).getByLabelText("Joining date for 1") as HTMLInputElement).value).toBe("");
    expect((within(dialog).getByLabelText("Employment type for 1") as HTMLSelectElement).value).toBe("");
    expect((within(dialog).getByLabelText("Register x 9") as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getAllByText(/cannot be registered as written/).length).toBeGreaterThan(0);
    const register = within(dialog).getByRole("button", { name: /2 need details/ }) as HTMLButtonElement;
    expect(register.disabled).toBe(true);

    // The name can be split differently but not changed
    fireEvent.change(within(dialog).getByLabelText("First name for 1"), { target: { value: "ASHA P" } });
    expect(within(dialog).getByText('First and last name must together read exactly "ASHA PATIL".')).toBeTruthy();
    expect(registerSheetEmployees).not.toHaveBeenCalled();
  });

  it("registers only after the details are completed and confirmed, then previews again without importing", async () => {
    const { dialog, file } = await openReview();
    fireEvent.change(within(dialog).getByLabelText("Designation for all"), { target: { value: "Operator" } });
    fireEvent.change(within(dialog).getByLabelText("Joining date for all"), { target: { value: "2026-08-01" } });
    fireEvent.change(within(dialog).getByLabelText("Employment type for all"), { target: { value: "CONTRACT" } });
    fireEvent.change(within(dialog).getByLabelText("Shift for sheet code GS"), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply to 2 selected" }));

    const register = within(dialog).getByRole("button", { name: "Register 2 employees" }) as HTMLButtonElement;
    expect(register.disabled).toBe(true); // not yet confirmed
    fireEvent.click(within(dialog).getByLabelText(/I have checked these 2 employee records/));
    vi.mocked(registerSheetEmployees).mockResolvedValue({
      created: [{ id: 70, employeeCode: "1", name: "ASHA PATIL" }, { id: 71, employeeCode: "2", name: "RAVI" }],
      report: {
        ...withNewcomers,
        rows: withNewcomers.rows.map((r, i) => (i < 2 ? { ...r, employeeId: 70 + i, result: "VALID" as const, reason: null } : r)),
        summary: { totalRows: 3, valid: 2, existing: 0, duplicate: 0, rejected: 1, blankRows: 0 },
        unregistered: [withNewcomers.unregistered[2]!],
      },
    });
    fireEvent.click(register);

    await waitFor(() => expect(registerSheetEmployees).toHaveBeenCalledTimes(1));
    expect(registerSheetEmployees).toHaveBeenCalledWith(file, TODAY, [
      { employeeCode: "1", firstName: "ASHA", lastName: "PATIL", designation: "Operator", joiningDate: "2026-08-01", employmentType: "CONTRACT", shiftId: 1 },
      { employeeCode: "2", firstName: "RAVI", lastName: "", designation: "Operator", joiningDate: "2026-08-01", employmentType: "CONTRACT", shiftId: null },
    ]);
    expect(await within(dialog).findByText(/2 employees were registered in Workforce Management. No attendance has been saved yet/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Confirm import of 2 records/ })).toBeTruthy();
    expect(importAttendanceSheet).not.toHaveBeenCalled();
  });

  it("shows the server's per-employee reasons and keeps the review open when registration is refused", async () => {
    const { dialog } = await openReview();
    fireEvent.change(within(dialog).getByLabelText("Designation for all"), { target: { value: "Helper" } });
    fireEvent.change(within(dialog).getByLabelText("Joining date for all"), { target: { value: "2026-08-01" } });
    fireEvent.change(within(dialog).getByLabelText("Employment type for all"), { target: { value: "FULL_TIME" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply to 2 selected" }));
    fireEvent.click(within(dialog).getByLabelText(/I have checked these 2 employee records/));
    vi.mocked(registerSheetEmployees).mockRejectedValue({
      status: 422, code: "VALIDATION_ERROR", message: "No employees were registered: 1 problem to fix.",
      details: [{ field: "employees.1", message: "2: is already registered in Workforce Management." }],
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Register 2 employees" }));
    expect(await within(dialog).findByText("2: is already registered in Workforce Management.")).toBeTruthy();
    expect(within(dialog).getByText(/Nothing was saved/)).toBeTruthy();
    expect(within(dialog).getByLabelText("Register employees from the sheet")).toBeTruthy();
  });
});
