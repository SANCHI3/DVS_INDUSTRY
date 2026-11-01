/**
 * Mirrors backend/src/utils/materialUse.ts: raw material can only be taken out
 * of stock per piece when the material is counted in sheets or strips and the
 * part says how many pieces come from one sheet or strip.
 */
export interface PartYield {
  piecesPerSheet: number | null;
  piecesPerStrip: number | null;
}

const SHEET_UNITS = new Set(["sheet", "sheets"]);
const STRIP_UNITS = new Set(["strip", "strips"]);

/** Material units per piece, or null when the unit and yields do not match. */
export function materialPerPiece(materialUnit: string, part: PartYield): number | null {
  const unit = materialUnit.trim().toLowerCase();
  if (SHEET_UNITS.has(unit) && part.piecesPerSheet && part.piecesPerSheet > 0) return 1 / part.piecesPerSheet;
  if (STRIP_UNITS.has(unit) && part.piecesPerStrip && part.piecesPerStrip > 0) return 1 / part.piecesPerStrip;
  return null;
}

export const DEDUCTION_UNIT_HELP =
  "Deducting raw material needs a material counted in sheets or strips and a part with pieces per sheet or strip.";

/** What is still due on a purchase order, or null when the ordered quantity is not a number. */
export function quantityDue(ordered: string | null, received: string | null | undefined): number | null {
  if (ordered === null) return null;
  const o = Number(ordered);
  if (!Number.isFinite(o)) return null;
  return Math.max(0, Math.round((o - Number(received ?? 0)) * 1000) / 1000);
}

/** "Received 400 of 1000 kg" for a PO linked to stock. */
export function receivedText(ordered: string | null, received: string | null | undefined, unit: string | null): string {
  const r = Number(received ?? 0);
  const u = unit ? ` ${unit}` : "";
  return ordered === null ? `Received ${r}${u}` : `Received ${r} of ${Number(ordered)}${u}`;
}
