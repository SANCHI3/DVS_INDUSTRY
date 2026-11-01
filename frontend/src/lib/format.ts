/**
 * Money formatting for the whole app. Use these instead of building "₹" strings
 * by hand, so every screen shows the same amount the same way.
 */

type Amount = number | string | null | undefined;

function toNumber(value: Amount): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const LAKH = 1_00_000;
const CRORE = 1_00_00_000;

/**
 * Full amount with Indian digit grouping: 1106610.94 → "₹11,06,610.94".
 * `decimals` fixes the paise shown; by default up to 2, none for whole rupees.
 */
export function formatINR(value: Amount, decimals?: number): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const digits = decimals === undefined
    ? { minimumFractionDigits: 0, maximumFractionDigits: 2 }
    : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return `₹${n.toLocaleString("en-IN", digits)}`;
}

/**
 * Short amount for KPI cards and chart labels: K (thousand), L (lakh),
 * Cr (crore). 1106610.94 → "₹11.1L", 45230 → "₹45.2K", 25400000 → "₹2.54Cr".
 */
export function formatINRCompact(value: Amount): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const trim = (x: string) => x.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  if (abs >= CRORE) return `${sign}₹${trim((abs / CRORE).toFixed(2))}Cr`;
  if (abs >= LAKH) return `${sign}₹${trim((abs / LAKH).toFixed(1))}L`;
  if (abs >= 1_000) return `${sign}₹${trim((abs / 1_000).toFixed(1))}K`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

/** Amount in a stated currency; INR uses the formatters above. */
export function formatMoney(value: Amount, currency = "INR"): string {
  if (currency === "INR") return formatINR(value);
  const n = toNumber(value);
  return n === null ? "—" : `${currency} ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
