import ExcelJS from "exceljs";
import { parseTabularContent } from "./tabular-content";

function parseRows(content: string): string[][] {
  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    if (line.includes("\t")) {
      return line.split("\t").map((cell) => cell.trim());
    }

    if (line.includes("|")) {
      return line
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean);
    }

    if (line.includes(",")) {
      return line.split(",").map((cell) => cell.trim());
    }

    return [line];
  });
}

export async function generateXlsx(
  title: string,
  content: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "SVANS-AI";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("SVANS-AI");

  worksheet.addRow([title]);

  const titleRow = worksheet.getRow(1);
  titleRow.font = {
    bold: true,
    size: 16,
  };

  worksheet.addRow([]);

  const rows = parseTabularContent(content);

  for (const row of rows) {
    worksheet.addRow(
      row.map((cell) =>
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cell) &&
        cell.replace(/\D/g, "").length <= 15
          ? Number(cell)
          : cell,
      ),
    );
  }
  worksheet.getRow(3).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 3 }];
  worksheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: rows[0].length },
  };

  worksheet.eachRow((row) => {
    row.alignment = {
      vertical: "top",
      wrapText: true,
    };
  });

  worksheet.columns.forEach((column) => {
    let maxLength = 10;

    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const value = String(cell.value ?? "");
      maxLength = Math.max(maxLength, value.length);
    });

    column.width = Math.min(maxLength + 2, 50);
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return Buffer.from(buffer);
}
