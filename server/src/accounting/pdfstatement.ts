import { fileURLToPath, pathToFileURL } from 'node:url';
import { HttpError } from '../errors.ts';
import { HEAD, cellText, parseGrid, type ParsedStatement } from './import.ts';

// Reads a bank statement PDF that has a text layer (what every bank's "download statement" gives you; not a photo or scan).
// A PDF has no table, only words at positions, so the table is rebuilt from where the words sit: the header row fixes the columns,
// each later line is dropped into the nearest column, and a line with no date is the wrapped end of the line above it.
// The rebuilt grid then goes through the same reader as CSV and Excel, including the check against the running balance column.
//
// The PDF engine is Mozilla's pdf.js (Apache 2.0), kept in server/vendor/pdfjs so the server still needs no npm install.

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 150;

interface Item { str: string; x: number; y: number; w: number; size: number }
interface Cell { text: string; x0: number; x1: number }
interface Line { y: number; cells: Cell[]; page: number }

type PdfJs = { getDocument: (o: Record<string, unknown>) => { promise: Promise<any> }; GlobalWorkerOptions: { workerSrc: string } };
let pdfjs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    // pdf.js expects a browser; for reading text it only needs these names to exist.
    const g = globalThis as Record<string, unknown>;
    g.DOMMatrix ??= class DOMMatrix { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; multiplySelf() { return this; } preMultiplySelf() { return this; } translate() { return this; } scale() { return this; } invertSelf() { return this; } };
    g.Path2D ??= class Path2D {};
    g.ImageData ??= class ImageData {};
    const dir = fileURLToPath(new URL('../../vendor/pdfjs/', import.meta.url));
    const lib = (await import(pathToFileURL(dir + 'pdf.mjs').href)) as PdfJs;
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(dir + 'pdf.worker.mjs').href;
    return lib;
  })();
  return pdfjs;
}

/** Words on one page → lines (top to bottom) → cells (left to right, words close together are one cell). */
function pageLines(items: Item[], page: number): Line[] {
  const sorted = [...items].filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const tol = Math.max(2, it.size * 0.45);
    if (row && Math.abs(row[0]!.y - it.y) <= tol) row.push(it); else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of row) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x1 : Infinity;
      if (last && gap <= it.size * 0.7) { last.text += (gap > it.size * 0.12 && !/\s$/.test(last.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str; last.x1 = it.x + it.w; }
      else cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
    }
    return { y: row[0]!.y, cells: cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text), page };
  }).filter((l) => l.cells.length);
}

const DATE_LIKE = /^\d{1,2}[\/\-. ](?:\d{1,2}|[A-Za-z]{3,9})[\/\-. ,]+\d{2,4}\b/;
const NOISE = /(page\s*:?\s*\d+|\bpage\s+\d+\s+of\s+\d+|^\d+\s*\/\s*\d+$|computer generated|registered office|www\.|\.com\b|toll free|customer care|end of statement|\*{3,})/i;
const TOTALS = /(grand total|^total|closing balance|statement summary|opening balance|brought forward|carried forward)/i;

interface Column { key: string | null; text: string; x0: number; x1: number }

/** The header row: a line whose cells include a date column, a description column and at least one amount column. */
function findHeader(lines: Line[]): { index: number; cols: Column[] } | null {
  for (let i = 0; i < lines.length; i++) {
    const cols: Column[] = lines[i]!.cells.map((c) => ({ key: null, text: c.text, x0: c.x0, x1: c.x1 }));
    const seen = new Set<string>();
    for (const c of cols) for (const [k, re] of Object.entries(HEAD)) if (!seen.has(k) && re.test(c.text) && !(k === 'balance' && /^opening/i.test(c.text))) { c.key = k; seen.add(k); break; }
    if (seen.has('date') && seen.has('description') && (seen.has('amount') || seen.has('debit') || seen.has('credit'))) return { index: i, cols };
  }
  return null;
}

/** Nearest column for a cell: left edges line up for text, right edges for numbers, and centres for centred headings. */
function columnOf(cell: Cell, cols: Column[]): number {
  let best = 0, bd = Infinity;
  cols.forEach((c, i) => {
    const d = Math.min(Math.abs(cell.x0 - c.x0), Math.abs(cell.x1 - c.x1), Math.abs((cell.x0 + cell.x1) / 2 - (c.x0 + c.x1) / 2));
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

export async function readPdfStatement(buf: Buffer, password?: string): Promise<ParsedStatement> {
  if (!buf.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (buf.length > MAX_PDF_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'That PDF is larger than 15 MB. Download the statement in smaller periods.');
  const lib = await loadPdfJs();
  let doc: any;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(buf), password: password || undefined, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  } catch (e: any) {
    if (e?.name === 'PasswordException') {
      if (e.code === 2) throw new HttpError(422, 'PDF_PASSWORD_WRONG', 'That password did not open the PDF. Check it and try again.');
      throw new HttpError(422, 'PDF_PASSWORD_REQUIRED', 'This PDF is password protected. Enter the password (many banks use your date of birth or customer ID) to read it.');
    }
    throw new HttpError(422, 'PDF_UNREADABLE', 'That file could not be read as a PDF. Download the statement again, or use the CSV or Excel version.');
  }
  try {
    if (doc.numPages > MAX_PAGES) throw new HttpError(413, 'FILE_TOO_LARGE', `That PDF has ${doc.numPages} pages. Download the statement in smaller periods.`);
    const pages: Line[][] = [];
    let words = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items: Item[] = (tc.items as any[]).filter((i) => typeof i.str === 'string').map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, size: Math.abs(i.height || i.transform[3] || 9) || 9 }));
      words += items.filter((i) => i.str.trim()).length;
      pages.push(pageLines(items, p));
      page.cleanup?.();
    }
    if (words < 20) throw new HttpError(422, 'PDF_NO_TEXT', 'This PDF is a photo or scan, so there is no text to read. Download the statement from net banking as a PDF, CSV or Excel file instead.');

    const all = pages.flat();
    const head = findHeader(all);
    if (!head) throw new HttpError(422, 'COLUMNS_NOT_FOUND', 'Could not find the statement table in this PDF. It needs a heading row with words like Date, Particulars, Withdrawals, Deposits and Balance.');
    const cols = head.cols.slice().sort((a, b) => a.x0 - b.x0);
    const dateCol = cols.findIndex((c) => c.key === 'date'), descCol = cols.findIndex((c) => c.key === 'description');

    // rows: a line whose date column holds a date starts a row; a line with only description text continues the row above on the same page
    const grid: string[][] = [cols.map((c) => c.text)];
    const wraps: { row: number; firstLen: number; extraStart: number }[] = [];
    let current: string[] | null = null, currentIdx = -1, lastPage = -1;
    const started = (line: Line): boolean => line.cells.some((c) => columnOf(c, cols) === dateCol && DATE_LIKE.test(c.text));
    for (let li = head.index + 1; li < all.length; li++) {
      const line = all[li]!;
      if (line.page !== lastPage) { current = null; lastPage = line.page; }
      const cells = cols.map(() => [] as string[]);
      for (const c of line.cells) cells[columnOf(c, cols)]!.push(c.text);
      const text = line.cells.map((c) => c.text).join(' ');
      if (started(line)) {
        if (TOTALS.test(text) && !/\d[\d,]*\.\d{2}/.test(text)) { current = null; continue; }
        current = cells.map((a) => a.join(' ').trim());
        grid.push(current); currentIdx = grid.length - 1;
      } else if (current) {
        if (NOISE.test(text) || (TOTALS.test(text) && line.cells.length > 1)) { current = null; continue; }
        const onlyDesc = cells.every((a, i) => i === descCol || a.length === 0);
        if (!onlyDesc) { current = null; continue; }
        const extra = cells[descCol]!.join(' ').trim();
        if (extra) { wraps.push({ row: currentIdx, firstLen: current[descCol]!.length, extraStart: 0 }); current[descCol] = current[descCol]! + '\u0000' + extra; }
      } else if (TOTALS.test(text) && cells.some((a, i) => i !== descCol && /\d/.test(a.join('')))) {
        // "B/F" style opening lines carry no date in some banks; ignore, the balance check uses the first dated row
      }
    }
    // a bank that wraps at a fixed width breaks words in the middle; join those pieces without a space
    const lens = wraps.map((w) => w.firstLen).sort((a, b) => a - b);
    let wrapAt = 0;
    if (lens.length >= 3) {
      const count = new Map<number, number>(); for (const n of lens) count.set(n, (count.get(n) ?? 0) + 1);
      const [mode, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0]!;
      if (n / lens.length >= 0.5) wrapAt = mode;
    }
    for (const r of grid.slice(1)) {
      const d = r[descCol] ?? '';
      if (!d.includes('\u0000')) continue;
      const [first, ...rest] = d.split('\u0000');
      r[descCol] = rest.reduce((acc, piece) => acc + (wrapAt && first!.length >= wrapAt && acc === first ? '' : ' ') + piece, first!).replace(/\s+/g, ' ').trim();
    }
    const parsed = parseGrid(grid.map((r) => r.map(cellText)), 'pdf');
    parsed.warnings.unshift('Read from a PDF. The totals are checked against the balance column; look over the rows before you import.');
    return parsed;
  } finally {
    try { await doc.destroy(); } catch { /* ignore */ }
  }
}
