import { Document, HeadingLevel, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, Header, Footer, PageNumber, AlignmentType, LevelFormat, PageBreak } from "docx";
import { parseDocumentSpec, type DocumentSpec } from "./document-spec";

async function generateStructuredDocx(title: string, spec: DocumentSpec): Promise<Buffer> {
  const color = spec.theme?.accentColor || "234E70";
  const children: (Paragraph | Table)[] = [new Paragraph({ text: spec.title || title, heading: HeadingLevel.TITLE, spacing: { after: 280 } })];
  const numbering: { reference: string; levels: { level: number; format: typeof LevelFormat.DECIMAL; text: string; alignment: typeof AlignmentType.START }[] }[] = [];
  for (const [index, block] of spec.blocks.entries()) {
    if (block.type === "heading") {
      children.push(new Paragraph({ text: block.text, heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][block.level - 1], keepNext: true, spacing: { before: 240, after: 120 } }));
    } else if (block.type === "paragraph") {
      for (const line of block.text.split("\n")) children.push(new Paragraph({ text: line, spacing: { after: 160 } }));
    } else if (block.type === "pageBreak") {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    } else if (block.type === "table") {
      const rows = [block.columns, ...block.rows].map((row, ri) => new TableRow({ tableHeader: ri === 0, children: row.map((value) => new TableCell({ shading: ri === 0 ? { fill: color } : undefined, children: value.split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, bold: ri === 0, color: ri === 0 ? "FFFFFF" : "172B4D" })], spacing: { after: 80 } })) })) }));
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
      children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
    } else {
      const reference = `list-${index}`;
      if (block.type === "numbered") numbering.push({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }] });
      for (const item of block.items) children.push(new Paragraph({ text: item, ...(block.type === "bullets" ? { bullet: { level: 0 } } : { numbering: { reference, level: 0 } }), spacing: { after: 100 } }));
    }
  }
  const footerChildren: TextRun[] = spec.footer ? [new TextRun(spec.footer)] : [];
  if (spec.pageNumbers) footerChildren.push(new TextRun({ children: ["  •  Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] }));
  const document = new Document({ creator: "SVANS-AI", title: spec.title || title,
    styles: { default: { document: { run: { font: spec.theme?.fontFace || "Calibri", size: 22, color: "172B4D" }, paragraph: { spacing: { line: 276 } } } } },
    numbering: { config: numbering },
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children,
      ...(spec.header ? { headers: { default: new Header({ children: [new Paragraph({ text: spec.header, style: "Header" })] }) } } : {}),
      ...(footerChildren.length ? { footers: { default: new Footer({ children: [new Paragraph({ children: footerChildren, alignment: AlignmentType.RIGHT })] }) } } : {}),
    }],
  });
  return Packer.toBuffer(document);
}

function splitContent(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function generateDocx(
  title: string,
  content: string,
): Promise<Buffer> {
  const spec = parseDocumentSpec(content);
  if (spec) return generateStructuredDocx(title, spec);
  const children: Paragraph[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: {
        after: 300,
      },
    }),
  ];

  for (const block of splitContent(content)) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        children.push(
          new Paragraph({
            text: heading[2],
            heading:
              heading[1].length === 1
                ? HeadingLevel.HEADING_1
                : HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
          }),
        );
        continue;
      }
      const bullet = /^[-*•]\s+(.+)$/.exec(line);

      if (bullet) {
        children.push(
          new Paragraph({
            children: [new TextRun(bullet[1])],
            bullet: {
              level: 0,
            },
            spacing: {
              after: 100,
            },
          }),
        );

        continue;
      }

      children.push(
        new Paragraph({
          children: [new TextRun(line)],
          spacing: {
            after: 180,
          },
        }),
      );
    }
  }

  const document = new Document({
    sections: [
      {
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
