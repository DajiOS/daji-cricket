// A small, strict-enough CSV reader for bank statements (RFC 4180 quoting, BOM, CRLF, a few delimiters).

export interface CsvResult { rows: string[][]; delimiter: string }

export const MAX_CSV_BYTES = 15 * 1024 * 1024;
export const MAX_CSV_ROWS = 200_000;

export function decodeText(buf: Buffer): string {
  // UTF-16 with BOM is what "Unicode text" exports from Excel produce.
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2));
    sw.swap16();
    return sw.toString('utf16le');
  }
  const t = buf.toString('utf8');
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

function sniffDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 30);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const nonZero = counts.filter((c) => c > 0);
    if (!nonZero.length) continue;
    const mode = [...nonZero].sort((a, b) => nonZero.filter((x) => x === b).length - nonZero.filter((x) => x === a).length)[0]!;
    const score = nonZero.filter((c) => c === mode).length * 100 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let q = false, n = 0;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
  return n;
}

export function parseCsv(text: string, delimiter?: string): CsvResult {
  const d = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    if (rows.length > MAX_CSV_ROWS) throw new CsvError(`The file has more than ${MAX_CSV_ROWS} rows`);
  };
  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === d) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; if (text[i] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { i++; endRow(); continue; }
    field += ch; i++;
  }
  if (inQuotes) throw new CsvError('A quoted value is never closed — the file looks cut off or damaged');
  if (field !== '' || row.length) endRow();
  return { rows, delimiter: d };
}

export class CsvError extends Error {}

/**
 * Cells that a spreadsheet would run as a formula. Used when WRITING csv/xlsx that other people open in Excel:
 * a bank narration like `=HYPERLINK(...)` must stay text.
 */
export function defuse(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : defuse(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
