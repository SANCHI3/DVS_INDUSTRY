// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProductionCalculator, materialForPart, type InventoryMaterial } from "../inventory/ProductionCalculator";
import type { PartSpecDto } from "../../../../lib/services/inventory.service";

afterEach(cleanup);

const material = (apiId: number, name: string, cost: number | null): InventoryMaterial => ({
  id: `MAT-${apiId}`, name, category: "Sheet", thickness: "", qty: 500, unit: "kg", cost,
  threshold: 50, location: "", status: "in-stock", apiId,
});
const part: PartSpecDto = {
  id: 3, partNumber: "BRK-110", rmGrade: "CRCA", thicknessMm: "1.60", stripSize: "120 x 1250",
  piecesPerStrip: 10, piecesPerSheet: 80, sheetSize: "1250 x 2500", notes: "Motor bracket",
  createdAt: "", updatedAt: "",
};
const materials = [material(1, "HR Sheet 2mm", 58), material(2, "CRCA Sheet 1.6mm", 62.862), material(3, "CRCA Sheet 2mm", 61)];

describe("materialForPart", () => {
  it("prefers the stock material with the part's grade and thickness", () => {
    expect(materialForPart(part, materials)?.name).toBe("CRCA Sheet 1.6mm");
    expect(materialForPart({ ...part, rmGrade: "SS304" }, materials)).toBeUndefined();
  });
});

describe("Production Calculator", () => {
  it("fills the part, material and cost per kg from the Parts Master", () => {
    render(<ProductionCalculator materials={materials} parts={[part]} />);
    fireEvent.change(screen.getByLabelText(/Choose from Parts Master/), { target: { value: "3" } });

    expect((screen.getByLabelText(/Part Number/) as HTMLInputElement).value).toBe("BRK-110");
    expect((screen.getByLabelText(/Part Name/) as HTMLInputElement).value).toBe("Motor bracket");
    expect((screen.getByLabelText(/Raw Material Type/) as HTMLSelectElement).value).toBe("CRCA Sheet 1.6mm");
    expect((screen.getByLabelText(/Material Cost Per Kg/) as HTMLInputElement).value).toBe("62.862");
    expect(screen.getByText(/80 per sheet/)).toBeTruthy();
    expect(screen.queryByText(/unavailable from the current inventory/)).toBeNull();
  });
});
