import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

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
