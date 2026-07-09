import ExcelJS from "exceljs";
import { formatDataSummary, summarizeDelimitedData } from "@/lib/ai/data-understanding";

function cellToText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("hyperlink" in value && "text" in value) return String(value.text ?? value.hyperlink ?? "");
    return JSON.stringify(value);
  }
  return String(value);
}

function worksheetToDelimitedText(worksheet: ExcelJS.Worksheet): string {
  const rows: string[] = [];
  const maxColumn = Math.min(worksheet.actualColumnCount || worksheet.columnCount || 20, 40);
  const maxRow = Math.min(worksheet.actualRowCount || worksheet.rowCount || 100, 250);

  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values: string[] = [];
    for (let columnNumber = 1; columnNumber <= maxColumn; columnNumber += 1) {
      const value = cellToText(row.getCell(columnNumber).value);
      values.push(value.includes(",") ? `"${value.replace(/"/g, '""')}"` : value);
    }
    if (values.some(Boolean)) rows.push(values.join(","));
  }

  return rows.join("\n");
}

export async function summarizeWorkbook(base64: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const bytes = Buffer.from(base64, "base64");
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  const sheetSummaries = workbook.worksheets.slice(0, 8).map((worksheet) => {
    const delimited = worksheetToDelimitedText(worksheet);
    const summary = summarizeDelimitedData(delimited, `${worksheet.name}.csv`);
    const base = [
      `Sheet: ${worksheet.name}`,
      `Rows with data: ${worksheet.actualRowCount || worksheet.rowCount}`,
      `Columns with data: ${worksheet.actualColumnCount || worksheet.columnCount}`,
    ].join("\n");

    return summary
      ? `${base}\n\n${formatDataSummary(summary)}`
      : `${base}\n\nSample data:\n${delimited.split("\n").slice(0, 10).join("\n")}`;
  });

  return `
Excel workbook summary:
- Sheets analyzed: ${sheetSummaries.length} of ${workbook.worksheets.length}

${sheetSummaries.join("\n\n---\n\n")}
`.trim().slice(0, 80_000);
}
