import { useEffect, useState } from 'react';
import { useSession } from '../App';
import { PageHead, Loading, ErrorBox, Icon, useToast } from '../ui';
import { api, post, put, useApi, go, can, addDaysISO, thisMonth } from '../lib';

// The starter kit's guided month-end close: eight checks in order, each worked out from the books, ending with the sign-off.
type State = 'done' | 'todo' | 'warn' | 'na';
interface Step { key: string; title: string; state: State; count: number; text: string; href: string | null; blocks: boolean }
interface Close { month: string; over: boolean; signedOff: boolean; steps: Step[] }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const name = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const shift = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const WORD: Record<State, string> = { done: 'Done', todo: 'To do', warn: 'Check', na: 'Not needed' };

export default function CloseWizard({ sub }: { sub: string }) {
  const { me, ownerId } = useSession(); const toast = useToast();
  const month = /^\d{4}-\d{2}$/.test(sub) ? sub : addDaysISO(thisMonth() + '-01', -1).slice(0, 7);
  const [d, err, reload] = useApi<Close>(`/api/desk/close?month=${month}`, [ownerId]);
  const [at, setAt] = useState<number | null>(null);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { let live = true; api(`/api/accounting/memos/${month}`).then((m) => live && setMemo(m.body || '')).catch(() => live && setMemo('')); return () => { live = false; }; }, [month]);
  // open on the first step that still needs doing
  useEffect(() => { if (d && at === null) { const i = d.steps.findIndex((s) => s.state === 'todo' || s.state === 'warn'); setAt(i < 0 ? d.steps.length - 1 : i); } }, [d, at]);

  if (err) return <div className="stack"><PageHead eyebrow="Month-end" title="Close the month" /><ErrorBox msg={err} /></div>;
  const steps = d?.steps ?? [];
  const cur = at !== null ? steps[at] : undefined;
  const done = steps.filter((s) => s.state === 'done' || s.state === 'na').length;
  const blocked = steps.some((s) => s.blocks && s.state !== 'done');
  const writer = can(me, 'manage_accounting');

  async function signOff() {
    setBusy(true); setFail(null);
    try {
      if (memo.trim()) await put(`/api/accounting/memos/${month}`, { body: memo.trim() });
      await post('/api/accounting/signoffs', { month });
      toast(`${name(month)} signed off`); reload();
    } catch (e: any) { setFail(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <PageHead eyebrow="Month-end, step by step" title={`Close ${name(month)}`} lede="Eight checks in order. Each one is worked out from the books, so it ticks itself once the work is done. The last step signs the month off and locks it.">
        <button className="btn sm" aria-label="Previous month" onClick={() => { setAt(null); go(`/close/${shift(month, -1)}`); }}>‹</button>
        <button className="btn sm" aria-label="Next month" onClick={() => { setAt(null); go(`/close/${shift(month, 1)}`); }}>›</button>
      </PageHead>
      {!d ? <Loading h={420} /> : (
        <div className="wiz">
          <ol className="wiz-steps" aria-label="Steps">
            <li className="wiz-progress"><span className="num">{done} of {steps.length}</span> done<span className="meter"><span style={{ width: `${(done / steps.length) * 100}%` }} /></span></li>
            {steps.map((s, i) => (
              <li key={s.key}>
                <button className={`wiz-step s-${s.state}${i === at ? ' on' : ''}`} onClick={() => setAt(i)} aria-current={i === at ? 'step' : undefined}>
                  <span className="wiz-n" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={13} /> : i + 1}</span>
                  <span className="wiz-t">{s.title}</span>
                  <span className="wiz-s small">{WORD[s.state]}</span>
                </button>
              </li>))}
          </ol>
          {cur && (
            <section className="card card-pad wiz-body" aria-live="polite">
              <div className="eyebrow">Step {at! + 1} of {steps.length} · {WORD[cur.state]}</div>
              <h2>{cur.title}</h2>
              <p className="wiz-text">{cur.text}</p>
              {cur.blocks && cur.state !== 'done' && <p className="small" style={{ color: 'var(--i-amber)' }}>The month cannot be signed off until this is done.</p>}
              {cur.key === 'signoff' ? (
                d.signedOff ? <p className="muted">To change something in {name(month)}, re-open it from Accounting, Month-end.</p> : <>
                  <label className="f full"><span>Month note (for you and your accountant)</span><textarea className="inp" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Anything to remember about this month" /></label>
                  <ErrorBox msg={fail} />
                  {!writer && <p className="small muted">Signing off needs the "manage_accounting" permission. Ask the owner.</p>}
                  <div className="row" style={{ marginTop: 14 }}>
                    <button className="btn primary" disabled={busy || !writer || blocked || !d.over} onClick={signOff}><Icon name="lock" />Sign off {name(month)}</button>
                  </div>
                </>
              ) : (
                <div className="row" style={{ marginTop: 14 }}>
                  {cur.href && <button className="btn primary" onClick={() => go(cur.href!)}>Open<Icon name="chevron" size={14} /></button>}
                  <button className="btn" onClick={() => reload()}><Icon name="repeat" />Check again</button>
                  <span className="spacer" style={{ flex: 1 }} />
                  {at! > 0 && <button className="btn ghost" onClick={() => setAt(at! - 1)}>Back</button>}
                  <button className="btn" onClick={() => setAt(Math.min(steps.length - 1, at! + 1))}>Next step</button>
                </div>
              )}
            </section>)}
        </div>)}
    </div>
  );
}
