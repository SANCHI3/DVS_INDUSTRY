// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type * as InquiriesModule from "../../../lib/services/inquiries.service";

vi.mock("../../../lib/services/inquiries.service", async (importOriginal) => ({
  ...(await importOriginal<typeof InquiriesModule>()),
  submitInquiry: vi.fn(),
}));

import { submitInquiry } from "../../../lib/services/inquiries.service";
import { HomePage, InquiryForm } from "../HomePage";

const send = vi.mocked(submitInquiry);

beforeEach(() => {
  send.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function fillInquiry() {
  fireEvent.change(screen.getByLabelText(/Full Name/), { target: { value: "Asha Rao" } });
  fireEvent.change(screen.getByLabelText(/Email Address/), { target: { value: "asha@raopumps.in" } });
  fireEvent.change(screen.getByLabelText(/Message/), { target: { value: "Quote for 500 brackets" } });
  fireEvent.submit(screen.getByLabelText(/Message/).closest("form")!);
}

// The full home page is large; give its renders more than the 5 s default
describe("Home page footer", { timeout: 20_000 }, () => {
  it("scrolls every quick link to a section that exists", () => {
    render(<HomePage onNavigateToLogin={vi.fn()} />);
    const footer = screen.getByRole("contentinfo");
    for (const label of ["AI Smart Factory", "Growth Journey"]) {
      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
      fireEvent.click(within(footer).getByRole("button", { name: label }));
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    }
  });

  it("offers only portals that exist (no Quality login)", () => {
    const open = vi.fn();
    render(<HomePage onNavigateToLogin={open} />);
    const footer = screen.getByRole("contentinfo");
    // The only "Quality" button left is the quick link to the Quality section
    const quality = within(footer).getAllByRole("button", { name: "Quality" });
    expect(quality).toHaveLength(1);
    fireEvent.click(quality[0]!);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(within(footer).getByRole("button", { name: "Store" }));
    expect(open).toHaveBeenCalledWith("store");
  });

  it("shows no placeholder phone number and the current year", () => {
    render(<HomePage onNavigateToLogin={vi.fn()} />);
    expect(screen.queryByText(/XXXXX/)).toBeNull();
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} DVS Industries`))).toBeTruthy();
    expect(screen.queryByText(/Predictive Maintenance/)).toBeNull();
  });
});

describe("Inquiry form", () => {
  it("sends the inquiry and only then says it was received", async () => {
    let finish!: () => void;
    send.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<InquiryForm />);
    fillInquiry();

    expect(await screen.findByRole("button", { name: /Sending/ })).toBeTruthy();
    expect(screen.queryByText("Inquiry Received")).toBeNull();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ name: "Asha Rao", email: "asha@raopumps.in", website: "" }));

    finish();
    expect(await screen.findByText("Inquiry Received")).toBeTruthy();
  });

  it("keeps the form and explains when sending fails", async () => {
    send.mockRejectedValue({ status: 429, code: "RATE_LIMIT_EXCEEDED", message: "Too many" });
    render(<InquiryForm />);
    fillInquiry();

    expect((await screen.findByRole("alert")).textContent).toMatch(/try again in an hour/);
    expect(screen.queryByText("Inquiry Received")).toBeNull();
  });

  it("does not send an incomplete form", () => {
    render(<InquiryForm />);
    fireEvent.submit(screen.getByLabelText(/Message/).closest("form")!);
    expect(send).not.toHaveBeenCalled();
    expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
  });
});
