import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../csv";

describe("CSV export", () => {
  it("keeps commas, quotes and line breaks inside their column", () => {
    expect(toCsv([["MS Sheet, 2mm", 'Bolt "M10"', "line 1\nline 2"]])).toBe(
      '"MS Sheet, 2mm","Bolt ""M10""","line 1\nline 2"',
    );
  });

  it("separates rows with CRLF and writes empty cells for missing values", () => {
    expect(toCsv([["a", null], [undefined, 3]])).toBe('"a",""\r\n"","3"');
  });

  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "@SUM(A1)", "-2+3", "\tcmd"])(
    "neutralises a formula: %s",
    (value) => {
      expect(csvCell(value).startsWith(`"'`)).toBe(true);
    },
  );

  it("leaves plain negative numbers alone", () => {
    expect(csvCell("-12.5")).toBe('"-12.5"');
    expect(csvCell(-3)).toBe('"-3"');
  });
});
