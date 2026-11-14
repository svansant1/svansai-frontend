// Deferred source fixtures; no tests run during implementation.
import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { inspectOfficePackage } from "../lib/artifacts/office-package";

test("accepts a small bounded Office package", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "<document/>");
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.doesNotThrow(() => inspectOfficePackage(bytes));
});

test("rejects highly compressed oversized parts before full parsing", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "a".repeat(13 * 1024 * 1024));
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.throws(() => inspectOfficePackage(bytes), /limits/i);
});
