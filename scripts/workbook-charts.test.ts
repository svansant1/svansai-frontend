// Authored only; all executions are deferred until the complete update's testing phase.
import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { generateWorkbookXlsx } from "../lib/artifacts/xlsx-generator";
import { parseWorkbookSpec } from "../lib/artifacts/workbook-spec";

test("native Excel charts link to live cells and keep table relationships", async () => {
  const spec = parseWorkbookSpec({ version: 1, sheets: [{ name: "Sales & tax", cells: [
    { address: "A1", value: "Month" }, { address: "B1", value: "Revenue" },
    { address: "A2", value: "Jan" }, { address: "B2", value: 20 },
    { address: "A3", value: "Feb" }, { address: "B3", formula: "B2*2" },
  ], tables: [{ name: "SalesData", range: "A1:B3" }],
    charts: [{ type: "bar", title: "Sales <Total>", anchor: "F2:N18", categories: "A2:A3", series: [{ name: "Sales", values: "B2:B3" }] }],
  }] });
  const zip = await JSZip.loadAsync(await generateWorkbookXlsx(spec));
  const chart = await zip.file("xl/charts/svans-chart1.xml")!.async("string");
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const rels = await zip.file("xl/worksheets/_rels/sheet1.xml.rels")!.async("string");
  assert.match(chart, /<c:barChart>/);
  assert.match(chart, /\$B\$2:\$B\$3/);
  assert.match(chart, /Sales &amp; tax/);
  assert.match(chart, /Sales &lt;Total&gt;/);
  assert.doesNotMatch(chart, /<c:pt idx="1"><c:v>40/); // Formula result is not fabricated.
  assert.ok(sheet.indexOf("<drawing") < sheet.indexOf("<tableParts"));
  assert.match(rels, /relationships\/table/);
  assert.match(rels, /relationships\/drawing/);
});

test("chart sources cannot read outside workbook or mix unequal series", () => {
  assert.throws(() => parseWorkbookSpec({ version: 1, sheets: [{ name: "Data", cells: [], charts: [{
    type: "line", title: "Bad", anchor: "F2:N18", dataSheet: "External",
    categories: "A1:A2", series: [{ name: "X", values: "B1:B2" }],
  }] }] }), /does not exist/i);
});
