const FORMULA = /^[=+\-@\t\r]/;

function cell(value: string | number): string {
  let text = String(value);
  if (FORMULA.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows to CSV text (CRLF). A cell a spreadsheet would run as a formula gets a leading quote. */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}
