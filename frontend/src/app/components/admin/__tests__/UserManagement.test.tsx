// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../../lib/services/users.service", () => ({
  getUsers: vi.fn(), getRoles: vi.fn(), registerUser: vi.fn(), updateUser: vi.fn(), deactivateUser: vi.fn(),
}));
vi.mock("../../../../lib/services/audit.service", () => ({ getAuditLogs: vi.fn().mockResolvedValue({ data: [] }) }));
vi.mock("../../../../lib/services/orders.service", () => ({ getSuppliers: vi.fn(), getClients: vi.fn() }));

import { toast } from "sonner";
import { getRoles, getUsers, registerUser, updateUser } from "../../../../lib/services/users.service";
import { UserManagementPage } from "../UserManagementPage";

const roles = [{ id: 1, name: "ADMIN" }, { id: 3, name: "HR" }, { id: 9, name: "PERCEPTION_SERVICE" }];
const person = (id: number, isActive: boolean) => ({
  id, fullName: `Person ${id}`, email: `p${id}@dvs.in`, isActive, lastLogin: null,
  createdAt: "2026-10-01T00:00:00Z", role: { id: 3, name: "HR" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRoles).mockResolvedValue(roles as never);
  vi.mocked(getUsers).mockResolvedValue([person(5, false)] as never);
  vi.mocked(registerUser).mockResolvedValue(person(12, true) as never);
  vi.mocked(updateUser).mockResolvedValue(person(5, true) as never);
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

async function openAdd() {
  render(<UserManagementPage />);
  await screen.findByText("Person 5");
  fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
  const dialog = await screen.findByRole("dialog", { name: "Add New User" });
  const inputs = within(dialog).getAllByRole("textbox");
  fireEvent.change(inputs[0]!, { target: { value: "Meera Joshi" } });
  fireEvent.change(inputs[1]!, { target: { value: "meera@dvs.in" } });
  return dialog;
}

describe("Add user", () => {
  it("has no role chosen by default and asks for one", async () => {
    const dialog = await openAdd();
    expect((within(dialog).getByLabelText("Role") as HTMLSelectElement).value).toBe("");
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "Strong@Pass9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add User" }));
    expect(toast.error).toHaveBeenCalledWith("Choose a role for the new user.");
    expect(registerUser).not.toHaveBeenCalled();
  });

  it("shows the password rules and refuses a weak password", async () => {
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "hr" } });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "weak" } });
    expect(within(dialog).getByRole("list", { name: "Password rules" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add User" }));
    expect(toast.error).toHaveBeenCalledWith("The password does not meet all the rules yet.");
    expect(registerUser).not.toHaveBeenCalled();
  });

  it("saves an inactive account as inactive", async () => {
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "hr" } });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "Strong@Pass9" } });
    fireEvent.change(within(dialog).getAllByRole("combobox")[1]!, { target: { value: "inactive" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add User" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith(12, { isActive: false }));
    expect(registerUser).toHaveBeenCalledWith(expect.objectContaining({ roleId: 3 }));
  });
});

describe("User list", () => {
  it("labels the HR filter properly and has no Department column", async () => {
    render(<UserManagementPage />);
    await screen.findByText("Person 5");
    expect(screen.getByRole("button", { name: "HR" })).toBeTruthy();
    expect(screen.queryByText("Department")).toBeNull();
  });
});
