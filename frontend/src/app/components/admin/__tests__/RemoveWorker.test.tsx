// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../../../lib/auth", () => ({ getStoredBackendRole: vi.fn() }));
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
import { createEmployee, deleteEmployee, getEmployees, type EmployeeDto } from "../../../../lib/services/employees.service";
import { getDepartments } from "../../../../lib/services/departments.service";
import { getAttendance, getEmployeeOutputs, getShifts } from "../../../../lib/services/workforce.service";
import { removalPhrase } from "../../../../lib/workforce";
import { WorkforceManagement } from "../WorkforceManagement";

const meta = (total: number, pageSize = 25) => ({ page: 1, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
const alex: EmployeeDto = {
  id: 1, employeeCode: "EMP-TEST-001", firstName: "Alex", lastName: "Morgan", email: null, phone: null, gender: null,
  designation: "Operator", employmentType: "FULL_TIME", salary: null, dailyWageRate: null, status: "ACTIVE",
  departmentId: null, department: null, shiftId: null, shift: null, managerId: null, profileImage: null,
  joiningDate: "2025-01-01T00:00:00.000Z", createdAt: "", updatedAt: "", deletedAt: null,
};
const PHRASE = "REMOVE EMP-TEST-001 — Alex Morgan";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStoredBackendRole).mockReturnValue("ADMIN");
  vi.mocked(getEmployees).mockResolvedValue({ data: [alex], meta: meta(1) });
  vi.mocked(getDepartments).mockResolvedValue([]);
  vi.mocked(getShifts).mockResolvedValue({ data: [], meta: meta(0) });
  vi.mocked(getEmployeeOutputs).mockResolvedValue({ data: [], meta: meta(0, 100) });
  vi.mocked(getAttendance).mockResolvedValue({ data: [], meta: meta(0, 100) });
});
afterEach(cleanup);

async function openRemove() {
  render(<WorkforceManagement />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove Alex Morgan (EMP-TEST-001)" }));
  return screen.getByRole("dialog", { name: "Remove Worker?" });
}

describe("Remove worker — two-step confirmation", () => {
  it("builds the exact phrase with an em dash", () => {
    expect(removalPhrase(alex)).toBe(PHRASE);
    expect(removalPhrase({ ...alex, lastName: "" })).toBe("REMOVE EMP-TEST-001 — Alex");
  });

  it("step 1 shows the worker's name and ID, and Cancel removes nothing", async () => {
    const step1 = await openRemove();
    expect(within(step1).getByText("Alex Morgan")).toBeTruthy();
    expect(within(step1).getByText("EMP-TEST-001")).toBeTruthy();
    fireEvent.click(within(step1).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteEmployee).not.toHaveBeenCalled();
  });

  it("step 2 keeps Remove Worker disabled until the exact text is typed", async () => {
    fireEvent.click(within(await openRemove()).getByRole("button", { name: "Continue" }));
    const step2 = screen.getByRole("dialog", { name: "Confirm Worker Removal" });
    const input = within(step2).getByLabelText("Type the following exact text to confirm:");
    const button = within(step2).getByRole("button", { name: /Remove Worker/ }) as HTMLButtonElement;

    for (const wrong of ["remove EMP-TEST-001 — Alex Morgan", "REMOVE EMP-TEST-001 - Alex Morgan", `${PHRASE} `, "REMOVE EMP-TEST-001 — Alex  Morgan"]) {
      fireEvent.change(input, { target: { value: wrong } });
      expect(button.disabled).toBe(true);
    }
    fireEvent.click(button);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(deleteEmployee).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: PHRASE } });
    expect(button.disabled).toBe(false);
  });

  it("step 2 Cancel removes nothing", async () => {
    fireEvent.click(within(await openRemove()).getByRole("button", { name: "Continue" }));
    const step2 = screen.getByRole("dialog", { name: "Confirm Worker Removal" });
    fireEvent.change(within(step2).getByLabelText("Type the following exact text to confirm:"), { target: { value: PHRASE } });
    fireEvent.click(within(step2).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteEmployee).not.toHaveBeenCalled();
  });

  it("removes once, even on a double click, then refreshes the list from the API", async () => {
    let resolve!: () => void;
    vi.mocked(deleteEmployee).mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
    fireEvent.click(within(await openRemove()).getByRole("button", { name: "Continue" }));
    const step2 = screen.getByRole("dialog", { name: "Confirm Worker Removal" });
    fireEvent.change(within(step2).getByLabelText("Type the following exact text to confirm:"), { target: { value: PHRASE } });
    const button = within(step2).getByRole("button", { name: /Remove Worker/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await within(step2).findByText("Removing…")).toBeTruthy();
    expect(deleteEmployee).toHaveBeenCalledTimes(1);
    expect(deleteEmployee).toHaveBeenCalledWith(1);

    const callsBefore = vi.mocked(getEmployees).mock.calls.length;
    resolve();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Alex Morgan (EMP-TEST-001) was removed")));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(vi.mocked(getEmployees).mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("keeps the dialog open with the server's reason when removal fails", async () => {
    vi.mocked(deleteEmployee).mockRejectedValue({ status: 403, code: "FORBIDDEN", message: "Access denied" });
    fireEvent.click(within(await openRemove()).getByRole("button", { name: "Continue" }));
    const step2 = screen.getByRole("dialog", { name: "Confirm Worker Removal" });
    fireEvent.change(within(step2).getByLabelText("Type the following exact text to confirm:"), { target: { value: PHRASE } });
    fireEvent.click(within(step2).getByRole("button", { name: /Remove Worker/ }));
    expect(await within(step2).findByText("Could not remove Alex Morgan: your role does not have access to this.")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("explains a stale row (already removed elsewhere) and refreshes the list", async () => {
    vi.mocked(deleteEmployee).mockRejectedValue({ status: 400, code: "BAD_REQUEST", message: "Employee is already deleted" });
    fireEvent.click(within(await openRemove()).getByRole("button", { name: "Continue" }));
    const step2 = screen.getByRole("dialog", { name: "Confirm Worker Removal" });
    fireEvent.change(within(step2).getByLabelText("Type the following exact text to confirm:"), { target: { value: PHRASE } });
    const callsBefore = vi.mocked(getEmployees).mock.calls.length;
    fireEvent.click(within(step2).getByRole("button", { name: /Remove Worker/ }));
    expect(await within(step2).findByText(/is no longer in the active list/)).toBeTruthy();
    await waitFor(() => expect(vi.mocked(getEmployees).mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it.each(["HR", "MANAGER", "PRODUCTION"])("shows no remove button to %s", async (role) => {
    vi.mocked(getStoredBackendRole).mockReturnValue(role);
    render(<WorkforceManagement />);
    await screen.findByText("Alex Morgan");
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });
});

describe("Add employee — double submission", () => {
  it("creates the employee only once when Save is clicked twice", async () => {
    let resolve!: (e: EmployeeDto) => void;
    vi.mocked(createEmployee).mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<WorkforceManagement />);
    await screen.findByText("Alex Morgan");
    fireEvent.click(screen.getAllByRole("button", { name: /Add Employee/ })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Add New Employee" });
    fireEvent.change(within(dialog).getByLabelText(/^Employee ID/), { target: { value: "EMP-2" } });
    fireEvent.change(within(dialog).getByLabelText(/^First name/), { target: { value: "Ravi" } });
    fireEvent.change(within(dialog).getByLabelText(/^Designation/), { target: { value: "Fitter" } });
    const save = within(dialog).getByRole("button", { name: /Add Employee/ });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(createEmployee).toHaveBeenCalledTimes(1));
    resolve({ ...alex, id: 2, employeeCode: "EMP-2", firstName: "Ravi", lastName: "" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ravi added."));
    expect(createEmployee).toHaveBeenCalledTimes(1);
    // Not recorded: no attendance, and no empty performance record
    const call = vi.mocked(createEmployee).mock.calls[0]![0];
    expect(call).toMatchObject({ employeeCode: "EMP-2", lastName: "" });
  });
});
