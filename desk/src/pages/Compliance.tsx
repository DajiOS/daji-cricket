import { useState } from 'react';
import { useApi, post, put, go, fmtDate, fmtDateTime, inr } from '../lib';
import { PageHead, Tabs, Table, Chip, Modal, Field, ErrorBox, Loading, useToast, useForm, type Tone } from '../ui';

type Tab = 'rules' | 'renewals' | 'updates' | 'changes' | 'gst' | 'terms';
const TABS: [Tab, string][] = [['rules', 'Rules and review dates'], ['renewals', 'Renewals'], ['updates', 'Law updates'], ['changes', 'Law-change log'], ['gst', 'GST invoices'], ['terms', 'Team terms']];

interface Item { code: string; title: string; authority: string; rule: string; currentValue: string; enforcedIn: string; reviewEveryDays: number; lastReviewedOn: string; nextReviewOn: string; status: 'ok' | 'soon' | 'due'; daysToReview: number }
interface Change { id: string; code: string; changedOn: string; summary: string; oldValue: string | null; newValue: string | null; source: string | null }
interface Alert { id: string; source: 'feed' | 'manual'; title: string; summary: string | null; url: string | null; publishedOn: string; codes: string[]; status: 'new' | 'reviewed' | 'not_relevant'; note: string | null; handledAt: number | null }
interface Feed { connected: boolean; sources: string[]; lastRun: { ranOn: string; ok: boolean; message: string; at: number } | null }
interface Reg { items: Item[]; changes: Change[]; checks: { ranOn: string; dueCount: number; due: string[] }[]; alerts: Alert[]; feed: Feed }
const TONE: Record<string, Tone> = { ok: 'good', soon: 'warn', due: 'bad' };
const LABEL: Record<string, string> = { ok: 'Up to date', soon: 'Review soon', due: 'Review overdue' };

/** The compliance register: each legal rule the software enforces, its review date, the law-change log and the team's accepted terms. */
export default function Compliance({ sub }: { sub: string }) {
  const first = sub.split('/')[0] as Tab;
  const tab: Tab = TABS.some(([k]) => k === first) ? first : 'rules';
  const [reg, err, reload] = useApi<Reg>('/api/compliance');
  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title="Compliance" lede="The Indian rules this software enforces, when each was last checked, and a record of every change in the law." />
      <Tabs<Tab> value={tab} onChange={(t) => go(`/compliance/${t}`)} items={TABS} label="Compliance sections" />
      <ErrorBox msg={err} />
      {tab === 'rules' && (reg ? <Rules reg={reg} reload={reload} /> : !err && <Loading />)}
      {tab === 'renewals' && (reg ? <Renewals reg={reg} reload={reload} /> : !err && <Loading />)}
      {tab === 'updates' && (reg ? <Updates reg={reg} reload={reload} /> : !err && <Loading />)}
      {tab === 'changes' && (reg ? <Changes reg={reg} reload={reload} /> : !err && <Loading />)}
      {tab === 'gst' && <Gst />}
      {tab === 'terms' && <Terms />}
    </div>
  );
}

function Rules({ reg, reload }: { reg: Reg; reload: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const due = reg.items.filter((i) => i.status === 'due').length;
  async function review(code: string) { try { await post(`/api/compliance/${code}/review`, {}); toast('Marked as reviewed'); reload(); } catch (e: any) { setErr(e.message); } }
  async function check() { try { const r = await post('/api/compliance/check', {}); toast(r.dueCount ? `${r.dueCount} rule${r.dueCount === 1 ? '' : 's'} need a review` : 'Everything is up to date'); reload(); } catch (e: any) { setErr(e.message); } }
  return (
    <div className="card">
      <div className="card-head">
        <h3>Rules {due > 0 && <Chip tone="bad">{due} overdue</Chip>}</h3>
        <button className="btn sm ghost" onClick={check}>Run the check now</button>
      </div>
      <div className="card-pad small muted">A check runs every day and flags any rule past its review date. Before you tick "Reviewed", look up the current rule on the official source and note any change in the log.{reg.checks[0] && ` Last check: ${fmtDate(reg.checks[0].ranOn)}.`}</div>
      {err && <div className="card-pad"><ErrorBox msg={err} /></div>}
      <Table rows={reg.items} rowKey={(i) => i.code} cols={[
        { head: 'Rule', cell: (i) => <><span className="strong">{i.title}</span><div className="small muted">{i.authority}</div><div className="small">{i.rule}</div></> },
        { head: 'Enforced as', cell: (i) => <><div>{i.currentValue}</div><div className="small muted">{i.enforcedIn}</div></> },
        { head: 'Last reviewed', cell: (i) => fmtDate(i.lastReviewedOn) },
        { head: 'Next review', cell: (i) => <><div>{fmtDate(i.nextReviewOn)}</div><Chip tone={TONE[i.status]!}>{LABEL[i.status]}</Chip></> },
        { head: '', cell: (i) => <button className="btn sm ghost" onClick={() => review(i.code)}>Reviewed</button> },
      ]} />
    </div>
  );
}

/** What has to be looked at again next: every rule by its next review date, soonest (or most overdue) first. */
function Renewals({ reg, reload }: { reg: Reg; reload: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const rows = [...reg.items].sort((a, b) => a.daysToReview - b.daysToReview);
  const within30 = rows.filter((i) => i.daysToReview <= 30).length;
  async function review(code: string) { try { await post(`/api/compliance/${code}/review`, {}); toast('Marked as reviewed'); reload(); } catch (e: any) { setErr(e.message); } }
  return (
    <div className="card">
      <div className="card-head"><h3>Renewals {within30 > 0 && <Chip tone="warn">{within30} in the next 30 days</Chip>}</h3></div>
      <div className="card-pad small muted">Each rule is checked again on its review date. Soonest first. Memberships that are ending are under Customers, Members &amp; plans, Expiring soon.</div>
      {err && <div className="card-pad"><ErrorBox msg={err} /></div>}
      <Table rows={rows} rowKey={(i) => i.code} empty="No rules on the register." cols={[
        { head: 'Due', cell: (i) => <><div>{fmtDate(i.nextReviewOn)}</div><div className="small muted">{i.daysToReview < 0 ? `${-i.daysToReview} days overdue` : i.daysToReview === 0 ? 'Today' : `In ${i.daysToReview} days`}</div></> },
        { head: 'Rule', cell: (i) => <><span className="strong">{i.title}</span><div className="small muted">{i.authority} · every {i.reviewEveryDays} days</div></> },
        { head: 'Status', cell: (i) => <Chip tone={TONE[i.status]!}>{LABEL[i.status]}</Chip> },
        { head: '', cell: (i) => <button className="btn sm ghost" onClick={() => review(i.code)}>Reviewed</button> },
      ]} />
    </div>
  );
}

const ALERT_LABEL: Record<Alert['status'], [string, Tone]> = { new: ['Waiting for a look', 'warn'], reviewed: ['Reviewed', 'good'], not_relevant: ['Not relevant', 'mute'] };

/** News of a change in the law, from the updates feed (Settings › Connections) or added by hand, until someone has looked at it. */
function Updates({ reg, reload }: { reg: Reg; reload: () => void }) {
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const waiting = reg.alerts.filter((a) => a.status === 'new').length;
  const name = (code: string) => reg.items.find((i) => i.code === code)?.title ?? code;
  async function handle(id: string, status: 'reviewed' | 'not_relevant') {
    setErr(null); setBusy(id);
    try { await post(`/api/compliance/alerts/${id}/handle`, { status }); toast(status === 'reviewed' ? 'Marked as reviewed' : 'Marked as not relevant'); reload(); } catch (e: any) { setErr(e.message); reload(); } finally { setBusy(''); }
  }
  async function fetchNow() {
    setErr(null); setBusy('feed');
    try { const r = await post('/api/compliance/feed/fetch', {}); toast(r.run?.ok ? r.run.message : 'The feed could not be read'); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }
  const f = reg.feed;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Law updates {waiting > 0 && <Chip tone="warn">{waiting} waiting</Chip>}</h3>
        <div className="row">
          {f.connected && <button className="btn sm ghost" disabled={busy === 'feed'} onClick={fetchNow}>Fetch now</button>}
          <button className="btn sm primary" onClick={() => setAdding(true)}>Add an update</button>
        </div>
      </div>
      <div className="card-pad small muted">
        {f.connected
          ? <>Read once a day from {f.sources.join(', ')}. {f.lastRun ? (f.lastRun.ok ? `Last read ${fmtDateTime(f.lastRun.at)}: ${f.lastRun.message}.` : '') : 'Not read yet.'}</>
          : <>No updates feed is connected, so add news of a change here by hand (for example from your CA). A feed can be connected in Settings › Connections, Law and policy updates.</>}
        {' '}When an update changes a rule, record it in the law-change log and mark the update reviewed.
      </div>
      {f.lastRun && !f.lastRun.ok && <div className="card-pad"><ErrorBox msg={`The feed could not be read on ${fmtDate(f.lastRun.ranOn)}. ${f.lastRun.message}`} /></div>}
      {err && <div className="card-pad"><ErrorBox msg={err} /></div>}
      <Table rows={reg.alerts} rowKey={(a) => a.id} empty="No law updates yet." cols={[
        { head: 'Date', cell: (a) => <><div>{fmtDate(a.publishedOn)}</div><div className="small muted">{a.source === 'feed' ? 'From the feed' : 'Added by hand'}</div></> },
        { head: 'Update', cell: (a) => <><span className="strong">{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : a.title}</span>{a.summary && <div className="small">{a.summary}</div>}{a.codes.length > 0 && <div className="small muted">About: {a.codes.map(name).join(', ')}</div>}{a.note && <div className="small muted">Note: {a.note}</div>}</> },
        { head: 'Status', cell: (a) => <Chip tone={ALERT_LABEL[a.status][1]}>{ALERT_LABEL[a.status][0]}</Chip> },
        { head: '', cell: (a) => a.status === 'new' ? <div className="row"><button className="btn sm ghost" disabled={busy === a.id} onClick={() => handle(a.id, 'reviewed')}>Reviewed</button><button className="btn sm ghost" disabled={busy === a.id} onClick={() => handle(a.id, 'not_relevant')}>Not relevant</button></div> : null },
      ]} />
      {adding && <AlertForm items={reg.items} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function AlertForm({ items, onClose, onSaved }: { items: Item[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ title: '', summary: '', url: '', publishedOn: '', code: '' });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setErr(null); setSaving(true);
    try { await post('/api/compliance/alerts', { title: f.v.title, summary: f.v.summary, url: f.v.url, publishedOn: f.v.publishedOn || undefined, codes: f.v.code ? [f.v.code] : [] }); toast('Update added'); onSaved(); } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }
  return (
    <Modal title="Add a law update" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="What is the news" full><input className="inp" {...f.bind('title')} placeholder="ESI wage ceiling raised" /></Field>
        <Field label="Details" full><input className="inp" {...f.bind('summary')} /></Field>
        <Field label="Link" full hint="The notification or circular, if you have it"><input className="inp" {...f.bind('url')} placeholder="https://" /></Field>
        <Field label="Date"><input className="inp" type="date" {...f.bind('publishedOn')} /></Field>
        <Field label="Rule it is about" hint="Leave empty to let the software match it"><select className="inp" {...f.bind('code')}><option value="">Match it for me</option>{items.map((i) => <option key={i.code} value={i.code}>{i.title}</option>)}</select></Field>
      </div>
      <ErrorBox msg={err} />
    </Modal>
  );
}

function Changes({ reg, reload }: { reg: Reg; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const name = (code: string) => reg.items.find((i) => i.code === code)?.title ?? code;
  return (
    <div className="card">
      <div className="card-head"><h3>Law-change log</h3><button className="btn sm primary" onClick={() => setOpen(true)}>Record a change</button></div>
      <Table rows={reg.changes} rowKey={(c) => c.id} empty="No changes recorded yet. When a limit or rate changes, record it here and update the figure in the software."
        cols={[
          { head: 'Date', cell: (c) => fmtDate(c.changedOn) },
          { head: 'Rule', cell: (c) => name(c.code) },
          { head: 'What changed', cell: (c) => <>{c.summary}{(c.oldValue || c.newValue) && <div className="small muted">{c.oldValue ?? '?'} to {c.newValue ?? '?'}</div>}{c.source && <div className="small muted">Source: {c.source}</div>}</> },
        ]} />
      {open && <ChangeForm items={reg.items} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </div>
  );
}

function ChangeForm({ items, onClose, onSaved }: { items: Item[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ code: items[0]?.code ?? '', summary: '', oldValue: '', newValue: '', source: '' });
  const [err, setErr] = useState<string | null>(null);
  async function save() { try { await post('/api/compliance/changes', f.v); toast('Change recorded'); onSaved(); } catch (e: any) { setErr(e.message); } }
  return (
    <Modal title="Record a change in the law" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Rule" full><select className="inp" {...f.bind('code')}>{items.map((i) => <option key={i.code} value={i.code}>{i.title}</option>)}</select></Field>
        <Field label="What changed" full><input className="inp" {...f.bind('summary')} placeholder="Cash limit for expenses raised" /></Field>
        <Field label="Old value"><input className="inp" {...f.bind('oldValue')} /></Field>
        <Field label="New value"><input className="inp" {...f.bind('newValue')} /></Field>
        <Field label="Source" full hint="Notification, circular or Finance Act reference"><input className="inp" {...f.bind('source')} /></Field>
      </div>
      <p className="hint">Recording a change also marks the rule as reviewed today. Remember to update the figure in the software (taxrules.ts or statutory.ts).</p>
      <ErrorBox msg={err} />
    </Modal>
  );
}

interface Profile { legalName: string | null; gstin: string | null; address: string | null; stateCode: string; prefix: string; sac: string }
interface Inv { id: string; number: string; kind: string; issuedOn: string; buyerName: string; totalPaise: number; cgstPaise: number; sgstPaise: number; sac: string }

function Gst() {
  const toast = useToast();
  const [p, perr, reloadP] = useApi<Profile>('/api/accounting/gst-profile');
  const [inv] = useApi<{ items: Inv[] }>('/api/accounting/invoices');
  if (perr) return <ErrorBox msg={perr} />;
  if (!p) return <Loading />;
  return <GstForm key={p.gstin ?? 'x'} p={p} inv={inv?.items ?? []} onSaved={() => { toast('Saved'); reloadP(); }} />;
}
function GstForm({ p, inv, onSaved }: { p: Profile; inv: Inv[]; onSaved: () => void }) {
  const f = useForm({ legalName: p.legalName ?? '', gstin: p.gstin ?? '', address: p.address ?? '', stateCode: p.stateCode, prefix: p.prefix, sac: p.sac });
  const [err, setErr] = useState<string | null>(null);
  async function save() { setErr(null); try { await put('/api/accounting/gst-profile', f.v); onSaved(); } catch (e: any) { setErr(e.message); } }
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h3>GST profile</h3><button className="btn sm primary" onClick={save}>Save</button></div>
        <div className="card-pad"><div className="form-grid">
          <Field label="Business name on invoices"><input className="inp" {...f.bind('legalName')} /></Field>
          <Field label="GSTIN" hint="Leave empty if you are not registered. You will then give receipts with no tax."><input className="inp" {...f.bind('gstin')} placeholder="24ABCDE1234F1Z5" /></Field>
          <Field label="Address" full><input className="inp" {...f.bind('address')} /></Field>
          <Field label="Invoice prefix" hint="Up to 4 letters or digits. Numbers look like DCG/26-27/000001 and never pass 16 characters."><input className="inp" {...f.bind('prefix')} /></Field>
          <Field label="SAC code" hint="Ask your accountant to confirm the code for ground hire"><input className="inp" {...f.bind('sac')} /></Field>
          <Field label="State code" hint="24 is Gujarat"><input className="inp" {...f.bind('stateCode')} /></Field>
        </div><ErrorBox msg={err} /></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Invoices issued</h3></div>
        <Table rows={inv} rowKey={(i) => i.id} empty="No invoices yet. One is made the first time a confirmed, paid booking's invoice is opened."
          cols={[
            { head: 'Number', cell: (i) => <span className="strong">{i.number}</span> },
            { head: 'Date', cell: (i) => fmtDate(i.issuedOn) },
            { head: 'Customer', cell: (i) => i.buyerName },
            { head: 'Type', cell: (i) => i.kind === 'tax_invoice' ? 'Tax invoice' : 'Receipt, no GST' },
            { head: 'SAC', cell: (i) => i.sac },
            { head: 'CGST + SGST', num: true, cell: (i) => inr(i.cgstPaise + i.sgstPaise) },
            { head: 'Total', num: true, cell: (i) => inr(i.totalPaise) },
          ]} />
      </div>
    </div>
  );
}

function Terms() {
  const [d, err] = useApi<{ version: number; sha256: string; items: { userId: string; name: string; acceptedAt: number | null; ip: string | null; sha256: string | null }[] }>('/api/legal/staff-terms/report');
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <Loading />;
  const waiting = d.items.filter((i) => !i.acceptedAt).length;
  return (
    <div className="card">
      <div className="card-head"><h3>Team terms, version {d.version}</h3>{waiting > 0 ? <Chip tone="warn">{waiting} yet to accept</Chip> : <Chip tone="good">Everyone has accepted</Chip>}</div>
      <div className="card-pad small muted">Each acceptance keeps a fingerprint (SHA-256) of the exact wording, the time and the IP address. Fingerprint of this version: <code>{d.sha256.slice(0, 16)}…</code></div>
      <Table rows={d.items} rowKey={(i) => i.userId} empty="You have no team members yet." cols={[
        { head: 'Team member', cell: (i) => <span className="strong">{i.name}</span> },
        { head: 'Accepted', cell: (i) => i.acceptedAt ? fmtDateTime(i.acceptedAt) : <Chip tone="warn">Not yet</Chip> },
        { head: 'IP address', cell: (i) => i.ip ?? '-' },
        { head: 'Wording fingerprint', cell: (i) => i.sha256 ? <code>{i.sha256.slice(0, 12)}…</code> : '-' },
      ]} />
    </div>
  );
}
