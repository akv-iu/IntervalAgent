// CSV for the Customer dashboard export (FR-54). Text that a spreadsheet would run as a formula is prefixed with '.
export function csvField(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const line = (fields: (string | number | null)[]) => `${fields.map(csvField).join(",")}\r\n`;

// Sections one after another: a title line, the header, the rows, and a blank line between sections.
export function toCsv(sections: { title: string; header: string[]; rows: (string | number | null)[][] }[]): string {
  return sections.map((s) => line([s.title]) + line(s.header) + s.rows.map(line).join("")).join("\r\n");
}
