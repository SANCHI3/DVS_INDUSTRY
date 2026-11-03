// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as ApiModule from "../../../lib/api";

vi.mock("../../../lib/auth", () => ({ login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  waitForServer: vi.fn(),
  isMailConfigured: vi.fn().mockResolvedValue(true),
}));

import { login, logout } from "../../../lib/auth";
import { isMailConfigured, waitForServer } from "../../../lib/api";
import { LoginPage } from "../LoginPage";

const apiLogin = vi.mocked(login);
const wait = vi.mocked(waitForServer);
const user = { id: 1, fullName: "Asha Rao", email: "asha@test.com", role: "ADMIN", isActive: true };

function signIn(portal: "admin" | "production" | "store" = "admin", onLoginSuccess = vi.fn()) {
  render(<LoginPage initialRole={portal} onNavigateHome={vi.fn()} onLoginSuccess={onLoginSuccess} />);
  fireEvent.change(screen.getByLabelText(/Email Address/), { target: { value: "asha@test.com" } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "secret-password" } });
  // Pressing Enter in the form submits it
  fireEvent.submit(screen.getByLabelText(/Password/).closest("form")!);
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

describe("Login page", () => {
  it("falls back to the administrator portal for an unknown role instead of crashing", () => {
    render(<LoginPage initialRole={"quality" as never} onNavigateHome={vi.fn()} onLoginSuccess={vi.fn()} />);
    expect(screen.getByText("Administrator Portal")).toBeTruthy();
  });

  it("has no Sign Up tab and tells people who to ask for access", () => {
    render(<LoginPage initialRole="admin" onNavigateHome={vi.fn()} onLoginSuccess={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Sign Up" })).toBeNull();
    expect(screen.getByText("Need access? Contact your administrator.")).toBeTruthy();
  });

  it("labels the fields for password managers", () => {
    render(<LoginPage initialRole="admin" onNavigateHome={vi.fn()} onLoginSuccess={vi.fn()} />);
    expect(screen.getByLabelText(/Email Address/).getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText(/Password/).getAttribute("autocomplete")).toBe("current-password");
  });
});

describe("Forgot password", () => {
  it("is offered when the server can send email", async () => {
    vi.mocked(isMailConfigured).mockResolvedValue(true);
    render(<LoginPage initialRole="admin" onNavigateHome={vi.fn()} onLoginSuccess={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Forgot password?" })).toBeTruthy();
  });

  it("points to an administrator when email is not set up", async () => {
    vi.mocked(isMailConfigured).mockResolvedValue(false);
    render(<LoginPage initialRole="admin" onNavigateHome={vi.fn()} onLoginSuccess={vi.fn()} />);
    expect(await screen.findByText("Forgot your password? Ask your administrator to reset it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Forgot password?" })).toBeNull();
  });
});

describe("Portal must match the account", () => {
  it("refuses an administrator account on the Production portal and signs it out", async () => {
    apiLogin.mockResolvedValue({ user, frontendRole: "admin" });
    const onLoginSuccess = vi.fn();

    signIn("production", onLoginSuccess);

    expect(await screen.findByText('This is an Administrator account. Choose "Administrator" above to sign in.')).toBeTruthy();
    expect(vi.mocked(logout)).toHaveBeenCalled();
    expect(onLoginSuccess).not.toHaveBeenCalled();
  });

  it("names the Production portal when a production account uses the Store portal", async () => {
    apiLogin.mockResolvedValue({ user: { ...user, role: "PRODUCTION" }, frontendRole: "production" });

    signIn("store");

    expect(await screen.findByText('This is a Production account. Choose "Production" above to sign in.')).toBeTruthy();
  });

  it("signs a production account in on the Production portal", async () => {
    apiLogin.mockResolvedValue({ user: { ...user, role: "PRODUCTION" }, frontendRole: "production" });

    signIn("production");

    expect(await screen.findByText(/Authenticated\. Loading Asha's dashboard/)).toBeTruthy();
  });
});
