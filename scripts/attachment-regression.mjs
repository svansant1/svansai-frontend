import { deflateSync } from "node:zlib";
import ExcelJS from "exceljs";

const baseUrl = process.env.SVANSAI_TEST_URL || "http://localhost:3000";
const testClientIp = process.env.SVANSAI_TEST_CLIENT_IP || "127.0.0.202";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toBase64(value) {
  return Buffer.from(value).toString("base64");
}

async function postChat({ prompt, files, sessionId = "attachment-regression" }) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": testClientIp },
    body: JSON.stringify({
      sessionId,
      responseMode: "direct",
      messages: [{ role: "user", content: prompt }],
      files,
    }),
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function makeTextFiles(count) {
  return Array.from({ length: count }, (_, index) => {
    const documentNumber = index + 1;
    return {
      name: `phase5-document-${String(documentNumber).padStart(2, "0")}.txt`,
      type: "text/plain",
      base64: toBase64(`Document ${documentNumber}\nValue: ITEM-${documentNumber}\n`),
    };
  });
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makeSolidPngBase64({ red, green, blue }) {
  const width = 64;
  const height = 64;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row[offset] = red;
      row[offset + 1] = green;
      row[offset + 2] = blue;
      row[offset + 3] = 255;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function makeImageFiles() {
  const colors = [
    ["red", { red: 220, green: 40, blue: 40 }],
    ["orange", { red: 240, green: 140, blue: 30 }],
    ["yellow", { red: 240, green: 220, blue: 30 }],
    ["green", { red: 40, green: 170, blue: 70 }],
    ["blue", { red: 40, green: 90, blue: 220 }],
    ["cyan", { red: 35, green: 190, blue: 210 }],
    ["pink", { red: 235, green: 90, blue: 170 }],
    ["gray", { red: 140, green: 140, blue: 140 }],
    ["black", { red: 15, green: 15, blue: 15 }],
    ["purple", { red: 120, green: 50, blue: 190 }],
  ];

  return colors.map(([color, rgb], index) => ({
    name: `phase5-image-${String(index + 1).padStart(2, "0")}-${color}.png`,
    type: "image/png",
    base64: makeSolidPngBase64(rgb),
  }));
}

function escapePdfText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makePdfBase64() {
  const lines = [
    "SVANS-AI Phase 5 PDF extraction test",
    "The verification phrase is ORBITAL PINEAPPLE 742.",
  ];
  const content = [
    "BT",
    "/F1 18 Tf",
    "72 720 Td",
    `(${escapePdfText(lines[0])}) Tj`,
    "0 -30 Td",
    `(${escapePdfText(lines[1])}) Tj`,
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return toBase64(pdf);
}

async function makeWorkbookBase64() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sales");
  sheet.addRow(["product", "revenue", "units"]);
  sheet.addRow(["Alpha", 120, 4]);
  sheet.addRow(["Beta", 250, 5]);
  sheet.addRow(["Gamma", 180, 3]);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

const textResult = await postChat({
  prompt: "How many numbered documents are attached, and what value is in document 10?",
  files: makeTextFiles(10),
});
assert(textResult.response.ok, `10 text attachments failed with HTTP ${textResult.response.status}`);
const textAnswer = String(textResult.body.text || "");
console.log(`\nTEXT ATTACHMENTS RESPONSE: ${textAnswer.replace(/\s+/g, " ").slice(0, 400)}`);
assert(/\b10\b/.test(textAnswer) && /ITEM-10/i.test(textAnswer), "10 text attachments were not understood.");
assert(
  textResult.body.orchestration?.capabilities?.includes("document_analysis"),
  "Text attachment orchestration did not include document_analysis.",
);

const tooManyResult = await postChat({
  prompt: "This should be rejected because it has too many files.",
  files: makeTextFiles(11),
  sessionId: "attachment-regression-too-many",
});
console.log(`\nTOO MANY ATTACHMENTS STATUS: ${tooManyResult.response.status}`);
assert(tooManyResult.response.status === 400, "11 attachments should be rejected with HTTP 400.");

const imageResult = await postChat({
  prompt: "How many images are attached, and what is the background color of image 10?",
  files: makeImageFiles(),
  sessionId: "attachment-regression-images",
});
assert(imageResult.response.ok, `10 image attachments failed with HTTP ${imageResult.response.status}`);
const imageAnswer = String(imageResult.body.text || "");
console.log(`\nIMAGE ATTACHMENTS RESPONSE: ${imageAnswer.replace(/\s+/g, " ").slice(0, 400)}`);
assert(/\b10\b/.test(imageAnswer) && /purple/i.test(imageAnswer), "10 image attachments were not understood.");
assert(
  imageResult.body.orchestration?.capabilities?.includes("image_analysis"),
  "Image attachment orchestration did not include image_analysis.",
);

const pdfResult = await postChat({
  prompt: "What is the verification phrase in this PDF?",
  files: [
    {
      name: "svansai-phase5-test.pdf",
      type: "application/pdf",
      base64: makePdfBase64(),
    },
  ],
  sessionId: "attachment-regression-pdf",
});
assert(pdfResult.response.ok, `PDF attachment failed with HTTP ${pdfResult.response.status}`);
const pdfAnswer = String(pdfResult.body.text || "");
console.log(`\nPDF ATTACHMENT RESPONSE: ${pdfAnswer.replace(/\s+/g, " ").slice(0, 400)}`);
assert(/ORBITAL PINEAPPLE 742/i.test(pdfAnswer), "PDF embedded text was not extracted.");
assert(
  pdfResult.body.orchestration?.capabilities?.includes("document_analysis"),
  "PDF orchestration did not include document_analysis.",
);

const csvResult = await postChat({
  prompt: "In this CSV, which product has the highest revenue and what is the average revenue?",
  files: [
    {
      name: "phase7-sales.csv",
      type: "text/csv",
      base64: toBase64("product,revenue,units\nAlpha,120,4\nBeta,250,5\nGamma,180,3\n"),
    },
  ],
  sessionId: "attachment-regression-csv",
});
assert(csvResult.response.ok, `CSV attachment failed with HTTP ${csvResult.response.status}`);
const csvAnswer = String(csvResult.body.text || "");
console.log(`\nCSV ATTACHMENT RESPONSE: ${csvAnswer.replace(/\s+/g, " ").slice(0, 400)}`);
assert(/Beta/i.test(csvAnswer) && /183\.?3|183\.33|average/i.test(csvAnswer), "CSV data summary was not understood.");
assert(
  csvResult.body.orchestration?.capabilities?.includes("data_analysis"),
  "CSV orchestration did not include data_analysis.",
);

const workbookResult = await postChat({
  prompt: "In this Excel workbook, which product has the highest revenue and what is the average revenue?",
  files: [
    {
      name: "phase3-sales.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64: await makeWorkbookBase64(),
    },
  ],
  sessionId: "attachment-regression-workbook",
});
assert(workbookResult.response.ok, `Excel attachment failed with HTTP ${workbookResult.response.status}`);
const workbookAnswer = String(workbookResult.body.text || "");
console.log(`\nEXCEL ATTACHMENT RESPONSE: ${workbookAnswer.replace(/\s+/g, " ").slice(0, 400)}`);
assert(/Beta/i.test(workbookAnswer) && /183\.?3|183\.33|average/i.test(workbookAnswer), "Excel workbook summary was not understood.");
assert(
  workbookResult.body.orchestration?.capabilities?.includes("data_analysis"),
  "Excel orchestration did not include data_analysis.",
);

console.log("\nAttachment regression prompts completed.");
