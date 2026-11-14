import JSZip from "jszip";
import type { WorkbookSpec, WorkbookChartSpec, WorkbookCellSpec } from "./workbook-spec";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const escapeXml = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
const absolute = (value: string) => value.replace(/([A-Z]+)(\d+)/g, (_, col, row) => "$" + col + "$" + row);
function point(value: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(value)!;
  let column = 0;
  for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}
function columnName(value: number) {
  let text = "";
  while (value > 0) { value--; text = String.fromCharCode(65 + value % 26) + text; value = Math.floor(value / 26); }
  return text;
}
function vector(range: string, cells: Map<string, WorkbookCellSpec>) {
  const [first, last = first] = range.split(":"), start = point(first), end = point(last);
  const entries: (WorkbookCellSpec | undefined)[] = [];
  for (let row = start.row; row <= end.row; row++) for (let column = start.column; column <= end.column; column++) {
    entries.push(cells.get(columnName(column) + row));
  }
  return entries;
}
function formula(sheet: string, range: string) { return escapeXml("'" + sheet.replace(/'/g, "''") + "'!" + absolute(range)); }
function seriesXml(chart: WorkbookChartSpec, cells: Map<string, WorkbookCellSpec>) {
  const categories = vector(chart.categories, cells);
  const cachedLabels = categories.map((cell, index) => cell && !cell.formula && cell.value != null
    ? '<c:pt idx="' + index + '"><c:v>' + escapeXml(cell.value) + '</c:v></c:pt>' : "").join("");
  return chart.series.map((series, index) => {
    const values = vector(series.values, cells);
    // Never invent cached formula results. Excel recalculates the linked worksheet on opening.
    const cachedValues = values.map((cell, i) => typeof cell?.value === "number"
      ? '<c:pt idx="' + i + '"><c:v>' + cell.value + '</c:v></c:pt>' : "").join("");
    return '<c:ser><c:idx val="' + index + '"/><c:order val="' + index + '"/><c:tx><c:v>' + escapeXml(series.name) +
      '</c:v></c:tx><c:cat><c:strRef><c:f>' + formula(chart.dataSheet, chart.categories) + '</c:f><c:strCache><c:ptCount val="' +
      categories.length + '"/>' + cachedLabels + '</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>' +
      formula(chart.dataSheet, series.values) + '</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="' +
      values.length + '"/>' + cachedValues + '</c:numCache></c:numRef></c:val></c:ser>';
  }).join("");
}
function chartXml(chart: WorkbookChartSpec, cells: Map<string, WorkbookCellSpec>) {
  const type = chart.type === "bar" ? "barChart" : "lineChart";
  const heading = '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"/></a:pPr><a:r><a:t>' +
    escapeXml(chart.title) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
  const plot = '<c:plotArea><c:layout/><c:' + type + '>' +
    (chart.type === "bar" ? '<c:barDir val="col"/><c:grouping val="clustered"/>' : '<c:grouping val="standard"/>') +
    '<c:varyColors val="0"/>' + seriesXml(chart, cells) +
    '<c:axId val="10001"/><c:axId val="10002"/></c:' + type + '>' +
    '<c:catAx><c:axId val="10001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="10002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>' +
    '<c:valAx><c:axId val="10002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="10001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>';
  return XML + '<c:chartSpace xmlns:c="' + C + '" xmlns:a="' + A + '" xmlns:r="' + R + '"><c:lang val="en-US"/><c:chart>' +
    heading + '<c:autoTitleDeleted val="0"/>' + plot + '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
}
function anchorXml(chart: WorkbookChartSpec, index: number) {
  const [first, last] = chart.anchor.split(":"), start = point(first), end = point(last);
  const marker = (name: string, column: number, row: number) => '<xdr:' + name + '><xdr:col>' + column +
    '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + row + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:' + name + '>';
  return '<xdr:twoCellAnchor editAs="oneCell">' + marker("from", start.column - 1, start.row - 1) + marker("to", end.column, end.row) +
    '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + index + '" name="Chart ' + index +
    '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
    '<a:graphic><a:graphicData uri="' + C + '"><c:chart xmlns:c="' + C + '" xmlns:r="' + R + '" r:id="rId' + index +
    '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
}
function appendElement(xml: string, close: string, element: string) {
  if (!xml.includes(close)) throw new Error("Generated workbook XML did not match its expected structure.");
  return xml.replace(close, element + close);
}

/**
 * Add chart parts to OUR freshly generated ExcelJS package only, never an uploaded ZIP.
 * Charts refer to validated bounded cells; no remote relationships, macros or user XML.
 */
export async function addNativeWorkbookCharts(bytes: Buffer, spec: WorkbookSpec): Promise<Buffer> {
  if (!spec.sheets.some((sheet) => sheet.charts?.length)) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  let contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  let chartId = 0;
  for (let sheetIndex = 0; sheetIndex < spec.sheets.length; sheetIndex++) {
    const sheet = spec.sheets[sheetIndex];
    if (!sheet.charts?.length) continue;
    const part = "xl/worksheets/sheet" + (sheetIndex + 1) + ".xml";
    const relPart = "xl/worksheets/_rels/sheet" + (sheetIndex + 1) + ".xml.rels";
    let worksheet = await zip.file(part)!.async("string");
    if (/<drawing\b/.test(worksheet)) throw new Error("Existing drawings cannot be overwritten by the chart renderer.");
    const relationship = zip.file(relPart);
    let rels = relationship ? await relationship.async("string") : XML + '<Relationships xmlns="' + RELS + '"></Relationships>';
    const drawingId = "svansDrawing" + (sheetIndex + 1);
    const drawingName = "svans-drawing" + (sheetIndex + 1) + ".xml";
    if (rels.includes('Id="' + drawingId + '"')) throw new Error("Drawing relationship conflict.");
    rels = appendElement(rels, "</Relationships>", '<Relationship Id="' + drawingId + '" Type="' + R + '/drawing" Target="../drawings/' + drawingName + '"/>');
    const drawingTag = '<drawing r:id="' + drawingId + '"/>';
    // ECMA worksheet ordering: drawings precede tableParts and extension lists.
    const insertion = worksheet.search(/<(?:tableParts|extLst|legacyDrawing|picture)\b/);
    worksheet = insertion < 0 ? appendElement(worksheet, "</worksheet>", drawingTag)
      : worksheet.slice(0, insertion) + drawingTag + worksheet.slice(insertion);
    zip.file(part, worksheet); zip.file(relPart, rels);
    let anchors = "", chartRelationships = "";
    for (let index = 0; index < sheet.charts.length; index++) {
      const chart = sheet.charts[index], id = ++chartId;
      const source = spec.sheets.find((candidate) => candidate.name === chart.dataSheet)!;
      zip.file("xl/charts/svans-chart" + id + ".xml", chartXml(chart, new Map(source.cells.map((cell) => [cell.address, cell]))));
      anchors += anchorXml(chart, index + 1);
      chartRelationships += '<Relationship Id="rId' + (index + 1) + '" Type="' + R + '/chart" Target="../charts/svans-chart' + id + '.xml"/>';
      contentTypes = appendElement(contentTypes, "</Types>", '<Override PartName="/xl/charts/svans-chart' + id + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>');
    }
    zip.file("xl/drawings/" + drawingName, XML + '<xdr:wsDr xmlns:xdr="' + XDR + '" xmlns:a="' + A + '">' + anchors + '</xdr:wsDr>');
    zip.file("xl/drawings/_rels/" + drawingName + ".rels", XML + '<Relationships xmlns="' + RELS + '">' + chartRelationships + '</Relationships>');
    contentTypes = appendElement(contentTypes, "</Types>", '<Override PartName="/xl/drawings/' + drawingName + '" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>');
  }
  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
