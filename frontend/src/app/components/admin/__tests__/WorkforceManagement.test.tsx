// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as CsvModule from "../../../../lib/csv";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../../../lib/auth", () => ({ getStoredBackendRole: vi.fn() }));
vi.mock("../../../../lib/csv", async (orig) => ({ ...(await orig<typeof CsvModule>()), downloadCSV: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/services/employees.service", () => ({
  getEmployees: vi.fn(), createEmployee: vi.fn(), updateEmployee: vi.fn(), deleteEmployee: vi.fn(),
  assignDepartment: vi.fn(), assignShift: vi.fn(),
}));
vi.mock("../../../../lib/services/departments.service", () => ({ getDepartments: vi.fn(), createDepartment: vi.fn() }));
vi.mock("../../../../lib/services/workforce.service", () => ({
  getShifts: vi.fn(), createShift: vi.fn(), getAttendance: vi.fn(), createAttendance: vi.fn(), updateAttendance: vi.fn(),
  getEmployeeOutputs: vi.fn(), createEmployeeOutput: vi.fn(), updateEmployeeOutput: vi.fn(),
}));

import { toast } from "sonner";
import { getStoredBackendRole } from "../../../../lib/auth";
import { downloadCSV } from "../../../../lib/csv";
import { assignDepartment, createEmployee, getEmployees, updateEmployee, type EmployeeDto } from "../../../../lib/services/employees.service";
import { createDepartment, getDepartments } from "../../../../lib/services/departments.service";
import {
  createAttendance, createEmployeeOutput, getAttendance, getEmployeeOutputs, getShifts, updateEmployeeOutput,
} from "../../../../lib/services/workforce.service";
import { WorkforceManagement } from "../WorkforceManagement";

const meta = (total: number, pageSize = 25) => ({ page: 1, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

const emp: EmployeeDto = {
  id: 1, employeeCode: "EMP-001", firstName: "Ananya", lastName: "Iyer", email: null, phone: null, gender: null,
  designation: "CNC Operator", employmentType: "FULL_TIME", salary: "24000.00", dailyWageRate: "650.00", status: "ACTIVE",
  departmentId: null, department: { id: 2, name: "Machining", code: "MACH" }, shiftId: null, shift: { id: 3, name: "General" },
  managerId: null, profileImage: null, joiningDate: "2024-04-01T00:00:00.000Z", createdAt: "", updatedAt: "", deletedAt: null,
};

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();

const output = {
  id: 9, employeeId: 1, employee: { ...emp, shift: null }, date: `${today}T00:00:00.000Z`, workingHours: 8, expectedParts: 200,
  producedParts: 180, operationsCount: 4, efficiency: 90, remarks: null, recordedById: 1, createdAt: "", updatedAt: "",
};

function role(r: string) { vi.mocked(getStoredBackendRole).mockReturnValue(r); }

beforeEach(() => {
  vi.clearAllMocks();
  role("ADMIN");
  vi.mocked(getEmployees).mockResolvedValue({ data: [emp], meta: meta(1) });
  vi.mocked(getDepartments).mockResolvedValue([{ id: 2, name: "Machining", code: "MACH", description: null, managerId: null, isActive: true, createdAt: "", updatedAt: "" }]);
  vi.mocked(getShifts).mockResolvedValue({ data: [{ id: 3, name: "General", startTime: "09:00", endTime: "17:30", isNightShift: false, description: null, createdAt: "", updatedAt: "", _count: { employees: 1 } }], meta: meta(1) });
  vi.mocked(getEmployeeOutputs).mockResolvedValue({ data: [output], meta: meta(1, 100) });
  vi.mocked(getAttendance).mockResolvedValue({ data: [], meta: meta(0, 100) });
});

afterEach(cleanup);

describe("Workforce Management table", () => {
  it("shows saved employee, performance and pay from the API", async () => {
    render(<WorkforceManagement />);
    const row = (await screen.findByText("Ananya Iyer")).closest("tr")!;
    const cells = within(row);
    expect(cells.getByText("Machining")).toBeTruthy();
    expect(cells.getByText("General")).toBeTruthy();
    expect(cells.getByText("8 h")).toBeTruthy();
    expect(cells.getByText("180")).toBeTruthy();
    expect(cells.getByText("90.0%")).toBeTruthy();
    expect(cells.getByText("₹650.00")).toBeTruthy();
    expect(cells.getByText("Not recorded")).toBeTruthy(); // attendance
  });

  it("hides pay and attendance from a production supervisor", async () => {
    role("PRODUCTION");
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    expect(screen.queryByText("Daily Wage")).toBeNull();
    expect(screen.queryByText("Attendance")).toBeNull();
    expect(getAttendance).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Add Employee/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("explains a failed load instead of showing an empty table", async () => {
    vi.mocked(getEmployees).mockRejectedValue({ status: 500, code: "INTERNAL_ERROR", message: "Database unavailable" });
    render(<WorkforceManagement />);
    expect(await screen.findByText(/Could not load employees: Database unavailable \(server error 500\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try Again/ })).toBeTruthy();
  });

  it("shows an accurate empty state", async () => {
    vi.mocked(getEmployees).mockResolvedValue({ data: [], meta: meta(0) });
    render(<WorkforceManagement />);
    expect(await screen.findByText("No employees yet")).toBeTruthy();
  });

  it("sends search and the status filter to the API and resets to page 1", async () => {
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.change(screen.getByLabelText("Filter by employment status"), { target: { value: "ON_LEAVE" } });
    fireEvent.change(screen.getByLabelText("Search employees by ID or name"), { target: { value: "EMP-0" } });
    await waitFor(() => expect(getEmployees).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1, status: "ON_LEAVE", search: "EMP-0",
    })));
    const lastQuery = vi.mocked(getEmployees).mock.calls.at(-1)![0]!;
    expect(lastQuery).not.toHaveProperty("departmentId");
    expect(lastQuery).not.toHaveProperty("shiftId");
  });

  it("has no department or shift filter in the toolbar, but still shows both on each row", async () => {
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    expect(screen.queryByLabelText("Filter by department")).toBeNull();
    expect(screen.queryByLabelText("Filter by shift")).toBeNull();
    expect(screen.queryByRole("option", { name: "All departments" })).toBeNull();
    expect(screen.queryByRole("option", { name: "All shifts" })).toBeNull();
    expect(screen.getByLabelText("Search employees by ID or name")).toBeTruthy();
    expect(screen.getByLabelText("Performance and attendance date")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Department" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Shift" })).toBeTruthy();
  });

  it("exports every matching employee across pages, with pay only for permitted roles", async () => {
    vi.mocked(getEmployees).mockImplementation(async (q) =>
      q?.pageSize === 100
        ? { data: q.page === 1 ? [emp] : [{ ...emp, id: 2, employeeCode: "EMP-002", firstName: "Ravi" }], meta: { page: q.page ?? 1, pageSize: 100, total: 101, totalPages: 2 } }
        : { data: [emp], meta: meta(1) });
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));

    await waitFor(() => expect(downloadCSV).toHaveBeenCalled());
    const [filename, rows] = vi.mocked(downloadCSV).mock.calls[0]!;
    expect(filename).toMatch(/^DVS_Workforce_\d{4}-\d{2}-\d{2}_exported_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(rows).toHaveLength(3); // header + 2 employees from 2 pages
    expect(rows[0]).toContain("Daily Wage Rate");
  });

  it("reports an export failure", async () => {
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    vi.mocked(getEmployees).mockRejectedValue({ status: 403, code: "FORBIDDEN", message: "no" });
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not export workforce data: your role does not have access to this."));
    expect(downloadCSV).not.toHaveBeenCalled();
  });
});

describe("Employee dialog", () => {
  it("creates an employee with a new department and today's performance and attendance", async () => {
    vi.mocked(getEmployeeOutputs).mockResolvedValue({ data: [], meta: meta(0, 100) });
    vi.mocked(createDepartment).mockResolvedValue({ id: 7, name: "Paint Shop", code: "PS", description: null, managerId: null, isActive: true, createdAt: "", updatedAt: "" });
    vi.mocked(createEmployee).mockResolvedValue({ ...emp, id: 5, employeeCode: "EMP-005", firstName: "Ravi", lastName: "" });
    vi.mocked(createEmployeeOutput).mockResolvedValue({ ...output, id: 10, employeeId: 5 });
    vi.mocked(createAttendance).mockResolvedValue({ id: 3, employeeId: 5, employee: output.employee, date: today, clockIn: null, clockOut: null, workingHours: null, status: "PRESENT", remarks: null, createdAt: "", updatedAt: "" });

    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getAllByRole("button", { name: /Add Employee/ })[0]!);

    const dialog = screen.getByRole("dialog", { name: "Add New Employee" });
    const set = (label: string | RegExp, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    set(/^Employee ID/, "emp-005");
    set(/^First name/, "Ravi");
    set(/^Designation/, "Painter");
    set(/^Department/, "Paint Shop");
    set(/^Daily wage rate/, "700");
    set(/^Expected parts/, "100");
    set(/^Produced parts/, "0");
    set(/^Attendance status/, "PRESENT");
    expect(within(dialog).getByText("0.0%")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /Add Employee/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ravi added."));
    expect(createDepartment).toHaveBeenCalledWith({ name: "Paint Shop", code: "PS" });
    expect(createEmployee).toHaveBeenCalledWith(expect.objectContaining({
      employeeCode: "EMP-005", firstName: "Ravi", lastName: "", departmentId: 7, shiftId: null, dailyWageRate: "700", status: "ACTIVE",
    }));
    expect(createEmployeeOutput).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 5, date: today, expectedParts: 100, producedParts: 0 }));
    expect(createAttendance).toHaveBeenCalledWith({ employeeId: 5, date: today, status: "PRESENT" });
  });

  it("Edit opens with every saved value and saves only the changes to the same employee", async () => {
    vi.mocked(updateEmployee).mockResolvedValue({ ...emp, designation: "Senior CNC Operator", lastName: "Iyer-Rao" });
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getByRole("button", { name: "Edit Ananya Iyer" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Employee" });
    const value = (label: RegExp) => (within(dialog).getByLabelText(label) as HTMLInputElement).value;
    expect(value(/^Employee ID/)).toBe("EMP-001");
    expect(value(/^First name/)).toBe("Ananya");
    expect(value(/^Last name/)).toBe("Iyer");
    expect(value(/^Designation/)).toBe("CNC Operator");
    expect(value(/^Department/)).toBe("Machining");
    expect(value(/^Shift/)).toBe("General");
    expect(value(/^Joining date/)).toBe("2024-04-01");
    expect(value(/^Employment type/)).toBe("FULL_TIME");
    expect(value(/^Employment status/)).toBe("ACTIVE");
    expect(value(/^Daily wage rate/)).toBe("650.00");
    await waitFor(() => expect(value(/^Expected parts/)).toBe("200"));

    fireEvent.change(within(dialog).getByLabelText(/^Designation/), { target: { value: "Senior CNC Operator" } });
    fireEvent.change(within(dialog).getByLabelText(/^Last name/), { target: { value: " Iyer-Rao " } });
    const listCalls = vi.mocked(getEmployees).mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Changes/ }));

    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith(1, { designation: "Senior CNC Operator", lastName: "Iyer-Rao" }));
    expect(createEmployee).not.toHaveBeenCalled();
    expect(createEmployeeOutput).not.toHaveBeenCalled(); // performance unchanged: history untouched
    await waitFor(() => expect(vi.mocked(getEmployees).mock.calls.length).toBeGreaterThan(listCalls));
  });

  it("Edit uses the same validation as Add and saves nothing while a field is invalid", async () => {
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getByRole("button", { name: "Edit Ananya Iyer" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Employee" });
    await waitFor(() => expect((within(dialog).getByLabelText(/^Expected parts/) as HTMLInputElement).value).toBe("200"));
    fireEvent.change(within(dialog).getByLabelText(/^First name/), { target: { value: "   " } });
    fireEvent.change(within(dialog).getByLabelText(/^Daily wage rate/), { target: { value: "-5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Changes/ }));
    expect(await within(dialog).findByText("First name is required.")).toBeTruthy();
    expect(within(dialog).getByText("Enter a non-negative amount with up to 2 decimals.")).toBeTruthy();
    expect(updateEmployee).not.toHaveBeenCalled();
    expect(createEmployee).not.toHaveBeenCalled();
  });

  it("does not create a duplicate department when the name differs only in case", async () => {
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getByRole("button", { name: "Edit Ananya Iyer" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Employee" });
    await waitFor(() => expect((within(dialog).getByLabelText(/^Expected parts/) as HTMLInputElement).value).toBe("200"));

    fireEvent.change(within(dialog).getByLabelText(/^Department/), { target: { value: "  machining " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Changes/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(createDepartment).not.toHaveBeenCalled();
    expect(assignDepartment).not.toHaveBeenCalled();
    expect(updateEmployee).not.toHaveBeenCalled();
  });

  it("updates the existing performance record instead of creating a second one", async () => {
    vi.mocked(updateEmployeeOutput).mockResolvedValue({ ...output, producedParts: 190 });
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getByRole("button", { name: "Edit Ananya Iyer" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Employee" });
    await waitFor(() => expect((within(dialog).getByLabelText(/^Produced parts/) as HTMLInputElement).value).toBe("180"));

    fireEvent.change(within(dialog).getByLabelText(/^Produced parts/), { target: { value: "190" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save Changes/ }));

    await waitFor(() => expect(updateEmployeeOutput).toHaveBeenCalledWith(9, { producedParts: 190 }));
    expect(createEmployeeOutput).not.toHaveBeenCalled();
  });

  it("shows field errors and does not call the API for invalid input", async () => {
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getAllByRole("button", { name: /Add Employee/ })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Add New Employee" });
    fireEvent.change(within(dialog).getByLabelText(/^Expected parts/), { target: { value: "-4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add Employee/ }));

    expect(await within(dialog).findByText("Employee ID is required.")).toBeTruthy();
    expect(within(dialog).getByText("Expected parts cannot be negative.")).toBeTruthy();
    expect(createEmployee).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and explains a duplicate employee ID", async () => {
    vi.mocked(createEmployee).mockRejectedValue({ status: 409, code: "CONFLICT", message: 'Employee with code "EMP-001" already exists' });
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getAllByRole("button", { name: /Add Employee/ })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Add New Employee" });
    fireEvent.change(within(dialog).getByLabelText(/^Employee ID/), { target: { value: "EMP-001" } });
    fireEvent.change(within(dialog).getByLabelText(/^First name/), { target: { value: "Dup" } });
    fireEvent.change(within(dialog).getByLabelText(/^Designation/), { target: { value: "Helper" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add Employee/ }));

    expect(await within(dialog).findByText('Could not create the employee: Employee with code "EMP-001" already exists.')).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Add New Employee" })).toBeTruthy();
  });

  it("shows N/A efficiency when expected parts is zero", async () => {
    vi.mocked(getEmployeeOutputs).mockResolvedValue({ data: [{ ...output, expectedParts: 0, efficiency: null }], meta: meta(1, 100) });
    render(<WorkforceManagement />);
    await screen.findByText("Ananya Iyer");
    fireEvent.click(screen.getByRole("button", { name: "View Ananya Iyer" }));
    const dialog = screen.getByRole("dialog", { name: "Employee Details" });
    expect(await within(dialog).findByText("Expected parts is 0, so efficiency cannot be calculated.")).toBeTruthy();
    expect(within(dialog).getByText("N/A")).toBeTruthy();
  });
});
