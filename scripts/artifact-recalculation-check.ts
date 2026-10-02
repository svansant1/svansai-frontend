// Optional independent recalculation QA. The artifact engine is NOT an app/runtime dependency.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { generateXlsx } from "../lib/artifacts/xlsx-generator";
import { hiloSpec } from "./fixtures/hilo-workbook";

async function main() {
  const engine = process.env.SVANSAI_QA_ARTIFACT_MODULE;
  if (!engine) throw new Error("Set SVANSAI_QA_ARTIFACT_MODULE to the bundled artifact-tool public entry point for this optional check.");
  const { SpreadsheetFile } = await import(pathToFileURL(engine).href);
  const bytes = await generateXlsx("Hi-Lo test", JSON.stringify(hiloSpec()));
  const book = await SpreadsheetFile.importXlsx(new Uint8Array(bytes).buffer);
  const inputs = book.worksheets.getItem("Card Inputs");
  const summary = book.worksheets.getItem("Summary");
  const value = (address: string) => summary.getRange(address).values[0][0];
  book.recalculate();
  assert.equal(value("A4"), 0);
  assert.equal(value("C4"), 6);
  assert.equal(value("G4"), "Not started");
  inputs.getRange("A4:A11").values = [[2],[5],[9],[10],["J"],["Q"],["K"],["A"]];
  book.recalculate();
  assert.equal(value("A4"), -3);
  assert.ok(Math.abs(value("C4") - (6 - 8 / 52)) < 1e-10);
  assert.ok(Math.abs(value("E4") - (-3 / (6 - 8 / 52))) < 1e-10);
  assert.equal(value("G4"), "In progress");
  inputs.getRange("A8").values = [[2]];
  inputs.getRange("K4").values = [["A"]];
  book.recalculate();
  assert.equal(value("A4"), -2);
  inputs.getRange("A4").values = [["invalid"]];
  book.recalculate();
  assert.equal(value("G4"), "Fix card entries");
  for (const column of ["A","C","E","G","I","K"]) inputs.getRange(`${column}4:${column}55`).values = Array.from({length:52},()=>[2]);
  book.recalculate();
  assert.equal(value("C4"),0);
  assert.equal(value("G4"),"Shoe exhausted");
  assert.equal(value("E4"), "N/A");
  for (const column of ["A","C","E","G","I","K"]) inputs.getRange(`${column}4:${column}55`).values = Array.from({length:52},()=>[null]);
  book.recalculate();
  assert.equal(value("A4"),0);
  assert.equal(value("C4"),6);
  console.log("PASS: independent engine recalculates blank, numeric/face ranks, changed input, six-round totals, invalid entry, exhausted shoe, and reset.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
