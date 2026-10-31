// Reads what a construction file is from the file itself, so nobody types a drawing number on upload: whether it is a
// drawing or a document, the drawing number, the revision and the title. The pages were already read into Documents
// (the PDF's own text, or Platform AI's reading of a photo or scan). Platform AI reads the title block when the Claude
// connection is set up; without it the title block is matched by its usual labels, then the file name. Whatever is read
// can be corrected afterwards on the project (Plans & Documents, open the file).
import type { Config } from './config.ts';
import { many } from './db.ts';
import { DOC_CATEGORIES, fitCategory } from './construction.ts';

export interface DrawingRead { kind: 'drawing' | 'document'; drawingNo: string | null; revision: string | null; title: string | null; category: string | null; party: string | null; from: 'ai' | 'text' | 'name' | 'none' }

const NO = String.raw`[A-Z]{1,5}[-_/.]?\d{1,5}(?:[-_/.][A-Z0-9]{1,5}){0,3}`;
const clean = (s: string | null | undefined, max: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };
const normNo = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');

/** The title block, matched by its usual labels: "Drawing No", "Dwg No", "Drg. No.", "Sheet No"; "Rev", "Revision"; "Title", "Drawing title". */
export function drawingFromText(text: string): Pick<DrawingRead, 'drawingNo' | 'revision' | 'title'> | null {
  const t = text.replace(/\r/g, '');
  const no = new RegExp(String.raw`(?:dr(?:awin)?g|dwg|sheet)\.?\s*(?:no\.?|number|#)\s*[:\-]?\s*(${NO})`, 'i').exec(t);
  if (!no) return null;
  const rev = /\brev(?:ision)?\.?\s*(?:no\.?)?\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i.exec(t);
  const title = /(?:drawing\s+title|title)\s*[:\-]\s*([^\n]{3,120})/i.exec(t);
  return { drawingNo: normNo(no[1]!), revision: rev ? rev[1]!.toUpperCase() : null, title: clean(title?.[1], 200) };
}

/** A drawing number and revision in a file name: "A-101 rev B.pdf", "A-101_RevB.pdf", "S-201-C.dwg", "A-101.pdf". */
export function drawingFromName(name: string): Pick<DrawingRead, 'drawingNo' | 'revision'> | null {
  const base = name.replace(/\.[^.]+$/, '').trim();
  const m = /^([A-Za-z]{1,4}[-_ ]?\d{1,5}(?:[.-]\d{1,3})?)(?:[\s_-]+(?:rev(?:ision)?[\s_.-]*)?([A-Za-z0-9]{1,3}))?(?:[\s_-].*)?$/i.exec(base);
  return m ? { drawingNo: normNo(m[1]!.replace(' ', '-')), revision: m[2] ? m[2].toUpperCase() : null } : null;
}

// Drawing disciplines by the letter a drawing number starts with, and by words on the sheet.
const DISCIPLINE: [RegExp, RegExp, string][] = [
  [/^A/, /architect|floor plan|elevation|section/i, 'Architectural'], [/^S/, /structur|foundation|footing|column|beam|slab|reinforcement/i, 'Structural'],
  [/^E/, /electric|lighting|power|wiring|db layout/i, 'Electrical'], [/^P/, /plumbing|drainage|water supply|sanitary/i, 'Plumbing'],
  [/^(M|H)/, /hvac|mechanical|ventilation|air.?condition/i, 'Mechanical'], [/^F/, /fire|sprinkler|hydrant/i, 'Fire'],
  [/^C/, /civil|road|levels|site grading/i, 'Civil'], [/^(I|ID)/, /interior|furniture|joinery|false ceiling/i, 'Interior'], [/^L/, /landscap|planting|hardscape/i, 'Landscape'],
];
const DOC_WORDS: [RegExp, string][] = [
  [/\b(tax )?invoice\b|\bbill no\b/i, 'Invoice'], [/\bquotation\b|\bquote\b|\bestimate\b/i, 'Quotation'], [/\bpurchase order\b|\bP\.?O\.? no\b/i, 'Purchase order'],
  [/\bagreement\b|\bcontract\b|\bwork order\b/i, 'Contract'], [/\bbill of quantities\b|\bB\.?O\.?Q\b/i, 'BOQ'],
  [/\bpermit\b|\bsanction\b|\bapproval\b|\bNOC\b|\blicen[cs]e\b/i, 'Permit or approval'], [/\breport\b|\btest certificate\b|\bcube test\b|\bsoil test\b/i, 'Report or test'],
  [/\bdear\b|\bsubject\s*:/i, 'Letter'],
];
/** The type of a file from its drawing number's letter and the words on it, without Platform AI. */
export function categoryOf(kind: 'drawing' | 'document', drawingNo: string | null, text: string): string {
  if (kind === 'drawing') return (DISCIPLINE.find(([letter]) => drawingNo && letter.test(drawingNo)) ?? DISCIPLINE.find(([, w]) => w.test(text)))?.[2] ?? 'Other drawing';
  if (/\.(jpe?g|png|webp|heic)\b/i.test(text.split('\n')[0] ?? '') && text.replace(/\s/g, '').length < 400) return 'Photo';
  return DOC_WORDS.find(([w]) => w.test(text))?.[1] ?? 'Other document';
}
/** The company a file is from, when it says so: "M/s Shree Steel", "From: Patel Consultants", "Vendor: …", "Supplier: …", "Architect: …". */
export function partyFromText(text: string): string | null {
  const m = /(?:\bM\/s\.?\s+|\b(?:from|vendor|supplier|contractor|consultant|architect|seller|billed by)\s*[:\-]\s*)([A-Za-z0-9&.,' ()-]{3,80})/i.exec(text);
  return m ? clean(m[1]!.split(/\s{2,}|,\s*(?:gst|pan|ph|tel|mob)/i)[0], 120) : null;
}

async function askAi(cfg: Config, fileName: string, text: string, fetchImpl: typeof fetch): Promise<Omit<DrawingRead, 'from'> | null> {
  const res = await fetchImpl(`${cfg.ai.apiUrl}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.ai.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.ai.model, max_tokens: 400, messages: [{ role: 'user', content:
      `This file was added to a construction project. File name: ${JSON.stringify(fileName)}. Its text (from the title block and pages) is below.\n` +
      'Say whether it is a drawing (a plan, section, elevation, detail or layout with a drawing number) or another document (contract, BOQ, report, letter, permit, invoice), ' +
      'and read the drawing number, the revision and the title exactly as written. Sort it under one type: for a drawing one of ' + DOC_CATEGORIES.drawing.join(', ') +
      '; for a document one of ' + DOC_CATEGORIES.document.join(', ') + '. Name the vendor, supplier, contractor or consultant it is from (a company or person), or null. ' +
      'Reply with JSON only: {"kind":"drawing"|"document","drawingNo":string|null,"revision":string|null,"title":string|null,"category":string,"party":string|null}.\n\n' +
      text.slice(0, 12_000) }] }),
    signal: AbortSignal.timeout(Math.max(cfg.ai.timeoutMs, 30_000)),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const txt = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)) as { kind?: string; drawingNo?: string | null; revision?: string | null; title?: string | null; category?: string | null; party?: string | null };
  const no = clean(j.drawingNo, 40);
  const kind = j.kind === 'drawing' && no ? 'drawing' : 'document';
  return { kind, drawingNo: kind === 'drawing' ? normNo(no!) : null, revision: kind === 'drawing' ? clean(j.revision, 10)?.toUpperCase() ?? null : null, title: clean(j.title, 200),
    category: fitCategory(kind, j.category), party: clean(j.party, 120) };
}

/** What a file on a project is, read from its pages (already in Documents) and its name. Never throws: a file that cannot be read is a document. */
export async function readDrawing(cfg: Config, docId: string, fileName: string, fetchImpl: typeof fetch = fetch): Promise<DrawingRead> {
  const text = many<{ text: string }>('SELECT text FROM doc_pages WHERE doc_id = ? ORDER BY page LIMIT 6', docId).map((p) => p.text).join('\n\n').trim();
  if (cfg.ai.apiKey && text) {
    try { const r = await askAi(cfg, fileName, text, fetchImpl); if (r) return { ...r, from: 'ai' }; } catch { /* fall back to the labels and the name */ }
  }
  const party = partyFromText(text);
  const fromText = text ? drawingFromText(text) : null;
  if (fromText) return { kind: 'drawing', ...fromText, category: categoryOf('drawing', fromText.drawingNo, `${fileName}\n${text}`), party, from: 'text' };
  const fromName = drawingFromName(fileName);
  if (fromName) return { kind: 'drawing', ...fromName, title: null, category: categoryOf('drawing', fromName.drawingNo, `${fileName}\n${text}`), party, from: 'name' };
  return { kind: 'document', drawingNo: null, revision: null, title: null, category: categoryOf('document', null, `${fileName}\n${text}`), party, from: text ? 'text' : 'none' };
}
