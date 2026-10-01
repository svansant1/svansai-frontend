/** Parse quoted CSV, TSV or Markdown tables without dropping empty cells. */
export function parseTabularContent(content: string): string[][] {
  if (content.length > 100_000) throw new Error("Table content is too large.");
  const text = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
  let rows: string[][] = [];
  if (/^\|.*\|\s*$/m.test(text)) {
    rows = text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
        return value.split("|").map((cell) => cell.trim());
      })
      .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
  } else {
    const delimiter = text.split("\n")[0].includes("\t") ? "\t" : ",";
    let row: string[] = [],
      cell = "",
      quoted = false;
    // Consume one character at a time so quoted commas and newlines stay in their cell.
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') {
          cell += '"';
          index++;
        } else if (quoted) quoted = false;
        else if (!cell) quoted = true;
        else throw new Error("Invalid quote in table.");
      } else if (!quoted && (char === delimiter || char === "\n")) {
        row.push(cell);
        cell = "";
        if (char === "\n") {
          rows.push(row);
          row = [];
        }
      } else cell += char;
    }
    if (quoted) throw new Error("The CSV has an unfinished quoted cell.");
    row.push(cell);
    rows.push(row);
  }
  const width = rows[0]?.length || 0;
  if (
    !width ||
    width > 100 ||
    rows.length > 5000 ||
    rows.some((row) => row.length !== width) ||
    rows.length * width > 50_000
  )
    throw new Error(
      "Use a consistent table with at most 100 columns, 5,000 rows and 50,000 cells.",
    );
  return rows;
}

/** CSV readers may execute leading formulas; neutralize them as text. */
export function safeCsv(content: string): string {
  return parseTabularContent(content)
    .map((row) =>
      row
        .map((cell) => {
          const literal =
            /^[\s]*[=+@-]/.test(cell) && !/^-?\d+(?:\.\d+)?$/.test(cell.trim())
              ? "'" + cell
              : cell;
          return '"' + literal.replace(/"/g, '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
