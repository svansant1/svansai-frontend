export type DataSummary = {
  delimiter: "," | "\t";
  rows: number;
  columns: string[];
  sampleRows: Record<string, string>[];
  numericStats: Array<{
    column: string;
    count: number;
    min: number;
    max: number;
    average: number;
    total: number;
    outliers: number[];
  }>;
  missingValues: Array<{ column: string; count: number }>;
  duplicateRows: number;
  categoricalTopValues: Array<{
    column: string;
    values: Array<{ value: string; count: number }>;
  }>;
  groupSummaries: Array<{
    groupBy: string;
    metric: string;
    groups: Array<{ value: string; count: number; total: number; average: number }>;
  }>;
};

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  if (delimiter === "\t") return line.split("\t").map((value) => value.trim());

  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function detectDelimiter(text: string, fallback: "," | "\t" = ","): "," | "\t" {
  const firstMeaningfulLine = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((line) => line.trim().length > 0);

  if (!firstMeaningfulLine) return fallback;
  return firstMeaningfulLine.includes("\t") ? "\t" : fallback;
}

export function summarizeDelimitedData(
  text: string,
  typeOrName: string,
): DataSummary | null {
  const delimiter = typeOrName.includes("tab-separated") || /\.tsv$/i.test(typeOrName)
    ? "\t"
    : detectDelimiter(text);
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const headers = parseDelimitedLine(lines[0], delimiter).map((header, index) =>
    header || `Column ${index + 1}`,
  );
  if (headers.length < 2) return null;

  const rows = lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });

  const numericStats = headers
    .map((column) => {
      const numbers = rows
        .map((row) => Number(String(row[column]).replace(/[$,%]/g, "")))
        .filter((value) => Number.isFinite(value));

      if (!numbers.length) return null;

      const sum = numbers.reduce((total, value) => total + value, 0);
      const average = sum / numbers.length;
      const sorted = [...numbers].sort((a, b) => a - b);
      const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)] ?? 0;
      const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)] ?? 0;
      const iqr = q3 - q1;
      const lowFence = q1 - 1.5 * iqr;
      const highFence = q3 + 1.5 * iqr;
      return {
        column,
        count: numbers.length,
        min: Math.min(...numbers),
        max: Math.max(...numbers),
        average: Number(average.toFixed(2)),
        total: Number(sum.toFixed(2)),
        outliers: numbers
          .filter((value) => value < lowFence || value > highFence)
          .slice(0, 8),
      };
    })
    .filter((item): item is DataSummary["numericStats"][number] => Boolean(item));

  const missingValues = headers
    .map((column) => ({
      column,
      count: rows.filter((row) => !String(row[column] ?? "").trim()).length,
    }))
    .filter((item) => item.count > 0);

  const duplicateRows = rows.length - new Set(rows.map((row) => JSON.stringify(row))).size;

  const numericColumns = new Set(numericStats.map((stat) => stat.column));
  const categoricalTopValues = headers
    .filter((column) => !numericColumns.has(column))
    .map((column) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const value = String(row[column] ?? "").trim();
        if (!value) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }

      return {
        column,
        values: [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([value, count]) => ({ value, count })),
      };
    })
    .filter((item) => item.values.length > 0)
    .slice(0, 8);

  const categoricalColumns = categoricalTopValues.map((item) => item.column).slice(0, 3);
  const groupSummaries = categoricalColumns
    .flatMap((groupBy) =>
      numericStats.slice(0, 4).map((metric) => {
        const groups = new Map<string, { count: number; total: number }>();
        for (const row of rows) {
          const groupValue = String(row[groupBy] ?? "").trim();
          const numericValue = Number(String(row[metric.column]).replace(/[$,%]/g, ""));
          if (!groupValue || !Number.isFinite(numericValue)) continue;
          const current = groups.get(groupValue) ?? { count: 0, total: 0 };
          current.count += 1;
          current.total += numericValue;
          groups.set(groupValue, current);
        }

        return {
          groupBy,
          metric: metric.column,
          groups: [...groups.entries()]
            .map(([value, group]) => ({
              value,
              count: group.count,
              total: Number(group.total.toFixed(2)),
              average: Number((group.total / group.count).toFixed(2)),
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 8),
        };
      }),
    )
    .filter((item) => item.groups.length > 1)
    .slice(0, 8);

  return {
    delimiter,
    rows: rows.length,
    columns: headers,
    sampleRows: rows.slice(0, 8),
    numericStats,
    missingValues,
    duplicateRows,
    categoricalTopValues,
    groupSummaries,
  };
}

export function formatDataSummary(summary: DataSummary): string {
  const sample = summary.sampleRows
    .map((row, index) => `${index + 1}. ${JSON.stringify(row)}`)
    .join("\n");
  const stats = summary.numericStats.length
    ? summary.numericStats
        .map(
          (stat) =>
            `- ${stat.column}: count ${stat.count}, total ${stat.total}, min ${stat.min}, max ${stat.max}, average ${stat.average}${
              stat.outliers.length ? `, possible outliers ${stat.outliers.join(", ")}` : ""
            }`,
        )
        .join("\n")
    : "No numeric columns detected.";
  const missing = summary.missingValues.length
    ? summary.missingValues.map((item) => `- ${item.column}: ${item.count}`).join("\n")
    : "No missing values detected in the analyzed rows.";
  const categorical = summary.categoricalTopValues.length
    ? summary.categoricalTopValues
        .map(
          (item) =>
            `- ${item.column}: ${item.values.map((value) => `${value.value} (${value.count})`).join(", ")}`,
        )
        .join("\n")
    : "No categorical frequency summary available.";
  const groups = summary.groupSummaries.length
    ? summary.groupSummaries
        .map(
          (item) =>
            `- By ${item.groupBy}, ${item.metric}: ${item.groups
              .map((group) => `${group.value} total ${group.total}, avg ${group.average}, count ${group.count}`)
              .join("; ")}`,
        )
        .join("\n")
    : "No grouped numeric summary available.";

  return `
Structured data summary:
- Rows: ${summary.rows}
- Columns: ${summary.columns.join(", ")}
- Duplicate rows: ${summary.duplicateRows}

Sample rows:
${sample || "No sample rows available."}

Numeric stats:
${stats}

Missing values:
${missing}

Top categorical values:
${categorical}

Grouped summaries:
${groups}
`.trim();
}
