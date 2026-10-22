// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../../lib/services/assistant.service", () => ({
  getAssistantStatus: vi.fn(),
  askAssistant: vi.fn(),
}));

import { askAssistant, getAssistantStatus } from "../../../../lib/services/assistant.service";
import { AskDvs, exampleQuestions } from "../AskDvs";

const status = vi.mocked(getAssistantStatus);
const ask = vi.mocked(askAssistant);

beforeEach(() => {
  status.mockResolvedValue({ configured: true });
  ask.mockReset();
  // jsdom has no layout; the panel scrolls its message list.
  Element.prototype.scrollTo = vi.fn();
});

afterEach(cleanup);

describe("Ask DVS panel", () => {
  it("opens from the top-bar button", async () => {
    render(<AskDvs backendRole="STORE" />);
    expect(screen.queryByRole("dialog", { name: "Ask DVS" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ask DVS/ }));

    expect(screen.getByRole("dialog", { name: "Ask DVS" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Which materials will run out this week?" })).toBeTruthy();
  });

  it("sends an example question and shows the answer with its sources", async () => {
    ask.mockResolvedValue({
      answer: "2 materials will run out this week: MS Sheet 2mm and Hex Bolt M10.",
      toolsUsed: [{ name: "getStockOutForecast", args: {} }],
      sources: ["Smart Analytics", "Inventory"],
      grounded: true,
    });
    render(<AskDvs backendRole="STORE" />);
    fireEvent.click(screen.getByRole("button", { name: /Ask DVS/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Which materials will run out this week?" }));

    expect(ask).toHaveBeenCalledWith("Which materials will run out this week?");
    expect(await screen.findByText("2 materials will run out this week: MS Sheet 2mm and Hex Bolt M10.")).toBeTruthy();
    expect(screen.getByText("Based on: Smart Analytics, Inventory")).toBeTruthy();
    // The question stays visible above the answer.
    expect(screen.getByText("Which materials will run out this week?")).toBeTruthy();
  });

  it("says the assistant is not configured when the server has no key", async () => {
    status.mockResolvedValue({ configured: false });
    render(<AskDvs backendRole="ADMIN" />);
    fireEvent.click(screen.getByRole("button", { name: /Ask DVS/ }));

    expect(await screen.findByText("Assistant not configured")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Your question" })).toBeNull();
  });

  it("shows the server's message when a question fails", async () => {
    ask.mockRejectedValue({ status: 429, code: "RATE_LIMIT_EXCEEDED", message: "You have asked 20 questions in 10 minutes. Please wait a few minutes and try again." });
    render(<AskDvs backendRole="PRODUCTION" />);
    fireEvent.click(screen.getByRole("button", { name: /Ask DVS/ }));

    const box = await screen.findByRole("textbox", { name: "Your question" });
    fireEvent.change(box, { target: { value: "How many units did we produce today?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));

    expect((await screen.findByRole("alert")).textContent).toContain("20 questions in 10 minutes");
  });
});

describe("exampleQuestions", () => {
  it("fits each role", () => {
    expect(exampleQuestions("STORE")).toContain("Which materials will run out this week?");
    expect(exampleQuestions("PRODUCTION")).toContain("How many units did we produce today?");
    expect(exampleQuestions("MANAGER")).toEqual(expect.arrayContaining(["Which suppliers are late?", "Any open safety incidents?"]));
    expect(exampleQuestions("STORE")).not.toContain("Any open safety incidents?");
  });
});
