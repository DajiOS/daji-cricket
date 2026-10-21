import { useEffect, useState } from 'react';
import { useApi, put, post, inr, toPaise, fmtDateTime, rupees } from '../../lib';
import { useSession } from '../../App';
import { ErrorBox, Loading, Confirm, useToast } from '../../ui';

// The approval rules builder: for each kind of approval the owner lists the steps, who signs each one, an amount that
// adds a step, and where a send-back goes. Written for people who are not technical: plain words, one screen, few clicks.
type Who = { type: 'owner' } | { type: 'anyone' } | { type: 'role'; value: string } | { type: 'person'; value: string };
interface Step { id: string; label: string; who: Who; overPaise: number | null }
interface Flow { steps: Step[]; notSelf: boolean; distinct: boolean; sendBack: 'start' | 'previous' }
interface KindData { kind: string; name: string; flow: Flow; custom: boolean; summary: string; defaultSummary: string; area: string; perm: string; updatedAt: number | null; updatedByName: string | null }
interface Data { kinds: KindData[]; people: { id: string; name: string; permissions: string[] }[]; roles: { key: string; title: string; permissions: string[] }[]; changes: { id: number; at: number; kind: string; actorName: string | null; detail: { after?: string; reset?: boolean } | null }[] }

const ABOUT: Record<string, string> = {
  bill: 'Vendor bills, from the moment someone sends one for approval until it can be paid.',
  payroll: 'The monthly staff pay run, before the month is locked and salaries can be paid.',
};
const whoKey = (w: Who) => (w.type === 'role' || w.type === 'person' ? `${w.type}:${w.value}` : w.type);
const whoFrom = (k: string): Who => (k.startsWith('role:') ? { type: 'role', value: k.slice(5) } : k.startsWith('person:') ? { type: 'person', value: k.slice(7) } : { type: k as 'owner' | 'anyone' });
let seq = 0;
const freshId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`.slice(0, 24);

export default function Rules() {
  const s = useSession(); const toast = useToast();
  const boss = s.me.role === 'owner' || s.me.role === 'super_admin';
  const [data, err, reload] = useApi<Data>(boss ? '/api/accounting/approvals/flows' : null, [s.ownerId]);
  const [kind, setKind] = useState('bill');
  const [draft, setDraft] = useState<Flow | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string | undefined>>({});
  const [tryAmt, setTryAmt] = useState('25000');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cur = data?.kinds.find((k) => k.kind === kind);

  useEffect(() => {
    if (!cur) return;
    setDraft(structuredClone(cur.flow));
    setAmounts(Object.fromEntries(cur.flow.steps.map((x) => [x.id, x.overPaise ? rupees(x.overPaise).replace(/\.00$/, '') : undefined])));
    setMsg(null);
  }, [cur]);

  if (!boss) return <div className="dap"><div className="dap-hd"><div><span className="eyebrow">Approvals</span><h1>Approval rules</h1></div></div><p className="muted">Only the owner can change who signs off. <a href="#/approvals">Back to Approvals</a></p></div>;
  if (!data || !cur || !draft) return <div className="dap"><ErrorBox msg={err} /><Loading h={300} /></div>;

  const people = data.people.filter((p) => p.permissions.includes(cur.perm));
  const dirty = JSON.stringify({ ...draft, steps: draft.steps.map((x) => ({ ...x, overPaise: amounts[x.id] !== undefined ? toPaise(amounts[x.id]!) : null })) }) !== JSON.stringify(cur.flow);
  const edit = (f: (d: Flow) => void) => setDraft((d) => { const n = structuredClone(d!); f(n); return n; });
  const setStep = (i: number, p: Partial<Step>) => edit((d) => { d.steps[i] = { ...d.steps[i]!, ...p }; });
  const move = (i: number, by: number) => edit((d) => { const [x] = d.steps.splice(i, 1); d.steps.splice(i + by, 0, x!); });
  const add = (st: Partial<Step> = {}) => edit((d) => { d.steps.push({ id: freshId(), label: d.steps.length ? 'Final sign-off' : 'Approve', who: { type: d.steps.length ? 'owner' : 'anyone' }, overPaise: null, ...st }); });
  const whoName = (w: Who) => w.type === 'owner' ? 'The owner' : w.type === 'anyone' ? cur.area : w.type === 'role' ? `Someone with the ${data.roles.find((r) => r.key === w.value)?.title ?? w.value} role` : data.people.find((p) => p.id === w.value)?.name ?? 'Someone no longer on the team';

  const tryPaise = toPaise(tryAmt) ?? 0;
  const applies = draft.steps.filter((x) => { const o = amounts[x.id] !== undefined ? toPaise(amounts[x.id]!) : null; return !o || tryPaise >= o; });

  async function save() {
    setMsg(null);
    const steps: Step[] = [];
    for (const [i, x] of draft!.steps.entries()) {
      const t = amounts[x.id]?.trim();
      const over = t !== undefined ? toPaise(t) : null;
      if (t !== undefined && (!over || over < 1)) { setMsg(`Step ${i + 1}: write the amount in rupees, like 25000.`); return; }
      if (!x.label.trim()) { setMsg(`Step ${i + 1} needs a name.`); return; }
      steps.push({ ...x, label: x.label.trim(), overPaise: over });
    }
    setBusy(true);
    try { await put(`/api/accounting/approvals/flows/${kind}`, { ...draft, steps }); toast('Saved. New submissions follow these rules.'); reload(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }
  async function reset() {
    setBusy(true);
    try { await post(`/api/accounting/approvals/flows/${kind}/reset`); toast('Back to the standard rules.'); reload(); } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  return (
    <div className="dap">
      <div className="dap-hd">
        <div><span className="eyebrow">Who signs off · {s.me.businessName || 'Daji Cricket Ground'}</span><h1>Approval rules</h1></div>
        <span className="muted"><a href="#/approvals">Back to Approvals</a></span>
      </div>
      <div role="tablist" className="dtabs">
        {data.kinds.map((k) => <button key={k.kind} type="button" role="tab" aria-selected={kind === k.kind} className={`dchip${kind === k.kind ? ' on' : ''}`} onClick={() => setKind(k.kind)}>{k.name}{k.custom ? ' · your rules' : ''}</button>)}
      </div>
      <div className="dap-row">
        <section className="dcard apr-edit" aria-label={`${cur.name} rules`}>
          <div className="apr-intro">
            <h2>{cur.name}</h2>
            <span className="muted">{ABOUT[kind]}</span>
            <span className="apr-now"><b>Now:</b> {cur.summary}</span>
            {cur.updatedAt && <span className="muted apr-small">Last changed by {cur.updatedByName ?? 'someone'}, {fmtDateTime(cur.updatedAt)}.</span>}
          </div>

          <h3 className="apr-h">Steps, in order</h3>
          {!draft.steps.length && <p className="apr-none">{kind === 'payroll' ? 'No sign-off. The owner locks the month straight away.' : 'No sign-off. A bill is approved as soon as it is sent.'}</p>}
          <ol className="apr-steps">
            {draft.steps.map((x, i) => (
              <li key={x.id} className="apr-step">
                <span className="dap-mark now">{i + 1}</span>
                <div className="apr-fields">
                  <label className="apr-f"><span>Step name</span><input className="inp" value={x.label} maxLength={60} onChange={(e) => setStep(i, { label: e.target.value })} /></label>
                  <label className="apr-f"><span>Who signs</span>
                    <select className="inp" value={whoKey(x.who)} onChange={(e) => setStep(i, { who: whoFrom(e.target.value) })}>
                      <option value="owner">The owner</option>
                      <option value="anyone">{cur.area}</option>
                      <optgroup label="Someone with a role">{data.roles.map((r) => <option key={r.key} value={`role:${r.key}`}>{r.title}</option>)}</optgroup>
                      {people.length > 0 && <optgroup label="A named person">{people.map((p) => <option key={p.id} value={`person:${p.id}`}>{p.name}</option>)}</optgroup>}
                      {x.who.type === 'person' && !people.some((p) => p.id === (x.who as { value: string }).value) && <option value={whoKey(x.who)}>Someone no longer on the team</option>}
                    </select>
                  </label>
                  <label className="apr-f"><span>When</span>
                    <select className="inp" value={amounts[x.id] !== undefined ? 'over' : 'always'} onChange={(e) => setAmounts((a) => ({ ...a, [x.id]: e.target.value === 'over' ? '50000' : undefined }))}>
                      <option value="always">Every time</option>
                      <option value="over">Larger amounts only</option>
                    </select>
                  </label>
                  {amounts[x.id] !== undefined && (
                    <label className="apr-f"><span>Amount, in rupees, or more</span><span className="apr-money"><i>₹</i><input className="inp" inputMode="decimal" value={amounts[x.id]} onChange={(e) => setAmounts((a) => ({ ...a, [x.id]: e.target.value }))} /></span></label>)}
                </div>
                <div className="apr-tools">
                  <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}>Up</button>
                  <button type="button" className="btn sm ghost" disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}>Down</button>
                  <button type="button" className="btn sm ghost apr-del" onClick={() => edit((d) => { d.steps.splice(i, 1); })}>Remove</button>
                </div>
              </li>))}
          </ol>
          {draft.steps.length < 6 && (
            <div className="apr-adds">
              <button type="button" className="btn sm" onClick={() => add()}>Add a step</button>
              {!draft.steps.some((x) => x.who.type === 'owner') && <button type="button" className="btn sm ghost" onClick={() => { const id = freshId(); add({ id, label: 'Owner sign-off', who: { type: 'owner' } }); setAmounts((a) => ({ ...a, [id]: '50000' })); }}>Add the owner for big amounts</button>}
            </div>)}

          <h3 className="apr-h">Fair play</h3>
          <label className="check"><input type="checkbox" checked={draft.notSelf} onChange={(e) => edit((d) => { d.notSelf = e.target.checked; })} /><span>The person who sent it in cannot sign it</span></label>
          <label className="check"><input type="checkbox" checked={draft.distinct} onChange={(e) => edit((d) => { d.distinct = e.target.checked; })} /><span>Each step needs a different person</span></label>
          <span className="muted apr-small">The owner can always sign any step.</span>

          <h3 className="apr-h">When someone sends it back</h3>
          <div className="apr-radios" role="radiogroup" aria-label="Send back">
            <label className="check"><input type="radio" name="sb" checked={draft.sendBack === 'start'} onChange={() => edit((d) => { d.sendBack = 'start'; })} /><span>It goes back to the person who sent it in, to fix and send again</span></label>
            <label className="check"><input type="radio" name="sb" checked={draft.sendBack === 'previous'} onChange={() => edit((d) => { d.sendBack = 'previous'; })} /><span>It goes back one step, to the person who signed before</span></label>
          </div>
          <span className="muted apr-small">A note is always needed, so people know what to fix.</span>

          {msg && <div className="err" style={{ margin: 0 }}>{msg}</div>}
          <div className="dap-acts apr-save">
            <button type="button" className="dap-yes" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save rules'}</button>
            {dirty && <button type="button" className="btn ghost" onClick={() => { setDraft(structuredClone(cur.flow)); setAmounts(Object.fromEntries(cur.flow.steps.map((x) => [x.id, x.overPaise ? rupees(x.overPaise).replace(/\.00$/, '') : undefined]))); }}>Undo changes</button>}
            {cur.custom && <Confirm label="Use the standard rules" className="btn ghost" ask={`Standard: ${cur.defaultSummary}`} onYes={reset} />}
          </div>
          <span className="muted apr-small">Changes apply to anything sent from now on. Anything already waiting keeps the steps it started with.</span>
        </section>

        <aside className="dcard dap-panel" aria-label="Try it">
          <h3 className="apr-h" style={{ marginTop: 0 }}>Try an amount</h3>
          <label className="apr-f"><span>{kind === 'payroll' ? 'Total net pay' : 'Bill amount'}, in rupees</span><span className="apr-money"><i>₹</i><input className="inp" inputMode="decimal" value={tryAmt} onChange={(e) => setTryAmt(e.target.value)} /></span></label>
          <ol aria-label="Steps for this amount" className="dap-chain">
            {[kind === 'payroll' ? 'Owner sends the pay run' : 'Someone sends the bill in', ...applies.map((x) => x.label || 'Unnamed step'), kind === 'payroll' ? 'Month locked' : 'Ready to pay'].map((label, i, arr) => {
              const st = i > 0 && i < arr.length - 1 ? applies[i - 1] : undefined;
              return (
                <li key={`${i}-${label}`}>
                  <span className="dap-rail"><span className={`dap-mark${i === 0 ? ' done' : ''}`}>{i === 0 ? '✓' : i}</span>{i < arr.length - 1 && <i />}</span>
                  <span className="dap-step"><b>{label}</b><span className="muted">{st ? whoName(st.who) : i === 0 ? 'Start' : 'Done'}</span></span>
                </li>);
            })}
          </ol>
          <span className="dap-rule">{applies.length ? `${inr(tryPaise)} needs ${applies.length} sign-off${applies.length === 1 ? '' : 's'}.` : `${inr(tryPaise)} needs no sign-off.`}{dirty ? ' (Not saved yet.)' : ''}</span>

          {data.changes.length > 0 && (<>
            <h3 className="apr-h">Recent rule changes</h3>
            <ul className="apr-log">
              {data.changes.slice(0, 4).map((c) => <li key={c.id}><b>{data.kinds.find((k) => k.kind === c.kind)?.name ?? c.kind}</b> <span className="muted">{c.actorName ?? 'Someone'} · {fmtDateTime(c.at)}</span><span>{c.detail?.reset ? 'Back to the standard rules.' : c.detail?.after}</span></li>)}
            </ul>
          </>)}
        </aside>
      </div>
    </div>
  );
}
