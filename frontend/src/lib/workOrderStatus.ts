/**
 * How a work order's status reads in lists. A COMPLETED order whose good output
 * stayed below target reads "Completed short (84%)", the same rule the
 * dashboard and Smart Analytics count as "completed short".
 */
export function workOrderStatusLabel(
  status: string,
  producedQty: string | number,
  targetQty: string | number,
): { label: string; short: boolean } {
  const produced = Number(producedQty);
  const target = Number(targetQty);
  if (status === "COMPLETED" && target > 0 && produced < target) {
    return { label: `Completed short (${Math.floor((produced / target) * 100)}%)`, short: true };
  }
  return { label: status.replace(/_/g, " "), short: false };
}
