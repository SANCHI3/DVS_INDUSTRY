// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DemoDataBanner, isDemoEmployee, isDemoWorkOrder } from "../production/DemoData";

afterEach(cleanup);

describe("Production demo data labels", () => {
  it("recognises demo records by their IDs only", () => {
    expect(isDemoEmployee("DEMO-EMP-001")).toBe(true);
    expect(isDemoEmployee("EMP-001")).toBe(false);
    expect(isDemoEmployee("1042")).toBe(false);
    expect(isDemoWorkOrder("DEMO-WO-003")).toBe(true);
    expect(isDemoWorkOrder("WO-0042")).toBe(false);
  });

  it("shows the DEMO DATA banner with what is demo, and nothing when there is none", () => {
    const { container, rerender } = render(<DemoDataBanner employees={0} workOrders={0} />);
    expect(container.innerHTML).toBe("");

    rerender(<DemoDataBanner employees={10} workOrders={5} />);
    const banner = screen.getByRole("note", { name: "Demo data" });
    expect(banner.textContent).toContain("DEMO DATA");
    expect(banner.textContent).toContain("10 employees with IDs DEMO-EMP-");
    expect(banner.textContent).toContain("5 work orders numbered DEMO-WO-");
    expect(banner.textContent).toContain("Company Performance figures include the demo work orders.");

    rerender(<DemoDataBanner employees={10} workOrders={0} />);
    expect(screen.getByRole("note").textContent).not.toContain("Company Performance");
  });
});
