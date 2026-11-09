// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/services/employees.service", () => ({
  assignDepartment: vi.fn(), assignShift: vi.fn(), createEmployee: vi.fn(), updateEmployee: vi.fn(),
}));
vi.mock("../../../../lib/services/departments.service", () => ({ createDepartment: vi.fn() }));
vi.mock("../../../../lib/services/workforce.service", () => ({
  createAttendance: vi.fn(), createEmployeeOutput: vi.fn(), createShift: vi.fn(), getAttendance: vi.fn(),
  getEmployeeOutputs: vi.fn(), updateAttendance: vi.fn(), updateEmployeeOutput: vi.fn(),
}));

import { createEmployee, updateEmployee, type EmployeeDto } from "../../../../lib/services/employees.service";
import { getEmployeeOutputs } from "../../../../lib/services/workforce.service";
import { EmployeeDialog } from "../workforce/EmployeeDialog";
import { weeklyOffText } from "../../../../lib/plant";
import type { WorkforcePermissions } from "../../../../lib/workforce";

// Profile only: no attendance or performance sections to fill in
const perms: WorkforcePermissions = {
  editEmployees: true, deleteEmployees: false, viewPay: false, createLookups: false,
  viewAttendance: false, editAttendance: false, deleteAttendance: false, editPerformance: false,
};

const employee: EmployeeDto = {
  id: 7, employeeCode: "EMP-007", firstName: "Ravi", lastName: "Kale", email: null, phone: null, gender: null,
  designation: "Press Operator", employmentType: "FULL_TIME", salary: null, dailyWageRate: null, status: "ACTIVE",
  departmentId: null, department: null, shiftId: null, shift: null, managerId: null, profileImage: null,
  joiningDate: "2024-01-08T00:00:00.000Z", createdAt: "", updatedAt: "", deletedAt: null, weeklyOffDay: null,
};

const open = (e: EmployeeDto | null) => render(
  <EmployeeDialog mode={e ? "edit" : "add"} employee={e} initialDate="2026-11-09" departments={[]} shifts={[]}
    perms={perms} onClose={vi.fn()} onChanged={vi.fn()} onSaved={vi.fn()} />,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEmployeeOutputs).mockResolvedValue({ data: [], meta: { page: 1, pageSize: 1, total: 0, totalPages: 1 } } as never);
  vi.mocked(updateEmployee).mockImplementation(async (_id, patch) => ({ ...employee, ...patch } as EmployeeDto));
  vi.mocked(createEmployee).mockImplementation(async (payload) => ({ ...employee, ...payload } as EmployeeDto));
});
afterEach(cleanup);

/** Save is enabled once the dialog has loaded the day's records */
async function save() {
  const button = screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe("an employee's weekly off", () => {
  it("defaults to the plant weekly off, Saturday", () => {
    open(employee);
    const select = screen.getByLabelText("Weekly off") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]!.textContent).toBe("Plant weekly off (Saturday)");
    expect(screen.getByText(/Sunday is a working day/)).toBeTruthy();
  });

  it("saves an employee's own weekly off, and only that change", async () => {
    open(employee);
    fireEvent.change(screen.getByLabelText("Weekly off"), { target: { value: "0" } });
    await save();
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith(7, { weeklyOffDay: 0 }));
  });

  it("can go back to the plant weekly off", async () => {
    open({ ...employee, weeklyOffDay: 3 });
    expect((screen.getByLabelText("Weekly off") as HTMLSelectElement).value).toBe("3");
    fireEvent.change(screen.getByLabelText("Weekly off"), { target: { value: "" } });
    await save();
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith(7, { weeklyOffDay: null }));
  });

  it("sends nothing for the weekly off when it is unchanged", async () => {
    open(employee);
    fireEvent.change(screen.getByLabelText(/Designation/), { target: { value: "Setter" } });
    await save();
    await waitFor(() => expect(updateEmployee).toHaveBeenCalledWith(7, { designation: "Setter" }));
  });

  it("describes it in words", () => {
    expect(weeklyOffText(null)).toBe("Saturday (plant weekly off)");
    expect(weeklyOffText(0)).toBe("Sunday");
  });
});
