// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DashboardData } from "../../../../lib/services/dashboard.service";
import type * as Recharts from "recharts";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof Recharts>();
  // jsdom has no layout; render charts at a fixed size
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 400, height: 200 }}>{children}</div> };
});
vi.mock("../../../../lib/services/dashboard.service", () => ({ getDashboard: vi.fn() }));
vi.mock("../../../../lib/services/production.service", () => ({ getProductionTrend: vi.fn().mockResolvedValue([]) }));

import { getDashboard } from "../../../../lib/services/dashboard.service";
import { AdminDashboard } from "../AdminDashboard";

function data(overrides: Partial<DashboardData["kpis"]> = {}): DashboardData {
  return {
    kpis: {
      totalEmployees: 92, activeEmployees: 90,
      attendanceTodayPresent: 0, attendanceTodayAbsent: 0, attendanceTodayLate: 0, attendanceTodayOnLeave: 0,
      attendanceTodayWeekOff: 88, attendanceTodayRecorded: 0, attendanceTodayRate: null, isWeeklyOffToday: true,
      totalMaterials: 12, lowStockCount: 0, outOfStockCount: 0, totalInventoryValue: "1106610.94",
      activeClientOrders: 4, pendingClientOrders: 1, dispatchedOrders: 0, pendingPurchaseOrders: 2, orderFulfillmentRate: "50.0%",
      totalScrapThisMonth: "0.000", scrapValueThisMonth: "0.00",
      activeWorkOrders: 3, overdueWorkOrders: 0,
      productionMonth: {
        label: "November 2026", outputQty: 0, rejectedQty: 0, outputRecords: 0, unit: "pcs",
        monthlyTarget: 20000, attainmentRate: null, rejectionRate: null, completedWorkOrders: 0, completedShort: 0,
      },
      totalDepartments: 5, activeDepartments: 5,
      openIncidents: 136, investigatingIncidents: 0, criticalOpenIncidents: 11, highOpenIncidents: 49,
      activeAlerts: 0, criticalAlerts: 0,
      ...overrides,
    },
    charts: {
      orderStatusPie: [], scrapByDepartment: [], scrapTrend: [],
      attendanceTrend: [
        { date: "Sat", present: 80, absent: 5, late: 2, onLeave: 1, weekOff: 0, nonWorkingDay: false },
        { date: "Sun", present: null, absent: 0, late: 0, onLeave: 0, weekOff: 88, nonWorkingDay: true },
      ],
      recentOrders: [
        { id: 1, orderNumber: "ORD-CES-2021000329", client: "CES", product: "Bracket", qty: 500, status: "pending", orderDate: "2026-10-26T00:00:00.000Z" },
      ],
      openIncidents: [
        { id: 9, incidentNumber: "INC-9", type: "FIRE_SMOKE", severity: "CRITICAL", status: "OPEN", location: "Press shop", occurredAt: "2026-10-17T09:41:35.000Z" },
      ],
    },
  };
}

beforeEach(() => vi.mocked(getDashboard).mockReset());
afterEach(cleanup);

describe("Operations dashboard", () => {
  it("shows inventory value in lakh correctly (₹11.1L, not ₹1.1L)", async () => {
    vi.mocked(getDashboard).mockResolvedValue(data());
    render(<AdminDashboard onNavigate={vi.fn()} />);
    expect(await screen.findByText("₹11.1L")).toBeTruthy();
  });

  it("treats a weekly off as a weekly off, not 0% attendance", async () => {
    vi.mocked(getDashboard).mockResolvedValue(data());
    render(<AdminDashboard onNavigate={vi.fn()} />);
    expect(await screen.findByText("Weekly off")).toBeTruthy();
    expect(screen.getByText(/weekly off for most of the plant/)).toBeTruthy();
    expect(screen.queryByText(/0\.0%/)).toBeNull();
  });

  it("says no output yet early in the month instead of a red 0.0%", async () => {
    vi.mocked(getDashboard).mockResolvedValue(data());
    render(<AdminDashboard onNavigate={vi.fn()} />);
    expect(await screen.findByText("No output yet")).toBeTruthy();
    expect(screen.getByText("Nothing recorded in November 2026")).toBeTruthy();
  });

  it("shows attainment against the monthly target once output exists", async () => {
    const d = data();
    d.kpis.productionMonth = { ...d.kpis.productionMonth, outputQty: 18200, outputRecords: 40, attainmentRate: "91.0%", completedWorkOrders: 5, completedShort: 4 };
    vi.mocked(getDashboard).mockResolvedValue(d);
    render(<AdminDashboard onNavigate={vi.fn()} />);
    expect(await screen.findByText("91.0%")).toBeTruthy();
    expect(screen.getByText("18,200 of 20,000 pcs target")).toBeTruthy();
    expect(screen.getByText("5 completed this month · 4 short of target")).toBeTruthy();
  });

  it("counts open incidents the same way as the Security page and lists them", async () => {
    vi.mocked(getDashboard).mockResolvedValue(data());
    render(<AdminDashboard onNavigate={vi.fn()} />);
    expect(await screen.findByText("136")).toBeTruthy();
    expect(screen.getByText("11 critical · 49 high")).toBeTruthy();
    expect(screen.getByText("Fire or smoke seen")).toBeTruthy();
    expect(screen.queryByText("No open security incidents.")).toBeNull();
  });

  it("dates recent orders by order date, like the Orders page", async () => {
    vi.mocked(getDashboard).mockResolvedValue(data());
    render(<AdminDashboard onNavigate={vi.fn()} />);
    expect(await screen.findByText("26 Oct")).toBeTruthy();
  });
});
