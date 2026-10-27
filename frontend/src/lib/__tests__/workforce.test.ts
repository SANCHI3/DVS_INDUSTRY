import { describe, expect, it } from "vitest";
import { toCsv } from "../csv";
import type { EmployeeDto } from "../services/employees.service";
import type { AttendanceDto, EmployeeOutputDto } from "../services/workforce.service";
import {
  attendanceCsvRows, calculateEfficiency, exportFilename, findByName, formatEfficiency, localIsoDate,
  suggestDepartmentCode, validateEmployeeForm, workforceCsvRows, workforcePermissions, type EmployeeFormValues,
} from "../workforce";

const employee = (over: Partial<EmployeeDto> = {}): EmployeeDto => ({
  id: 1, employeeCode: "EMP-001", firstName: "Zoë", lastName: "Ñúñez, \"Jr\"", email: null, phone: null, gender: null,
  designation: "Operator", employmentType: "FULL_TIME", salary: "24000.00", dailyWageRate: "650.00", status: "ACTIVE",
  departmentId: null, department: { id: 2, name: "Machining", code: "MACH" }, shiftId: null, shift: { id: 3, name: "General" },
  managerId: null, profileImage: null, joiningDate: "2024-04-01T00:00:00.000Z", createdAt: "", updatedAt: "", deletedAt: null,
  ...over,
});

const ref = { id: 1, employeeCode: "EMP-001", firstName: "राम", lastName: "कुमार", designation: "Welder", department: { id: 2, name: "Machining" }, shift: null };

const output = (over: Partial<EmployeeOutputDto> = {}): EmployeeOutputDto => ({
  id: 9, employeeId: 1, employee: ref, date: "2026-10-20T00:00:00.000Z", workingHours: 8, expectedParts: 200, producedParts: 180,
  operationsCount: 4, efficiency: 90, remarks: null, recordedById: 1, createdAt: "", updatedAt: "", ...over,
});

const attendance = (over: Partial<AttendanceDto> = {}): AttendanceDto => ({
  id: 5, employeeId: 1, employee: ref, date: "2026-10-20T00:00:00.000Z", clockIn: null, clockOut: null, workingHours: null,
  status: "WEEK_OFF", remarks: "Line 2\nshutdown, planned", createdAt: "", updatedAt: "", ...over,
});

describe("workforcePermissions", () => {
  it("mirrors the backend rules for each role", () => {
    expect(workforcePermissions("ADMIN")).toMatchObject({ editEmployees: true, deleteEmployees: true, viewPay: true, viewAttendance: true, editPerformance: true });
    expect(workforcePermissions("HR")).toMatchObject({ editEmployees: true, deleteEmployees: false, viewPay: true, editAttendance: true });
    expect(workforcePermissions("MANAGER")).toMatchObject({ editEmployees: false, viewPay: false, viewAttendance: true, editAttendance: false, editPerformance: false });
    expect(workforcePermissions("PRODUCTION")).toMatchObject({ editEmployees: false, viewPay: false, viewAttendance: false, editPerformance: true });
    expect(Object.values(workforcePermissions(null)).some(Boolean)).toBe(false);
  });
});

describe("efficiency", () => {
  it("is produced / expected × 100", () => {
    expect(calculateEfficiency(200, 180)).toBe(90);
    expect(formatEfficiency(calculateEfficiency(3, 2))).toBe("66.7%");
  });

  it.each([[0, 5], [null, 5], [5, null], [Number.NaN, 5]])("shows N/A, never Infinity or NaN, for %s/%s", (expected, produced) => {
    expect(formatEfficiency(calculateEfficiency(expected, produced))).toBe("N/A");
  });
});

describe("workforce CSV", () => {
  it("writes one row per employee with Unicode, commas and quotes kept in their column", () => {
    const rows = workforceCsvRows([{ employee: employee(), output: output(), attendance: attendance() }], { date: "2026-10-20", includePay: true, includeAttendance: true });
    const csv = toCsv(rows);
    expect(csv).toContain('"Zoë","Ñúñez, ""Jr"""');
    expect(rows[1]).toContain("Week Off");
    expect(rows[1]).toContain("90.0");
    expect(rows[1]).toContain("650.00");
    expect(rows[1]).toContain("2024-04-01");
  });

  it("leaves out pay and attendance columns for roles that may not see them", () => {
    const rows = workforceCsvRows([{ employee: employee(), output: null, attendance: null }], { date: "2026-10-20", includePay: false, includeAttendance: false });
    expect(rows[0]).not.toContain("Daily Wage Rate");
    expect(rows[0]).not.toContain("Attendance Status");
    expect(rows[1]).not.toContain("650.00");
    expect(rows[0]!.length).toBe(rows[1]!.length);
  });

  it("marks efficiency N/A when recorded figures cannot produce one, and blank when nothing was recorded", () => {
    const rows = workforceCsvRows([
      { employee: employee(), output: output({ expectedParts: 0, efficiency: null }), attendance: null },
      { employee: employee({ id: 2 }), output: null, attendance: null },
    ], { date: "2026-10-20", includePay: false, includeAttendance: false });
    const col = rows[0]!.indexOf("Efficiency (%)");
    expect(rows[1]![col]).toBe("N/A");
    expect(rows[2]![col]).toBe("");
  });

  it("exports attendance with line breaks and commas quoted", () => {
    const csv = toCsv(attendanceCsvRows([attendance()]));
    expect(csv).toContain('"Line 2\nshutdown, planned"');
    expect(csv).toContain('"राम कुमार"');
    expect(csv.split("\r\n")[0]).toBe('"Date","Employee ID","Employee Name","Department","Designation","Shift","Status","Check-In","Check-Out","Hours Worked","Remarks"');
  });

  it("names files after the report and export date", () => {
    expect(exportFilename("Attendance", "2026-10-01_to_2026-10-26", "2026-10-26")).toBe("DVS_Attendance_2026-10-01_to_2026-10-26_exported_2026-10-26.csv");
  });
});

describe("departments typed into the form", () => {
  it("matches an existing name regardless of case and spacing, so no duplicate is created", () => {
    const list = [{ id: 1, name: "Machining" }];
    expect(findByName(list, "  machining ")?.id).toBe(1);
    expect(findByName(list, "Assembly")).toBeUndefined();
    expect(findByName(list, "")).toBeUndefined();
  });

  it("suggests a valid unused code", () => {
    expect(suggestDepartmentCode("Quality Control", [])).toBe("QC");
    expect(suggestDepartmentCode("Quality Control", ["QC"])).toBe("QC2");
    expect(suggestDepartmentCode("Paint", [])).toMatch(/^[A-Z0-9_]{2,10}$/);
    expect(suggestDepartmentCode("X", [])).toMatch(/^[A-Z0-9_]{2,10}$/);
  });
});

describe("employee form validation", () => {
  const valid: EmployeeFormValues = {
    employeeCode: "EMP-010", firstName: "Asha", lastName: "", designation: "Fitter", joiningDate: "2026-01-05",
    dailyWageRate: "650", workingHours: "8", expectedParts: "100", producedParts: "95", operationsCount: "3",
    performanceDate: "2026-01-06",
  };
  const all = { checkProfile: true, checkPay: true, checkPerformance: true };

  it("accepts a complete form with an empty last name", () => {
    expect(validateEmployeeForm(valid, all)).toEqual({});
  });

  it.each<[Partial<EmployeeFormValues>, keyof EmployeeFormValues]>([
    [{ employeeCode: "" }, "employeeCode"],
    [{ employeeCode: "emp 10" }, "employeeCode"],
    [{ firstName: " " }, "firstName"],
    [{ designation: "" }, "designation"],
    [{ joiningDate: "" }, "joiningDate"],
    [{ dailyWageRate: "-1" }, "dailyWageRate"],
    [{ dailyWageRate: "12.345" }, "dailyWageRate"],
    [{ workingHours: "25" }, "workingHours"],
    [{ expectedParts: "-3" }, "expectedParts"],
    [{ producedParts: "abc" }, "producedParts"],
    [{ operationsCount: "2.5" }, "operationsCount"],
    [{ performanceDate: "2999-01-01" }, "performanceDate"],
  ])("rejects %o", (patch, field) => {
    expect(validateEmployeeForm({ ...valid, ...patch }, all)[field]).toBeTruthy();
  });

  it("skips sections the user cannot edit", () => {
    expect(validateEmployeeForm({ ...valid, employeeCode: "", dailyWageRate: "-1" }, { checkProfile: false, checkPay: false, checkPerformance: true })).toEqual({});
  });
});

describe("localIsoDate", () => {
  it("uses the local calendar day", () => {
    expect(localIsoDate(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
  });
});

describe("one efficiency rule for backend and frontend", () => {
  it("gives the same answer as the API's calculation for every case", async () => {
    const backend = await import("../../../../backend/src/utils/efficiency");
    const cases: [number | null, number | null][] = [
      [200, 180], [3, 2], [100, 125], [50, 0], [0, 10], [null, 10], [10, null], [-5, 10], [0.1, 0.07], [1e9, 1],
    ];
    for (const [expected, produced] of cases) {
      expect(calculateEfficiency(expected, produced)).toBe(backend.calculateEfficiency(expected, produced));
    }
  });
});
