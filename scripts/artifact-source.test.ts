import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph } from "docx";
import { extractArtifactSource } from "../lib/artifacts/source-extraction";

function source(name: string, type: string, content: string | Buffer) {
  return { name, type, base64: Buffer.from(content).toString("base64") };
}

test("CSV and TSV retain every row and quoted/empty cells, not an eight-row summary", async () => {
  const csv = 'Name,Note,Empty\n' + Array.from({ length: 30 }, (_, i) => `Person${i + 1},"Note, ${i + 1}",`).join("\n");
  const result = await extractArtifactSource(source("source.csv", "text/csv", csv));
  assert.equal(result.extractedText, csv);
  assert.equal(result.error, undefined);
  const tsv = "Name\tValue\nFinal\t\n";
  assert.equal((await extractArtifactSource(source("source.tsv", "text/tab-separated-values", tsv))).extractedText, tsv);
});

test("text at the limit is complete; oversized and binary text are explicitly rejected", async () => {
  const complete = "x".repeat(100_000);
  assert.equal((await extractArtifactSource(source("data.txt", "text/plain", complete))).extractedText, complete);
  const result = await extractArtifactSource(source("large.csv", "text/csv", complete + "LAST ROW"));
  assert.match(result.error!, /100,000/);
  assert.equal(result.extractedText, undefined);
  const binary = await extractArtifactSource(source("binary.txt", "text/plain", Buffer.from([0xff, 0x00])));
  assert.ok(binary.error);
  assert.equal(binary.extractedText, undefined);
});

test("DOCX body text after the old 60k cutoff survives with text-only limitations", async () => {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("x".repeat(60_010)), new Paragraph("FINAL BODY TEXT")] }] }));
  const result = await extractArtifactSource(source("source.docx", "application/octet-stream", bytes));
  assert.equal(result.error, undefined);
  assert.ok(result.extractedText!.includes("FINAL BODY TEXT"));
  assert.match(result.limitations!, /body text only/);
  const tooLarge = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("x".repeat(100_001))] }] }));
  const rejected = await extractArtifactSource(source("large.docx", "application/octet-stream", tooLarge));
  assert.match(rejected.error!, /100,000/);
  assert.equal(rejected.extractedText, undefined);
});

test("XLSX retains all sheets and sparse rows/columns beyond old sample bounds", async () => {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet("First");
  first.getCell("A1").value = "Header";
  first.getCell("AO251").value = 'Last, "quoted" value';
  for (let i = 2; i <= 9; i++) workbook.addWorksheet(`Sheet ${i}`).getCell("A1").value = `Sheet ${i} data`;
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await extractArtifactSource(source("source.xlsx", "application/octet-stream", bytes));
  assert.equal(result.error, undefined);
  assert.match(result.extractedText!, /251 rows, 41 columns/);
  assert.match(result.extractedText!, /Last, ""quoted"" value/);
  assert.match(result.extractedText!, /Sheet 9 data/);
  assert.match(result.limitations!, /All sheet cell values/);
});

test("XLSX rejects full used ranges above 50,000 cells and text above 100k", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Oversized").getCell("A50001").value = "Do not lose this value";
  const result = await extractArtifactSource(source("large.xlsx", "application/octet-stream", Buffer.from(await workbook.xlsx.writeBuffer())));
  assert.match(result.error!, /50,000 cells/);
  assert.equal(result.extractedText, undefined);
  const largeText = new ExcelJS.Workbook();
  const sheet = largeText.addWorksheet("Text");
  for (let row = 1; row <= 4; row++) sheet.getCell(row, 1).value = "x".repeat(30_000);
  const rejected = await extractArtifactSource(source("text.xlsx", "application/octet-stream", Buffer.from(await largeText.xlsx.writeBuffer())));
  assert.match(rejected.error!, /100,000/);
  assert.equal(rejected.extractedText, undefined);
});

test("unsupported images are rejected without OCR or paid calls", async () => {
  const result = await extractArtifactSource(source("image.png", "image/png", "Not a text source"));
  assert.match(result.error!, /not supported/);
  assert.equal(result.extractedText, undefined);
});
