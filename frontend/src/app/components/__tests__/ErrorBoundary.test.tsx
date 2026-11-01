// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../shared/ErrorBoundary";

afterEach(cleanup);

function Broken(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("shows a reload screen instead of a blank page when a child throws", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByRole("alert").textContent).toMatch(/Something went wrong/);
    expect(screen.getByRole("button", { name: /Reload/ })).toBeTruthy();
    quiet.mockRestore();
  });

  it("renders its children when nothing fails", () => {
    render(<ErrorBoundary><p>All good</p></ErrorBoundary>);
    expect(screen.getByText("All good")).toBeTruthy();
  });
});
