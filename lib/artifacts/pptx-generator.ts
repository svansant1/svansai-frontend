import PptxGenJS from "pptxgenjs";
import { parseDeckSpec, type DeckSpec } from "./document-spec";

async function generateStructuredDeck(title: string, spec: DeckSpec): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "SVANS-AI";
  pptx.title = spec.title || title;
  pptx.subject = title;
  const background = spec.theme?.backgroundColor || "FFFFFF";
  const foreground = spec.theme?.textColor || "172B4D";
  const accent = spec.theme?.accentColor || "236B8E";
  const fontFace = spec.theme?.fontFace || "Aptos";
  const luminance = (hex: string) => {
    const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const light = luminance(background), dark = luminance(foreground);
  if ((Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05) < 4.5) throw new Error("Presentation text/background contrast is too low.");
  let pages = 0;
  function newPage(heading: string, notes?: string) {
    if (++pages > 100) throw new Error("Presentation exceeds 100 slides; split it into smaller decks.");
    const slide = pptx.addSlide();
    slide.background = { color: background };
    slide.addText(heading, { x: 0.65, y: 0.35, w: 12, h: 1.0, fontFace, color: foreground, bold: true, fontSize: 26, margin: 0, breakLine: false });
    slide.addShape(pptx.ShapeType.rect, { x: 0.65, y: 1.4, w: 1.3, h: 0.06, fill: { color: accent }, line: { color: accent } });
    slide.addText(String(pages), { x: 12.2, y: 7.0, w: 0.5, h: 0.2, color: foreground, fontSize: 10, margin: 0, align: "right" });
    if (notes) slide.addNotes(notes);
    return slide;
  }
  for (const entry of spec.slides) {
    const lines = [...(entry.body ? [entry.body] : []), ...(entry.bullets || [])].flatMap((line) => line.match(/[\s\S]{1,160}(?:\s|$)|[\s\S]{1,160}/g) || []);
    let continuation = 0;
    for (let offset = 0; offset < Math.max(lines.length, entry.table ? 0 : 1); offset += 5) {
      const slide = newPage(entry.title + (continuation++ ? " (continued)" : ""), entry.notes);
      const text = lines.slice(offset, offset + 5).map((line) => ({ text: line, options: { bullet: entry.bullets?.length ? { indent: 18 } : undefined, breakLine: true } }));
      if (text.length) slide.addText(text, { x: 0.8, y: 1.8, w: 11.7, h: 4.7, fontSize: 20, color: foreground, fontFace, valign: "top", paraSpaceAfter: 16, margin: 0.03 });
    }
    if (entry.table) {
      // Bound each row's estimated wrapped height, and start continuation slides as needed.
      const charsPerLine = Math.max(10, Math.floor(105 / entry.table.columns.length));
      const rowHeight = (row: string[]) => Math.max(...row.map((cell) => cell.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0))) * 0.26 + 0.16;
      const headHeight = Math.max(0.45, rowHeight(entry.table.columns));
      let batch: string[][] = [], height = headHeight;
      const flush = () => {
        if (!batch.length) return;
        const slide = newPage(entry.title + (continuation++ ? " (continued)" : ""), entry.notes);
        const header = entry.table!.columns.map((text) => ({ text, options: { bold: true, fill: { color: accent }, color: luminance(accent) > 0.45 ? "172B4D" : "FFFFFF" } }));
        slide.addTable([header, ...batch.map((row) => row.map((text) => ({ text })))], { x: 0.65, y: 1.75, w: 12, fontSize: 14, fontFace, color: foreground, fill: { color: background }, border: { type: "solid", color: "CBD5E1", pt: 0.5 }, margin: 0.08, colW: Array(entry.table!.columns.length).fill(12 / entry.table!.columns.length), autoPage: false });
        batch = []; height = headHeight;
      };
      for (const row of entry.table.rows) {
        const needed = rowHeight(row);
        if (headHeight + needed > 4.8) throw new Error("A presentation table row is too tall; shorten it or move detail to notes.");
        if (height + needed > 4.8) flush();
        batch.push(row); height += needed;
      }
      flush();
    }
  }
  return Buffer.from(await pptx.write({ outputType: "nodebuffer" }) as Buffer);
}

type SlideSection = {
  title: string;
  bullets: string[];
};

function buildSections(content: string): SlideSection[] {
  const blocks = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, index) => {
    const lines = block
      .split("\n")
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);

    const [first, ...rest] = lines;

    return {
      title: first || `Section ${index + 1}`,
      bullets: rest.length > 0 ? rest : [first || ""],
    };
  });
}

export async function generatePptx(
  title: string,
  content: string,
): Promise<Buffer> {
  const spec = parseDeckSpec(content);
  if (spec) return generateStructuredDeck(title, spec);
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "SVANS-AI";
  pptx.subject = title;
  pptx.title = title;
  pptx.company = "Vansant Platform";

  const titleSlide = pptx.addSlide();

  titleSlide.addText(title, {
    x: 0.8,
    y: 2.2,
    w: 11.7,
    h: 1,
    fontSize: 28,
    bold: true,
    align: "center",
    margin: 0,
  });

  titleSlide.addText("Generated by SVANS-AI", {
    x: 0.8,
    y: 3.35,
    w: 11.7,
    h: 0.5,
    fontSize: 14,
    align: "center",
    margin: 0,
  });

  const sections = buildSections(content);

  const pages: SlideSection[] = [];
  // Split long bullets and overflow into additional slides instead of dropping content.
  for (const section of sections) {
    const titleFits = section.title.length <= 100;
    const source = titleFits
      ? section.bullets
      : [
          section.title,
          ...section.bullets.filter((bullet) => bullet !== section.title),
        ];
    const chunks = source.flatMap(
      (bullet) => bullet.match(/[\s\S]{1,180}(?:\s|$)|[\s\S]{1,180}/g) || [],
    );
    for (let offset = 0; offset < chunks.length; offset += 5) {
      pages.push({
        title:
          (titleFits ? section.title.replace(/^#+\s*/, "") : "Details") +
          (offset ? " (continued)" : ""),
        bullets: chunks.slice(offset, offset + 5),
      });
    }
  }
  if (pages.length > 100)
    throw new Error(
      "The presentation needs more than 100 slides; split it into smaller decks.",
    );
  for (const section of pages) {
    const slide = pptx.addSlide();

    slide.addText(section.title, {
      x: 0.7,
      y: 0.45,
      w: 11.9,
      h: 0.6,
      fontSize: 24,
      bold: true,
      margin: 0,
    });

    const bulletText = section.bullets.filter(Boolean).map((bullet) => ({
      text: bullet,
      options: {
        bullet: {
          indent: 18,
        },
        breakLine: true,
      },
    }));

    if (bulletText.length > 0) {
      slide.addText(bulletText, {
        x: 0.9,
        y: 1.35,
        w: 11.2,
        h: 5.2,
        fontSize: 18,
        breakLine: false,
        valign: "top",
        margin: 0.05,
      });
    }
  }

  const output = await pptx.write({
    outputType: "nodebuffer",
  });

  return Buffer.from(output as Buffer);
}
