import { describe, it, expect } from 'vitest';
import { materialIssuedFor, materialPerPiece } from '../../utils/materialUse';

describe('materialPerPiece', () => {
  it('uses pieces per sheet for sheet materials and per strip for strip materials', () => {
    expect(materialPerPiece('sheets', { piecesPerSheet: 80, piecesPerStrip: 10 })).toBe(1 / 80);
    expect(materialPerPiece('Strip', { piecesPerSheet: 80, piecesPerStrip: 10 })).toBe(1 / 10);
  });

  it('cannot convert kg, or a part without the matching yield', () => {
    expect(materialPerPiece('kg', { piecesPerSheet: 80, piecesPerStrip: 10 })).toBeNull();
    expect(materialPerPiece('sheets', { piecesPerSheet: null, piecesPerStrip: 10 })).toBeNull();
  });
});

describe('materialIssuedFor', () => {
  it('counts every piece made, good or not, to three decimals', () => {
    expect(materialIssuedFor({ good: 150, rejected: 8, scrap: 2 }, 1 / 80)).toBe(2);
    expect(materialIssuedFor({ good: 100, rejected: 0, scrap: 0 }, 1 / 3)).toBe(33.333);
  });
});
