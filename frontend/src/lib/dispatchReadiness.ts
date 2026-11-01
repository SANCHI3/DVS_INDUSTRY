/** A work order producing (part of) a client order, as the order detail returns it. */
export interface LinkedWorkOrder {
  id: number;
  workOrderNumber: string;
  status: string;
  targetQuantity: number;
  producedQty: number;
  unit: string;
}

export interface ReadinessItem {
  label: string;
  done: boolean;
  detail: string;
}

/**
 * Whether a client order can be dispatched, from the work orders linked to it:
 * all of them completed, and their good output covering the ordered quantity.
 * Cancelled work orders do not count. `linked` is false when nothing is
 * linked, in which case readiness cannot be judged.
 */
export function dispatchReadiness(
  orderedQty: number,
  workOrders: LinkedWorkOrder[],
): { linked: boolean; ready: boolean; items: ReadinessItem[] } {
  const active = workOrders.filter((wo) => wo.status !== "CANCELLED");
  if (active.length === 0) return { linked: false, ready: false, items: [] };
  const completed = active.filter((wo) => wo.status === "COMPLETED").length;
  const produced = active.reduce((sum, wo) => sum + wo.producedQty, 0);
  const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  const items: ReadinessItem[] = [
    {
      label: "Linked work orders completed",
      done: completed === active.length,
      detail: `${completed} of ${active.length}`,
    },
    {
      label: "Good output covers the ordered quantity",
      done: produced >= orderedQty,
      detail: `${qty(produced)} of ${qty(orderedQty)}`,
    },
  ];
  return { linked: true, ready: items.every((i) => i.done), items };
}
