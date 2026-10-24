// Account Aggregator: the account holder approves on the gateway's own page (Setu), then the bank's transactions arrive like any other feed.
import { useState } from 'react';
import { post, put, useApi, fmtDateTime, inr } from '../../lib';
import { Chip, ErrorBox, Loading, Modal, Field, useToast, type Tone } from '../../ui';
import { Section, Note } from './kit';

const STATUS: Record<string, [Tone, string]> = { PENDING: ['warn', 'Waiting for approval'], ACTIVE: ['good', 'Approved'], REJECTED: ['bad', 'Declined'], REVOKED: ['mute', 'Stopped'], EXPIRED: ['mute', 'Expired'], PAUSED: ['warn', 'Paused'] };

export function AccountAggregator() {
  const [d, e, reload] = useApi<any>('/api/accounting/aa');
  const [feed] = useApi<any>('/api/accounting/feed');
  const [ask, setAsk] = useState(false);
  const toast = useToast(); const [busy, setBusy] = useState<string | null>(null);
  if (e) return <ErrorBox msg={e} />;
  if (!d || !feed) return <Loading h={80} />;
  const act = async (id: string, fn: () => Promise<any>, msg: (r: any) => string) => { setBusy(id); try { toast(msg(await fn())); reload(); } catch (x: any) { toast(x.message); } finally { setBusy(null); } };
  const accounts: { id: string; name: string }[] = feed.accounts;
  return (
    <>
      <Section title="Bank access with consent (Account Aggregator)" aside={<button className="btn sm primary" disabled={!d.providers.setu} onClick={() => setAsk(true)}>Ask for bank access</button>}>
        {!d.providers.setu && <Note>Not set up on this server yet. The software owner adds the Setu keys under Platform, Bank feed.</Note>}
        {d.providers.setu && !d.consents.length && <p className="muted" style={{ margin: 0 }}>Enter the mobile number linked to the bank account. The account holder approves on Setu's page, and the transactions then arrive here by themselves every day.</p>}
        <div className="bk-list">
          {d.consents.map((c: any) => {
            const [tone, label] = STATUS[c.status] ?? ['mute', c.status];
            return (
              <div key={c.id} className="bk-li" style={{ display: 'block' }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div><span className="strong">{c.mobile}</span> <Chip tone={tone}>{label}</Chip> <span className="muted small">via {c.provider === 'setu' ? 'Setu' : 'Finvu'} · asked {fmtDateTime(c.createdAt)}</span></div>
                  <div className="row" style={{ gap: 6 }}>
                    {c.url && <a className="btn sm" href={c.url} target="_blank" rel="noreferrer">Open approval page</a>}
                    <button className="btn sm primary" disabled={busy === c.id || c.status === 'REVOKED' || c.status === 'REJECTED'} onClick={() => act(c.id, () => post(`/api/accounting/aa/consents/${c.id}/sync`), (r) => r.message)}>Get the latest</button>
                    {c.status !== 'REVOKED' && <button className="btn sm ghost" disabled={busy === c.id} onClick={() => act(c.id, () => post(`/api/accounting/aa/consents/${c.id}/forget`), () => 'Stopped. Revoke it in your bank app or at Setu too.')}>Stop</button>}
                  </div>
                </div>
                {c.lastMessage && <div className="muted small" style={{ marginTop: 4 }}>{c.lastFetchAt ? `${fmtDateTime(c.lastFetchAt)}: ` : ''}{c.lastMessage}</div>}
                {c.accounts.map((a: any) => (
                  <div key={a.id} className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ minWidth: 140 }}>{a.masked ?? 'Account'}{a.fipId ? <span className="muted small"> · {a.fipId}</span> : null}</span>
                    {a.balancePaise !== null && <span className="muted small">Bank says {inr(a.balancePaise, 2)}</span>}
                    <select className="inp" style={{ maxWidth: 240 }} aria-label="Books account" value={a.accountId ?? ''} onChange={(ev) => act(c.id, () => put(`/api/accounting/aa/accounts/${a.id}`, { accountId: ev.target.value }), () => 'Saved')}>
                      <option value="">Not joined to a books account</option>
                      {accounts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </div>))}
              </div>);
          })}
        </div>
      </Section>
      {ask && <AskDialog onClose={() => setAsk(false)} done={() => { setAsk(false); reload(); }} />}
    </>
  );
}

function AskDialog({ onClose, done }: { onClose: () => void; done: () => void }) {
  const [mobile, setMobile] = useState(''); const [months, setMonths] = useState('12'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    if (mobile.replace(/\D/g, '').length < 10) { setErr('Enter the 10-digit mobile number linked to the bank account.'); return; }
    setBusy(true); setErr('');
    try { const r = await post<any>('/api/accounting/aa/consents', { provider: 'setu', mobile, months: Number(months) }); if (r.url) window.open(r.url, '_blank', 'noopener'); done(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Ask for bank access" onClose={onClose} foot={<button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={go}>{busy ? 'Sending…' : 'Send to Setu'}</button>}>
      <ErrorBox msg={err} />
      <Field label="Mobile number linked to the bank" hint="The account holder gets an OTP on this number and chooses which accounts to share."><input className="inp" inputMode="tel" autoFocus value={mobile} onChange={(e) => setMobile(e.target.value)} /></Field>
      <Field label="Keep access for" hint="They can stop it earlier at any time."><select className="inp" value={months} onChange={(e) => setMonths(e.target.value)}>{[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} months</option>)}</select></Field>
    </Modal>
  );
}
