// The owner's combined view (combined.ts, redesign step 6). Sunny's sign-in opens Daji Cricket Ground (his own), Sunny's
// Portfolio (marked "Mine", with House, Office and the restricted Personal branch) and a business he only supports. The view
// shows the "Mine" businesses side by side, read-only, with every line labelled and linked; a supported business, another
// owner's data, a team member and a customer get nothing. Cash handed to a wallet shows once, as a movement, not as spending.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';
import { readers } from '../src/combined.ts';
import { profitAndLoss } from '../src/accounting/statements.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SUP_PASSWORD = 'Supervisor-Combined-2026!';
interface W { sunny: string; groundId: string; spId: string; supportId: string; sup: string; supId: string; house: string; office: string; personal: string; houseProject: string; other: string }
let w: W;
const inBiz = (biz: string) => <T = any>(method: string, path: string, token: string, body?: unknown) => h.call<T>(method, path, { token, body, headers: { 'x-daji-business': biz } });
const view = (token: string, q = '') => h.call<any>('GET', `/api/me/combined${q ? `?${q}` : ''}`, { token });

const realBooks = readers.books;
beforeEach(async () => {
  h.reset();
  readers.books = realBooks;
  const sunny = await h.login('owner1');
  const me = (await h.call<any>('GET', '/api/me/portfolio', { token: sunny })).body.items;
  const b = await h.post('/api/me/portfolio', { businessName: "Sunny's Portfolio", ownerName: 'Sunny Patel', phone: '9876500011', email: 'portfolio@daji.test' }, sunny);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const s2 = await h.post('/api/me/portfolio', { businessName: 'Friendly Ground', ownerName: 'A Friend', phone: '9876500012', email: 'friend@daji.test' }, sunny);
  assert.equal(s2.status, 201, JSON.stringify(s2.body));
  w = { sunny, groundId: me[0].id, spId: b.body.id, supportId: s2.body.id } as W;
  assert.equal((await h.call('PATCH', `/api/me/portfolio/${w.spId}`, { token: sunny, body: { relation: 'mine' } })).status, 200);
  const sp = inBiz(w.spId);
  w.house = (await sp('POST', '/api/areas', sunny, { name: 'House' })).body.id;
  w.office = (await sp('POST', '/api/areas', sunny, { name: 'Office' })).body.id;
  w.personal = (await sp('POST', '/api/areas', sunny, { name: 'Personal', restricted: true })).body.id;
  w.houseProject = (await sp('POST', '/api/projects', sunny, { name: 'House interior', areaId: w.house })).body.id;
  // the supervisor works at the ground and is added to Sunny's Portfolio
  const s = await h.post('/api/staff/team', { firstName: 'Ramesh', lastName: 'Supervisor', email: 'supervisor@daji.test', password: SUP_PASSWORD, permissions: ['manage_tasks'] }, sunny);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  w.supId = s.body.id;
  assert.equal((await sp('POST', '/api/staff/team-memberships', sunny, { email: 'supervisor@daji.test', permissions: ['manage_tasks'] })).status, 201);
  w.sup = (await h.post('/api/auth/login', { email: 'supervisor@daji.test', password: SUP_PASSWORD })).body.token;
  w.other = await h.login('owner2');
});

/** Sunny hands the supervisor ₹10,000; he spends ₹1,500 on the house project (signed) and ₹400 in the Office (waiting). */
async function someActivity() {
  const sp = inBiz(w.spId);
  assert.equal((await sp('POST', '/api/cash/advances', w.sunny, { holderId: w.supId, amountPaise: 10_000_00, description: 'Cash for the week' })).status, 201);
  const e1 = await sp('POST', '/api/cash/expenses', w.sup, { amountPaise: 1_500_00, description: 'Cement bags', payee: 'Shree Hardware', projectId: w.houseProject });
  assert.equal(e1.status, 201, JSON.stringify(e1.body));
  const req = (await sp('GET', '/api/accounting/approvals/requests', w.sunny)).body.items.find((r: any) => r.entityId === e1.body.id);
  assert.equal((await sp('POST', `/api/accounting/approvals/requests/${req.id}/approve`, w.sunny, {})).status, 200);
  const e2 = await sp('POST', '/api/cash/expenses', w.sup, { amountPaise: 400_00, description: 'Printer paper', areaId: w.office });
  assert.equal(e2.status, 201, JSON.stringify(e2.body));
  // jobs: one in the house project for the supervisor, one at the ground, one in Personal (only Sunny sees that branch)
  const t1 = await sp('POST', '/api/tasks', w.sunny, { title: 'Fix the kitchen tiles', projectId: w.houseProject, assignedTo: w.supId, dueDate: '2020-01-01', photosRequired: 0 });
  assert.equal(t1.status, 201, JSON.stringify(t1.body));
  const pp = (await sp('POST', '/api/projects', w.sunny, { name: 'Family trip', areaId: w.personal })).body.id;
  assert.equal((await sp('POST', '/api/tasks', w.sunny, { title: 'Plan the family dinner', projectId: pp, photosRequired: 0 })).status, 201);
  const g = await h.call<any>('POST', '/api/tasks', { token: w.sunny, body: { title: 'Roll the pitch', photosRequired: 0 } });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.equal((await h.call('POST', `/api/tasks/${g.body.id}/complete`, { token: w.sunny, body: {} })).status, 200);
  return { e1: e1.body.id, e2: e2.body.id, t1: t1.body.id, personalProject: pp };
}

test('Sunny sees his "Mine" businesses side by side; a business he only supports is left out, and nothing is changed', async () => {
  const ids = await someActivity();
  const before = many('SELECT COUNT(*) n FROM cash_entries')[0];
  const r = await view(w.sunny);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = r.body;
  assert.equal(v.readOnly, true);
  assert.match(v.label, /combined view/i);
  assert.deepEqual(v.businesses.map((b: any) => b.id), [w.groundId, w.spId]);
  assert.equal(v.options.supported, 1);
  assert.ok(!JSON.stringify(v).includes('Friendly Ground'), 'a supported business never appears');
  assert.ok(v.notes.some((n: string) => /support/.test(n)));

  const sp = v.businesses.find((b: any) => b.id === w.spId);
  assert.equal(sp.status, 'ok');
  // ₹10,000 handed out is a movement, shown once; spending is only the ₹1,500 signed and the ₹400 waiting
  assert.deepEqual([sp.cash.handedOutPaise, sp.cash.spentConfirmedPaise, sp.cash.spentWaitingPaise], [10_000_00, 1_500_00, 400_00]);
  assert.equal(sp.cash.wallets[0].expectedPaise, 10_000_00 - 1_500_00 - 400_00);
  assert.equal(sp.approvalsWaiting.count, 1);
  // the books are each business's own, read with the same function as its Reports tab
  for (const b of v.businesses) {
    const p = profitAndLoss(b.id, { from: v.filters.from, to: v.filters.to });
    assert.deepEqual([b.books.revenuePaise, b.books.expensesPaise], [p.revenue.totalPaise, p.expenses.totalPaise]);
  }
  const t = v.totals[0];
  assert.equal(t.currency, 'INR');
  assert.equal(t.businesses, 2);
  assert.deepEqual(t.leftOut, []);
  assert.equal(t.books.revenuePaise, v.businesses.reduce((n: number, b: any) => n + b.books.revenuePaise, 0));
  assert.deepEqual([t.handedOutPaise, t.spentConfirmedPaise, t.spentWaitingPaise], [10_000_00, 1_500_00, 400_00]);
  assert.deepEqual([t.openTasks, t.overdueTasks, t.doneTasks], [2, 1, 1]);

  // by branch: House holds the project's spend (through its project), Office the waiting one, Personal its job (Sunny sees it)
  const row = (name: string) => v.byArea.find((a: any) => a.businessId === w.spId && a.areaName === name);
  assert.deepEqual([row('House').spentConfirmedPaise, row('House').openTasks, row('House').overdueTasks], [1_500_00, 1, 1]);
  assert.equal(row('Office').spentWaitingPaise, 400_00);
  assert.equal(row('Personal').restricted, true);
  assert.equal(row('Personal').openTasks, 1);
  assert.equal(v.byProject.find((p: any) => p.projectId === w.houseProject).spentConfirmedPaise, 1_500_00);

  // every line is labelled with its business, branch and project, and links to the original record in its own business
  const l = v.lines.find((x: any) => x.id === ids.e1);
  assert.deepEqual([l.businessName, l.areaName, l.projectName, l.personName, l.kind], ["Sunny's Portfolio", 'House', 'House interior', 'Ramesh Supervisor', 'spend']);
  assert.deepEqual(l.open, { businessId: w.spId, page: 'cash', id: ids.e1, holderId: w.supId });
  const tl = v.lines.find((x: any) => x.id === ids.t1);
  assert.deepEqual(tl.open, { businessId: w.spId, page: 'tasks', id: ids.t1 });

  // read-only: no record was written by looking, and only the look itself is in the audit trail, under Sunny's name
  assert.deepEqual(many('SELECT COUNT(*) n FROM cash_entries')[0], before);
  const a = many<{ actor_id: string }>("SELECT actor_id FROM audit_log WHERE action = 'combined.view'");
  assert.ok(a.length >= 1 && a.every((x) => x.actor_id === w.groundId), JSON.stringify(a));
});

test('filters by business, branch, project, person and dates; the books say "not split" rather than showing a whole business under a branch', async () => {
  const ids = await someActivity();
  let v = (await view(w.sunny, `business=${w.spId}`)).body;
  assert.deepEqual(v.businesses.map((b: any) => b.id), [w.spId]);
  assert.ok(v.businesses[0].books.status === 'ok');

  v = (await view(w.sunny, `area=${w.house}`)).body;
  assert.equal(v.filters.businessId, w.spId, 'a branch fixes its business');
  assert.equal(v.businesses[0].books.status, 'not_split');
  assert.equal(v.businesses[0].approvalsWaiting.status, 'not_split');
  assert.equal(v.totals[0].books, null);
  assert.match(v.totals[0].booksNote, /per business/);
  assert.deepEqual([v.businesses[0].cash.spentConfirmedPaise, v.businesses[0].cash.spentWaitingPaise, v.businesses[0].cash.handedOutPaise], [1_500_00, 0, 0]);
  assert.equal(v.businesses[0].cash.wallets, null, 'a wallet is not kept per branch');
  assert.ok(v.lines.every((l: any) => l.areaName === 'House'));
  assert.ok(!v.lines.some((l: any) => l.id === ids.e2));

  v = (await view(w.sunny, `project=${w.houseProject}`)).body;
  assert.deepEqual(v.byArea.map((a: any) => a.areaName), ['House']);
  assert.deepEqual(v.byProject.map((p: any) => p.projectName), ['House interior']);

  v = (await view(w.sunny, `person=${w.supId}`)).body;
  assert.deepEqual(v.businesses.map((b: any) => b.id).sort(), [w.groundId, w.spId].sort(), 'he works in both');
  assert.ok(v.lines.filter((l: any) => l.kind === 'task').every((l: any) => l.personName === 'Ramesh Supervisor'));
  assert.equal(v.totals[0].openTasks, 1);

  // dates: a period before anything happened has no spends, and still shows the jobs open today
  v = (await view(w.sunny, 'from=2019-01-01&to=2019-01-31')).body;
  assert.equal(v.totals[0].spentConfirmedPaise, 0);
  assert.equal(v.totals[0].openTasks, 2);

  // bad input
  assert.equal((await view(w.sunny, 'from=2026-13-01')).status, 400);
  assert.equal((await view(w.sunny, 'from=2026-10-10&to=2026-10-01')).status, 400);
  assert.equal((await view(w.sunny, 'from=2019-01-01&to=2026-10-01')).status, 400);
});

test('nothing outside his "Mine" businesses can be reached by changing an id; other people get no combined view', async () => {
  await someActivity();
  // the supported business, another owner's business and their branch: all 404, never named
  const otherArea = (await h.call<any>('POST', '/api/areas', { token: w.other, body: { name: 'Their branch' } })).body.id;
  for (const q of [`business=${w.supportId}`, `business=${w.other}`, `area=${otherArea}`, 'project=prj_nope', 'person=usr_nope', `area=${w.house}&business=${w.groundId}`]) {
    const r = await view(w.sunny, q);
    assert.equal(r.status, 404, `${q}: ${JSON.stringify(r.body)}`);
    assert.ok(!JSON.stringify(r.body).includes('Their branch'));
  }
  // the other owner sees only their own business, none of Sunny's
  const o = (await view(w.other)).body;
  assert.ok(!o.businesses.some((b: any) => b.id === w.spId || b.id === w.groundId));
  assert.ok(!JSON.stringify(o).includes('House'));
  assert.equal((await view(w.other, `business=${w.spId}`)).status, 404);
  // a team member (even one working in both businesses) and a customer have no combined view
  assert.equal((await view(w.sup)).status, 403);
  const cust = await h.login('customer');
  assert.equal((await view(cust)).status, 403);
  // switched into Sunny's Portfolio, the view is still about Sunny, the person signed in
  const sw = await h.call<any>('GET', '/api/me/combined', { token: w.sunny, headers: { 'x-daji-business': w.spId } });
  assert.equal(sw.status, 200);
  assert.deepEqual(sw.body.businesses.map((b: any) => b.id), [w.groundId, w.spId]);
  // marking the business "support" again takes it out at once
  assert.equal((await h.call('PATCH', `/api/me/portfolio/${w.spId}`, { token: w.sunny, body: { relation: 'support' } })).status, 200);
  assert.deepEqual((await view(w.sunny)).body.businesses.map((b: any) => b.id), [w.groundId]);
  assert.equal((await view(w.sunny, `area=${w.house}`)).status, 404);
});

test('a business that cannot be read says "not available", never ₹0, and the total names what it leaves out', async () => {
  await someActivity();
  readers.books = (ownerId, f) => { if (ownerId === w.spId) throw new Error('books unreadable'); return realBooks(ownerId, f); };
  const v = (await view(w.sunny)).body;
  const sp = v.businesses.find((b: any) => b.id === w.spId);
  assert.equal(sp.status, 'unavailable');
  assert.equal(sp.books.status, 'unavailable');
  assert.equal(sp.books.revenuePaise, undefined, 'no figure, not zero');
  assert.deepEqual(v.totals[0].leftOut, ["Sunny's Portfolio"]);
  assert.match(v.totals[0].booksNote, /Leaves out Sunny's Portfolio/);
  const g = v.businesses.find((b: any) => b.id === w.groundId);
  assert.equal(v.totals[0].books.revenuePaise, g.books.revenuePaise);
  assert.equal(v.totals[0].businesses, 1);
  // the cash and jobs of the business could still be read, and are still shown
  assert.equal(sp.cash.status, 'ok');
});

test('an owner with no other businesses sees just their own; empty is empty, not missing', async () => {
  const v = (await view(w.other)).body;
  assert.equal(v.businesses.length, 1);
  assert.equal(v.businesses[0].status, 'ok');
  assert.deepEqual([v.totals[0].spentConfirmedPaise, v.totals[0].openTasks], [0, 0]);
  assert.deepEqual(v.lines, []);
});

test('Ask AI answers about all my businesses for the owner, wherever he is working, and never for a team member', async () => {
  await someActivity();
  const ask = (token: string, question: string, biz?: string) => h.call<any>('POST', '/api/staff/ask', { token, body: { question }, headers: biz ? { 'x-daji-business': biz } : {} });
  for (const biz of [undefined, w.spId]) {
    const a = await ask(w.sunny, 'How are all my businesses doing?', biz);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.intent, 'combined');
    assert.match(a.body.answer, /2 businesses/);
    assert.ok(a.body.details.some((d: any) => d.label === "Sunny's Portfolio" && /cash spent ₹1,500/.test(d.text)), JSON.stringify(a.body.details));
    assert.ok(!JSON.stringify(a.body).includes('Friendly Ground'));
  }
  // a business that cannot be read is said to be not available, not ₹0
  readers.books = (ownerId, f) => { if (ownerId === w.spId) throw new Error('books unreadable'); return realBooks(ownerId, f); };
  const na = await ask(w.sunny, 'Show the combined view across my businesses');
  assert.ok(na.body.details.some((d: any) => d.label === "Sunny's Portfolio" && /not available/.test(d.text)), JSON.stringify(na.body.details));
  assert.ok(na.body.notes.some((n: string) => /left out of the total: Sunny's Portfolio/.test(n)));
  readers.books = realBooks;
  // the supervisor, in either business, is told it is the owner's view and hears nothing about the other business
  for (const biz of [undefined, w.spId]) {
    const s = await ask(w.sup, 'How are all my businesses doing?', biz);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.match(s.body.answer, /for the business owner/);
    assert.equal(s.body.details.length, 0);
  }
});
