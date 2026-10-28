import { ZipReader, ZipError, writeZip } from './zip.ts';
import { excelSerialToDate } from './parse.ts';

// Reads bank statements saved as .xlsx and writes the P&L workbook. No dependencies.

export class XlsxError extends Error {}

export interface Sheet { name: string; rows: string[][]; hidden: boolean }

const MAX_ROWS = 200_000;
const MAX_COLS = 200;

const unescapeXml = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
    }
  });

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]!] = unescapeXml(m[2] ?? m[3] ?? '');
  return out;
}

function textOf(xml: string): string {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) out += unescapeXml(m[1] ?? '');
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(code: string): boolean {
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(c) && !/^general$/i.test(c.trim());
}

function readStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, boolean>();
  const numFmts = /<numFmts\b[\s\S]*?<\/numFmts>/.exec(xml)?.[0] ?? '';
  for (const m of numFmts.matchAll(/<numFmt\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.numFmtId) custom.set(Number(a.numFmtId), isDateFormat(a.formatCode ?? ''));
  }
  const xfs = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? '';
  const out: boolean[] = [];
  for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(attrs(m[0]).numFmtId ?? 0);
    out.push(custom.has(id) ? custom.get(id)! : BUILTIN_DATE_FORMATS.has(id));
  }
  return out;
}

function colIndex(ref: string): number {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]!.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function numberToText(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const r = Math.round(v * 100) / 100;
  return Math.abs(v - r) < 1e-7 ? r.toFixed(2) : String(v);
}

export function readXlsx(buf: Buffer): Sheet[] {
  let zip: ZipReader;
  try { zip = new ZipReader(buf); } catch (e) { throw new XlsxError(e instanceof ZipError ? e.message : 'Not an Excel workbook'); }
  try {
    if (!zip.has('xl/workbook.xml')) throw new XlsxError('This is a zip file but not an Excel (.xlsx) workbook');
    if (zip.has('xl/vbaProject.bin') || zip.has('EncryptedPackage')) throw new XlsxError('Macro-enabled or encrypted workbooks are not accepted. Save a plain .xlsx or export CSV.');
    const wb = zip.text('xl/workbook.xml');
    const date1904 = /<workbookPr\b[^>]*date1904\s*=\s*["'](?:1|true)["']/i.test(wb);
    const rels = new Map<string, string>();
    if (zip.has('xl/_rels/workbook.xml.rels')) {
      for (const m of zip.text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
        const a = attrs(m[0]);
        if (a.Id && a.Target) rels.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`);
      }
    }
    const shared: string[] = [];
    if (zip.has('xl/sharedStrings.xml')) {
      for (const m of zip.text('xl/sharedStrings.xml').matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(textOf(m[1] ?? ''));
    }
    const dateStyle = readStyles(zip.has('xl/styles.xml') ? zip.text('xl/styles.xml') : null);

    const sheets: Sheet[] = [];
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      if (sheets.length >= 12) break;
      const a = attrs(m[0]);
      const target = rels.get(a['r:id'] ?? '');
      if (!target || !zip.has(target)) continue;
      sheets.push({ name: a.name ?? `Sheet${sheets.length + 1}`, hidden: a.state === 'hidden' || a.state === 'veryHidden', rows: readSheet(zip.text(target), shared, dateStyle, date1904) });
    }
    if (!sheets.length) throw new XlsxError('The workbook has no sheets');
    return sheets;
  } catch (e) {
    if (e instanceof ZipError) throw new XlsxError(e.message);
    throw e;
  }
}

function readSheet(xml: string, shared: string[], dateStyle: boolean[], date1904: boolean): string[][] {
  const rows: string[][] = [];
  let seq = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1] ?? '');
    const rowIdx = ra.r ? Number(ra.r) - 1 : seq;
    seq = rowIdx + 1;
    if (rowIdx >= MAX_ROWS) throw new XlsxError(`The sheet has more than ${MAX_ROWS} rows`);
    if (!rm[2]) continue;
    const row: string[] = [];
    let cseq = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1] ?? '');
      const ci = ca.r ? colIndex(ca.r) : cseq;
      cseq = ci + 1;
      if (ci < 0 || ci >= MAX_COLS) continue;
      const inner = cm[2] ?? '';
      const t = ca.t ?? 'n';
      let value = '';
      if (t === 's') value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '-1')] ?? '';
      else if (t === 'inlineStr') value = textOf(/<is\b[\s\S]*?<\/is>/.exec(inner)?.[0] ?? '');
      else if (t === 'str') value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      else if (t === 'b') value = /<v>\s*1\s*<\/v>/.test(inner) ? '1' : '0';
      else if (t === 'e') value = '';
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (raw !== undefined && raw.trim() !== '') {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            const isDate = dateStyle[Number(ca.s ?? 0)] === true;
            value = isDate ? (excelSerialToDate(date1904 ? n + 1462 : n) ?? numberToText(n)) : numberToText(n);
          } else value = unescapeXml(raw);
        }
      }
      while (row.length < ci) row.push('');
      row[ci] = value;
    }
    while (rows.length < rowIdx) rows.push([]);
    rows[rowIdx] = row;
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ writing

export type StyleName = 'default' | 'header' | 'money' | 'moneyBold' | 'date' | 'percent' | 'title' | 'wrap' | 'bold' | 'int' | 'quote' | 'note';
const STYLE_INDEX: Record<StyleName, number> = { default: 0, header: 1, money: 2, moneyBold: 3, date: 4, percent: 5, title: 6, wrap: 7, bold: 8, int: 9, quote: 10, note: 11 };

export type Cell = string | number | null | { v?: string | number | null; f?: string; s?: StyleName };
export interface SheetSpec { name: string; rows: Cell[][]; widths?: number[]; freezeRows?: number }

// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const esc = (s: string): string => s.replace(ILLEGAL_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\-#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3D2E"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sp: SheetSpec): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
  if (sp.freezeRows) out.push(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sp.freezeRows}" topLeftCell="A${sp.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`);
  if (sp.widths?.length) out.push(`<cols>${sp.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`);
  out.push('<sheetData>');
  sp.rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((c, i) => {
      if (c === null || c === undefined) return;
      const ref = `${colName(i)}${r + 1}`;
      const obj = typeof c === 'object' ? c : { v: c };
      const v = obj.v;
      let style = obj.s ? STYLE_INDEX[obj.s] : 0;
      if (obj.f !== undefined) {
        const cached = typeof v === 'number' ? `<v>${Number.isFinite(v) ? v : 0}</v>` : v !== undefined && v !== null ? `<v>${esc(String(v))}</v>` : '';
        cells.push(`<c r="${ref}"${style ? ` s="${style}"` : ''}${typeof v === 'string' ? ' t="str"' : ''}><f>${esc(obj.f)}</f>${cached}</c>`);
      } else if (typeof v === 'number') {
        if (!Number.isFinite(v)) return;
        cells.push(`<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`);
      } else if (typeof v === 'string' && v !== '') {
        // A text cell is never a formula, but if someone retypes it in Excel it would become one: keep it quoted.
        if (!style && /^[=+\-@\t\r]/.test(v)) style = STYLE_INDEX.quote;
        cells.push(`<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
      } else if (style) cells.push(`<c r="${ref}" s="${style}"/>`);
    });
    out.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\[\]:*?/\\]/g, '-').replace(/^'+|'+$/g, '').slice(0, 31).trim() || 'Sheet';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suffix = ` ${i++}`; n = base.slice(0, 31 - suffix.length) + suffix; }
  used.add(n.toLowerCase());
  return n;
}

export function writeXlsx(sheets: SheetSpec[], opts: { creator?: string; when?: Date } = {}): Buffer {
  if (!sheets.length) throw new Error('a workbook needs at least one sheet');
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const when = opts.when ?? new Date();
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${esc(opts.creator ?? 'Daji Cricket Ground')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${when.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return writeZip(files, when);
}
