import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startHarness, grounds, bookAndPay, dayFromNow, type Harness, type GroundLite } from './helpers.ts';
import { many, one, run } from '../src/db.ts';
import { readWithAi, isDocQuestion } from '../src/docs.ts';
import { loadConfig } from '../src/config.ts';

// Documents: every page of an upload is read and indexed, the document is filed in the folder its pages point to with the other likely
// folders offered, it is tied to the bookings, customers and bank accounts it mentions, and Ask AI finds it by what is on its pages.

let h: Harness; let g: GroundLite; let owner: string, owner2: string, cust: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!; owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer'); staff = await h.login('staff1');
});

const send = (path: string, body: Buffer | string, token = owner) => fetch(`${h.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body });
const upload = async (name: string, body: Buffer | string, token = owner) => { const r = await send(`/api/docs?filename=${encodeURIComponent(name)}`, body, token); return { status: r.status, body: await r.json() as any }; };

/** A small PDF with a text layer: one entry per page, each a list of printed lines. */
function pdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const kids: number[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let n = 4;
  for (const lines of pages) {
    const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c);
    const stream = `BT /F1 12 Tf 50 780 Td 16 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
    objs[n] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    objs[n + 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${n} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    kids.push(n + 1); n += 2;
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = Buffer.byteLength(out); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const folderId = async (name: string) => (await h.get('/api/docs/folders', owner)).body.items.find((f: any) => f.name === name).id as string;

test('every page of a PDF is read and indexed, and the document is filed where its pages point, with other folders offered', async () => {
  const lease = pdf([['LEAVE AND LICENSE AGREEMENT', 'This agreement is made at Pune between the parties'], ['Licensor: Arvindbhai Patel', 'Monthly rent Rs 45,000 for the cricket ground', 'IN WITNESS WHEREOF the parties have signed']]);
  const up = await upload('ground-lease.pdf', lease);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.pages, 2); assert.equal(up.body.reading, 'text');
  assert.equal(up.body.folder.name, 'Contracts & agreements', 'filed by what is on its pages');
  assert.equal(up.body.filedBy, 'auto');
  assert.ok(up.body.suggestions.length >= 2, 'other folders are offered beside it');
  assert.match(up.body.suggestions[0].reason, /agreement|lease/);
  assert.ok(up.body.suggestions.some((s: any) => s.name === 'Other'), 'Other is always an option');
  const page2 = (await h.get(`/api/docs/${up.body.id}`, owner)).body.pageTexts[1];
  assert.match(page2.text, /Arvindbhai Patel/);
  // search finds the page by a word that is only on page 2
  const hits = (await h.get('/api/docs/search?q=arvindbhai', owner)).body.items;
  assert.equal(hits.length, 1); assert.equal(hits[0].docId, up.body.id); assert.equal(hits[0].page, 2);
  assert.match(hits[0].snippet, /\[Arvindbhai\]/);
  // the folder counts reflect it
  assert.equal((await h.get('/api/docs/folders', owner)).body.items.find((f: any) => f.name === 'Contracts & agreements').count, 1);
});

test('a bank statement is filed under Bank statements, tied to the bank account it names, and can go into the books from there', async () => {
  const acct = (await h.post('/api/accounting/accounts', { kind: 'bank', name: 'HDFC current', last4: '4521', openingPaise: 0, openingDate: dayFromNow(-400) }, owner)).body.id;
  const statement = readFileSync(new URL('./fixtures/bank-statement.pdf', import.meta.url));
  const up = await upload('statement.pdf', statement);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.folder.name, 'Bank statements');
  const imp = await h.post(`/api/docs/${up.body.id}/import-statement`, { accountId: acct }, owner);
  assert.equal(imp.status, 201, JSON.stringify(imp.body));
  assert.ok(imp.body.rowsNew > 0, 'its rows are in the books');
  assert.ok((await h.get(`/api/docs/${up.body.id}`, owner)).body.links.some((l: any) => l.kind === 'bank_import'), 'the document points at the import');
  // an account named on the pages by its last 4 digits is linked
  const named = await upload('hdfc-oct.pdf', pdf([['HDFC BANK Statement of Account', 'Account No XXXXXXXX4521  IFSC HDFC0000123', 'Opening Balance 1,00,000.00']]));
  assert.deepEqual(named.body.links.filter((l: any) => l.kind === 'bank_account').map((l: any) => l.id), [acct]);
});

test('a document that mentions a booking shows with that booking and its customer', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(5), '07:00', 1);
  const ref = one<{ ref: string; customer_id: string }>('SELECT ref, customer_id FROM bookings WHERE id = ?', b.id)!;
  const up = await upload('team-list.pdf', pdf([[`Team list for booking ${ref.ref}`, 'Captain: R. Sharma', 'Squad of 11 players']]));
  assert.equal(up.status, 201);
  assert.equal(up.body.folder.name, 'Customers & bookings');
  assert.ok(up.body.links.some((l: any) => l.kind === 'booking' && l.id === b.id));
  assert.ok(up.body.links.some((l: any) => l.kind === 'customer' && l.id === ref.customer_id));
  const forBooking = (await h.get(`/api/docs?linkKind=booking&linkId=${b.id}`, owner)).body.items;
  assert.deepEqual(forBooking.map((d: any) => d.id), [up.body.id]);
});

test('moving a document is the person\'s choice from then on; a folder the owner makes is offered when the pages use its name', async () => {
  const up = await upload('notes.txt', 'Meeting with the ground committee about parking');
  assert.equal(up.body.folder.name, 'Other');
  const mine = await h.post('/api/docs/folders', { name: 'Ground committee' }, owner);
  assert.equal(mine.status, 201);
  assert.equal((await h.post('/api/docs/folders', { name: 'ground committee' }, owner)).status, 409, 'no two folders with one name');
  const moved = await h.patch(`/api/docs/${up.body.id}`, { folderId: mine.body.id }, owner);
  assert.equal(moved.status, 200); assert.equal(moved.body.folder.name, 'Ground committee'); assert.equal(moved.body.filedBy, 'person');
  const next = await upload('minutes.txt', 'Minutes of the ground committee meeting held on Sunday');
  assert.equal(next.body.folder.name, 'Ground committee', 'the new folder is picked by its own name');
  assert.match(next.body.suggestions[0].reason, /committee|ground/);
  assert.equal((await h.del(`/api/docs/folders/${mine.body.id}`, owner)).status, 409, 'a folder with documents in it stays');
  assert.equal((await h.del(`/api/docs/folders/${await folderId('Other')}`, owner)).status, 409, 'Other always stays');
});

test('a photo waits for Platform AI; once it is read, its words are searchable and it is filed again by what it says', async () => {
  const up = await upload('IMG_2041.png', PNG);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.reading, 'waiting');
  assert.equal(up.body.folder.name, 'Photos & scans');
  assert.ok(up.body.suggestions.some((s: any) => s.name === 'Bills & receipts'), 'a photo is often a receipt');
  const off = await h.post(`/api/docs/${up.body.id}/read`, {}, owner);
  assert.equal(off.status, 409); assert.equal(off.body.error.code, 'AI_NOT_SET_UP', 'without the connection it says where to set it up');
  assert.equal((await h.get('/api/docs/folders', owner)).body.waiting, 1);
  // with the Claude connection set up (a stand-in for Anthropic here), the page is read
  const cfg = loadConfig({ PUBLIC_URL: 'http://localhost:4000', LOG: 'off', ANTHROPIC_API_KEY: 'test-key', AI_MODE: 'auto', DATA_DIR: h.cfg.dataDir });
  let sent: any = null;
  const fake = (async (_url: string, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type: 'text', text: '[{"page":1,"text":"SHARMA HARDWARE Tax Invoice No 118  Grand Total Rs 2,360  Floodlight bulbs"}]' }] }), { status: 200 }); }) as typeof fetch;
  const ownerId = one<{ id: string }>("SELECT id FROM users WHERE email = 'owner1@daji.test'")!.id;
  const read = await readWithAi(cfg, ownerId, { id: ownerId, role: 'owner' }, up.body.id, fake);
  assert.equal(sent.messages[0].content[0].type, 'image', 'the photo itself is sent');
  assert.equal(read.reading, 'ai');
  assert.equal(read.folder!.name, 'Bills & receipts', 'filed again now its words are known');
  const hits = (await h.get('/api/docs/search?q=floodlight', owner)).body.items;
  assert.equal(hits[0].docId, up.body.id);
});

test('Ask AI finds a document by what is on its pages and gives the page to show', async () => {
  const fire = await upload('scan-0007.pdf', pdf([['PUNE MUNICIPAL CORPORATION', 'Fire Department'], ['FIRE NO OBJECTION CERTIFICATE', 'Valid until 31 March 2027', 'Premises: Daji Cricket Ground']]));
  assert.equal(fire.body.folder.name, 'Licences & compliance');
  assert.ok(isDocQuestion('where is the fire NOC'));
  assert.ok(!isDocQuestion('how much revenue this month'));
  const a = await h.post('/api/staff/ask', { question: 'where is the fire objection certificate' }, owner);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.intent, 'documents');
  assert.equal(a.body.documents[0].docId, fire.body.id);
  assert.equal(a.body.documents[0].page, 2, 'the page the words are on');
  assert.match(a.body.answer, /scan-0007\.pdf, page 2 of 2/);
  const none = await h.post('/api/staff/ask', { question: 'find the insurance policy' }, owner);
  assert.equal(none.body.intent, 'documents'); assert.deepEqual(none.body.documents, []);
  assert.match(none.body.answer, /No document mentions "insurance"/);
  // money questions still get money answers
  assert.notEqual((await h.post('/api/staff/ask', { question: 'revenue this month' }, owner)).body.intent, 'documents');
});

test('documents stay inside the business, and only the owner and the bookkeepers see them', async () => {
  const up = await upload('payslip-oct.pdf', pdf([['Pay slip for October', 'Employee: Ramesh', 'Net salary 18,000']]));
  assert.equal(up.body.folder.name, 'Staff & payroll');
  assert.equal((await h.get(`/api/docs/${up.body.id}`, owner2)).status, 404, 'another business');
  assert.deepEqual((await h.get('/api/docs/search?q=ramesh', owner2)).body.items, []);
  assert.equal((await h.get('/api/docs', staff)).status, 403, 'front desk staff');
  assert.equal((await h.get('/api/docs', cust)).status, 403, 'customers');
  assert.equal((await upload('x.pdf', 'hello', staff)).status, 403);
  const ask = await h.post('/api/staff/ask', { question: 'find the pay slip for Ramesh' }, staff);
  assert.notEqual(ask.body.intent, 'documents', 'Ask AI does not show front desk staff the documents');
  assert.equal((await upload('virus.exe', Buffer.from('MZ\x90\x00 not a document'))).status, 415);
  // the file comes back as it went up
  const file = await fetch(`${h.url}/api/docs/${up.body.id}/file`, { headers: { authorization: `Bearer ${owner}` } });
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'application/pdf');
  // removed: off every list and out of search, the record stays
  assert.equal((await h.del(`/api/docs/${up.body.id}`, owner)).status, 200);
  assert.deepEqual((await h.get('/api/docs', owner)).body.items, []);
  assert.deepEqual((await h.get('/api/docs/search?q=ramesh', owner)).body.items, []);
  assert.equal(many('SELECT 1 FROM docs').length, 1);
  run('SELECT 1');
});
