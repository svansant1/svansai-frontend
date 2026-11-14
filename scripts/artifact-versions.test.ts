// Pure unit fixtures authored now. Execution waits for the full implementation pass.
import test from "node:test";
import assert from "node:assert/strict";
import { encodeStoredMessage, decodeStoredMessage } from "../lib/artifacts/message-storage";
import { parseArtifactReference } from "../lib/artifacts/references";
import { applyRecipeReplacements } from "../lib/artifacts/revisions";
import { recipeDifferences } from "../lib/artifacts/recipe-diff";
const ref = { id: "b3127c03-2354-42f0-a50b-a5856d3bf072", name: "Notes.pdf", format: "pdf", mimeType: "application/pdf", size: 100, sha256: "a".repeat(64) };

test("saved chat uses metadata references and preserves readable text", () => {
  const encoded = encodeStoredMessage({ role: "assistant", content: "Created Notes.pdf.", artifactReference: ref });
  assert.match(encoded, /^\[\[SVANS_SAVED_ARTIFACT_V2\]\]/);
  assert.doesNotMatch(encoded, /base64|access_token/);
  assert.deepEqual(decodeStoredMessage({ role: "assistant", content: encoded }), { role: "assistant", content: "Created Notes.pdf.", artifactReference: ref });
  assert.throws(() => parseArtifactReference({ ...ref, id: "../../other-user" }));
});

test("recipe edits leave unrelated document blocks unchanged", () => {
  const original = { version: 1, kind: "docx", blocks: [{ type: "paragraph", text: "Old" }, { type: "paragraph", text: "Keep this" }] };
  const updated = { ...original, blocks: [{ type: "paragraph", text: "New" }, original.blocks[1]] };
  const operations = recipeDifferences(original, updated);
  assert.deepEqual(operations, [{ op: "replace", path: "/blocks/0/text", value: "New" }]);
  const output = JSON.parse(applyRecipeReplacements(JSON.stringify(original), operations, "docx"));
  assert.equal(output.blocks[0].text, "New");
  assert.deepEqual(output.blocks[1], original.blocks[1]);
});

test("revisions cannot inject arbitrary fields, formulas or prototype changes", () => {
  const original = JSON.stringify({ version: 1, kind: "docx", blocks: [{ type: "paragraph", text: "Old" }] });
  assert.throws(() => applyRecipeReplacements(original, [{ op: "replace", path: "/__proto__/x", value: 1 }], "docx"));
  assert.throws(() => applyRecipeReplacements(original, [{ op: "replace", path: "/blocks/0", value: { type: "script", text: "bad" } }], "docx"));
});
