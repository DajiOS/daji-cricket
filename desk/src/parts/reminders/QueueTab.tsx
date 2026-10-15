import { useState } from 'react';
import { post, fmtDateTime, formatPhone } from '../../lib';
import { Chip, Table, Tabs, useToast } from '../../ui';
import { KIND_LABEL, KIND_TONE, type Queue, type QueueItem } from './shared';

type Filter = 'pending' | 'all' | 'booking' | 'payment' | 'membership';

export default function QueueTab({ queue, reload }: { queue: Queue; reload: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Filter>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const rows = queue.items.filter((i) => (f === 'all' ? true : f === 'pending' ? !i.sentAt : i.kind === f));
  const mark = async (i: QueueItem) => {
    setBusy(i.kind + i.key);
    try { await post('/api/desk/reminders/sent', { kind: i.kind, key: i.key }); toast(`Logged as sent to ${i.name}`); reload(); }
    catch (e: any) { toast(e.message); }
    finally { setBusy(null); }
  };
  const tabs: [Filter, string][] = [['pending', 'To send'], ['all', 'All'], ['booking', 'Tomorrow'], ['payment', 'Balances']];
  if (queue.membershipsAvailable) tabs.push(['membership', 'Memberships']);
  return (
    <div className="card">
      <div className="card-head"><div><h3>Who to remind</h3><div className="small muted">Open WhatsApp, press send in the chat, then come back and mark it sent.</div></div><Tabs value={f} onChange={setF} items={tabs} label="Filter" /></div>
      <Table rows={rows} key={(r) => r.kind + r.key} empty={f === 'pending' ? 'Everyone is reminded for now.' : 'Nothing in this list.'} cols={[
        { head: 'Type', cell: (r) => <Chip tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Chip> },
        { head: 'Who', cell: (r) => <div><div className="strong">{r.name}</div><div className="small muted">{r.phone ? formatPhone(r.phone) : 'No phone number'}</div></div> },
        { head: 'Details', cell: (r) => <span className="small">{r.summary}</span> },
        { head: 'Message', cell: (r) => <div className="rem-msg" title={r.message}>{r.message}</div> },
        { head: '', cell: (r) => r.sentAt ? <div className="rem-actions"><Chip tone="good">Sent {fmtDateTime(r.sentAt)}</Chip>{r.link && <a className="btn sm ghost" href={r.link} target="_blank" rel="noopener noreferrer">Open again</a>}</div> : (
          <div className="rem-actions">
            {r.link ? <a className="btn sm primary" href={r.link} target="_blank" rel="noopener noreferrer">Open WhatsApp</a> : <Chip tone="bad">Cannot send</Chip>}
            <button className="btn sm" disabled={busy === r.kind + r.key || !r.link} onClick={() => mark(r)}>Mark sent</button>
          </div>) },
      ]} />
    </div>
  );
}
