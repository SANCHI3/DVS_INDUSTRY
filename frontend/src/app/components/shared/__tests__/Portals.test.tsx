// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../lib/auth", () => ({
  getUser: vi.fn(() => ({ id: 3, email: "portal@test.local", fullName: "Portal", role: { name: "SUPPLIER" } })),
  getStoredBackendRole: vi.fn(() => "SUPPLIER"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../../lib/services/orders.service", () => ({
  getSuppliers: vi.fn(), getPurchaseOrders: vi.fn(), getClients: vi.fn(), getClientOrders: vi.fn(),
  createClientOrder: vi.fn(), cancelClientOrder: vi.fn(),
}));
vi.mock("../../../../lib/services/portal.service", () => ({
  getPortalMessages: vi.fn(), sendPortalMessage: vi.fn(), markPortalMessagesRead: vi.fn(),
}));

import { getClientOrders, getClients, getPurchaseOrders, getSuppliers } from "../../../../lib/services/orders.service";
import { getPortalMessages, markPortalMessagesRead, sendPortalMessage } from "../../../../lib/services/portal.service";
import { SupplierApp } from "../../supplier/SupplierApp";
import { ClientApp } from "../../client/ClientApp";

const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } });

const supplier = {
  id: 7, name: "Mahindra Accelo Limited", code: "SUP-MAL", contactName: null, email: "portal@test.local", phone: null,
  address: null, state: "Maharashtra", city: "Pune", country: "India", gstin: "27AAACM4745P1ZZ", rating: null,
  leadTimeDays: null, reliability: null, materials: "SPCC Sheet", isActive: true, createdAt: "",
};
const purchaseOrder = {
  id: 1, poNumber: "PO-MAL-96-1", supplierId: 7, supplierName: supplier.name, material: "SPCC Sheet 1.2mm",
  quantity: "1000", unit: "kg", totalCost: "62862", currency: "INR", orderDate: "2026-10-20T00:00:00.000Z",
  expectedDelivery: "2026-10-25T00:00:00.000Z", actualDelivery: "2026-10-24T00:00:00.000Z", status: "DELIVERED",
  notes: null, createdAt: "",
};
const client = {
  id: 9, name: "Chitnis Engineering Systems", code: "CLT-CHITNIS", contactName: null, email: "portal@test.local",
  phone: null, address: null, city: "Nashik", state: "Maharashtra", country: "India", gstin: null, isActive: true, createdAt: "",
};
const clientOrder = {
  id: 1, orderNumber: "ORD-CES-2021000329", clientId: 9, clientName: client.name, product: "Assembly Clamp Battery",
  quantity: 800, unit: "nos", value: "17521.00", currency: "INR", orderDate: "2026-10-26T00:00:00.000Z",
  requiredDate: null, dispatchDate: "2026-10-26T00:00:00.000Z", deliveryDate: null, status: "DISPATCHED", notes: null,
  dispatchNote: "vehicle MH17BD4579", challanNumber: "2113", invoiceNumber: "26-27/2113", createdAt: "", updatedAt: "",
};
const dvsMessage = { id: 1, fromDvs: true, senderName: "DVS Industries", body: "Please confirm the dispatch date", readAt: null, createdAt: "2026-10-27T10:00:00.000Z" };

const NOT_SUPPORTED = /not supported|backend is not|not available in api/i;

beforeAll(() => {
  // Recharts measures its container; jsdom has no layout
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  // The open section lives in the URL hash; start every test on the dashboard
  window.history.replaceState(null, "", "/");
  vi.mocked(getSuppliers).mockResolvedValue(page([supplier]));
  vi.mocked(getPurchaseOrders).mockResolvedValue(page([purchaseOrder]) as never);
  vi.mocked(getClients).mockResolvedValue(page([client]));
  vi.mocked(getClientOrders).mockResolvedValue(page([clientOrder]) as never);
  vi.mocked(getPortalMessages).mockResolvedValue([dvsMessage]);
  vi.mocked(markPortalMessagesRead).mockResolvedValue();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openEverySection(labels: string[]) {
  for (const label of labels) {
    fireEvent.click(screen.getAllByText(label)[0]);
    await waitFor(() => expect(document.body.textContent).not.toMatch(/Loading…/));
    expect(document.body.textContent, `${label} page`).not.toMatch(NOT_SUPPORTED);
  }
}

describe("supplier portal", () => {
  it("shows the supplier's own data on every page", async () => {
    render(<SupplierApp onLogout={() => {}} />);
    expect(await screen.findByText(/Mahindra Accelo Limited · Partner ID: SUP-MAL/)).toBeTruthy();
    expect(screen.getByText("Please confirm the dispatch date")).toBeTruthy();

    await openEverySection(["Material Catalog", "Purchase Orders", "Delivery Management", "Communication", "My Performance", "Reports"]);
    expect(markPortalMessagesRead).toHaveBeenCalled();
  });

  it("sends a message from the Communication page", async () => {
    vi.mocked(sendPortalMessage).mockResolvedValue({ ...dvsMessage, id: 2, fromDvs: false, senderName: "Mahindra", body: "Dispatching Friday" });
    render(<SupplierApp onLogout={() => {}} />);
    await screen.findByText(/Partner ID: SUP-MAL/);
    fireEvent.click(screen.getAllByText("Communication")[0]);

    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Dispatching Friday" } });
    fireEvent.click(screen.getByText("Send"));

    expect(await screen.findByText("Dispatching Friday")).toBeTruthy();
    expect(sendPortalMessage).toHaveBeenCalledWith("Dispatching Friday", {});
  });

  it("explains a login that is not linked to a supplier record", async () => {
    vi.mocked(getSuppliers).mockResolvedValue(page([{ ...supplier, email: "someone-else@test.local" }]));
    render(<SupplierApp onLogout={() => {}} />);
    expect((await screen.findAllByText(/No supplier record matches this login's email/)).length).toBeGreaterThan(0);
  });
});

describe("client portal", () => {
  it("shows the client's own data on every page", async () => {
    render(<ClientApp onLogout={() => {}} />);
    expect(await screen.findByText(/Chitnis Engineering Systems · Client ID: CLT-CHITNIS/)).toBeTruthy();

    await openEverySection(["Product Catalog", "Order Management", "Shipment Tracking", "Notifications", "Support Center", "Reports"]);
  });

  it("shows dispatch documents on Shipment Tracking", async () => {
    render(<ClientApp onLogout={() => {}} />);
    await screen.findByText(/Client ID: CLT-CHITNIS/);
    fireEvent.click(screen.getAllByText("Shipment Tracking")[0]);
    expect(await screen.findByText("26-27/2113")).toBeTruthy();
    expect(screen.getByText(/vehicle MH17BD4579/)).toBeTruthy();
  });

  it("opens a prefilled order from the catalogue", async () => {
    render(<ClientApp onLogout={() => {}} />);
    await screen.findByText(/Client ID: CLT-CHITNIS/);
    fireEvent.click(screen.getAllByText("Product Catalog")[0]);
    fireEvent.click(await screen.findByText("Order again"));
    expect((await screen.findByDisplayValue("Assembly Clamp Battery"))).toBeTruthy();
  });
});
