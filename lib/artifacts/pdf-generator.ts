import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { parseDocumentSpec, safeDocumentText, type DocumentSpec, type NativeTable } from "./document-spec";

export class PdfLayoutError extends Error {
  constructor(message: string) { super(message); this.name = "PdfLayoutError"; }
}

const WIDTH = 612, HEIGHT = 792, MARGIN = 48, TOP = 724, BOTTOM = 64;
const TEXT_WIDTH = WIDTH - MARGIN * 2, MAX_PAGES = 80;
const INK = rgb(0.09, 0.17, 0.27), MUTED = rgb(0.32, 0.39, 0.47);
const WHITE = rgb(1, 1, 1), RULE = rgb(0.82, 0.86, 0.90);

/** Unsupported characters fail visibly instead of becoming empty squares or missing text. */
function printable(text: string, font: PDFFont): string {
  const value = text.replace(/\t/g, "    ");
  try { font.encodeText(value.replace(/\n/g, "")); }
  catch { throw new PdfLayoutError("This PDF font does not support some characters. Choose Word for this text; no characters were removed."); }
  return value;
}

/** Wrap within measured font widths, splitting a long token without dropping characters. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of printable(text, font).split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) { lines.push(line); line = ""; }
        if (font.widthOfTextAtSize(char, size) > width) throw new PdfLayoutError("A PDF character cannot fit its column.");
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Render trusted data blocks; never execute HTML, scripts, URLs, or arbitrary PDF objects. */
export async function generatePdf(title: string, content: string): Promise<Buffer> {
  safeDocumentText(title, "title", 200);
  safeDocumentText(content, "content", 100_000);
  const spec: DocumentSpec = parseDocumentSpec(content, "pdf") ?? {
    version: 1, kind: "pdf", title, pageNumbers: true,
    blocks: content.split(/\n\s*\n/).map((text) => ({ type: "paragraph" as const, text })),
  };
  const document = await PDFDocument.create();
  const normal = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const accentHex = spec.theme?.accentColor || "234E70";
  const accent = rgb(...[0, 2, 4].map((offset) => parseInt(accentHex.slice(offset, offset + 2), 16) / 255) as [number, number, number]);
  document.setTitle(spec.title || title);
  document.setCreator("SVANS-AI");
  document.setProducer("SVANS-AI native PDF renderer");
  document.setLanguage("en");
  let page: PDFPage;
  let y = TOP;
  const newPage = () => {
    if (document.getPageCount() >= MAX_PAGES) throw new PdfLayoutError("PDF exceeds 80 pages. Split the document; no partial file was created.");
    page = document.addPage([WIDTH, HEIGHT]);
    y = TOP;
    if (spec.header) {
      const lines = wrap(spec.header, normal, 9, TEXT_WIDTH);
      if (lines.length > 1) throw new PdfLayoutError("The PDF running header is too wide.");
      page.drawText(lines[0], { x: MARGIN, y: HEIGHT - 35, font: normal, size: 9, color: MUTED });
      page.drawLine({ start: { x: MARGIN, y: HEIGHT - 44 }, end: { x: WIDTH - MARGIN, y: HEIGHT - 44 }, color: RULE, thickness: 0.5 });
    }
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) newPage(); };
  const textBlock = (text: string, size = 11, font = normal, indent = 0, color: RGB = INK, keepNext = false) => {
    const lines = wrap(text, font, size, TEXT_WIDTH - indent);
    const lineHeight = size * 1.4;
    // Keep short headings with the beginning of their following block where possible.
    ensure(Math.min(lines.length, keepNext ? 3 : 2) * lineHeight + (keepNext ? 28 : 0));
    for (const line of lines) {
      ensure(lineHeight);
      if (line) page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color });
      y -= lineHeight;
    }
    y -= 8;
  };
  const table = (value: NativeTable) => {
    const columnWidth = TEXT_WIDTH / value.columns.length, size = 9, lineHeight = 12;
    const layout = (cells: string[], font: PDFFont) => {
      const lines = cells.map((cell) => wrap(cell, font, size, columnWidth - 12));
      return { lines, height: Math.max(...lines.map((cell) => cell.length), 1) * lineHeight + 12 };
    };
    const header = layout(value.columns, bold);
    const maxHeight = TOP - BOTTOM;
    if (header.height > maxHeight / 3) throw new PdfLayoutError("The PDF table header is too tall.");
    const drawRow = (row: ReturnType<typeof layout>, heading: boolean, stripe: boolean) => {
      row.lines.forEach((lines, column) => {
        const x = MARGIN + column * columnWidth;
        // Fixed dark header keeps white labels legible even with a light user theme.
        page.drawRectangle({ x, y: y - row.height, width: columnWidth, height: row.height,
          color: heading ? INK : stripe ? rgb(0.96, 0.97, 0.98) : WHITE, borderColor: RULE, borderWidth: 0.5 });
        lines.forEach((line, i) => {
          if (line) page.drawText(line, { x: x + 6, y: y - 6 - size - i * lineHeight, size,
            font: heading ? bold : normal, color: heading ? WHITE : INK });
        });
      });
      y -= row.height;
    };
    let needsHeader = true;
    for (let index = 0; index < value.rows.length; index++) {
      const row = layout(value.rows[index], normal);
      if (header.height + row.height > maxHeight) throw new PdfLayoutError("A PDF table row cannot fit on one page. Shorten the row or use Word; no text was truncated.");
      if (y - row.height - (needsHeader ? header.height : 0) < BOTTOM) { newPage(); needsHeader = true; }
      if (needsHeader) { drawRow(header, true, false); needsHeader = false; }
      drawRow(row, false, index % 2 === 1);
    }
    y -= 12;
  };
  newPage();
  textBlock(spec.title || title, 24, bold);
  page!.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, color: accent, thickness: 2 });
  y -= 14;
  for (const block of spec.blocks) {
    switch (block.type) {
      case "heading": textBlock(block.text, block.level === 1 ? 18 : block.level === 2 ? 15 : 12, bold, 0, INK, true); break;
      case "paragraph": textBlock(block.text); break;
      case "bullets": case "numbered":
        block.items.forEach((item, index) => textBlock((block.type === "bullets" ? "• " : (index + 1) + ". ") + item, 11, normal, 10));
        break;
      case "table": table(block); break;
      case "pageBreak": newPage(); break;
    }
  }
  document.getPages().forEach((current, index) => {
    const counter = spec.pageNumbers === false ? "" : (index + 1) + " / " + document.getPageCount();
    const counterWidth = normal.widthOfTextAtSize(counter, 9);
    const footerWidth = TEXT_WIDTH - (counter ? counterWidth + 18 : 0);
    if (spec.footer) {
      const lines = wrap(spec.footer, normal, 9, footerWidth);
      if (lines.length > 1) throw new PdfLayoutError("The PDF footer is too wide beside the page number.");
      current.drawText(lines[0], { x: MARGIN, y: 35, font: normal, size: 9, color: MUTED });
    }
    if (counter) current.drawText(counter, { x: WIDTH - MARGIN - counterWidth, y: 35, font: normal, size: 9, color: MUTED });
  });
  return Buffer.from(await document.save());
}
