import { describe, expect, it } from "vitest";
import {
  clientNotifications, deliveryStats, orderTimeline, orderedProducts, purchaseOrderTrend, suppliedMaterials, supplierNotifications,
} from "../portalInsights";
import type { ClientOrderDto, PurchaseOrderDto } from "../services/orders.service";
import type { PortalMessageDto } from "../services/portal.service";

const po = (over: Partial<PurchaseOrderDto>): PurchaseOrderDto => ({
  id: 1, poNumber: "PO-1", supplierId: 7, supplierName: "Mahindra Accelo", material: "SPCC Sheet",
  quantity: "1000", unit: "kg", totalCost: "62862", currency: "INR", orderDate: "2026-10-10T00:00:00.000Z",
  expectedDelivery: null, actualDelivery: null, status: "PENDING", notes: null, createdAt: "2026-10-10T00:00:00.000Z",
  ...over,
});

const order = (over: Partial<ClientOrderDto>): ClientOrderDto => ({
  id: 1, orderNumber: "ORD-1", clientId: 9, clientName: "Chitnis", product: "Assembly Clamp Battery", quantity: 800,
  unit: "nos", value: "14848", currency: "INR", orderDate: "2026-10-26T00:00:00.000Z", requiredDate: null,
  dispatchDate: null, deliveryDate: null, status: "PENDING", notes: null, dispatchNote: null, challanNumber: null,
  invoiceNumber: null, createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z",
  ...over,
});

describe("suppliedMaterials", () => {
  it("groups by material, keeps the newest rate and skips cancelled orders", () => {
    const rows = suppliedMaterials([
      po({ id: 1, quantity: "1000", totalCost: "60000", orderDate: "2026-09-01T00:00:00.000Z" }),
      po({ id: 2, quantity: "500", totalCost: "31431", orderDate: "2026-10-01T00:00:00.000Z" }),
      po({ id: 3, quantity: "9999", totalCost: "1", status: "CANCELLED" }),
      po({ id: 4, material: "SPCC GA Sheet", quantity: "200", totalCost: null }),
    ]);
    expect(rows).toHaveLength(2);
    const sheet = rows.find((r) => r.material === "SPCC Sheet")!;
    expect(sheet).toMatchObject({ orders: 2, quantity: 1500, value: 91431 });
    expect(sheet.lastRate).toBeCloseTo(62.862, 3);
    expect(rows.find((r) => r.material === "SPCC GA Sheet")!.lastRate).toBeNull();
  });
});

describe("deliveryStats", () => {
  it("measures only delivered orders with both dates", () => {
    const stats = deliveryStats([
      po({ status: "DELIVERED", expectedDelivery: "2026-10-10", actualDelivery: "2026-10-09" }),
      po({ status: "DELIVERED", expectedDelivery: "2026-10-10", actualDelivery: "2026-10-14" }),
      po({ status: "DELIVERED", expectedDelivery: null, actualDelivery: "2026-10-14" }),
      po({ status: "CONFIRMED", expectedDelivery: "2026-10-10" }),
    ]);
    expect(stats).toEqual({ measured: 2, onTime: 1, onTimePct: 50, avgDaysLate: 4 });
  });

  it("reports nothing rather than 0% when nothing was measured", () => {
    expect(deliveryStats([po({})]).onTimePct).toBeNull();
  });
});

describe("purchaseOrderTrend", () => {
  it("returns one point per month, oldest first, including empty months", () => {
    const trend = purchaseOrderTrend([po({ orderDate: "2026-10-10T00:00:00.000Z" })], 3, new Date(2026, 10, 1));
    expect(trend.map((t) => t.orders)).toEqual([0, 1, 0]);
    expect(trend[1].value).toBe(62862);
  });
});

describe("orderedProducts", () => {
  it("derives the last unit price from the newest priced order", () => {
    const [row] = orderedProducts([
      order({ id: 1, value: "14848", quantity: 800, orderDate: "2026-10-26T00:00:00.000Z" }),
      order({ id: 2, value: "9000", quantity: 500, orderDate: "2026-09-01T00:00:00.000Z" }),
    ]);
    expect(row).toMatchObject({ orders: 2, quantity: 1300 });
    expect(row.lastPrice).toBeCloseTo(18.56, 2);
  });
});

describe("orderTimeline", () => {
  it("ticks every step up to the current status", () => {
    const steps = orderTimeline(order({ status: "DISPATCHED", dispatchDate: "2026-10-26" }));
    expect(steps.map((s) => s.done)).toEqual([true, true, true, true, false]);
    expect(steps[3].date).toBe("2026-10-26");
  });

  it("dates the approved and in-production steps when they were recorded", () => {
    const steps = orderTimeline(order({ status: "IN_PRODUCTION", approvedAt: "2026-10-27", productionStartedAt: "2026-10-28" }));
    expect(steps[1]).toMatchObject({ label: "Approved", date: "2026-10-27", done: true });
    expect(steps[2]).toMatchObject({ label: "In production", date: "2026-10-28", done: true });
  });

  it("ticks nothing for a cancelled order", () => {
    expect(orderTimeline(order({ status: "CANCELLED" })).some((s) => s.done)).toBe(false);
  });
});

describe("notifications", () => {
  const dvsMessage: PortalMessageDto = { id: 5, fromDvs: true, senderName: "DVS Industries", body: "Truck leaves at 4 pm", readAt: null, createdAt: "2026-10-27T10:00:00.000Z" };
  const ownMessage: PortalMessageDto = { ...dvsMessage, id: 6, fromDvs: false, body: "Thanks" };

  it("lists order updates and DVS messages for clients, newest first", () => {
    const list = clientNotifications(
      [order({ status: "DISPATCHED", dispatchDate: "2026-10-26T00:00:00.000Z", challanNumber: "2113" })],
      [dvsMessage, ownMessage],
    );
    expect(list.map((n) => n.msg)).toEqual([
      "Message from DVS: Truck leaves at 4 pm",
      "ORD-1 (Assembly Clamp Battery) has been dispatched, challan 2113.",
    ]);
  });

  it("warns suppliers about overdue orders", () => {
    const list = supplierNotifications(
      [po({ status: "CONFIRMED", expectedDelivery: "2026-10-01T00:00:00.000Z" })],
      [],
      new Date("2026-11-01T00:00:00.000Z"),
    );
    expect(list[0]).toMatchObject({ type: "warn", msg: "PO-1 (SPCC Sheet) is past its expected delivery date." });
  });
});
