// The live bank feed: link a books account to its bank account at the provider, then pull new transactions.
import { useState } from 'react';
import { post, useApi, fmtDate } from '../../lib';
import { Chip, ErrorBox, Loading, useToast, Icon } from '../../ui';
import { Section, Note } from './kit';
import { AccountDialog } from './dialogs';

function FeedRow({ a, reload }: { a: any; reload: () => void }) {
  const [ref, setRef] = useState<string>(a.providerRef ? a.providerRef.slice(a.providerRef.indexOf(':') + 1) : '');
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<any>, msg: (r: any) => string) => { setBusy(true); try { toast(msg(await fn())); reload(); } catch (e: any) { toast(e.message); } finally { setBusy(false); } };
  return (
    <div className="bk-li bk-feed-row">
      <div style={{ minWidth: 0 }}>
        <div className="strong">{a.name}</div>
        <div className="muted small">{a.lastSyncAt ? `Last pulled ${fmtDate(new Date(a.lastSyncAt + 330 * 60000).toISOString().slice(0, 10))}` : 'Not pulled yet'}{a.lastOk === false && <> · <span style={{ color: 'var(--bad)' }}>failed: {a.lastMessage}</span></>}</div>
      </div>
      <input className="inp" style={{ maxWidth: 260 }} placeholder="Account id at the provider" aria-label="Account id at the provider" value={ref} onChange={(e) => setRef(e.target.value)} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" disabled={busy} onClick={() => act(() => post('/api/accounting/feed/link', { accountId: a.id, providerRef: ref.trim() }), () => 'Linked')}>{a.providerRef ? 'Save link' : 'Link'}</button>
        {a.providerRef && <button className="btn sm primary" disabled={busy} onClick={() => act(() => post('/api/accounting/feed/sync', { accountId: a.id }), (r) => `${r.rowsNew} new, ${r.rowsDuplicate} already there`)}>Pull now</button>}
      </div>
    </div>
  );
}

export function FeedPanel({ onAccountAdded }: { onAccountAdded?: () => void }) {
  const [f, e, reload] = useApi<any>('/api/accounting/feed');
  const [adding, setAdding] = useState(false);
  if (e) return <ErrorBox msg={e} />;
  if (!f) return <Loading h={120} />;
  const add = <button className="btn sm primary" onClick={() => setAdding(true)}><Icon name="plus" />Add a bank account</button>;
  return (
    <>
      <Section title={f.provider ? <>Bank feed <Chip tone="gold">{f.provider}</Chip></> : 'Bank feed'} aside={add}>
        {!f.provider
          ? <Note>Not connected on this server. Until it is, load statements below. When a feed provider is set up, new bank transactions will arrive here by themselves each day.</Note>
          : <>
            {f.provider === 'demo' && <Note>Demo feed: made-up transactions so you can see how it works.</Note>}
            {f.accounts.length ? <div className="bk-list">{f.accounts.map((a: any) => <FeedRow key={a.id} a={a} reload={reload} />)}</div> : <p className="muted" style={{ margin: 0 }}>Add a bank account first.</p>}
          </>}
      </Section>
      {adding && <AccountDialog onClose={() => setAdding(false)} done={() => { reload(); onAccountAdded?.(); }} />}
    </>
  );
}
