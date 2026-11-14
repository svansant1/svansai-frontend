// Authored during implementation. Do not run until the full update's verification phase.
import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { generatePdf, PdfLayoutError } from "../lib/artifacts/pdf-generator";
import { detectArtifactRequest } from "../lib/artifacts/request-parser";
import { generateArtifact } from "../lib/artifacts/artifact-generator";

test("routes a PDF destination instead of its Word source", () => {
  assert.equal(detectArtifactRequest("Convert this Word document to PDF")?.format, "pdf");
  assert.equal(detectArtifactRequest("Can you create PDFs?"), null);
});

test("creates native paginated PDF bytes with metadata and a table", async () => {
  const bytes = await generatePdf("Report", JSON.stringify({
    version: 1, kind: "pdf", title: "Quarterly report", header: "Company report",
    footer: "Internal", pageNumbers: true,
    blocks: [
      { type: "paragraph", text: "Revenue was supplied by the user." },
      { type: "table", columns: ["Period", "Revenue"], rows: Array.from({ length: 100 }, (_, i) => [String(i + 1), "1200"]) },
      { type: "pageBreak" },
      { type: "numbered", items: ["Review the figures.", "Approve the report."] },
    ],
  }));
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getTitle(), "Quarterly report");
  assert.ok(document.getPageCount() > 2);
});

test("does not silently replace unsupported glyphs or truncate a table row", async () => {
  await assert.rejects(() => generatePdf("Report", "Unrepresentable character: 😀"), PdfLayoutError);
  await assert.rejects(() => generatePdf("Report", JSON.stringify({
    version: 1, kind: "pdf", blocks: [{ type: "table", columns: ["A", "B", "C", "D", "E", "F", "G", "H"],
      rows: [["a ".repeat(900), "", "", "", "", "", "", ""]] }],
  })), /row.*page/i);
});

test("native PDF artifact has matching type and real bytes", async () => {
  const { artifact } = await generateArtifact({ title: "Notes", content: "Finished content.", format: "pdf", kind: "document" });
  assert.equal(artifact.mimeType, "application/pdf");
  assert.ok(artifact.name.endsWith(".pdf"));
  assert.equal(Buffer.from(artifact.base64, "base64").length, artifact.size);
});
