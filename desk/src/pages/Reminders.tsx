import { useApi, go } from '../lib';
import { PageHead, Stat, Tabs, Loading, ErrorBox } from '../ui';
import QueueTab from '../parts/reminders/QueueTab';
import TemplatesTab from '../parts/reminders/TemplatesTab';
import ComposeTab from '../parts/reminders/ComposeTab';
import HistoryTab from '../parts/reminders/HistoryTab';
import type { HistoryRow, Queue, Template } from '../parts/reminders/shared';

type Tab = 'queue' | 'templates' | 'one' | 'history';

export default function Reminders({ sub }: { sub: string }) {
  const first = sub.replace(/^\//, '').split('/')[0] ?? '';
  const tab: Tab = (['queue', 'templates', 'one', 'history'] as string[]).includes(first) ? (first as Tab) : 'queue';
  const setTab = (t: Tab) => go(t === 'queue' ? '/reminders' : `/reminders/${t}`);
  const [queue, qErr, reloadQ] = useApi<Queue>('/api/desk/reminders/queue');
  const [tpl, tErr, reloadT] = useApi<{ items: Template[] }>('/api/desk/reminders/templates');
  const [hist, hErr, reloadH] = useApi<{ items: HistoryRow[] }>('/api/desk/reminders/history');
  const err = qErr || tErr || hErr;
  const c = queue?.counts;
  return (
    <div className="stack">
      <PageHead eyebrow="Customers" title="WhatsApp reminders" lede="Prefilled WhatsApp messages for the people who need a nudge. You press send, we keep the log." />
      <ErrorBox msg={err} />
      <div className="grid g4">
        <Stat label="To send" value={c?.pending ?? '—'} foot="Not yet marked sent" />
        <Stat label="Tomorrow" value={c?.booking ?? '—'} foot="Bookings to remind" />
        <Stat label="Balances due" value={c?.payment ?? '—'} foot="Unpaid bookings, last 30 days on" />
        <Stat label="Memberships" value={queue ? (queue.membershipsAvailable ? c?.membership ?? 0 : 'n/a') : '—'} foot={queue && !queue.membershipsAvailable ? 'Memberships not set up yet' : 'Ending within 7 days'} />
      </div>
      <Tabs value={tab} onChange={setTab} label="Sections" items={[['queue', 'Queue'], ['templates', 'Templates'], ['one', 'Send one'], ['history', 'History']]} />
      {tab === 'queue' && (queue ? <QueueTab queue={queue} reload={() => { reloadQ(); reloadH(); }} /> : <Loading />)}
      {tab === 'templates' && (tpl ? <TemplatesTab templates={tpl.items} reload={() => { reloadT(); reloadQ(); }} /> : <Loading />)}
      {tab === 'one' && (tpl ? <ComposeTab templates={tpl.items} onLogged={reloadH} /> : <Loading />)}
      {tab === 'history' && (hist ? <HistoryTab rows={hist.items} /> : <Loading />)}
    </div>
  );
}
