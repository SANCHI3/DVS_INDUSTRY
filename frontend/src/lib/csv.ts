/**
 * CSV export.
 *
 * Every cell is quoted, so commas, quotes and line breaks inside values keep
 * their column. Cells starting with = + - @ (or a tab/CR) are prefixed with
 * an apostrophe: spreadsheet apps would otherwise run them as formulas
 * ("CSV injection"), and names and notes here are typed by users.
 */

export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  let text = value == null ? "" : String(value);
  // Plain negative numbers are data, not formulas
  if (FORMULA_START.test(text) && !/^-\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadCSV(filename: string, rows: CsvCell[][]): void {
  // The byte-order mark makes Excel read UTF-8 (₹, names) correctly
  const blob = new Blob(["﻿", toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking straight away can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
