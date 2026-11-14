// Test source only: execution is deferred until the full implementation pass is done.
import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { generatePptx } from "../lib/artifacts/pptx-generator";
import { parseDeckSpec } from "../lib/artifacts/document-spec";

test("PowerPoint includes editable native charts and their workbook", async () => {
  const bytes = await generatePptx("Report", JSON.stringify({ version: 1, kind: "pptx", slides: [{
    title: "Revenue", chart: { type: "bar", series: [{ name: "Revenue", labels: ["Jan", "Feb"], values: [120, 150] }] },
  }] }));
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(Object.keys(zip.files).some((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path)));
  assert.ok(Object.keys(zip.files).some((path) => /^ppt\/embeddings\/.*\.xlsx$/.test(path)));
});

test("chart categories and pie values must be valid, not silently adjusted", () => {
  assert.throws(() => parseDeckSpec(JSON.stringify({ version: 1, kind: "pptx", slides: [{
    title: "Bad chart", chart: { type: "pie", series: [{ name: "Data", labels: ["A", "B"], values: [-1, 3] }] },
  }] })), /nonnegative/i);
});
