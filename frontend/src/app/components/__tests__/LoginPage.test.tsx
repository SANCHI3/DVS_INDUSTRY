// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as ApiModule from "../../../lib/api";

vi.mock("../../../lib/auth", () => ({ login: vi.fn() }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  waitForServer: vi.fn(),
}));

import { login } from "../../../lib/auth";
import { waitForServer } from "../../../lib/api";
import { LoginPage } from "../LoginPage";

const apiLogin = vi.mocked(login);
const wait = vi.mocked(waitForServer);
const user = { id: 1, fullName: "Asha Rao", email: "asha@test.com", role: "ADMIN", isActive: true };

function signIn() {
  render(<LoginPage initialRole="admin" onNavigateHome={vi.fn()} onLoginSuccess={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("Enter your email"), { target: { value: "asha@test.com" } });
  fireEvent.change(screen.getByPlaceholderText("Enter password"), { target: { value: "secret-password" } });
  // The mode tab and the submit button are both labelled "Sign In"; submit comes last
  fireEvent.click(screen.getAllByRole("button", { name: /Sign In/ }).at(-1)!);
}

beforeEach(() => {
  apiLogin.mockReset();
  wait.mockReset();
});
afterEach(cleanup);

describe("Login while the server is asleep", () => {
  it("waits for the server, says so, and signs in without a second click", async () => {
    let wake!: (up: boolean) => void;
    wait.mockReturnValue(new Promise((resolve) => { wake = resolve; }));
    apiLogin
      .mockRejectedValueOnce({ status: 0, code: "NETWORK_ERROR", message: "timeout of 15000ms exceeded" })
      .mockResolvedValueOnce({ user, frontendRole: "admin" });

    signIn();

    expect(await screen.findByText("Starting the server…")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/up to a minute/);
    wake(true);

    expect(await screen.findByText(/Authenticated\. Loading Asha's dashboard/)).toBeTruthy();
    expect(apiLogin).toHaveBeenCalledTimes(2);
  });

  it("gives up with a clear message when the server never starts", async () => {
    wait.mockResolvedValue(false);
    apiLogin.mockRejectedValue({ status: 503, code: "X", message: "Service Unavailable" });

    signIn();

    expect(await screen.findByText(/server is not responding/)).toBeTruthy();
    expect(apiLogin).toHaveBeenCalledTimes(1);
  });

  it("shows a wrong password straight away, without waiting", async () => {
    apiLogin.mockRejectedValue({ status: 401, code: "UNAUTHORIZED", message: "Invalid email or password" });

    signIn();

    expect(await screen.findByText("Invalid email or password")).toBeTruthy();
    expect(wait).not.toHaveBeenCalled();
  });
});
