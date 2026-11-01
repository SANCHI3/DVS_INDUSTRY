// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReceivePOModal, type SupplierOrder } from "../orders/OrderModals";
import { workOrderProgressText } from "../OrdersPage";

const po = (over: Partial<SupplierOrder> = {}): SupplierOrder => ({
  id: "PO-MAL-96-1", supplier: "Mahindra Accelo", material: "SPCC Sheet", qty: "1000 kg",
  orderDate: "20 Oct", expectedDel: "30 Oct", actualDel: "–", cost: "—", status: "in-transit",
  materialId: 7, orderedQty: "1000", receivedQty: "400", unit: "kg", _apiId: 4, ...over,
});

afterEach(cleanup);

describe("Receive purchase order", () => {
  it("offers what is still due and sends the quantity received", async () => {
    const onReceive = vi.fn().mockResolvedValue(undefined);
    render(<ReceivePOModal order={po()} onClose={() => {}} onReceive={onReceive} />);
    expect(screen.getByText(/Received 400 of 1000 kg/)).toBeTruthy();
    const input = screen.getByLabelText(/Quantity received now/);
    expect((input as HTMLInputElement).value).toBe("600");
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Receipt/ }));
    await waitFor(() => expect(onReceive).toHaveBeenCalledWith(250));
  });

  it("just marks delivered when the PO is not a stock item", async () => {
    const onReceive = vi.fn().mockResolvedValue(undefined);
    render(<ReceivePOModal order={po({ materialId: null })} onClose={() => {}} onReceive={onReceive} />);
    expect(screen.queryByLabelText(/Quantity received now/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Confirm Receipt/ }));
    await waitFor(() => expect(onReceive).toHaveBeenCalledWith(undefined));
  });
});

describe("work order progress on client orders", () => {
  it("reads plainly", () => {
    expect(workOrderProgressText(undefined)).toBe("No work order");
    expect(workOrderProgressText({ total: 2, completed: 1 })).toBe("1 of 2 done");
    expect(workOrderProgressText({ total: 2, completed: 2 })).toBe("2 done");
  });
});
