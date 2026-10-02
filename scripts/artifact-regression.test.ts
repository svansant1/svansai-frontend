import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { generateArtifact } from "../lib/artifacts/artifact-generator";
import { detectArtifactRequest } from "../lib/artifacts/request-parser";
import { generateChatArtifact } from "../lib/artifacts/chat-artifacts";
import { parseTabularContent, safeCsv } from "../lib/artifacts/tabular-content";
import {
  encodeStoredMessage,
  decodeStoredMessage,
} from "../lib/artifacts/message-storage";
import { artifactToChatFile } from "../components/GeneratedFileDownload";
import {
  isImageGenerationRequest,
  generateImageWithOpenAI,
} from "../lib/ai/image-generation";

test("routes explicit Office requests without stealing ordinary writing or capability questions", () => {
  assert.equal(
    detectArtifactRequest("Can you make a Word document about routers?")
      ?.format,
    "docx",
  );
  assert.equal(detectArtifactRequest("Put that into Word")?.format, "docx");
  assert.equal(detectArtifactRequest("Create an Excel budget")?.format, "xlsx");
  assert.equal(
    detectArtifactRequest("Make a PowerPoint about safety")?.format,
    "pptx",
  );
  assert.equal(detectArtifactRequest("Export this CSV")?.kind, "spreadsheet");
  for (const [prompt, format] of [
    ["Create a PowerPoint from this Word document", "pptx"],
    ["Convert this Word document to PowerPoint", "pptx"],
    ["Turn the PowerPoint into a Word document", "docx"],
    ["Save this Excel workbook as CSV", "csv"],
    ["Create a Word document about PowerPoint", "docx"],
    ["Create a PowerPoint\nContent:\nMy Word document", "pptx"],
  ]) assert.equal(detectArtifactRequest(prompt)?.format, format, prompt);
  for (const prompt of [
    "Write a 100 word reply",
    "How do I create a PowerPoint?",
    "Don't create an Excel file",
    "Can you make Word documents?",
  ])
    assert.equal(detectArtifactRequest(prompt), null, prompt);
});

test("native Word file contains the supplied text and heading structure", async () => {
  const result = await generateArtifact({
    title: "Study guide",
    content: "# Networks\n\nA router connects networks.\n- Review DNS",
    format: "docx",
    kind: "document",
  });
  const zip = await JSZip.loadAsync(
    Buffer.from(result.artifact.base64, "base64"),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /A router connects networks/);
  assert.match(xml, /Heading1/);
  assert.ok(artifactToChatFile(result.artifact)?.fileName.endsWith(".docx"));
});

test("Excel preserves quoted CSV, empty columns, identifiers and numeric cells", async () => {
  const content =
    'Name,Missing,Amount,ID\n"Smith, Jane",,12.5,0012\n"Two\nlines",,4,0013';
  assert.deepEqual(parseTabularContent(content)[1], [
    "Smith, Jane",
    "",
    "12.5",
    "0012",
  ]);
  const result = await generateArtifact({
    title: "Data",
    content,
    format: "xlsx",
    kind: "spreadsheet",
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    new Uint8Array(Buffer.from(result.artifact.base64, "base64")).buffer,
  );
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("A4").value, "Smith, Jane");
  assert.equal(sheet.getCell("C4").value, 12.5);
  assert.equal(sheet.getCell("D4").value, "0012");
  assert.equal(sheet.getCell("A5").value, "Two\nlines");
  assert.deepEqual(
    parseTabularContent("| A | B | C |\n| --- | --- | --- |\n| 1 | | 3 |")[1],
    ["1", "", "3"],
  );
});

test("PowerPoint retains later sections rather than silently dropping them", async () => {
  const content = Array.from(
    { length: 30 },
    (_, i) => `Topic ${i + 1}\n- Detail ${i + 1}`,
  ).join("\n\n");
  const result = await generateArtifact({
    title: "Training",
    content,
    format: "pptx",
    kind: "presentation",
  });
  const zip = await JSZip.loadAsync(
    Buffer.from(result.artifact.base64, "base64"),
  );
  const slides = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name),
  );
  assert.equal(slides.length, 31);
  assert.match(
    await zip.file("ppt/slides/slide31.xml")!.async("string"),
    /Detail 30/,
  );
});

test("CSV neutralizes executable formulas and exporters reject oversized input", async () => {
  assert.match(
    safeCsv(
      'Name,Value\nTest,=WEBSERVICE("x")'.replace('=WEBSERVICE("x")', "=1+1"),
    ),
    /\'=1\+1/,
  );
  assert.throws(() => parseTabularContent('A,B\n"x'), /unfinished/);
  await assert.rejects(
    generateArtifact({
      title: "Large",
      content: "x".repeat(100_001),
      format: "txt",
      kind: "text",
    }),
    /size limit/,
  );
});

test("chat generation exports supplied content without calling a model and failures have no fake file", async () => {
  const request = detectArtifactRequest(
    'Create a Word document titled "Report"\nContent:\nAll systems reviewed.',
  )!;
  const result = await generateChatArtifact(
    { request, messages: [{ role: "user", content: request.prompt }] },
    {
      draft: async () => {
        throw Error("Should not call");
      },
    },
  );
  assert.ok("artifact" in result);
  const failure = await generateChatArtifact(
    { request: detectArtifactRequest("Create an Excel budget")!, messages: [] },
    {
      draft: async () => {
        throw Error("offline");
      },
    },
  );
  assert.ok(!("artifact" in failure));
  const drafted = await generateChatArtifact(
    { request: detectArtifactRequest("Create an Excel budget")!, messages: [] },
    { draft: async () => JSON.stringify({ version: 1, title: "Budget", sheets: [{ name: "Budget", cells: [{ address: "A1", value: "Item" }, { address: "B1", value: "Cost" }, { address: "A2", value: "Supplies" }, { address: "B2", value: 10 }] }] }) },
  );
  assert.ok("artifact" in drafted);
});

test("downloads survive a saved-message round trip without putting binary into visible text", async () => {
  const result = await generateArtifact({
    title: "Test",
    content: "Saved text",
    format: "docx",
    kind: "document",
  });
  const file = artifactToChatFile(result.artifact)!;
  const message = { role: "assistant" as const, content: result.text, ...file };
  const stored = encodeStoredMessage(message);
  const restored = decodeStoredMessage({ role: "assistant", content: stored });
  assert.deepEqual(restored, message);
  assert.ok(!restored.content.includes(result.artifact.base64));
  assert.deepEqual(decodeStoredMessage({ role: "user", content: "Old chat" }), {
    role: "user",
    content: "Old chat",
  });
  assert.throws(
    () => artifactToChatFile({ ...result.artifact, size: 0 }),
    /incomplete/,
  );
});

test("polite picture requests route to images and mocked image output is a real PNG", async () => {
  assert.ok(isImageGenerationRequest("Can you create a picture of a robot?"));
  assert.ok(!isImageGenerationRequest("Can you generate images?"));
  assert.ok(!isImageGenerationRequest("Don't generate a picture of a robot"));
  const oldKey = process.env.OPENAI_API_KEY,
    oldFetch = globalThis.fetch,
    oldFormat = process.env.SVANSAI_IMAGE_FORMAT;
  process.env.OPENAI_API_KEY = "offline-test";
  process.env.SVANSAI_IMAGE_FORMAT = "png";
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
      headers: { "content-type": "application/json" },
    });
  try {
    assert.equal(
      (await generateImageWithOpenAI("Generate a picture of a robot"))?.base64,
      png,
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    if (oldFormat === undefined) delete process.env.SVANSAI_IMAGE_FORMAT;
    else process.env.SVANSAI_IMAGE_FORMAT = oldFormat;
  }
});
