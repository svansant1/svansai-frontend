/** A deliberately bounded, data-only Excel format. No scripts or arbitrary Excel objects. */
export const WORKBOOK_LIMITS = {
  sheets: 8,
  rows: 5_000,
  columns: 100,
  cells: 50_000,
  jsonCharacters: 100_000,
  formulas: 5_000,
  formulaCharacters: 2_000,
  expandedFormulaCharacters: 1_000_000,
  dependencyEdges: 250_000,
  rangeWork: 500_000,
} as const;

export type WorkbookCellStyle = "title" | "header" | "input" | "output" | "note";
export interface WorkbookCellSpec {
  address: string;
  value?: string | number | boolean | null;
  valueType?: "date" | "datetime" | "time";
  formula?: string;
  style?: WorkbookCellStyle;
  numberFormat?: string;
}
export interface WorkbookValidationSpec {
  range: string;
  type: "list" | "whole" | "decimal";
  values?: string[];
  minimum?: number;
  maximum?: number;
}
export interface WorkbookFormulaFillSpec { range: string; formula: string }
export interface WorkbookConditionalFormatSpec {
  range: string;
  operator: "greaterThan" | "lessThan" | "equal";
  value: number;
  color: string;
}
export interface WorkbookSheetSpec {
  name: string;
  cells: WorkbookCellSpec[];
  merges?: string[];
  columnWidths?: number[];
  freezeRows?: number;
  autoFilter?: string;
  validations?: WorkbookValidationSpec[];
  formulaFills?: WorkbookFormulaFillSpec[];
  conditionalFormats?: WorkbookConditionalFormatSpec[];
  tables?: { name: string; range: string }[];
  charts?: WorkbookChartSpec[];
}
export interface WorkbookChartSpec {
  type: "bar" | "line";
  title: string;
  anchor: string;
  dataSheet: string;
  categories: string;
  series: { name: string; values: string }[];
}
export interface WorkbookNamedRange { name: string; sheet: string; range: string }
export interface WorkbookSpec { version: 1; title?: string; sheets: WorkbookSheetSpec[]; namedRanges?: WorkbookNamedRange[] }

export class WorkbookSpecError extends Error {
  constructor(message: string) {
    super(`Invalid workbook: ${message}`);
    this.name = "WorkbookSpecError";
  }
}

function fail(message: string): never { throw new WorkbookSpecError(message); }
function record(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${path} must be an object.`);
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (!keys.includes(key)) fail(`${path}.${key} is not supported.`);
  return result;
}
function text(value: unknown, path: string, limit: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > limit ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(value)) {
    fail(`${path} must be ${allowEmpty ? "" : "nonempty "}text of at most ${limit} characters.`);
  }
  for (const char of value) { const code = char.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) fail(path + " has invalid Unicode."); }
  return value;
}
function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a finite number.`);
  return value;
}
function array(value: unknown, path: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) fail(`${path} must be an array with at most ${limit} entries.`);
  return value;
}
function member<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(`${path} must be one of ${values.join(", ")}.`);
  return value as T;
}

interface Coordinate { row: number; column: number; absoluteRow: boolean; absoluteColumn: boolean }
interface Range { first: Coordinate; last: Coordinate; address: string }
function columnName(column: number): string {
  let result = "";
  while (column > 0) { column--; result = String.fromCharCode(65 + column % 26) + result; column = Math.floor(column / 26); }
  return result;
}
function address(coordinate: Coordinate, anchors = false): string {
  return `${anchors && coordinate.absoluteColumn ? "$" : ""}${columnName(coordinate.column)}${anchors && coordinate.absoluteRow ? "$" : ""}${coordinate.row}`;
}
function coordinate(value: string, path: string, anchors = false): Coordinate {
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(value);
  if (!match || (!anchors && (match[1] || match[3]))) fail(`${path} must be an A1 cell address.`);
  let column = 0;
  for (const char of match[2].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[4]);
  if (column > WORKBOOK_LIMITS.columns || row > WORKBOOK_LIMITS.rows) fail(`${path} exceeds 100 columns or 5,000 rows.`);
  return { column, row, absoluteColumn: !!match[1], absoluteRow: !!match[3] };
}
function range(value: unknown, path: string): Range {
  const parts = text(value, path, 32).split(":");
  if (parts.length > 2) fail(`${path} must be one local A1 range.`);
  const first = coordinate(parts[0], path), last = coordinate(parts[1] ?? parts[0], path);
  if (last.row < first.row || last.column < first.column) fail(`${path} must run from top-left to bottom-right.`);
  return { first, last, address: address(first) + (parts.length === 2 ? `:${address(last)}` : "") };
}
function key(point: Coordinate): number { return (point.row - 1) * WORKBOOK_LIMITS.columns + point.column; }

// Explicit allowlist: no INDIRECT, OFFSET, HYPERLINK, WEBSERVICE, RTD, CALL, macros,
// add-ins, named expressions, external workbooks, volatile random/time functions or eval.
const FUNCTIONS = new Set((
  "SUM SUMIF SUMIFS SUMPRODUCT AVERAGE AVERAGEIF AVERAGEIFS MIN MAX MEDIAN COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS " +
  "IF IFS IFERROR IFNA AND OR NOT XOR TRUE FALSE ABS ROUND ROUNDUP ROUNDDOWN MROUND CEILING CEILING.MATH FLOOR FLOOR.MATH " +
  "INT TRUNC MOD QUOTIENT POWER SQRT EXP LN LOG LOG10 SIGN PI PRODUCT SUBTOTAL AGGREGATE " +
  "VLOOKUP HLOOKUP LOOKUP INDEX MATCH CHOOSE ROW ROWS COLUMN COLUMNS " +
  "LEFT RIGHT MID LEN TRIM CLEAN UPPER LOWER PROPER CONCATENATE SUBSTITUTE REPLACE FIND SEARCH EXACT TEXT VALUE " +
  "DATE DATEVALUE DAY MONTH YEAR DAYS DAYS360 EDATE EOMONTH WEEKDAY WEEKNUM NETWORKDAYS WORKDAY TIME TIMEVALUE HOUR MINUTE SECOND " +
  "ISBLANK ISNUMBER ISTEXT ISLOGICAL ISERROR ISERR ISNA N NA " +
  "PMT IPMT PPMT PV FV NPV IRR RATE NPER RANK RANK.EQ LARGE SMALL STDEV STDEV.S STDEV.P VAR VAR.S VAR.P"
).split(" "));

interface Reference { first: Coordinate; last: Coordinate; sheet: string; prefix: string; isRange: boolean; start: number; end: number }
interface Token { type: "value" | "reference" | "function" | "operator"; value: string }
interface ParsedFormula { formula: string; references: Reference[] }

function parseFormula(value: unknown, sheet: string, sheetNames: Set<string>, path: string, definedNames = new Map<string, WorkbookNamedRange>()): ParsedFormula {
  let formula = text(value, path, WORKBOOK_LIMITS.formulaCharacters).trim();
  if (formula.startsWith("=")) formula = formula.slice(1).trim();
  if (!formula) fail(`${path} is empty.`);
  const tokens: Token[] = [], references: Reference[] = [];
  let offset = 0;
  while (offset < formula.length) {
    const rest = formula.slice(offset), char = rest[0];
    if (/\s/.test(char)) { offset++; continue; }
    if (char === '"') {
      let end = offset + 1, closed = false;
      while (end < formula.length) {
        if (formula[end++] === '"') {
          if (formula[end] === '"') end++;
          else { closed = true; break; }
        }
      }
      if (!closed) fail(`${path} has an unfinished string.`);
      tokens.push({ type: "value", value: formula.slice(offset, end) }); offset = end; continue;
    }
    const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/.exec(rest);
    if (numeric) {
      if (!Number.isFinite(Number(numeric[0]))) fail(`${path} contains a non-finite number.`);
      tokens.push({ type: "value", value: numeric[0] }); offset += numeric[0].length; continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (identifier && /^\s*\(/.test(rest.slice(identifier[0].length))) {
      const name = identifier[0].toUpperCase();
      if (!FUNCTIONS.has(name)) fail(`${path} uses unsupported function ${identifier[0]}.`);
      tokens.push({ type: "function", value: name }); offset += identifier[0].length; continue;
    }
    if (/[A-Za-z_$']/.test(char)) {
      const named = identifier && definedNames.get(identifier[0].toLowerCase());
      if (named && rest[identifier![0].length] !== "!") {
        const selected = range(named.range, path);
        const first = { ...selected.first, absoluteRow: true, absoluteColumn: true };
        const last = { ...selected.last, absoluteRow: true, absoluteColumn: true };
        references.push({ first, last, sheet: named.sheet.toLowerCase(), prefix: "'" + named.sheet.replace(/'/g, "''") + "'!",
          isRange: key(first) !== key(last), start: offset, end: offset + identifier![0].length });
        tokens.push({ type: "reference", value: identifier![0] }); offset += identifier![0].length; continue;
      }
      let prefix = "", referencedSheet = sheet, remaining = rest;
      if (char === "'") {
        const qualified = /^'((?:[^']|'')+)'!/.exec(rest);
        if (!qualified) fail(`${path} has an invalid quoted sheet reference.`);
        prefix = qualified[0]; referencedSheet = qualified[1].replace(/''/g, "'"); remaining = rest.slice(prefix.length);
      } else {
        const qualified = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(rest);
        if (qualified) { prefix = qualified[0]; referencedSheet = qualified[1]; remaining = rest.slice(prefix.length); }
      }
      const cell = /^\$?[A-Za-z]{1,3}\$?[1-9]\d*/.exec(remaining);
      if (cell) {
        const first = coordinate(cell[0], path, true);
        let length = prefix.length + cell[0].length, last = first, isRange = false;
        if (rest[length] === ":") {
          const end = /^\$?[A-Za-z]{1,3}\$?[1-9]\d*/.exec(rest.slice(length + 1));
          if (!end) fail(`${path} must use bounded A1 ranges, not whole rows or columns.`);
          last = coordinate(end[0], path, true); length += 1 + end[0].length; isRange = true;
          if (last.row < first.row || last.column < first.column) fail(`${path} has a reversed range.`);
        }
        if (!sheetNames.has(referencedSheet.toLowerCase())) fail(`${path} references missing sheet ${referencedSheet}.`);
        references.push({ first, last, sheet: referencedSheet.toLowerCase(), prefix, isRange, start: offset, end: offset + length });
        tokens.push({ type: "reference", value: rest.slice(0, length) }); offset += length; continue;
      }
      if (!prefix && identifier && /^(TRUE|FALSE)$/i.test(identifier[0])) {
        tokens.push({ type: "value", value: identifier[0] }); offset += identifier[0].length; continue;
      }
      fail(`${path} contains an unsupported name or invalid reference.`);
    }
    const operator = /^(?:<>|<=|>=|[+\-*/^&%=<>(),])/.exec(rest);
    if (!operator) fail(`${path} contains an unsupported token (external links, DDE and arrays are not allowed).`);
    tokens.push({ type: "operator", value: operator[0] }); offset += operator[0].length;
  }
  if (tokens.length > 1_000) fail(`${path} is too complex.`);
  // Parse the expression instead of merely searching for dangerous function names.
  let cursor = 0;
  const precedence: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };
  function expression(minimum: number, depth: number): void {
    if (depth > 64) fail(`${path} is nested too deeply.`);
    const token = tokens[cursor++];
    if (!token) fail(`${path} has an incomplete expression.`);
    if (token.value === "+" || token.value === "-") expression(6, depth + 1);
    else if (token.value === "(") {
      expression(0, depth + 1);
      if (tokens[cursor++]?.value !== ")") fail(`${path} has unbalanced parentheses.`);
    } else if (token.type === "function") {
      if (tokens[cursor++]?.value !== "(") fail(`${path} has an invalid function call.`);
      if (tokens[cursor]?.value !== ")") {
        expression(0, depth + 1);
        while (tokens[cursor]?.value === ",") { cursor++; expression(0, depth + 1); }
      }
      if (tokens[cursor++]?.value !== ")") fail(`${path} has an invalid function argument list.`);
    } else if (token.type !== "value" && token.type !== "reference") fail(`${path} has an invalid expression.`);
    while (cursor < tokens.length) {
      const next = tokens[cursor];
      if (next.value === "%") { cursor++; continue; }
      const priority = precedence[next.value];
      if (priority === undefined || priority < minimum) break;
      cursor++; expression(priority + 1, depth + 1);
    }
  }
  expression(0, 0);
  if (cursor !== tokens.length) fail(`${path} has an invalid expression or unsupported name.`);
  return { formula, references };
}

function translateFormula(parsed: ParsedFormula, rowDelta: number, columnDelta: number, path: string): string {
  let result = "", previous = 0;
  function shift(point: Coordinate): Coordinate {
    const shifted = { ...point, row: point.row + (point.absoluteRow ? 0 : rowDelta), column: point.column + (point.absoluteColumn ? 0 : columnDelta) };
    if (shifted.row < 1 || shifted.column < 1 || shifted.row > WORKBOOK_LIMITS.rows || shifted.column > WORKBOOK_LIMITS.columns) fail(`${path} translates a reference outside workbook bounds.`);
    return shifted;
  }
  for (const ref of parsed.references) {
    result += parsed.formula.slice(previous, ref.start) + ref.prefix + address(shift(ref.first), true);
    if (ref.isRange) result += `:${address(shift(ref.last), true)}`;
    previous = ref.end;
  }
  return result + parsed.formula.slice(previous);
}

interface FormulaNode { id: string; sheet: string; point: Coordinate; parsed: ParsedFormula }
function assertAcyclic(nodes: FormulaNode[]): void {
  // Index formula cells by sheet/column: large sparse ranges do not enumerate empty cells.
  const columns = new Map<string, FormulaNode[]>();
  for (const node of nodes) {
    const columnKey = `${node.sheet}!${node.point.column}`;
    const entries = columns.get(columnKey) ?? []; entries.push(node); columns.set(columnKey, entries);
  }
  for (const entries of columns.values()) entries.sort((a, b) => a.point.row - b.point.row);
  const graph = new Map<string, string[]>();
  let edges = 0, work = 0;
  for (const node of nodes) {
    const dependencies = new Set<string>();
    for (const ref of node.parsed.references) {
      for (let column = ref.first.column; column <= ref.last.column; column++) {
        if (++work > WORKBOOK_LIMITS.rangeWork) fail("formula dependency analysis is too complex.");
        const entries = columns.get(`${ref.sheet}!${column}`) ?? [];
        let low = 0, high = entries.length;
        while (low < high) { const middle = (low + high) >>> 1; if (entries[middle].point.row < ref.first.row) low = middle + 1; else high = middle; }
        for (let index = low; index < entries.length && entries[index].point.row <= ref.last.row; index++) {
          if (++edges > WORKBOOK_LIMITS.dependencyEdges) fail("formula dependency graph is too large.");
          dependencies.add(entries[index].id);
        }
      }
    }
    graph.set(node.id, [...dependencies]);
  }
  const state = new Map<string, number>();
  for (const node of nodes) {
    if (state.get(node.id) === 2) continue;
    const stack = [{ id: node.id, next: 0 }]; state.set(node.id, 1);
    while (stack.length) {
      const current = stack[stack.length - 1], dependencies = graph.get(current.id)!;
      if (current.next === dependencies.length) { state.set(current.id, 2); stack.pop(); continue; }
      const child = dependencies[current.next++];
      if (state.get(child) === 1) fail(`circular formula dependency involving ${child}.`);
      if (!state.has(child)) { state.set(child, 1); stack.push({ id: child, next: 0 }); }
    }
  }
}

/** Validate JSON/object input, normalize addresses and expand safe formula fills. Throws on every invalid input. */
export function parseWorkbookSpec(input: unknown): WorkbookSpec {
  if (typeof input === "string") {
    if (input.length > WORKBOOK_LIMITS.jsonCharacters) fail("JSON exceeds 100,000 characters.");
    try { input = JSON.parse(input); } catch { fail("JSON is malformed."); }
  } else {
    let serialized: string | undefined;
    try { serialized = JSON.stringify(input); } catch { fail("input must be serializable JSON."); }
    if (!serialized || serialized.length > WORKBOOK_LIMITS.jsonCharacters) fail("JSON exceeds 100,000 characters or is missing.");
  }
  const root = record(input, ["version", "title", "sheets", "namedRanges"], "workbook");
  if (root.version !== 1) fail("version must be 1.");
  const rawSheets = array(root.sheets, "sheets", WORKBOOK_LIMITS.sheets);
  if (!rawSheets.length) fail("at least one sheet is required.");
  const names = new Set<string>();
  const sheetRecords = rawSheets.map((item, index) => {
    const raw = record(item, ["name", "cells", "merges", "columnWidths", "freezeRows", "autoFilter", "validations", "formulaFills", "conditionalFormats", "tables", "charts"], `sheets[${index}]`);
    const name = text(raw.name, `sheets[${index}].name`, 31);
    if (/[\\/*?:\[\]\u0000-\u001F]/.test(name) || /^'|'$/.test(name) || name.trim() !== name) fail(`sheet name ${name} is not a valid Excel name.`);
    if (names.has(name.toLowerCase())) fail(`duplicate sheet name ${name}.`);
    names.add(name.toLowerCase());
    return { raw, name };
  });
  const result: WorkbookSpec = { version: 1, sheets: [] };
  const definedNames = new Map<string, WorkbookNamedRange>();
  const objectNames = new Set<string>();
  let namedRangeCells = 0;
  function objectName(value: unknown): string {
    const name = text(value, "named range/table name", 64);
    if (Object.getOwnPropertyNames(Object.prototype).some((key) => key.toLowerCase() === name.toLowerCase())) fail("reserved named range/table name.");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^[A-Za-z]{1,3}[1-9]\d*$|^R\d*C\d*$|^[RC]$|^(TRUE|FALSE)$/i.test(name) || FUNCTIONS.has(name.toUpperCase())) fail("named range/table name conflicts with an Excel reference or function.");
    if (objectNames.has(name.toLowerCase())) fail("duplicate named range/table name.");
    objectNames.add(name.toLowerCase());
    return name;
  }
  if (root.namedRanges !== undefined) {
    result.namedRanges = array(root.namedRanges, "namedRanges", 100).map((value) => {
      const entry = record(value, ["name", "sheet", "range"], "namedRange");
      const name = objectName(entry.name), sheet = text(entry.sheet, "namedRange.sheet", 31);
      if (!names.has(sheet.toLowerCase())) fail("namedRange references a missing sheet.");
      const selected = range(entry.range, "namedRange.range");
      namedRangeCells += (selected.last.row - selected.first.row + 1) * (selected.last.column - selected.first.column + 1);
      if (namedRangeCells > WORKBOOK_LIMITS.cells) fail("named ranges expand to more than 50,000 cells.");
      const canonicalSheet = sheetRecords.find((item) => item.name.toLowerCase() === sheet.toLowerCase())!.name;
      const named = { name, sheet: canonicalSheet, range: selected.address };
      definedNames.set(name.toLowerCase(), named); return named;
    });
  }
  if (root.title !== undefined) result.title = text(root.title, "title", 200);
  let totalCells = 0, rangeWork = 0, formulaCharacters = 0;
  const formulaNodes: FormulaNode[] = [];
  for (const { raw, name } of sheetRecords) {
    const sheet: WorkbookSheetSpec = { name, cells: [] }, cells = new Map<string, WorkbookCellSpec>(), touched = new Set<number>();
    function touch(point: Coordinate): void {
      const id = key(point);
      if (!touched.has(id)) { touched.add(id); if (++totalCells > WORKBOOK_LIMITS.cells) fail("expanded workbook exceeds 50,000 cells."); }
    }
    function visit(selected: Range, action?: (point: Coordinate) => void): void {
      const area = (selected.last.row - selected.first.row + 1) * (selected.last.column - selected.first.column + 1);
      if (area > WORKBOOK_LIMITS.cells || (rangeWork += area) > WORKBOOK_LIMITS.rangeWork) fail("expanded ranges are too large.");
      for (let row = selected.first.row; row <= selected.last.row; row++) for (let column = selected.first.column; column <= selected.last.column; column++) {
        const point = { row, column, absoluteRow: false, absoluteColumn: false }; touch(point); action?.(point);
      }
    }
    function addFormula(cell: WorkbookCellSpec, point: Coordinate): void {
      const parsed = parseFormula(cell.formula, name, names, `${name}!${cell.address}`, definedNames);
      cell.formula = parsed.formula;
      formulaCharacters += parsed.formula.length;
      if (formulaNodes.length >= WORKBOOK_LIMITS.formulas || formulaCharacters > WORKBOOK_LIMITS.expandedFormulaCharacters) fail("expanded workbook exceeds formula limits (5,000 formulas).");
      formulaNodes.push({ id: `${name.toLowerCase()}!${cell.address}`, sheet: name.toLowerCase(), point, parsed });
    }
    for (const item of array(raw.cells, `${name}.cells`, WORKBOOK_LIMITS.cells)) {
      const rawCell = record(item, ["address", "value", "valueType", "formula", "style", "numberFormat"], `${name}.cell`);
      const point = coordinate(text(rawCell.address, "cell.address", 16), "cell.address"), cell: WorkbookCellSpec = { address: address(point) };
      if (cells.has(cell.address)) fail(`duplicate cell ${name}!${cell.address}.`);
      if (rawCell.value !== undefined) {
        const value = rawCell.value;
        if (value !== null && typeof value !== "boolean" && typeof value !== "string" && typeof value !== "number") fail(`${name}!${cell.address}.value must be text, a number, boolean or null.`);
        if (typeof value === "string") text(value, "cell.value", 32_767, true);
        if (typeof value === "number") number(value, "cell.value");
        cell.value = value as WorkbookCellSpec["value"];
      }
      if (rawCell.formula !== undefined) {
        if (rawCell.value !== undefined) fail(`${name}!${cell.address} cannot have both a value and formula.`);
        cell.formula = text(rawCell.formula, "cell.formula", WORKBOOK_LIMITS.formulaCharacters);
        addFormula(cell, point);
      }
      if (rawCell.valueType !== undefined) {
        cell.valueType = member(rawCell.valueType, ["date", "datetime", "time"], "cell.valueType");
        if (cell.formula || typeof cell.value !== "string") fail("typed date/time needs a string value and cannot have a formula.");
        const value = cell.value as string;
        if (cell.valueType === "time") {
          if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)) fail("time must be HH:mm:ss in a 24-hour clock.");
        } else {
          const dateOnly = cell.valueType === "date";
          if (!(dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/).test(value)) fail("date must be YYYY-MM-DD; datetime must be YYYY-MM-DDTHH:mm:ssZ.");
          const date = new Date(dateOnly ? value + "T00:00:00Z" : value);
          if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9999 ||
              (dateOnly ? date.toISOString().slice(0, 10) !== value : date.toISOString().replace(".000Z", "Z") !== value)) fail("invalid calendar date/datetime.");
        }
      }
      if (rawCell.style !== undefined) cell.style = member(rawCell.style, ["title", "header", "input", "output", "note"], "cell.style");
      if (rawCell.numberFormat !== undefined) cell.numberFormat = text(rawCell.numberFormat, "cell.numberFormat", 100);
      cells.set(cell.address, cell); touch(point);
    }
    if (raw.formulaFills !== undefined) {
      for (const item of array(raw.formulaFills, `${name}.formulaFills`, 200)) {
        const fill = record(item, ["range", "formula"], "formulaFill"), selected = range(fill.range, "formulaFill.range");
        const parsed = parseFormula(fill.formula, name, names, "formulaFill.formula", definedNames);
        visit(selected, (point) => {
          const id = address(point), cell = cells.get(id) ?? { address: id };
          if (cell.formula !== undefined || (cell.value !== undefined && cell.value !== null)) fail(`formulaFill would overwrite ${name}!${id}.`);
          delete cell.value;
          cell.formula = translateFormula(parsed, point.row - selected.first.row, point.column - selected.first.column, "formulaFill");
          addFormula(cell, point); cells.set(id, cell);
        });
      }
    }
    if (raw.merges !== undefined) {
      const merged = new Set<number>();
      sheet.merges = array(raw.merges, `${name}.merges`, 200).map((item) => {
        const selected = range(item, "merge");
        if (key(selected.first) === key(selected.last)) fail("merge must include at least two cells.");
        visit(selected, (point) => {
          if (merged.has(key(point))) fail("merged ranges overlap.");
          merged.add(key(point));
          const cell = cells.get(address(point));
          if (key(point) !== key(selected.first) && cell && (cell.formula !== undefined || (cell.value !== null && cell.value !== undefined))) fail(`merge would hide populated cell ${name}!${cell.address}.`);
        });
        return selected.address;
      });
    }
    if (raw.columnWidths !== undefined) sheet.columnWidths = array(raw.columnWidths, `${name}.columnWidths`, WORKBOOK_LIMITS.columns).map((width) => {
      const value = number(width, "columnWidth"); if (value < 1 || value > 100) fail("column widths must be between 1 and 100."); return value;
    });
    if (raw.freezeRows !== undefined) {
      const rows = number(raw.freezeRows, "freezeRows");
      if (!Number.isInteger(rows) || rows < 0 || rows > WORKBOOK_LIMITS.rows) fail("freezeRows must be an integer from 0 to 5,000.");
      sheet.freezeRows = rows;
    }
    if (raw.autoFilter !== undefined) { const selected = range(raw.autoFilter, "autoFilter"); visit(selected); sheet.autoFilter = selected.address; }
    if (raw.tables !== undefined) {
      if (raw.autoFilter !== undefined) fail("use native table filters or a sheet autoFilter, not both.");
      const tableCells = new Set<number>();
      const mergedRanges = (sheet.merges || []).map((item) => range(item, "merge"));
      sheet.tables = array(raw.tables, "tables", 20).map((value) => {
        const entry = record(value, ["name", "range"], "table");
        const tableName = objectName(entry.name), selected = range(entry.range, "table.range");
        if (selected.first.row === selected.last.row) fail("native table requires a header and at least one data row.");
        if (mergedRanges.some((merged) => selected.first.row <= merged.last.row && selected.last.row >= merged.first.row &&
            selected.first.column <= merged.last.column && selected.last.column >= merged.first.column)) fail("native tables cannot overlap merged cells.");
        visit(selected, (point) => { if (tableCells.has(key(point))) fail("native tables cannot overlap."); tableCells.add(key(point)); });
        const headers = new Set<string>();
        for (let column = selected.first.column; column <= selected.last.column; column++) {
          const cell = cells.get(address({ ...selected.first, column }));
          if (!cell || typeof cell.value !== "string" || !cell.value.trim() || cell.value.length > 128 || cell.formula || cell.valueType || /[\r\n]/.test(cell.value)) fail("native table headers must be nonempty plain text of at most 128 characters.");
          if (headers.has(cell.value.toLowerCase())) fail("native table headers must be unique.");
          headers.add(cell.value.toLowerCase());
        }
        return { name: tableName, range: selected.address };
      });
    }
    if (raw.validations !== undefined) sheet.validations = array(raw.validations, `${name}.validations`, 200).map((item) => {
      const entry = record(item, ["range", "type", "values", "minimum", "maximum"], "validation"), selected = range(entry.range, "validation.range");
      const validation: WorkbookValidationSpec = { range: selected.address, type: member(entry.type, ["list", "whole", "decimal"], "validation.type") };
      if (validation.type === "list") {
        if (entry.minimum !== undefined || entry.maximum !== undefined) fail("list validation does not accept numeric bounds.");
        validation.values = array(entry.values, "validation.values", 100).map((value) => {
          const item = text(value, "validation.values item", 255);
          if (/[,"\r\n]/.test(item)) fail("list values cannot contain commas, quotes or line breaks.");
          return item;
        });
        if (!validation.values.length || validation.values.join(",").length > 253) fail("inline validation list must contain 1–253 characters.");
      } else {
        if (entry.values !== undefined) fail("numeric validation does not accept list values.");
        validation.minimum = number(entry.minimum, "validation.minimum"); validation.maximum = number(entry.maximum, "validation.maximum");
        if (validation.minimum > validation.maximum) fail("validation minimum exceeds maximum.");
        if (validation.type === "whole" && (!Number.isInteger(validation.minimum) || !Number.isInteger(validation.maximum))) fail("whole-number validation requires integer bounds.");
      }
      visit(selected); return validation;
    });
    if (raw.conditionalFormats !== undefined) sheet.conditionalFormats = array(raw.conditionalFormats, `${name}.conditionalFormats`, 200).map((item) => {
      const entry = record(item, ["range", "operator", "value", "color"], "conditionalFormat"), selected = range(entry.range, "conditionalFormat.range");
      const color = text(entry.color, "conditionalFormat.color", 8);
      if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) fail("conditionalFormat.color must be 6- or 8-digit hexadecimal (without #).");
      visit(selected);
      return { range: selected.address, operator: member(entry.operator, ["greaterThan", "lessThan", "equal"], "conditionalFormat.operator"), value: number(entry.value, "conditionalFormat.value"), color: (color.length === 6 ? `FF${color}` : color).toUpperCase() };
    });
    if (raw.charts !== undefined) sheet.charts = array(raw.charts, "charts", 10).map((value) => {
      const data = record(value, ["type", "title", "anchor", "dataSheet", "categories", "series"], "chart");
      const anchor = range(data.anchor, "chart.anchor");
      if (anchor.last.column - anchor.first.column < 4 || anchor.last.row - anchor.first.row < 6) fail("chart anchor needs at least 5 columns and 7 rows.");
      const dataSheet = data.dataSheet === undefined ? name : text(data.dataSheet, "chart.dataSheet", 31);
      const canonical = sheetRecords.find((item) => item.name.toLowerCase() === dataSheet.toLowerCase());
      if (!canonical) fail("chart data sheet does not exist.");
      const categories = range(data.categories, "chart.categories");
      const vectorSize = (selected: Range) => {
        if (selected.first.row !== selected.last.row && selected.first.column !== selected.last.column) fail("chart source must be a single row or column.");
        const size = selected.last.row - selected.first.row + selected.last.column - selected.first.column + 1;
        if (size > 200) fail("chart source exceeds 200 categories.");
        return size;
      };
      const count = vectorSize(categories);
      const series = array(data.series, "chart.series", 5).map((value) => {
        const entry = record(value, ["name", "values"], "chart.series");
        const selected = range(entry.values, "chart.series.values");
        if (vectorSize(selected) !== count) fail("chart values must match the category count.");
        return { name: text(entry.name, "chart.series.name", 80), values: selected.address };
      });
      if (!series.length) fail("chart requires at least one series.");
      return { type: member(data.type, ["bar", "line"], "chart.type"), title: text(data.title, "chart.title", 120),
        anchor: anchor.address, dataSheet: canonical.name, categories: categories.address, series };
    });
    sheet.cells = [...cells.values()]; result.sheets.push(sheet);
  }
  let chartCount = 0;
  for (const sheet of result.sheets) for (const chart of sheet.charts || []) {
    if (++chartCount > 20) fail("workbook exceeds 20 charts.");
    const source = new Map(result.sheets.find((item) => item.name === chart.dataSheet)!.cells.map((cell) => [cell.address, cell]));
    for (const series of chart.series) {
      const selected = range(series.values, "chart.series.values");
      let dataPoints = 0;
      for (let row = selected.first.row; row <= selected.last.row; row++) for (let column = selected.first.column; column <= selected.last.column; column++) {
        const cell = source.get(address({ row, column, absoluteRow: false, absoluteColumn: false }));
        if (!cell || cell.value === null) continue;
        if (cell.formula || typeof cell.value === "number") dataPoints++;
        else if (cell.value !== undefined) fail("chart series must reference numeric or formula cells, not text or dates.");
      }
      if (!dataPoints) fail("chart series has no numeric or formula data.");
    }
  }
  assertAcyclic(formulaNodes);
  return result;
}
