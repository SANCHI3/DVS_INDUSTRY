import { FlaskConical } from "lucide-react";

/**
 * Labels for the Production demo data (backend/src/scripts/productionDemoSeed.ts).
 * Demo records are recognised by their IDs: employees DEMO-EMP-…, work orders
 * DEMO-WO-…; their remarks and notes start with "[DEMO]".
 */
export const isDemoEmployee = (employeeCode: string) => /^DEMO-EMP-/i.test(employeeCode);
export const isDemoWorkOrder = (workOrderNumber: string) => /^DEMO-WO-/i.test(workOrderNumber);

export function DemoTag() {
  return (
    <span title="Demonstration data, not a verified company record" className="inline-block px-1.5 rounded ml-1.5 align-middle"
      style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.04em", background: "#EDE7F6", color: "#5E35B1", lineHeight: "1.1rem" }}>
      DEMO
    </span>
  );
}

/** Shown on every Production tab while demo records exist. */
export function DemoDataBanner({ employees, workOrders }: { employees: number; workOrders: number }) {
  if (employees === 0 && workOrders === 0) return null;
  const parts = [
    employees > 0 && `${employees} employee${employees === 1 ? "" : "s"} with IDs DEMO-EMP-… and their attendance and daily performance`,
    workOrders > 0 && `${workOrders} work order${workOrders === 1 ? "" : "s"} numbered DEMO-WO-… with their output`,
  ].filter(Boolean);
  return (
    <div role="note" aria-label="Demo data" className="flex items-start gap-2.5 px-4 py-3 rounded-md mb-4"
      style={{ background: "#F3EEFB", border: "1px solid #D1C4E9", color: "#4527A0", fontSize: "0.8rem" }}>
      <FlaskConical size={16} style={{ marginTop: 1, flexShrink: 0 }} />
      <p>
        <strong style={{ letterSpacing: "0.04em" }}>DEMO DATA</strong> — this module includes demonstration records,
        not verified company records: {parts.join("; ")}. They are marked <DemoTag /> and their remarks start with [DEMO].
        {workOrders > 0 && " Company Performance figures include the demo work orders."}
      </p>
    </div>
  );
}
