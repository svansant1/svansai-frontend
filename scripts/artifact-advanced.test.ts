import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { generateArtifact } from "../lib/artifacts/artifact-generator";
import { generateChatArtifact } from "../lib/artifacts/chat-artifacts";
import { detectArtifactRequest } from "../lib/artifacts/request-parser";
import { parseWorkbookSpec } from "../lib/artifacts/workbook-spec";
import { imageOutputOptions, generateImageWithOpenAI, isImageEditingRequest } from "../lib/ai/image-generation";
import { hiloSpec, hiloPrompt } from "./fixtures/hilo-workbook";

test("positive file requests survive negative design constraints across formats", () => {
  for (const [prompt, format] of [
    [hiloPrompt,"xlsx"], ["Create a Word document. Do not create a static reference table.","docx"],
    ["Do not create a Word document. Create an Excel workbook instead.","xlsx"],
    ["Send that as an .xlsx file","xlsx"], ["Create a PowerPoint from a Word document.","pptx"],
  ]) assert.equal(detectArtifactRequest(prompt)?.format, format, prompt);
  for (const prompt of ["Do not create an Excel file", "I don't want you to create a Word document", "How do I create Excel formulas?", "Create an Excel workbook. Do not create the file after all."]) assert.equal(detectArtifactRequest(prompt), null, prompt);
});

test("six-round Hi-Lo request becomes a native workbook with blank inputs and real linked formulas", async () => {
  const spec = hiloSpec();
  const normalized = parseWorkbookSpec(spec);
  assert.equal(normalized.sheets[1].cells.filter((cell) => cell.formula).length, 312);
  const result = await generateChatArtifact({ request: detectArtifactRequest(hiloPrompt)!, messages: [{ role: "user", content: hiloPrompt }] }, { draft: async (input) => {
    assert.match(input.systemInstruction, /formulaFills/);
    return JSON.stringify(spec);
  } });
  assert.ok("artifact" in result);
  const bytes = Buffer.from(result.artifact.base64, "base64");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  assert.equal(book.worksheets.length, 2);
  const sheet = book.getWorksheet("Card Inputs")!;
  assert.equal(sheet.getCell("A4").value, null);
  assert.equal(sheet.getCell("A4").dataValidation.type, "list");
  assert.match(sheet.getCell("B4").formula, /UPPER\(TRIM\(A4/);
  assert.match(sheet.getCell("L55").formula, /UPPER\(TRIM\(K55/);
  assert.equal(book.getWorksheet("Summary")!.getCell("A4").formula, "D16");
  const zip = await JSZip.loadAsync(bytes);
  assert.match(await zip.file("xl/workbook.xml")!.async("string"), /fullCalcOnLoad="1"/);
  assert.match(await zip.file("xl/worksheets/sheet1.xml")!.async("string"), /conditionalFormatting/);
});

test("formula validator rejects external, dynamic, malformed, cyclic and missing-sheet formulas", () => {
  const spec = (formula: string) => ({ version: 1, sheets: [{ name: "Test", cells: [{ address: "A1", formula }] }] });
  for (const formula of ['WEBSERVICE("https://example.com")','HYPERLINK("https://example.com","x")','INDIRECT("B1")',"'[remote.xlsx]Sheet1'!B1","Missing!A2","A1+1","SUM(","A99999"]) assert.throws(() => parseWorkbookSpec(spec(formula)), undefined, formula);
  assert.throws(() => parseWorkbookSpec({ version: 1, sheets: [{ name: "Test", cells: [{address:"A1",formula:"B1"},{address:"B1",formula:"A1"}] }] }), /circular/i);
});

test("Word exports real tables, lists, page breaks, running header and page-number footer", async () => {
  const result = await generateArtifact({ title:"Report", format:"docx", kind:"document", content: JSON.stringify({version:1,kind:"docx",header:"Review",footer:"Internal",pageNumbers:true,blocks:[{type:"heading",level:1,text:"Findings"},{type:"table",columns:["Item","Status"],rows:[["Network","Ready"]]},{type:"numbered",items:["Review","Approve"]},{type:"pageBreak"},{type:"paragraph",text:"Second page"}]}) });
  const zip = await JSZip.loadAsync(Buffer.from(result.artifact.base64,"base64"));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<w:tbl>/); assert.match(xml, /w:type="page"/); assert.match(xml, /w:numPr/);
  assert.match(await zip.file("word/header1.xml")!.async("string"), /Review/);
  assert.match(await zip.file("word/footer1.xml")!.async("string"), /PAGE/);
});

test("PowerPoint exports editable tables and speaker notes in explicit slide order", async () => {
  const result = await generateArtifact({ title:"Deck", format:"pptx", kind:"presentation", content:JSON.stringify({version:1,kind:"pptx",slides:[{title:"Overview",bullets:["A key point"],notes:"Say this out loud."},{title:"Results",table:{columns:["Item","Value"],rows:[["Count","4"]]},notes:"Explain the table."}]}) });
  const zip = await JSZip.loadAsync(Buffer.from(result.artifact.base64,"base64"));
  assert.match(await zip.file("ppt/slides/slide2.xml")!.async("string"), /<a:tbl>/);
  assert.match(await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string"), /Say this out loud/);
  assert.equal(Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 2);
});

test("invalid native specs and unsupported model requests never become fake downloads", async () => {
  for (const format of ["docx","pptx","xlsx"] as const) await assert.rejects(generateArtifact({title:"Bad",format,kind:"document",content:'{"version":1,"remoteImage":"https://example.com/x.png"}'}));
  const result = await generateChatArtifact({request:detectArtifactRequest("Create an interactive Excel workbook")!,messages:[]},{draft:async()=>"Label,Value\nNot a formula,4"});
  assert.ok(!("artifact" in result));
  const staticWorkbook = await generateChatArtifact({ request: detectArtifactRequest("Create an interactive Excel workbook")!, messages: [] }, { draft: async () => JSON.stringify({ version: 1, sheets: [{ name: "Static", cells: [{ address: "A1", value: "Not interactive" }] }] }) });
  assert.ok(!("artifact" in staticWorkbook)); assert.match(staticWorkbook.text, /omitted the requested calculations/);
  const unsupported = await generateChatArtifact({request:detectArtifactRequest("Create an Excel chart")!,messages:[]},{draft:async()=>JSON.stringify({unsupported:"Native charts are not supported yet."})});
  assert.ok(!("artifact" in unsupported)); assert.match(unsupported.text,/not supported/);
});

test("image options support orientation and transparency; edits send source files not fresh generation", async () => {
  const options = imageOutputOptions("Create a landscape logo with transparent background as JPEG");
  assert.equal(options.size,"1536x1024"); assert.equal(options.output_format,"png"); assert.equal(options.background,"transparent");
  assert.ok(isImageEditingRequest("Edit this image to make the background blue"));
  const previousFetch=globalThis.fetch, previousKey=process.env.OPENAI_API_KEY;
  const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=";
  process.env.OPENAI_API_KEY="offline-test";
  globalThis.fetch=async(url,init)=>{assert.match(String(url),/\/images\/edits$/);assert.ok(init?.body instanceof FormData);assert.equal(init.body.getAll("image[]").length,1);return new Response(JSON.stringify({data:[{b64_json:png}]}));};
  try { assert.ok(await generateImageWithOpenAI("Edit this image with a transparent background",[{name:"source.png",type:"image/png",base64:png}])); assert.equal(await generateImageWithOpenAI("Edit this image"),null); }
  finally {globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;}
});
