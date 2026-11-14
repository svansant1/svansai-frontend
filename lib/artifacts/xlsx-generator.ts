import ExcelJS from "exceljs";
import { parseTabularContent } from "./tabular-content";
import { parseWorkbookSpec, type WorkbookSpec, type WorkbookCellSpec } from "./workbook-spec";
import { addNativeWorkbookCharts } from "./xlsx-charts";

function nativeValue(entry: WorkbookCellSpec): ExcelJS.CellValue {
  if (entry.formula) return { formula: entry.formula };
  if (entry.valueType === "date") return new Date(String(entry.value) + "T00:00:00Z");
  if (entry.valueType === "datetime") return new Date(String(entry.value));
  if (entry.valueType === "time") {
    const [hours, minutes, seconds] = String(entry.value).split(":").map(Number);
    return (hours * 3600 + minutes * 60 + seconds) / 86400;
  }
  return entry.value ?? null;
}

/** Only validated data specifications can create formulas; CSV remains literal data. */
export async function generateWorkbookXlsx(input: WorkbookSpec, fallbackTitle = "SVANS-AI"): Promise<Buffer> {
  const spec = parseWorkbookSpec(input);
  const book = new ExcelJS.Workbook();
  book.creator = "SVANS-AI";
  book.title = spec.title || fallbackTitle;
  book.calcProperties.fullCalcOnLoad = true;
  for (const named of spec.namedRanges || []) {
    const reference = named.range.split(":").map((cell) => cell.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2")).join(":");
    book.definedNames.add("'" + named.sheet.replace(/'/g, "''") + "'!" + reference, named.name);
  }
  for (const item of spec.sheets) {
    const sheet = book.addWorksheet(item.name);
    sheet.properties.defaultRowHeight = 22;
    sheet.properties.defaultColWidth = 18;
    sheet.views = [{ state: "frozen", ySplit: item.freezeRows || 0, showGridLines: false }];
    item.columnWidths?.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    for (const entry of item.cells) {
      const cell = sheet.getCell(entry.address);
      cell.value = nativeValue(entry);
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF172B4D" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (entry.numberFormat) cell.numFmt = entry.numberFormat;
      else if (entry.valueType) cell.numFmt = entry.valueType === "time" ? "hh:mm:ss" : entry.valueType === "datetime" ? "yyyy-mm-dd hh:mm:ss" : "yyyy-mm-dd";
      if (entry.style === "title" || entry.style === "header") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } };
        cell.font = { name: "Calibri", size: entry.style === "title" ? 18 : 11, bold: true, color: { argb: "FFFFFFFF" } };
        sheet.getRow(Number(cell.row)).height = entry.style === "title" ? 36 : 32;
      } else if (entry.style === "input") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF3FF" } };
        cell.font = { name: "Calibri", size: 11, color: { argb: "FF145DA0" } };
        cell.protection = { locked: false };
      } else if (entry.style === "output" || entry.formula) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } };
      } else if (entry.style === "note") {
        cell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF526477" } };
      }
    }
    for (const table of item.tables || []) {
      const [first, last] = table.range.split(":");
      const start = sheet.getCell(first), end = sheet.getCell(last);
      const columns: { name: string; filterButton: boolean }[] = [];
      const rows: ExcelJS.CellValue[][] = [];
      for (let column = Number(start.col); column <= Number(end.col); column++) {
        columns.push({ name: String(sheet.getCell(Number(start.row), column).value), filterButton: true });
      }
      for (let row = Number(start.row) + 1; row <= Number(end.row); row++) {
        const values: ExcelJS.CellValue[] = [];
        for (let column = Number(start.col); column <= Number(end.col); column++) values.push(sheet.getCell(row, column).value);
        rows.push(values);
      }
      sheet.addTable({ name: table.name, ref: first, headerRow: true, totalsRow: false,
        style: { theme: "TableStyleMedium2", showRowStripes: true }, columns, rows });
    }
    for (const merge of item.merges || []) sheet.mergeCells(merge);
    if (item.autoFilter) sheet.autoFilter = item.autoFilter;
    for (const validation of item.validations || []) {
      const [start, end = start] = validation.range.split(":");
      const first = sheet.getCell(start), last = sheet.getCell(end);
      for (let row = Number(first.row); row <= Number(last.row); row++) {
        for (let column = Number(first.col); column <= Number(last.col); column++) {
          const cell = sheet.getCell(row, column);
          cell.dataValidation = validation.type === "list"
            ? { type: "list", allowBlank: true, formulae: ['"' + validation.values!.join(",") + '"'], showErrorMessage: true, errorStyle: "stop", errorTitle: "Choose a valid value", error: "Use the dropdown choices or leave this cell blank." }
            : { type: validation.type, operator: "between", allowBlank: true, formulae: [validation.minimum!, validation.maximum!], showErrorMessage: true, errorStyle: "stop", errorTitle: "Value outside range", error: `Enter a value between ${validation.minimum} and ${validation.maximum}.` };
          if (!cell.formula) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF3FF" } };
            cell.protection = { locked: false };
          }
        }
      }
    }
    for (const rule of item.conditionalFormats || []) {
      sheet.addConditionalFormatting({ ref: rule.range, rules: [{ type: "cellIs", operator: rule.operator, formulae: [String(rule.value)], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: rule.color }, fgColor: { argb: rule.color } } } }] });
    }
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  return addNativeWorkbookCharts(Buffer.from(await book.xlsx.writeBuffer()), spec);
}

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
  const source = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (/^[{\[]/.test(source)) return generateWorkbookXlsx(JSON.parse(source), title);
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
