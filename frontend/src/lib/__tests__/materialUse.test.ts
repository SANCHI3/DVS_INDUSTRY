import { describe, it, expect } from "vitest";
import { materialPerPiece, quantityDue, receivedText } from "../materialUse";

describe("materialPerPiece", () => {
  it("matches the material unit to the part's yield", () => {
    expect(materialPerPiece("Sheets", { piecesPerSheet: 80, piecesPerStrip: 10 })).toBe(1 / 80);
    expect(materialPerPiece("strip", { piecesPerSheet: null, piecesPerStrip: 10 })).toBe(1 / 10);
    expect(materialPerPiece("kg", { piecesPerSheet: 80, piecesPerStrip: 10 })).toBeNull();
  });
});

describe("purchase order receipts", () => {
  it("works out what is still due", () => {
    expect(quantityDue("1000", "400")).toBe(600);
    expect(quantityDue("1000", "1200")).toBe(0);
    expect(quantityDue(null, "0")).toBeNull();
  });

  it("describes the receipt so far", () => {
    expect(receivedText("1000", "400", "kg")).toBe("Received 400 of 1000 kg");
    expect(receivedText(null, "5", null)).toBe("Received 5");
  });
});
