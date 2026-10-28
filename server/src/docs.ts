import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { audit, type Actor } from './audit.ts';
import { HttpError, conflict, notFound } from './errors.ts';
import { storeUpload } from './intake.ts';
import { pdfPagesText } from './accounting/pdfstatement.ts';
import { readXlsx } from './accounting/xlsx.ts';
import { hasPermission, type UserRow } from './auth.ts';

// Documents: any file the business keeps (statements, bills, agreements, licences, photos of receipts). Every page is read and indexed, so
// Ask AI and the search box find a document by what is written on its pages. On upload the document is filed in the folder its pages point to,
// with the other likely folders offered beside it, and it is tied to the bookings, customers, suppliers and bank accounts its pages mention.
// A PDF with a text layer, a CSV, a text file and an Excel sheet are read here. A photo or a scanned PDF has no text layer: Platform AI (the
// Claude connection in Settings) reads those pages when it is set up; until then they wait, and everything else about the document still works.

registerSchema('docs-1', `
CREATE TABLE doc_folders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  key TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX ux_doc_folders_name ON doc_folders(owner_id, name) WHERE deleted_at IS NULL;
CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  folder_id TEXT REFERENCES doc_folders(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  pages INTEGER NOT NULL DEFAULT 0,
  reading TEXT NOT NULL CHECK (reading IN ('text','waiting','ai','none')),
  suggestions TEXT NOT NULL DEFAULT '[]',
  filed_by TEXT NOT NULL DEFAULT 'auto' CHECK (filed_by IN ('auto','person')),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_docs_owner ON docs(owner_id, deleted_at, created_at);
CREATE TABLE doc_pages (
  doc_id TEXT NOT NULL REFERENCES docs(id),
  page INTEGER NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('file','ai')),
  PRIMARY KEY (doc_id, page)
);
CREATE TABLE doc_links (
  doc_id TEXT NOT NULL REFERENCES docs(id),
  kind TEXT NOT NULL CHECK (kind IN ('booking','customer','vendor','bank_account','bank_import')),
  ref_id TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (doc_id, kind, ref_id)
);
CREATE INDEX ix_doc_links_ref ON doc_links(kind, ref_id);
`);

export const MAX_DOC_BYTES = 25 * 1024 * 1024;

/** Documents hold agreements, statements and staff papers: the owner, and team members who keep the books. */
export const seesDocs = (u: UserRow): boolean => u.role !== 'staff' || hasPermission(u, 'manage_accounting');

/** The folders every business starts with, and the words on a page that point to each. */
const FOLDERS: { key: string; name: string; words: [RegExp, string][] }[] = [
  { key: 'bank', name: 'Bank statements', words: [[/statement of account|account statement|bank statement/i, 'says it is a bank statement'], [/opening balance|closing balance/i, 'has opening and closing balances'], [/\bifsc\b/i, 'has an IFSC code'], [/\b(neft|imps|rtgs)\b/i, 'lists NEFT, IMPS or RTGS transfers'], [/withdrawals?|deposits?/i, 'has withdrawal or deposit columns']] },
  { key: 'bills', name: 'Bills & receipts', words: [[/tax invoice|\binvoice\b/i, 'says invoice'], [/\breceipt\b/i, 'says receipt'], [/amount due|total amount|grand total|amount payable/i, 'has a total to pay'], [/quotation|purchase order|delivery challan/i, 'is a quotation, order or challan'], [/bill (no|number|date)/i, 'has a bill number']] },
  { key: 'gst', name: 'Tax & GST', words: [[/\bgstr|\bgst return/i, 'is a GST return'], [/\b(cgst|sgst|igst)\b/i, 'shows CGST, SGST or IGST'], [/\btds\b|form 16|income tax|\bitr\b/i, 'is about TDS or income tax'], [/\bgstin\b/i, 'has a GSTIN'], [/\bchallan\b/i, 'is a tax challan']] },
  { key: 'contracts', name: 'Contracts & agreements', words: [[/agreement|contract\b/i, 'says agreement or contract'], [/\blease\b|rent agreement|leave and licen[cs]e/i, 'is a lease or rent agreement'], [/hereinafter|witnesseth|in witness whereof/i, 'is written as a legal agreement'], [/memorandum of understanding|\bmou\b/i, 'is an MOU'], [/terms and conditions/i, 'has terms and conditions']] },
  { key: 'licences', name: 'Licences & compliance', words: [[/licen[cs]e/i, 'says licence'], [/\bpermit\b|no objection|\bnoc\b/i, 'is a permit or NOC'], [/registration certificate|certificate of registration/i, 'is a registration certificate'], [/fire safety|fire noc|\bfssai\b|shops? and establishment/i, 'is a fire, food or shop registration'], [/municipal|corporation|panchayat/i, 'is from the municipality']] },
  { key: 'insurance', name: 'Insurance', words: [[/insurance/i, 'says insurance'], [/policy (no|number)/i, 'has a policy number'], [/premium/i, 'shows a premium'], [/sum (assured|insured)|insured/i, 'names what is insured'], [/\bclaim\b|nominee/i, 'is about a claim or nominee']] },
  { key: 'staff', name: 'Staff & payroll', words: [[/salary|pay ?slip|payroll/i, 'is about salary'], [/appointment letter|offer letter|relieving letter/i, 'is a staff letter'], [/\bemployee\b|\bstaff\b/i, 'names an employee'], [/\b(epf|pf|esic?|uan)\b/i, 'is about PF or ESI'], [/attendance/i, 'is about attendance']] },
  { key: 'customers', name: 'Customers & bookings', words: [[/\bDJ-[A-HJ-NP-Z2-9]{6}\b/, 'has a booking number'], [/\bbooking\b/i, 'says booking'], [/tournament|fixture|match/i, 'is about a match or tournament'], [/team (list|sheet)|squad/i, 'is a team list'], [/waiver|consent form/i, 'is a waiver or consent form']] },
  { key: 'academy', name: 'Academy', words: [[/academy|coaching/i, 'is about the academy'], [/\bstudents?\b|admission/i, 'is about students or admission'], [/\bcoach(es)?\b/i, 'names a coach'], [/\bbatch\b|parent|guardian/i, 'is about a batch or parents']] },
  { key: 'photos', name: 'Photos & scans', words: [] },
  { key: 'other', name: 'Other', words: [] },
];

export interface Suggestion { folderId: string; name: string; reason: string }
export interface DocLink { kind: string; id: string; label: string }
export interface DocOut {
  id: string; name: string; mime: string; bytes: number; pages: number;
  /** text: read from the file · ai: read by Platform AI · waiting: a photo or scan waiting for Platform AI · none: nothing to read */
  reading: 'text' | 'ai' | 'waiting' | 'none';
  folder: { id: string; name: string } | null; filedBy: 'auto' | 'person'; suggestions: Suggestion[]; links: DocLink[]; createdAt: number;
}
export interface FolderOut { id: string; key: string | null; name: string; count: number }
export interface SearchHit { docId: string; name: string; folder: string | null; mime: string; page: number; pages: number; snippet: string }

interface DocRow { id: string; owner_id: string; folder_id: string | null; name: string; mime: string; bytes: number; sha256: string; pages: number; reading: DocOut['reading']; suggestions: string; filed_by: 'auto' | 'person'; created_at: number; fname: string | null }

/** The standard folders, made the first time a business opens Documents. */
function ensureFolders(ownerId: string): void {
  if (one('SELECT 1 FROM doc_folders WHERE owner_id = ? AND key IS NOT NULL LIMIT 1', ownerId)) return;
  const t = now();
  tx(() => { for (const f of FOLDERS) run('INSERT INTO doc_folders(id, owner_id, key, name, created_at) VALUES(?,?,?,?,?)', newId('dfo'), ownerId, f.key, f.name, t); });
}

export function listFolders(ownerId: string): FolderOut[] {
  ensureFolders(ownerId);
  return many<{ id: string; key: string | null; name: string; n: number }>(
    `SELECT f.id, f.key, f.name, (SELECT COUNT(*) FROM docs d WHERE d.folder_id = f.id AND d.deleted_at IS NULL) n FROM doc_folders f WHERE f.owner_id = ? AND f.deleted_at IS NULL ORDER BY f.created_at, f.rowid`, ownerId)
    .map((f) => ({ id: f.id, key: f.key, name: f.name, count: f.n }));
}

const cleanName = (raw: unknown, what: string): string => {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!s) throw new HttpError(400, 'VALIDATION_FAILED', `Give the ${what} a name`, { fields: [{ field: 'name', message: 'Required' }] });
  if (s.length > 80) throw new HttpError(400, 'VALIDATION_FAILED', 'Keep the name under 80 characters', { fields: [{ field: 'name', message: 'At most 80 characters' }] });
  return s;
};

export function createFolder(ownerId: string, actor: Actor, body: unknown): FolderOut {
  ensureFolders(ownerId);
  const name = cleanName((body as { name?: unknown })?.name, 'folder');
  if (one('SELECT 1 FROM doc_folders WHERE owner_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL', ownerId, name)) throw conflict('FOLDER_EXISTS', `There is already a folder called ${name}.`);
  const id = newId('dfo');
  run('INSERT INTO doc_folders(id, owner_id, name, created_at, created_by) VALUES(?,?,?,?,?)', id, ownerId, name, now(), actor.id);
  audit(actor, 'doc.folder.create', 'doc_folder', id, { name }, ownerId);
  return { id, key: null, name, count: 0 };
}

const folderRow = (ownerId: string, id: string) => {
  const f = one<{ id: string; name: string; key: string | null }>('SELECT id, name, key FROM doc_folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!f) throw notFound('Folder not found');
  return f;
};

export function renameFolder(ownerId: string, actor: Actor, id: string, body: unknown): FolderOut {
  const f = folderRow(ownerId, id);
  const name = cleanName((body as { name?: unknown })?.name, 'folder');
  if (one('SELECT 1 FROM doc_folders WHERE owner_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?', ownerId, name, id)) throw conflict('FOLDER_EXISTS', `There is already a folder called ${name}.`);
  run('UPDATE doc_folders SET name = ? WHERE id = ?', name, id);
  audit(actor, 'doc.folder.rename', 'doc_folder', id, { from: f.name, to: name }, ownerId);
  return listFolders(ownerId).find((x) => x.id === id)!;
}

export function removeFolder(ownerId: string, actor: Actor, id: string): void {
  const f = folderRow(ownerId, id);
  if (f.key === 'other') throw conflict('FOLDER_NEEDED', 'Other is where documents go when nothing else fits, so it stays.');
  if (one('SELECT 1 FROM docs WHERE folder_id = ? AND deleted_at IS NULL', id)) throw conflict('FOLDER_NOT_EMPTY', `Move the documents out of ${f.name} first.`);
  run('UPDATE doc_folders SET deleted_at = ? WHERE id = ?', now(), id);
  audit(actor, 'doc.folder.remove', 'doc_folder', id, { name: f.name }, ownerId);
}

// ------------------------------------------------------------------ reading a file

const KINDS: { test: (b: Buffer, name: string) => boolean; mime: string; ext: string }[] = [
  { test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-', mime: 'application/pdf', ext: 'pdf' },
  { test: (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG', mime: 'image/png', ext: 'png' },
  { test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, mime: 'image/jpeg', ext: 'jpg' },
  { test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP', mime: 'image/webp', ext: 'webp' },
  { test: (b, n) => b[0] === 0x50 && b[1] === 0x4b && /\.xlsx$/i.test(n), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  { test: (b, n) => /\.(csv|txt)$/i.test(n) && !b.subarray(0, 4096).includes(0), mime: 'text/plain', ext: 'txt' },
];
const isImage = (mime: string) => mime.startsWith('image/');

/** The text of each page, read from the file itself. Photos and scans give empty pages. */
async function pagesOf(buf: Buffer, mime: string): Promise<string[]> {
  if (mime === 'application/pdf') return pdfPagesText(buf);
  if (isImage(mime)) return [''];
  if (mime.includes('spreadsheet')) return readXlsx(buf).map((s) => s.rows.map((r) => r.map((c) => String(c ?? '')).join('  ').trim()).filter(Boolean).join('\n'));
  return [buf.toString('utf8').slice(0, 2_000_000)];
}

const textChars = (pages: string[]) => pages.reduce((n, p) => n + p.replace(/\s/g, '').length, 0);

// ------------------------------------------------------------------ where a document belongs

/** The folders a document's pages and name point to, best first, each with the reason. Folders the owner made match on their own name. */
export function suggestFolders(ownerId: string, name: string, pages: string[], mime: string): Suggestion[] {
  const folders = listFolders(ownerId);
  const text = pages.join('\n');
  const scored: { f: FolderOut; score: number; reasons: string[] }[] = [];
  for (const f of folders) {
    const def = FOLDERS.find((x) => x.key === f.key);
    let score = 0; const reasons: string[] = [];
    if (def) {
      for (const [re, why] of def.words) {
        const inName = re.test(name), inText = re.test(text);
        if (inName || inText) { score += inName ? 2 : 1; reasons.push(inName && !inText ? `its name ${why.replace(/^(says|is|has|names|shows|lists) /, '$1 ')}` : why); }
      }
    } else {
      // a folder the owner made ("Arvindbhai", "Ground lease") is offered when the pages or the file name use its words
      const words = f.name.toLowerCase().split(/[^a-z0-9ऀ-࿿]+/).filter((w) => w.length >= 4);
      const hay = (name + '\n' + text).toLowerCase();
      const hit = words.filter((w) => hay.includes(w));
      if (words.length && hit.length) { score += 2 + hit.length; reasons.push(`mentions "${hit[0]}"`); }
    }
    if (score) scored.push({ f, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = scored.slice(0, 3).map((s) => ({ folderId: s.f.id, name: s.f.name, reason: s.reasons.slice(0, 2).join(' and ') }));
  const add = (key: string, reason: string) => { const f = folders.find((x) => x.key === key); if (f && !out.some((o) => o.folderId === f.id) && out.length < 3) out.push({ folderId: f.id, name: f.name, reason }); };
  if (isImage(mime) && textChars(pages) === 0) { add('photos', 'it is a photo or scan'); add('bills', 'photos are often receipts'); }
  add('other', out.length ? 'if none of these fit' : 'nothing on its pages points to another folder');
  return out;
}

/** Bookings, customers, suppliers and bank accounts the pages mention, so the document shows with them too. */
function findLinks(ownerId: string, pages: string[]): DocLink[] {
  const text = pages.join('\n');
  const out: DocLink[] = [];
  const seen = new Set<string>();
  const add = (l: DocLink) => { const k = l.kind + l.id; if (!seen.has(k)) { seen.add(k); out.push(l); } };
  const refs = [...new Set(text.match(/\bDJ-[A-HJ-NP-Z2-9]{6}\b/g) ?? [])].slice(0, 20);
  for (const ref of refs) {
    const b = one<{ id: string; ref: string; customer_id: string; cname: string | null; date: string }>('SELECT b.id, b.ref, b.customer_id, u.name cname, b.date FROM bookings b LEFT JOIN users u ON u.id = b.customer_id WHERE b.ref = ? AND b.owner_id = ?', ref, ownerId);
    if (!b) continue;
    add({ kind: 'booking', id: b.id, label: `Booking ${b.ref} (${b.date})` });
    if (b.cname) add({ kind: 'customer', id: b.customer_id, label: b.cname });
  }
  const phones = [...new Set([...text.matchAll(/(?:\+?91[\s-]?)?\b([6-9]\d{4})[\s-]?(\d{5})\b/g)].map((m) => m[1]! + m[2]!))].slice(0, 20);
  for (const p of phones) {
    const c = one<{ id: string; name: string }>("SELECT u.id, u.name FROM users u WHERE u.role = 'customer' AND substr(replace(replace(u.phone, ' ', ''), '-', ''), -10) = ? AND EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = u.id AND b.owner_id = ?)", p, ownerId);
    if (c) add({ kind: 'customer', id: c.id, label: c.name });
  }
  const lower = text.toLowerCase();
  for (const v of many<{ id: string; name: string; gstin: string | null }>('SELECT id, name, gstin FROM acct_vendors WHERE owner_id = ? AND deleted_at IS NULL', ownerId)) {
    if ((v.gstin && text.toUpperCase().includes(v.gstin.toUpperCase())) || (v.name.trim().length >= 4 && lower.includes(v.name.trim().toLowerCase()))) add({ kind: 'vendor', id: v.id, label: v.name });
  }
  for (const a of many<{ id: string; name: string; last4: string | null }>("SELECT id, name, last4 FROM acct_accounts WHERE owner_id = ? AND deleted_at IS NULL AND kind = 'bank' AND last4 IS NOT NULL AND last4 <> ''", ownerId)) {
    if (new RegExp(`(?:x{2,}|\\*{2,}|\\d{4,})${a.last4}\\b`, 'i').test(text)) add({ kind: 'bank_account', id: a.id, label: a.name });
  }
  return out;
}

// ------------------------------------------------------------------ the index

function indexPages(docId: string, pages: string[], source: 'file' | 'ai'): void {
  run('DELETE FROM doc_pages WHERE doc_id = ?', docId);
  pages.forEach((text, i) => run('INSERT INTO doc_pages(doc_id, page, text, source) VALUES(?,?,?,?)', docId, i + 1, text, source));
}

// ------------------------------------------------------------------ upload, list, change

const docRow = (ownerId: string, id: string): DocRow => {
  const d = one<DocRow>('SELECT d.*, f.name fname FROM docs d LEFT JOIN doc_folders f ON f.id = d.folder_id WHERE d.id = ? AND d.owner_id = ? AND d.deleted_at IS NULL', id, ownerId);
  if (!d) throw notFound('Document not found');
  return d;
};
const toOut = (d: DocRow): DocOut => ({
  id: d.id, name: d.name, mime: d.mime, bytes: d.bytes, pages: d.pages, reading: d.reading,
  folder: d.folder_id ? { id: d.folder_id, name: d.fname ?? '' } : null, filedBy: d.filed_by,
  suggestions: JSON.parse(d.suggestions || '[]'),
  links: many<{ kind: string; ref_id: string; label: string }>('SELECT kind, ref_id, label FROM doc_links WHERE doc_id = ? ORDER BY kind, label', d.id).map((l) => ({ kind: l.kind, id: l.ref_id, label: l.label })),
  createdAt: d.created_at,
});

function refile(ownerId: string, d: { id: string; name: string; mime: string; filed_by: string }, pages: string[]): void {
  const sug = suggestFolders(ownerId, d.name, pages, d.mime);
  run('UPDATE docs SET suggestions = ? WHERE id = ?', JSON.stringify(sug), d.id);
  // a document a person filed stays where they put it; one filed automatically follows what its pages now say
  if (d.filed_by === 'auto' && sug[0]) run('UPDATE docs SET folder_id = ? WHERE id = ?', sug[0].folderId, d.id);
  for (const l of findLinks(ownerId, pages)) run('INSERT OR IGNORE INTO doc_links(doc_id, kind, ref_id, label) VALUES(?,?,?,?)', d.id, l.kind, l.id, l.label);
}

/** Keeps a document: virus-checked (by the route), stored, every page read and indexed, filed in the best folder, and tied to what it mentions. */
export async function addDocument(cfg: Config, ownerId: string, actor: Actor, filename: string, buf: Buffer, fetchImpl: typeof fetch = fetch): Promise<DocOut> {
  if (!buf.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (buf.length > MAX_DOC_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'A document can be at most 25 MB.');
  const base = filename.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\.+$/, '').slice(0, 120).trim() || 'document';
  const kind = KINDS.find((k) => k.test(buf, base));
  if (!kind) throw new HttpError(415, 'FILE_TYPE_NOT_ALLOWED', 'Documents can be PDF, photos (JPEG, PNG, WebP), Excel (.xlsx), CSV or text files.');
  const name = new RegExp(`\\.${kind.ext === 'txt' ? '(txt|csv)' : kind.ext === 'jpg' ? 'jpe?g' : kind.ext}$`, 'i').test(base) ? base : `${base}.${kind.ext}`;
  ensureFolders(ownerId);
  const pages = await pagesOf(buf, kind.mime);
  const reading: DocOut['reading'] = textChars(pages) >= 10 * Math.max(1, pages.filter((p) => p.trim()).length) && pages.some((p) => p.trim()) ? 'text' : (isImage(kind.mime) || kind.mime === 'application/pdf') ? 'waiting' : 'none';
  const id = newId('doc'), t = now();
  const sug = suggestFolders(ownerId, name, pages, kind.mime);
  storeUpload({
    dataDir: cfg.dataDir, buf, finalPath: join(cfg.dataDir, 'documents', ownerId, id), purpose: 'document', actor, ownerId,
    writeMetadata: () => {
      run('INSERT INTO docs(id, owner_id, folder_id, name, mime, bytes, sha256, pages, reading, suggestions, filed_by, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, ownerId, sug[0]?.folderId ?? null, name, kind.mime, buf.length, createHash('sha256').update(buf).digest('hex'), pages.length, reading, JSON.stringify(sug), 'auto', t, actor.id);
      indexPages(id, pages, 'file');
      for (const l of findLinks(ownerId, pages)) run('INSERT OR IGNORE INTO doc_links(doc_id, kind, ref_id, label) VALUES(?,?,?,?)', id, l.kind, l.id, l.label);
      audit(actor, 'doc.add', 'doc', id, { name, bytes: buf.length, pages: pages.length, folder: sug[0]?.name ?? null }, ownerId);
    },
  });
  if (reading === 'waiting' && cfg.ai.apiKey) {
    try { await readWithAi(cfg, ownerId, actor, id, fetchImpl); } catch { /* the pages stay waiting; Read again on the page retries */ }
  }
  return toOut(docRow(ownerId, id));
}

export function listDocs(ownerId: string, f: { folderId?: string; linkKind?: string; linkId?: string; q?: string } = {}): DocOut[] {
  ensureFolders(ownerId);
  const where = ['d.owner_id = ?', 'd.deleted_at IS NULL']; const args: string[] = [ownerId];
  if (f.folderId) { where.push('d.folder_id = ?'); args.push(f.folderId); }
  if (f.linkKind && f.linkId) { where.push('EXISTS (SELECT 1 FROM doc_links l WHERE l.doc_id = d.id AND l.kind = ? AND l.ref_id = ?)'); args.push(f.linkKind, f.linkId); }
  return many<DocRow>(`SELECT d.*, f.name fname FROM docs d LEFT JOIN doc_folders f ON f.id = d.folder_id WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC, d.rowid DESC LIMIT 500`, ...args).map(toOut);
}

export function getDoc(ownerId: string, id: string): DocOut & { pageTexts: { page: number; text: string; source: string }[] } {
  const d = docRow(ownerId, id);
  return { ...toOut(d), pageTexts: many<{ page: number; text: string; source: string }>('SELECT page, text, source FROM doc_pages WHERE doc_id = ? ORDER BY page', id) };
}

export function docFile(cfg: Config, ownerId: string, id: string): { name: string; mime: string; data: Buffer } {
  const d = docRow(ownerId, id);
  try { return { name: d.name, mime: d.mime, data: readFileSync(join(cfg.dataDir, 'documents', ownerId, id)) }; } catch { throw notFound('The file is missing from storage'); }
}

/** Moves a document to another folder (a person's choice from now on) and/or renames it. */
export function updateDoc(ownerId: string, actor: Actor, id: string, body: unknown): DocOut {
  const d = docRow(ownerId, id);
  const b = (body ?? {}) as { folderId?: unknown; name?: unknown };
  if (b.folderId !== undefined) {
    const f = folderRow(ownerId, String(b.folderId));
    run("UPDATE docs SET folder_id = ?, filed_by = 'person' WHERE id = ?", f.id, id);
    audit(actor, 'doc.move', 'doc', id, { from: d.fname, to: f.name }, ownerId);
  }
  if (b.name !== undefined) {
    const name = cleanName(b.name, 'document');
    run('UPDATE docs SET name = ? WHERE id = ?', name, id);
    audit(actor, 'doc.rename', 'doc', id, { from: d.name, to: name }, ownerId);
  }
  return toOut(docRow(ownerId, id));
}

/** Takes a document off every list and out of search. The file and its record stay for the audit trail. */
export function removeDoc(ownerId: string, actor: Actor, id: string): void {
  const d = docRow(ownerId, id);
  run('UPDATE docs SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'doc.remove', 'doc', id, { name: d.name }, ownerId);
}

/** Records that a document became a bank import (Bank statements › Import), so the two point at each other. */
export function linkImport(docId: string, importId: string, label: string): void {
  run('INSERT OR IGNORE INTO doc_links(doc_id, kind, ref_id, label) VALUES(?,?,?,?)', docId, 'bank_import', importId, label);
}

// ------------------------------------------------------------------ search

const STOP = new Set('a an and are as at be by can do does find for from get give have i in is it its look me my of on or our please search see show the their there this to up us was we what where which who with you your document documents doc docs file files upload uploads uploaded page pages paper papers copy scan scanned pdf'.split(' '));

/** Words worth searching for in a question ("find the lease with Arvindbhai" -> lease, arvindbhai). */
export function searchWords(q: string): string[] {
  return [...new Set(q.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}-]+/u).map((w) => w.replace(/^-+|-+$/g, '')).filter((w) => w.length >= 2 && !STOP.has(w)))].slice(0, 12);
}

/** Pages that mention the words, best first: one hit per document (its best page), with the words in context. */
export function searchDocs(ownerId: string, q: string, limit = 10): SearchHit[] {
  const words = searchWords(q);
  if (!words.length) return [];
  const like = (w: string) => '%' + w.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const any = words.map(() => "(p.text LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\')").join(' OR ');
  const rows = many<{ doc_id: string; page: number; text: string; name: string; mime: string; pages: number; fname: string | null; created_at: number }>(
    `SELECT p.doc_id, p.page, p.text, d.name, d.mime, d.pages, f.name fname, d.created_at FROM doc_pages p JOIN docs d ON d.id = p.doc_id LEFT JOIN doc_folders f ON f.id = d.folder_id
     WHERE d.owner_id = ? AND d.deleted_at IS NULL AND (${any}) LIMIT 5000`, ownerId, ...words.flatMap((w) => [like(w), like(w)]));
  const best = new Map<string, { row: typeof rows[number]; score: number }>();
  for (const r of rows) {
    const text = r.text.toLowerCase(), name = r.name.toLowerCase();
    let found = 0, times = 0;
    for (const w of words) {
      const n = text.split(w).length - 1;
      if (n || name.includes(w)) found++;
      times += Math.min(n, 5) + (name.includes(w) ? 3 : 0);
    }
    // a page with more of the words wins; then the one that says them more often
    const score = found * 100 + times;
    const b = best.get(r.doc_id);
    if (!b || score > b.score || (score === b.score && r.page < b.row.page)) best.set(r.doc_id, { row: r, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.row.created_at - a.row.created_at).slice(0, limit)
    .map(({ row: r }) => ({ docId: r.doc_id, name: r.name, folder: r.fname, mime: r.mime, page: r.page, pages: r.pages, snippet: snippetOf(r.text, words) }));
}

/** About twenty words around the first match, with each searched word in [brackets]. */
function snippetOf(text: string, words: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const at = Math.min(...words.map((w) => { const i = lower.indexOf(w); return i < 0 ? Infinity : i; }));
  if (!Number.isFinite(at)) return flat.slice(0, 140);
  const from = Math.max(0, flat.lastIndexOf(' ', Math.max(0, at - 60)) + 1), to = Math.min(flat.length, at + 100);
  const cut = flat.slice(from, to);
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}\\p{N}]*`, 'giu');
  return (from > 0 ? '…' : '') + cut.replace(re, '[$&]') + (to < flat.length ? '…' : '');
}

// ------------------------------------------------------------------ Platform AI reads photos and scans

/** Sends a photo or scanned PDF to Platform AI (the Claude connection) to copy out the text of each page, then indexes and refiles it. */
export async function readWithAi(cfg: Config, ownerId: string, actor: Actor, id: string, fetchImpl: typeof fetch = fetch): Promise<DocOut> {
  if (!cfg.ai.apiKey) throw new HttpError(409, 'AI_NOT_SET_UP', 'Photos and scans are read by Platform AI. Set up the Claude connection in Settings › Connections, then press Read again.');
  const d = docRow(ownerId, id);
  const data = docFile(cfg, ownerId, id).data.toString('base64');
  const file = d.mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } : { type: 'image', source: { type: 'base64', media_type: d.mime, data } };
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.ai.apiUrl}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.ai.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.ai.model, max_tokens: 8000, messages: [{ role: 'user', content: [file, { type: 'text', text: 'Copy out all the text on each page of this file, in reading order, exactly as written (keep numbers, dates and names). Reply with JSON only, in this shape: [{"page":1,"text":"..."}]. A page with no text has "text":"".' }] }] }),
      signal: AbortSignal.timeout(Math.max(cfg.ai.timeoutMs, 60_000)),
    });
  } catch { throw new HttpError(502, 'AI_UNREACHABLE', 'Platform AI could not be reached. The document is kept; press Read again later.'); }
  if (!res.ok) throw new HttpError(502, 'AI_REFUSED', `Platform AI did not read the file (status ${res.status}). The document is kept; press Read again later.`);
  let pages: string[];
  try {
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const txt = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)) as { page: number; text: string }[];
    const n = Math.max(d.pages, ...arr.map((p) => Number(p.page) || 0));
    pages = Array.from({ length: n }, (_, i) => String(arr.find((p) => Number(p.page) === i + 1)?.text ?? ''));
  } catch { throw new HttpError(502, 'AI_UNREADABLE', 'Platform AI answered in a way that could not be read. Press Read again.'); }
  tx(() => {
    indexPages(id, pages, 'ai');
    run("UPDATE docs SET pages = ?, reading = 'ai' WHERE id = ?", pages.length, id);
    refile(ownerId, { id, name: d.name, mime: d.mime, filed_by: d.filed_by }, pages);
  });
  audit(actor, 'doc.read_ai', 'doc', id, { pages: pages.length }, ownerId);
  return toOut(docRow(ownerId, id));
}

/** The documents whose pages still wait for Platform AI. */
export const waitingCount = (ownerId: string): number => one<{ n: number }>("SELECT COUNT(*) n FROM docs WHERE owner_id = ? AND deleted_at IS NULL AND reading = 'waiting'", ownerId)!.n;

/** A question that asks for a document ("find the ground lease", "where is the fire NOC", "show me the insurance policy"). */
export function isDocQuestion(q: string): boolean {
  const noun = /\b(documents?|docs?|files?|uploads?|uploaded|pdfs?|scans?|scanned|agreements?|contracts?|lease|policy|policies|licen[cs]es?|certificates?|permits?|noc|letters?|invoices?|receipts?|statements?|papers?|photos? of)\b/i;
  const ask = /\b(find|where('s| is| are| did)?|show( me)?|open|look ?up|search|which (document|file|page)|do (we|i) have|get me|pull up)\b/i;
  return (noun.test(q) && ask.test(q)) || /\bin (the|my|our) (documents|uploads|files)\b/i.test(q);
}
