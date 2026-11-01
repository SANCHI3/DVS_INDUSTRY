/**
 * Raw material used per finished piece, from the Parts Master yields. Only
 * materials counted in sheets or strips can be converted: a part's yield
 * says how many pieces come from one sheet or one strip, not from one kg.
 */
export interface PartYield {
  piecesPerSheet: number | null;
  piecesPerStrip: number | null;
}

const SHEET_UNITS = new Set(['sheet', 'sheets']);
const STRIP_UNITS = new Set(['strip', 'strips']);

/** Material units per piece, or null when the unit and yields do not match. */
export function materialPerPiece(materialUnit: string, part: PartYield): number | null {
  const unit = materialUnit.trim().toLowerCase();
  if (SHEET_UNITS.has(unit) && part.piecesPerSheet && part.piecesPerSheet > 0) {
    return 1 / part.piecesPerSheet;
  }
  if (STRIP_UNITS.has(unit) && part.piecesPerStrip && part.piecesPerStrip > 0) {
    return 1 / part.piecesPerStrip;
  }
  return null;
}

/**
 * Material to take out of stock for an output entry: every piece made
 * (good, rejected or scrapped) used material. Three decimals, like stock.
 */
export function materialIssuedFor(
  pieces: { good: number; rejected: number; scrap: number },
  perPiece: number,
): number {
  const total = pieces.good + pieces.rejected + pieces.scrap;
  return Math.round(total * perPiece * 1000) / 1000;
}

export const DEDUCTION_UNIT_HELP =
  'Deducting raw material needs a material counted in sheets or strips and a part with pieces per sheet or strip.';
