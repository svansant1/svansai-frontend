// Deferred: run only during the full update's acceptance phase.
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { parseWorkbookSpec } from "../lib/artifacts/workbook-spec";
import { generateWorkbookXlsx } from "../lib/artifacts/xlsx-generator";

test("typed dates, times, tables and named ranges remain native Excel objects", async () => {
  const spec = parseWorkbookSpec({
    version: 1, namedRanges: [{ name: "TaxRate", sheet: "Data", range: "D2" }],
    sheets: [{ name: "Data", cells: [
      { address: "A1", value: "Date" }, { address: "B1", value: "Amount" },
      { address: "A2", value: "2026-11-02", valueType: "date" }, { address: "B2", value: 100 },
      { address: "C2", value: "12:30:00", valueType: "time" }, { address: "D2", value: 0.1 },
      { address: "E2", formula: "B2*(1+TaxRate)" },
    ], tables: [{ name: "Transactions", range: "A1:B2" }] }],
  });
  const bytes = await generateWorkbookXlsx(spec);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  const sheet = book.getWorksheet("Data")!;
  assert.ok(sheet.getCell("A2").value instanceof Date);
  // ExcelJS reloads time-formatted serials as Dates; verify the stored numeric value too.
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const timeCell = xml.match(/<c\b[^>]*\br="C2"[^>]*>([\s\S]*?)<\/c>/)?.[1];
  const serial = timeCell?.match(/<v>([^<]+)<\/v>/)?.[1];
  assert.ok(serial && Math.abs(Number(serial) - 12.5 / 24) < 1e-8);
  assert.equal((sheet.getCell("C2").value as Date).toISOString(), "1899-12-30T12:30:00.000Z");
  assert.equal(sheet.getCell("C2").numFmt, "hh:mm:ss");
  assert.equal(sheet.getCell("E2").formula, "B2*(1+TaxRate)");
  assert.ok(sheet.getTable("Transactions"));
  assert.equal(book.definedNames.getRanges("TaxRate").ranges[0], "Data!$D$2");
});

test("named references participate in circular dependency detection", () => {
  assert.throws(() => parseWorkbookSpec({
    version: 1, namedRanges: [{ name: "OwnCell", sheet: "Data", range: "A1" }],
    sheets: [{ name: "Data", cells: [{ address: "A1", formula: "OwnCell+1" }] }],
  }), /circular/i);
});

test("invalid calendar dates and table/merge collisions fail explicitly", () => {
  assert.throws(() => parseWorkbookSpec({ version: 1, sheets: [{ name: "Data",
    cells: [{ address: "A1", value: "2026-02-30", valueType: "date" }] }] }), /date/i);
  assert.throws(() => parseWorkbookSpec({ version: 1, sheets: [{ name: "Data",
    cells: [{ address: "A1", value: "Header" }], merges: ["A1:B1"],
    tables: [{ name: "DataTable", range: "A1:B3" }] }] }), /overlap|merge/i);
});
