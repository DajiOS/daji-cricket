// Connect a bank through Yodlee FastLink, then choose which connected bank account feeds which account in the books.
import { useEffect, useRef, useState } from 'react';
import { post, useApi, inr } from '../../lib';
import { Modal, ErrorBox, Loading, useToast, Icon } from '../../ui';
import { Note } from './kit';

interface Session { url: string; accessToken: string; params: { configName: string; flow?: string; providerAccountId?: string } }
type Flow = { flow?: 'edit' | 'refresh'; providerAccountId?: string };

/** FastLink is Yodlee's own bank-login screen. It opens inside this dialog; the page only passes it a short-lived token. */
function FastLinkDialog({ onClose, flow }: { onClose: () => void; flow: Flow }) {
  const [s, setS] = useState<Session | null>(null); const [err, setErr] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null); const toast = useToast();
  useEffect(() => { post<Session>('/api/accounting/feed/yodlee/session', flow).then(setS).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (s) form.current?.submit(); }, [s]);
  useEffect(() => {
    if (!s) return;
    const origin = new URL(s.url).origin;
    const f = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      const d = e.data as { action?: string; data?: { status?: string } } | undefined;
      if (d && d.action === 'exit') { toast(d.data?.status === 'SUCCESS' ? 'Bank connected' : 'Bank connection closed'); onClose(); }
    };
    addEventListener('message', f); return () => removeEventListener('message', f);
  }, [s, onClose, toast]);
  return (
    <Modal title={flow.flow === 'refresh' ? 'Answer your bank' : flow.flow === 'edit' ? 'Fix your bank login' : 'Connect your bank'} onClose={onClose} wide foot={<button className="btn primary" onClick={onClose}>Done</button>}>
      {err ? <ErrorBox msg={err} /> : !s ? <Loading h={200} /> : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>Sign in to your bank in the box below. Your bank password goes to the bank's own screen (run by Yodlee) and never reaches this software. Press Done when it says the bank is connected.</p>
          <form ref={form} method="post" action={s.url} target="yodlee-fastlink">
            <input type="hidden" name="accessToken" value={s.accessToken} />
            <input type="hidden" name="extraParams" value={`configName=${s.params.configName}${s.params.flow ? `&flow=${s.params.flow}&providerAccountId=${s.params.providerAccountId}` : ''}`} />
          </form>
          <iframe name="yodlee-fastlink" title="Bank sign-in" style={{ width: '100%', height: 520, border: '1px solid var(--line, #2a2620)', borderRadius: 10, background: '#fff' }} />
        </>
      )}
    </Modal>
  );
}

/** The bank accounts Yodlee reports for this business, each with a picker for the books account it should feed. */
function Connected({ accounts, reloadFeed, openFlow }: { accounts: { id: string; name: string; holds?: string }[]; reloadFeed: () => void; openFlow: (f: Flow) => void }) {
  const [list, e, reload] = useApi<{ accounts: any[] }>('/api/accounting/feed/yodlee/accounts');
  const [feed] = useApi<{ accounts: any[] }>('/api/accounting/feed');
  const [pick, setPick] = useState<Record<string, string>>({}); const [busy, setBusy] = useState<string | null>(null); const toast = useToast();
  const working = !!list?.accounts.some((a: any) => a.status?.code === 'working');
  useEffect(() => { if (!working) return; const t = setInterval(reload, 4000); return () => clearInterval(t); }, [working, reload]);
  if (e) return <ErrorBox msg={e} />;
  if (!list) return <Loading h={80} />;
  if (!list.accounts.length) return <p className="muted small" style={{ margin: '0 0 8px' }}>No bank connected yet. Use Connect a bank, then come back here to choose the account.</p>;
  const act = async (id: string, fn: () => Promise<any>, msg: string) => { setBusy(id); try { await fn(); toast(msg); reload(); reloadFeed(); } catch (er: any) { toast(er.message); } finally { setBusy(null); } };
  return (
    <div className="bk-list" style={{ marginBottom: 12 }}>
      {list.accounts.map((a) => {
        const books = accounts.find((x) => x.id === a.linkedTo);
        const fb = feed?.accounts.find((x) => x.id === a.linkedTo);
        const want = a.container === 'creditCard' ? 'card' : a.container === 'loan' ? 'loan' : 'bank';
        const choices = accounts.filter((x) => (x.holds ?? 'bank') === want);
        return (
          <div key={a.id} className="bk-li bk-feed-row">
            <div style={{ minWidth: 0 }}>
              <div className="strong">{a.bankName} {a.maskedNumber}</div>
              <div className="muted small">{a.container === 'creditCard' ? 'Credit card' : a.container === 'loan' ? 'Loan' : 'Bank account'} · {a.accountName}{a.balancePaise !== null && <> · {a.container === 'bank' ? 'balance' : 'owing'} {inr(a.balancePaise)}</>}</div>
              <div className={a.status?.code === 'ok' || a.status?.code === 'working' ? 'muted small' : 'err small'}>{a.status?.text}</div>
            </div>
            {books ? <span className="muted small">Feeds <strong>{books.name}</strong>{fb && fb.bankBalancePaise !== null && <><br />Bank says {inr(fb.bankBalancePaise)} · books say {inr(fb.bookBalancePaise)}{fb.bankBalancePaise === fb.bookBalancePaise ? ' ✓' : ''}</>}</span> : (
              <div className="row" style={{ gap: 6 }}>
                <select className="inp" style={{ maxWidth: 220 }} aria-label="Books account" value={pick[a.id] ?? ''} onChange={(ev) => setPick({ ...pick, [a.id]: ev.target.value })}>
                  <option value="">Choose {a.container === 'bank' ? 'a books account' : a.container === 'creditCard' ? 'a credit card account' : 'a loan account'}</option>
                  {choices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button className="btn sm primary" disabled={!pick[a.id] || busy === a.id} onClick={() => act(a.id, () => post('/api/accounting/feed/link', { accountId: pick[a.id], providerRef: a.id }), 'Linked')}>Link</button>
              </div>
            )}
            {a.status?.action === 'fix' && <button className="btn sm primary" onClick={() => openFlow({ flow: 'edit', providerAccountId: a.providerAccountId })}>Fix login</button>}
            {a.status?.action === 'otp' && <button className="btn sm primary" onClick={() => openFlow({ flow: 'refresh', providerAccountId: a.providerAccountId })}>Enter code</button>}
            {a.providerAccountId && a.status?.code !== 'working' && <button className="btn sm" disabled={busy === a.id} onClick={() => act(a.id, () => post('/api/accounting/feed/yodlee/refresh', { providerAccountId: a.providerAccountId }), 'Asked the bank for new data')}>Refresh from bank</button>}
            <button className="btn sm ghost" disabled={busy === a.id} onClick={() => act(a.id, () => post('/api/accounting/feed/yodlee/disconnect', { providerAccountId: a.id }), 'Bank disconnected')}>Disconnect</button>
          </div>
        );
      })}
    </div>
  );
}

export function YodleeConnect({ accounts, reload }: { accounts: { id: string; name: string; holds?: string }[]; reload: () => void }) {
  const toast = useToast(); const [open, setOpen] = useState<Flow | null>(null); const [tick, setTick] = useState(0);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Note>Connect your bank once and new transactions arrive here by themselves.</Note>
        <button className="btn sm primary" onClick={() => setOpen({})}><Icon name="plus" />Connect a bank</button>
      </div>
      <Connected key={tick} accounts={accounts} reloadFeed={reload} openFlow={setOpen} />
      <SyncLog key={'l' + tick} />
      {open && <FastLinkDialog flow={open} onClose={async () => { setOpen(null); try { const r: any = await post('/api/accounting/feed/yodlee/autolink', {}); if (r.linked?.length) toast(`Joined ${r.linked.map((x: any) => x.name).join(', ')}`); } catch { /* the list below still shows what to choose */ } reload(); setTick((t) => t + 1); }} />}
    </>
  );
}

/** The last syncs: when, what triggered it, what came in, and any error. */
function SyncLog() {
  const [d] = useApi<{ items: any[] }>('/api/accounting/feed/log');
  const [show, setShow] = useState(false);
  if (!d || !d.items.length) return null;
  const why: Record<string, string> = { manual: 'Sync now', schedule: 'Scheduled', webhook: 'Bank update' };
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn sm ghost" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'} recent syncs ({d.items.length})</button>
      {show && (
        <div className="bk-list" style={{ marginTop: 8 }}>
          {d.items.slice(0, 20).map((l) => (
            <div key={l.id} className="bk-li">
              <div style={{ minWidth: 0 }}>
                <div className="strong">{l.accountName} · {why[l.trigger] ?? l.trigger}</div>
                <div className="muted small">{new Date(l.startedAt).toLocaleString('en-IN')} · {l.ok === null ? 'running' : l.ok ? `${l.fetched} fetched, ${l.newRows} new, ${l.duplicates} already there, ${l.matched} categorised` : l.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
