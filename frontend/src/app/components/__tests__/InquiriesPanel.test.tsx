// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as InquiriesModule from "../../../lib/services/inquiries.service";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../lib/services/inquiries.service", async (importOriginal) => ({
  ...(await importOriginal<typeof InquiriesModule>()),
  listInquiries: vi.fn(),
  updateInquiryStatus: vi.fn(),
}));

import { listInquiries, updateInquiryStatus } from "../../../lib/services/inquiries.service";
import { InquiriesPanel } from "../admin/InquiriesPanel";

const inquiry = {
  id: 7, name: "Asha Rao", company: "Rao Pumps", email: "asha@raopumps.in", phone: "+91 98765 43210",
  message: "Quote for 500 brackets", status: "NEW" as const,
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z",
};

beforeEach(() => {
  vi.mocked(listInquiries).mockResolvedValue({ data: [inquiry], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
  vi.mocked(updateInquiryStatus).mockResolvedValue({ ...inquiry, status: "CONTACTED" });
});
afterEach(cleanup);

describe("InquiriesPanel", () => {
  it("lists website inquiries with reply links", async () => {
    render(<InquiriesPanel />);
    expect(await screen.findByText("Quote for 500 brackets")).toBeTruthy();
    expect(screen.getByRole("link", { name: /asha@raopumps.in/ }).getAttribute("href")).toBe("mailto:asha@raopumps.in");
    expect(screen.getByRole("link", { name: /98765/ }).getAttribute("href")).toBe("tel:+919876543210");
  });

  it("marks an inquiry as contacted", async () => {
    render(<InquiriesPanel />);
    fireEvent.change(await screen.findByLabelText(/Status of inquiry from Asha Rao/), { target: { value: "CONTACTED" } });
    await waitFor(() => expect(updateInquiryStatus).toHaveBeenCalledWith(7, "CONTACTED"));
    expect(await screen.findByText("Contacted", { selector: "span" })).toBeTruthy();
  });

  it("filters by status", async () => {
    render(<InquiriesPanel />);
    await screen.findByText("Quote for 500 brackets");
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    await waitFor(() => expect(listInquiries).toHaveBeenLastCalledWith("CLOSED"));
  });
});
