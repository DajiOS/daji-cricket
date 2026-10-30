import { ROLE_PRESETS, type StaffPermission } from '@daji/shared';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { audit, listAudit, type Actor } from './audit.ts';
import { conflict, forbidden, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator } from './input.ts';
import { permissionList, type UserRow } from './auth.ts';

// Approval workflows the owner builds: for each kind of thing that needs a decision, the steps it goes through, who signs
// each step (the owner, a role, a named person, or anyone who looks after that area), amounts that add a step, and where a
// send-back goes. A submission snapshots the steps that apply to its amount, so changing the rules never moves anything
// already waiting. Every sign-off and send-back is written to the audit log against the item itself.

registerSchema('approval-flows-1', `
CREATE TABLE approval_flows (
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (owner_id, kind)
);

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  submitted_by TEXT,
  submitted_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','sent_back','withdrawn')),
  steps TEXT NOT NULL,
  rules TEXT NOT NULL,
  at_step INTEGER NOT NULL,
  round INTEGER NOT NULL,
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_approval_requests_owner ON approval_requests(owner_id, status, kind);
CREATE INDEX ix_approval_requests_entity ON approval_requests(kind, entity_id);
`);

export const APPROVAL_KINDS = ['bill', 'payroll', 'refund', 'discount', 'waiver', 'expense', 'cash', 'purchase_order'] as const;
export type ApprovalKind = typeof APPROVAL_KINDS[number];

/** What each kind is called, the right that looks after it, the audit entity its trail is written against, and what
 * happens when no step applies. */
export const KIND_INFO: Record<ApprovalKind, { name: string; one: string; perm: StaffPermission; role?: string; area: string; can: string; entity: string; selfNo: string; none: string }> = {
  bill: { name: 'Bills', one: 'bill', perm: 'manage_accounting', area: 'Anyone who can manage the books', can: 'manage the books', entity: 'acct_bill', selfNo: 'You entered this bill, so someone else has to approve it', none: 'Approved as soon as it is sent, with no sign-off.' },
  payroll: { name: 'Staff pay', one: 'pay run', perm: 'manage_accounting', area: 'Anyone who can manage the books', can: 'manage the books', entity: 'payroll_runs', selfNo: 'You sent this pay run, so someone else has to approve it', none: 'The owner locks the month with no extra sign-off.' },
  refund: { name: 'Refunds', one: 'refund', perm: 'record_payments', role: 'general_manager', area: 'The general manager', can: 'act as general manager', entity: 'refund', selfNo: 'You started this refund, so someone else has to approve it', none: 'Goes straight to the super admin to authorise, with no sign-off at the ground.' },
  discount: { name: 'Discounts', one: 'discount', perm: 'manage_bookings', role: 'general_manager', area: 'The general manager', can: 'act as general manager', entity: 'money_ask', selfNo: 'You asked for this discount, so someone else has to approve it', none: 'Given as soon as it is asked for, with no sign-off.' },
  waiver: { name: 'Fee waivers', one: 'fee waiver', perm: 'manage_academy', area: 'Anyone who runs the academy', can: 'run the academy', entity: 'money_ask', selfNo: 'You asked for this waiver, so someone else has to approve it', none: 'Given as soon as it is asked for, with no sign-off.' },
  purchase_order: { name: 'Purchase orders', one: 'purchase order', perm: 'manage_accounting', area: 'Anyone who can manage the books', can: 'manage the books', entity: 'construction_po', selfNo: 'You raised this order, so someone else has to approve it', none: 'Approved as soon as it is sent, with no sign-off.' },
  cash: { name: 'Cash spends', one: 'cash spend', perm: 'manage_accounting', area: 'Anyone who can manage the books', can: 'manage the books', entity: 'cash_entry', selfNo: 'You spent this cash, so someone else has to approve it', none: 'Confirmed as soon as it is entered, with no sign-off.' },
  expense: { name: 'Expenses', one: 'expense', perm: 'manage_accounting', area: 'Anyone who can manage the books', can: 'manage the books', entity: 'money_ask', selfNo: 'You entered this expense, so someone else has to approve it', none: 'Recorded in the books as soon as it is entered, with no sign-off.' },
};

export type Who = { type: 'owner' } | { type: 'anyone' } | { type: 'role'; value: string } | { type: 'person'; value: string };
export interface FlowStep { id: string; label: string; who: Who; overPaise: number | null }
export interface Flow { steps: FlowStep[]; notSelf: boolean; distinct: boolean; sendBack: 'start' | 'previous' }
interface Snap extends FlowStep { signedBy: string | null; signedAt: number | null; note: string | null }

/** Out of the box: a bill needs one sign-off from someone else who manages the books; a refund needs the owner or the general
 * manager before the super admin authorises it; a discount or fee waiver of ₹1,000 or more needs the owner; an expense of
 * ₹5,000 or more needs a second person; a cash spend from money someone holds needs the owner, whatever the amount (Sunny: everything
 * needs his approval from ₹0); a construction purchase or work order needs the owner, from ₹0 as well (a team member who raised it can
 * never sign it; the owner, who signs every step, may sign an order they raised themselves, and that is recorded); a pay run needs no extra sign-off. */
export function defaultFlow(kind: ApprovalKind): Flow {
  if (kind === 'bill') return { steps: [{ id: 'approve', label: 'Approve the bill', who: { type: 'anyone' }, overPaise: null }], notSelf: true, distinct: false, sendBack: 'start' };
  if (kind === 'discount' || kind === 'waiver') return { steps: [{ id: 'owner', label: 'Owner sign-off', who: { type: 'owner' }, overPaise: 1000_00 }], notSelf: false, distinct: false, sendBack: 'start' };
  if (kind === 'refund') return { steps: [{ id: 'approve', label: 'Owner or GM approves', who: { type: 'anyone' }, overPaise: null }], notSelf: false, distinct: false, sendBack: 'start' };
  if (kind === 'purchase_order') return { steps: [{ id: 'owner', label: 'Owner sign-off', who: { type: 'owner' }, overPaise: null }], notSelf: true, distinct: false, sendBack: 'start' };
  if (kind === 'cash') return { steps: [{ id: 'owner', label: 'Owner sign-off', who: { type: 'owner' }, overPaise: null }], notSelf: true, distinct: false, sendBack: 'start' };
  if (kind === 'expense') return { steps: [{ id: 'second', label: 'Second person checks', who: { type: 'anyone' }, overPaise: 5000_00 }], notSelf: true, distinct: false, sendBack: 'start' };
  return { steps: [], notSelf: false, distinct: false, sendBack: 'start' };
}

export function isKind(k: string): k is ApprovalKind { return (APPROVAL_KINDS as readonly string[]).includes(k); }
const kindOr404 = (k: string): ApprovalKind => { if (!isKind(k)) throw notFound('There is no approval of that kind'); return k; };

export function getFlow(ownerId: string, kind: ApprovalKind): { flow: Flow; custom: boolean; updatedAt: number | null; updatedBy: string | null } {
  const r = one<{ config: string; updated_at: number; updated_by: string | null }>('SELECT config, updated_at, updated_by FROM approval_flows WHERE owner_id = ? AND kind = ?', ownerId, kind);
  if (!r) return { flow: defaultFlow(kind), custom: false, updatedAt: null, updatedBy: null };
  return { flow: JSON.parse(r.config) as Flow, custom: true, updatedAt: r.updated_at, updatedBy: r.updated_by };
}

const name = (id: string | null): string | null => (id ? one<{ name: string }>('SELECT name FROM users WHERE id = ?', id)?.name ?? null : null);
const team = (ownerId: string) => many<UserRow>("SELECT * FROM users WHERE role = 'staff' AND owner_id = ? AND active = 1 ORDER BY name", ownerId);
const perms = (u: UserRow): string[] => (u.role === 'staff' ? permissionList(u.permissions) : []);
/** Whether a team member looks after this kind: its right, and for refunds and discounts every right of the General manager
 * role too (the owner decided only the owner and the general manager deal with those). */
const holds = (mine: string[], kind: ApprovalKind): boolean => {
  const k = KIND_INFO[kind];
  return mine.includes(k.perm) && (!k.role || (ROLE_PRESETS[k.role]?.permissions ?? []).every((x) => mine.includes(x)));
};
export const looksAfter = (u: UserRow, kind: ApprovalKind): boolean => u.role === 'owner' || u.role === 'super_admin' || holds(perms(u), kind);

/** The signer in plain words, e.g. "The owner", "Someone with the Accountant role", "Priya Shah". */
export function whoWords(kind: ApprovalKind, w: Who): string {
  if (w.type === 'owner') return 'The owner';
  if (w.type === 'anyone') return KIND_INFO[kind].area;
  if (w.type === 'role') return `Someone with the ${ROLE_PRESETS[w.value]?.title ?? w.value} role`;
  return name(w.value) ?? 'A person no longer on the team';
}

export function validateFlow(ownerId: string, kind: ApprovalKind, raw: unknown): Flow {
  const v = new Validator(raw);
  const notSelf = v.bool('notSelf') ?? false;
  const distinct = v.bool('distinct') ?? false;
  const sendBack = v.oneOf('sendBack', ['start', 'previous'] as const) ?? 'start';
  const list = (raw as Record<string, unknown>).steps;
  const steps: FlowStep[] = [];
  if (!Array.isArray(list)) v.fail('steps', 'Send a list of steps');
  else if (list.length > 6) v.fail('steps', 'Six steps at most');
  else {
    const people = new Set(team(ownerId).filter((u) => holds(perms(u), kind)).map((u) => u.id));
    list.forEach((s, i) => {
      const f = `steps[${i}]`;
      if (!s || typeof s !== 'object') { v.fail(f, 'Each step is an object'); return; }
      const o = s as Record<string, unknown>;
      const label = typeof o.label === 'string' ? o.label.trim() : '';
      if (!label || label.length > 60) v.fail(`${f}.label`, 'Give the step a name of up to 60 letters');
      const w = (o.who && typeof o.who === 'object' ? o.who : {}) as Record<string, unknown>;
      let who: Who | null = null;
      if (w.type === 'owner' || w.type === 'anyone') who = { type: w.type };
      else if (w.type === 'role' && typeof w.value === 'string' && w.value in ROLE_PRESETS) who = { type: 'role', value: w.value };
      else if (w.type === 'person' && typeof w.value === 'string') {
        if (people.has(w.value)) who = { type: 'person', value: w.value };
        else v.fail(`${f}.who`, `That person is not on the team or cannot ${KIND_INFO[kind].can}`);
      } else v.fail(`${f}.who`, 'Pick who signs this step');
      let over: number | null = null;
      if (o.overPaise !== undefined && o.overPaise !== null) {
        if (typeof o.overPaise !== 'number' || !Number.isInteger(o.overPaise) || o.overPaise < 1 || o.overPaise > 100000000000) v.fail(`${f}.overPaise`, 'The amount is whole paise above zero');
        else over = o.overPaise;
      }
      if (who && label && label.length <= 60) steps.push({ id: typeof o.id === 'string' && /^[a-z0-9_-]{1,24}$/i.test(o.id) ? o.id : `s${i + 1}`, label, who, overPaise: over });
    });
    const ids = new Set<string>();
    for (const s of steps) { if (ids.has(s.id)) s.id = `${s.id}${steps.indexOf(s) + 1}`; ids.add(s.id); }
  }
  v.done();
  return { steps, notSelf, distinct, sendBack };
}

export function saveFlow(ownerId: string, actor: Actor, kindRaw: string, raw: unknown) {
  const kind = kindOr404(kindRaw);
  const flow = validateFlow(ownerId, kind, raw);
  const before = getFlow(ownerId, kind).flow;
  const t = now();
  run(`INSERT INTO approval_flows(owner_id, kind, config, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(owner_id, kind) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, ownerId, kind, JSON.stringify(flow), t, actor.id, t, actor.id);
  audit(actor, 'approvals.flow', 'approval_flow', kind, { before: describe(kind, before), after: describe(kind, flow) }, ownerId);
  return flowOut(ownerId, kind);
}

export function resetFlow(ownerId: string, actor: Actor, kindRaw: string) {
  const kind = kindOr404(kindRaw);
  const before = getFlow(ownerId, kind);
  if (before.custom) {
    run('DELETE FROM approval_flows WHERE owner_id = ? AND kind = ?', ownerId, kind);
    audit(actor, 'approvals.flow', 'approval_flow', kind, { before: describe(kind, before.flow), after: describe(kind, defaultFlow(kind)), reset: true }, ownerId);
  }
  return flowOut(ownerId, kind);
}

const rupees = (p: number) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** The whole flow as one or two sentences, for the builder's summary and the audit log. */
export function describe(kind: ApprovalKind, f: Flow): string {
  if (!f.steps.length) return KIND_INFO[kind].none;
  const steps = f.steps.map((s, i) => `${i + 1}. ${s.label} (${whoWords(kind, s.who)}${s.overPaise ? `, only for ${rupees(s.overPaise)} or more` : ''})`).join('; ');
  const extra = [f.notSelf ? 'the person who sent it in cannot sign it' : '', f.distinct ? 'each step needs a different person' : ''].filter(Boolean).join(' and ');
  return `${steps}.${extra ? ` ${extra[0]!.toUpperCase()}${extra.slice(1)}.` : ''} Sent back goes ${f.sendBack === 'previous' ? 'back one step' : 'to the person who sent it in'}.`;
}

/** The steps a submission of this amount goes through. */
export const stepsFor = (f: Flow, amountPaise: number): FlowStep[] => f.steps.filter((s) => s.overPaise === null || amountPaise >= s.overPaise);

export function flowOut(ownerId: string, kind: ApprovalKind) {
  const g = getFlow(ownerId, kind);
  return { kind, name: KIND_INFO[kind].name, flow: g.flow, custom: g.custom, summary: describe(kind, g.flow), updatedAt: g.updatedAt, updatedByName: name(g.updatedBy) };
}

/** Everything the builder needs: each kind's rules, the people and roles who can sign, and the latest rule changes. */
export function builderData(ownerId: string) {
  const people = team(ownerId).map((u) => ({ id: u.id, name: u.name, permissions: perms(u) }));
  const changes = listAudit({ ownerId, entity: 'approval_flow', limit: 20 }).items.map((e) => ({ id: e.id, at: e.at, kind: e.entityId, actorName: name(e.actorId), detail: e.detail }));
  return {
    kinds: APPROVAL_KINDS.map((k) => ({ ...flowOut(ownerId, k), perm: KIND_INFO[k].perm, area: KIND_INFO[k].area, defaultSummary: describe(k, defaultFlow(k)) })),
    people, roles: Object.entries(ROLE_PRESETS).map(([key, p]) => ({ key, title: p.title, permissions: p.permissions })), changes,
  };
}

// ---- requests

interface ReqRow { id: string; owner_id: string; kind: ApprovalKind; entity_id: string; title: string; amount_paise: number; submitted_by: string | null; submitted_at: number; status: string; steps: string; rules: string; at_step: number; round: number; decided_at: number | null }
export interface Subject { title: string; amountPaise: number; submittedBy: string | null }

const pendingRow = (ownerId: string, kind: ApprovalKind, entityId: string) => one<ReqRow>("SELECT * FROM approval_requests WHERE owner_id = ? AND kind = ? AND entity_id = ? AND status = 'pending'", ownerId, kind, entityId);

/** Start the chain for a submission. Returns null when no step applies to it, so the caller approves it straight away. */
export function startRequest(ownerId: string, kind: ApprovalKind, entityId: string, s: Subject): ReqRow | null {
  const old = pendingRow(ownerId, kind, entityId);
  if (old) run("UPDATE approval_requests SET status = 'withdrawn', updated_at = ? WHERE id = ?", now(), old.id);
  const { flow } = getFlow(ownerId, kind);
  const steps = stepsFor(flow, s.amountPaise);
  if (!steps.length) return null;
  const round = (one<{ n: number }>('SELECT COUNT(*) n FROM approval_requests WHERE owner_id = ? AND kind = ? AND entity_id = ?', ownerId, kind, entityId)!.n) + 1;
  const id = newId('apr'), t = now();
  const snap: Snap[] = steps.map((x) => ({ ...x, signedBy: null, signedAt: null, note: null }));
  run(`INSERT INTO approval_requests(id, owner_id, kind, entity_id, title, amount_paise, submitted_by, submitted_at, status, steps, rules, at_step, round, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,'pending',?,?,0,?,?,?)`, id, ownerId, kind, entityId, s.title, s.amountPaise, s.submittedBy, t, JSON.stringify(snap),
    JSON.stringify({ notSelf: flow.notSelf, distinct: flow.distinct, sendBack: flow.sendBack }), round, t, t);
  return pendingRow(ownerId, kind, entityId)!;
}

/** The chain waiting on an item; one is started from today's rules for an item that was waiting before the rules existed. */
export function ensureRequest(ownerId: string, kind: ApprovalKind, entityId: string, s: Subject): ReqRow | null {
  return pendingRow(ownerId, kind, entityId) ?? startRequest(ownerId, kind, entityId, s);
}

export function withdrawRequest(ownerId: string, kind: ApprovalKind, entityId: string): void {
  run("UPDATE approval_requests SET status = 'withdrawn', updated_at = ? WHERE owner_id = ? AND kind = ? AND entity_id = ? AND status = 'pending'", now(), ownerId, kind, entityId);
}

const isBoss = (u: { role: string | null }) => u.role === 'owner' || u.role === 'super_admin';

/** Why this person cannot sign the step that is waiting, or null when they can. The owner can always sign. */
export function whyNot(r: ReqRow, u: UserRow | Actor & { permissions?: string }): string | null {
  if (r.status !== 'pending') return 'This is not waiting for a decision';
  const steps = JSON.parse(r.steps) as Snap[];
  const step = steps[r.at_step]!;
  const rules = JSON.parse(r.rules) as Pick<Flow, 'notSelf' | 'distinct'>;
  if (isBoss(u)) return null;
  const row = (u as UserRow).permissions !== undefined ? u as UserRow : one<UserRow>('SELECT * FROM users WHERE id = ?', u.id);
  if (!row || row.role !== 'staff' || row.owner_id !== r.owner_id) return 'Only the team can sign this';
  const mine = perms(row);
  if (!holds(mine, r.kind)) return KIND_INFO[r.kind].role ? 'Only the owner or the general manager can approve this' : 'You do not have the right to approve this';
  if (rules.notSelf && r.submitted_by && r.submitted_by === row.id) return KIND_INFO[r.kind].selfNo;
  if (rules.distinct && steps.slice(0, r.at_step).some((s) => s.signedBy === row.id)) return 'You signed an earlier step, so someone else signs this one';
  const w = step.who;
  if (w.type === 'owner') return 'This step is for the owner';
  if (w.type === 'role') { const p = ROLE_PRESETS[w.value]; if (!p || !p.permissions.every((x) => mine.includes(x))) return `This step is for someone with the ${p?.title ?? w.value} role`; }
  if (w.type === 'person' && w.value !== row.id) return `This step is for ${name(w.value) ?? 'someone else'}`;
  return null;
}

/** Sign the step that is waiting. `done` is true when that was the last step. */
export function signStep(r: ReqRow, actor: Actor, note: string | null): { done: boolean; step: Snap; index: number } {
  const why = whyNot(r, actor);
  if (why) throw forbidden(why);
  const steps = JSON.parse(r.steps) as Snap[];
  const i = r.at_step, t = now();
  steps[i] = { ...steps[i]!, signedBy: actor.id, signedAt: t, note };
  const done = i + 1 >= steps.length;
  run(`UPDATE approval_requests SET steps = ?, at_step = ?, status = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND at_step = ?`,
    JSON.stringify(steps), done ? i : i + 1, done ? 'approved' : 'pending', done ? t : null, t, r.id, i);
  if (!done) audit(actor, `${r.kind}.signoff`, KIND_INFO[r.kind].entity, r.entity_id, { step: i + 1, of: steps.length, label: steps[i]!.label, round: r.round, ...(note ? { note } : {}) }, r.owner_id);
  return { done, step: steps[i]!, index: i };
}

/** Send the item back. `toStart` is true when it goes back to the person who sent it in (the caller then reopens the item).
 * With `keepWaiting` (refunds, which have nobody to fix and resend them) going back to the start clears every signature and
 * the chain waits again from its first step. */
export function sendBack(r: ReqRow, actor: Actor, note: string, opts: { keepWaiting?: boolean } = {}): { toStart: boolean } {
  const why = whyNot(r, actor);
  if (why) throw forbidden(why);
  const steps = JSON.parse(r.steps) as Snap[];
  const rules = JSON.parse(r.rules) as Pick<Flow, 'sendBack'>;
  const t = now();
  if (rules.sendBack === 'previous' && r.at_step > 0) {
    const back = r.at_step - 1;
    steps[back] = { ...steps[back]!, signedBy: null, signedAt: null, note: null };
    run("UPDATE approval_requests SET steps = ?, at_step = ?, updated_at = ? WHERE id = ? AND status = 'pending'", JSON.stringify(steps), back, t, r.id);
    audit(actor, `${r.kind}.sendback`, KIND_INFO[r.kind].entity, r.entity_id, { from: r.at_step + 1, to: back + 1, label: steps[back]!.label, round: r.round, reason: note }, r.owner_id);
    return { toStart: false };
  }
  if (opts.keepWaiting) {
    const fresh = steps.map((x) => ({ ...x, signedBy: null, signedAt: null, note: null }));
    run("UPDATE approval_requests SET steps = ?, at_step = 0, updated_at = ? WHERE id = ? AND status = 'pending'", JSON.stringify(fresh), t, r.id);
    audit(actor, `${r.kind}.sendback`, KIND_INFO[r.kind].entity, r.entity_id, { from: r.at_step + 1, to: 1, label: fresh[0]!.label, round: r.round, reason: note }, r.owner_id);
    return { toStart: false };
  }
  run("UPDATE approval_requests SET status = 'sent_back', decided_at = ?, updated_at = ? WHERE id = ?", t, t, r.id);
  return { toStart: true };
}

export function requestOr404(ownerId: string, id: string): ReqRow {
  const r = one<ReqRow>('SELECT * FROM approval_requests WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!r) throw notFound('Approval not found');
  return r;
}
export const pendingFor = pendingRow;

/** What the Approvals board shows for one chain: its steps in words, where it is, whether this person can act, and its trail. */
export function requestOut(r: ReqRow, viewer: UserRow) {
  const steps = JSON.parse(r.steps) as Snap[];
  const rules = JSON.parse(r.rules) as Pick<Flow, 'notSelf' | 'distinct' | 'sendBack'>;
  const why = r.status === 'pending' ? whyNot(r, viewer) : 'This is not waiting for a decision';
  const trail = listAudit({ ownerId: r.owner_id, entity: KIND_INFO[r.kind].entity, entityId: r.entity_id, limit: 50 }).items
    .map((e) => ({ id: e.id, at: e.at, action: e.action.split('.')[1] ?? e.action, actorName: name(e.actorId), detail: e.detail })).reverse();
  return {
    id: r.id, kind: r.kind, entityId: r.entity_id, title: r.title, amountPaise: r.amount_paise, status: r.status, round: r.round,
    submittedBy: r.submitted_by, submittedByName: name(r.submitted_by), submittedAt: r.submitted_at, atStep: r.at_step,
    steps: steps.map((s, i) => ({ label: s.label, who: whoWords(r.kind, s.who), overPaise: s.overPaise, state: s.signedBy ? 'done' : i === r.at_step && r.status === 'pending' ? 'now' : 'later', signedByName: name(s.signedBy), signedAt: s.signedAt, note: s.note })),
    rule: [
      steps.length === 1 ? 'One sign-off.' : `${steps.length} sign-offs, in order.`,
      rules.notSelf ? 'The person who sent it in cannot sign it; the owner can sign any step.' : 'The owner can sign any step.',
      rules.distinct ? 'Each step needs a different person.' : '',
      rules.sendBack === 'previous' ? 'Send back returns it one step.' : r.kind === 'refund' ? 'Send back returns it to the first step; it keeps waiting.' : 'Send back returns it to the person who sent it in.',
    ].filter(Boolean).join(' '),
    canSign: why === null, whyNot: why, trail,
  };
}

/** Whether this person looks after any kind of approval (so may open the board). */
export const looksAfterAny = (u: UserRow): boolean => isBoss(u) || APPROVAL_KINDS.some((k) => holds(perms(u), k));

/** The chains waiting now, for the board: everything for the owner, and for a team member the ones in an area they look after. */
export function listOpen(ownerId: string, viewer: UserRow) {
  const mine = perms(viewer);
  return many<ReqRow>("SELECT * FROM approval_requests WHERE owner_id = ? AND status = 'pending' ORDER BY submitted_at", ownerId)
    .filter((r) => isBoss(viewer) || holds(mine, r.kind))
    .map((r) => requestOut(r, viewer));
}

export function needNote(raw: unknown): string {
  const v = new Validator(raw ?? {});
  const note = v.str('note', { required: true, min: 3, max: 500 });
  v.done();
  return note!;
}
export function optNote(raw: unknown): string | null {
  const v = new Validator(raw ?? {});
  const note = v.str('note', { max: 500 });
  v.done();
  return note ?? null;
}
export const assertPending = (r: ReqRow) => { if (r.status !== 'pending') throw conflict('NOT_WAITING', 'This is not waiting for a decision'); };
export type { ReqRow };
