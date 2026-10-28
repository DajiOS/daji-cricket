import type { Cell, SheetSpec } from './xlsx.ts';

// A small, dependency-free PDF writer for the Reports downloads: A4 landscape, one table per report, Helvetica.
// It prints the same cells the Excel and CSV files hold (formulas as their values). Money is shown as "Rs 1,23,456.00".

const W = 842, H = 595, MX = 36, TOP = 60, BOTTOM = 40, LINE = 13;

const inr = (n: number): string => {
  const neg = n < 0; const [i, d] = Math.abs(n).toFixed(2).split('.') as [string, string];
  const last3 = i.slice(-3), rest = i.slice(0, -3);
  const g = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return `${neg ? '-' : ''}Rs ${g}.${d}`;
};

interface Txt { text: string; right: boolean; bold: boolean }
function render(c: Cell): Txt {
  if (c === null || c === undefined) return { text: '', right: false, bold: false };
  if (typeof c !== 'object') return { text: String(c), right: typeof c === 'number', bold: false };
  const v = c.v ?? null; const s = c.s ?? 'default';
  const bold = s === 'header' || s === 'title' || s === 'bold' || s === 'moneyBold';
  if (v === null) return { text: '', right: false, bold };
  if (typeof v === 'number') return { text: s === 'money' || s === 'moneyBold' ? inr(v) : s === 'percent' ? `${(v * 100).toFixed(1)}%` : String(v), right: true, bold };
  return { text: v, right: false, bold };
}

/** Helvetica has no glyphs outside Latin-1; replace anything else so the file stays valid. */
const latin = (s: string): string => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/₹/g, 'Rs ').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const pdfStr = (s: string): string => '(' + latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
// average Helvetica glyph width is ~0.5em
const textW = (s: string, size: number): number => s.length * size * 0.5;
const fit = (s: string, maxW: number, size: number): string => {
  const max = Math.max(1, Math.floor(maxW / (size * 0.5)));
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + '.';
};

export function pdfBuffer(sheet: SheetSpec, business: string, subtitle: string): Buffer {
  const widths = sheet.widths ?? [];
  const cols = Math.max(widths.length, ...sheet.rows.map((r) => r.length), 1);
  const raw = Array.from({ length: cols }, (_, i) => widths[i] ?? 14);
  const avail = W - MX * 2;
  const scale = avail / raw.reduce((a, b) => a + b, 0);
  const cw = raw.map((w) => w * scale);
  const xs: number[] = []; cw.reduce((x, w, i) => { xs[i] = x; return x + w; }, MX);

  const pages: string[][] = [[]];
  let y = H - TOP;
  const size = 8.5;
  const put = (page: string[], font: 'F1' | 'F2', sz: number, x: number, yy: number, t: string): void => {
    page.push(`BT /${font} ${sz} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td ${pdfStr(t)} Tj ET`);
  };
  for (const row of sheet.rows) {
    if (y < BOTTOM + LINE) { pages.push([]); y = H - TOP; }
    const page = pages[pages.length - 1]!;
    if (!row.length) { y -= LINE / 2; continue; }
    const first = render(row[0]!);
    const title = row.length === 1 && first.bold; // a title or note line spans the page
    for (let i = 0; i < row.length; i++) {
      const t = render(row[i]!);
      if (!t.text) continue;
      const sz = title ? 12 : size;
      const shown = title || (row.length === 1) ? t.text : fit(t.text, cw[i]! - 6, sz);
      const x = t.right ? xs[i]! + cw[i]! - 4 - textW(shown, sz) : xs[i]! + 2;
      put(page, t.bold ? 'F2' : 'F1', sz, x, y, shown);
    }
    if (row.some((c) => c && typeof c === 'object' && c.s === 'header')) page.push(`0.6 w ${MX} ${(y - 3).toFixed(1)} m ${W - MX} ${(y - 3).toFixed(1)} l S`);
    y -= title ? LINE + 4 : LINE;
  }

  const objs: string[] = [];
  const add = (body: string): number => { objs.push(body); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages, filled below
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const ids: number[] = [];
  pages.forEach((p, n) => {
    const head = [`BT /F1 8 Tf ${MX} ${H - 28} Td ${pdfStr(business)} Tj ET`, `BT /F1 8 Tf ${W - MX - 60} ${H - 28} Td ${pdfStr(`Page ${n + 1} of ${pages.length}`)} Tj ET`,
      `BT /F1 7 Tf ${MX} 22 Td ${pdfStr(subtitle)} Tj ET`];
    const stream = [...head, ...p].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    ids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[1] = `<< /Type /Pages /Kids [${ids.map((i) => `${i} 0 R`).join(' ')}] /Count ${ids.length} >>`;

  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Producer (Daji Cricket Ground) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
