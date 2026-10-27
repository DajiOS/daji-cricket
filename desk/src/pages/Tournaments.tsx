import { useState } from 'react';
import { Chip, ErrorBox, Loading, PageHead, Stat, Status, Table, Tabs, Confirm, useToast } from '../ui';
import { del, fmtDate, formatPhone, go, inr, useApi } from '../lib';
import { TournamentForm } from '../parts/tournaments/TournamentForm';
import { TeamsTab } from '../parts/tournaments/TeamsTab';
import { FixturesTab } from '../parts/tournaments/FixturesTab';
import { TableTab } from '../parts/tournaments/TableTab';
import { FeesTab } from '../parts/tournaments/FeesTab';
import { UpcomingTournaments } from '../parts/tournaments/Upcoming';
import { API, STATUS, formatLabel, type Detail, type Tournament } from '../parts/tournaments/shared';

type Tab = 'fixtures' | 'table' | 'teams' | 'fees';

function List() {
  const [data, err, reload] = useApi<{ items: Tournament[] }>(API);
  const [form, setForm] = useState(false);
  const items = data?.items ?? [];
  const sum = (f: (t: Tournament) => number) => items.reduce((s, t) => s + f(t), 0);
  return (
    <div className="stack">
      <PageHead eyebrow="Compete" title="Tournaments" lede="Teams, entry fees, fixtures and the points table.">
        <button className="btn primary" onClick={() => setForm(true)}>New tournament</button>
      </PageHead>
      <ErrorBox msg={err} />
      {!data && !err ? <Loading /> : <>
        <div className="grid g4">
          <Stat label="Tournaments" value={items.length} foot={`${items.filter((t) => t.status === 'running' || t.status === 'open').length} open or running`} />
          <Stat label="Teams entered" value={sum((t) => t.teamCount)} />
          <Stat label="Entry fees collected" value={inr(sum((t) => t.fees.collectedPaise))} />
          <Stat label="Still to collect" value={inr(sum((t) => t.fees.pendingPaise))} />
        </div>
        <div className="card">
          <Table rows={items} onRow={(t) => go('/tournaments/' + t.id)} empty="No tournaments yet. Create one to start taking team entries."
            cols={[
              { head: 'Tournament', cell: (t) => <><b>{t.name}</b><div className="small muted">{formatLabel(t.format)} · {t.overs} overs</div></> },
              { head: 'Dates', cell: (t) => `${fmtDate(t.startDate)} to ${fmtDate(t.endDate)}` },
              { head: 'Status', cell: (t) => <span className="row" style={{ gap: 6 }}><Status s={t.status} map={STATUS} />{t.booking && <Chip tone="info">Ground booked</Chip>}</span> },
              { head: 'Teams', num: true, cell: (t) => t.teamCount },
              { head: 'Played', num: true, cell: (t) => `${t.playedCount}/${t.fixtureCount}` },
              { head: 'Entry fee', num: true, cell: (t) => inr(t.entryFeePaise) },
              { head: 'Collected', num: true, cell: (t) => <>{inr(t.fees.collectedPaise)}{t.fees.pendingPaise > 0 && <div className="small muted">{inr(t.fees.pendingPaise)} due</div>}</> },
            ]} />
        </div>
      </>}
      <div className="card">
        <div className="card-head"><h3>Coming up</h3><span className="small muted">Tournaments set up here and bookings made on a tournament price</span></div>
        <div className="card-pad"><UpcomingTournaments /></div>
      </div>
      {form && <TournamentForm onClose={() => setForm(false)} onSaved={(t) => { setForm(false); go('/tournaments/' + t.id); }} />}
    </div>
  );
}

function One({ id }: { id: string }) {
  const toast = useToast();
  const [d, err, reload] = useApi<Detail>(`${API}/${id}`);
  const [tab, setTab] = useState<Tab>('fixtures');
  const [edit, setEdit] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  if (err) return <div className="stack"><PageHead eyebrow="Compete" title="Tournament"><button className="btn" onClick={() => go('/tournaments')}>All tournaments</button></PageHead><ErrorBox msg={err} /></div>;
  if (!d) return <div className="stack"><PageHead eyebrow="Compete" title="Tournament" /><Loading /></div>;
  const t = d.tournament;
  return (
    <div className="stack">
      <PageHead eyebrow={`${formatLabel(t.format)} · ${t.overs} overs`} title={t.name} lede={<>{fmtDate(t.startDate)} to {fmtDate(t.endDate)} <Status s={t.status} map={STATUS} /></>}>
        <button className="btn" onClick={() => go('/tournaments')}>All tournaments</button>
        <button className="btn primary" onClick={() => setEdit(true)}>Edit</button>
      </PageHead>
      <ErrorBox msg={delErr} />
      {t.notes && <div className="muted small">{t.notes}</div>}
      {t.organiser && (t.organiser.firstName || t.organiser.phone) && <div className="small muted">Organiser: <b>{`${t.organiser.firstName} ${t.organiser.lastName}`.trim() || '—'}</b>{t.organiser.phone ? ` · ${formatPhone(t.organiser.phone)}` : ''}{t.organiser.email ? ` · ${t.organiser.email}` : ''}</div>}
      {t.booking && (
        <div className="card card-pad row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div><b>Ground booked</b> {t.booking.cancelled ? <Chip tone="bad">Cancelled</Chip> : t.booking.balancePaise > 0 ? <Chip tone="warn">{inr(t.booking.balancePaise)} to collect</Chip> : <Chip tone="good">Paid</Chip>}
            <div className="small muted">{t.booking.groundName} · {fmtDate(t.booking.fromDate)} to {fmtDate(t.booking.toDate)} · {inr(t.booking.paidPaise)} of {inr(t.booking.totalPaise)} received</div></div>
          {t.booking.firstBookingId && <button className="btn sm" onClick={() => go('/bookings/' + t.booking!.firstBookingId)}>Open booking</button>}
        </div>)}
      <div className="grid g4">
        <Stat label="Teams" value={t.teamCount} foot={`${d.fees.paidTeams} paid, ${d.fees.unpaidTeams} due`} />
        <Stat label="Matches played" value={`${t.playedCount}/${t.fixtureCount}`} meter={t.fixtureCount ? (t.playedCount / t.fixtureCount) * 100 : 0} />
        <Stat label="Fees collected" value={inr(d.fees.collectedPaise)} foot={`of ${inr(d.fees.expectedPaise)}`} />
        <Stat label="Leader" value={d.table[0] && d.table[0].played > 0 ? d.table[0].team : '—'} foot={d.table[0] && d.table[0].played > 0 ? `${d.table[0].points} points` : 'No results yet'} />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} label="Sections" items={[['fixtures', 'Fixtures'], ['table', 'Points table'], ['teams', 'Teams'], ['fees', 'Fees']]} />
      {tab === 'fixtures' && <FixturesTab d={d} reload={reload} />}
      {tab === 'table' && <TableTab d={d} />}
      {tab === 'teams' && <TeamsTab d={d} reload={reload} />}
      {tab === 'fees' && <FeesTab d={d} reload={reload} />}
      <div><Confirm label="Delete tournament" ask="Delete this tournament and its fixtures?" onYes={async () => { setDelErr(null); try { await del(`${API}/${id}`); toast('Tournament deleted'); go('/tournaments'); } catch (e: any) { setDelErr(e.message); } }} /></div>
      {edit && <TournamentForm t={t} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
    </div>
  );
}

export default function Tournaments({ sub }: { sub: string }) {
  const id = sub.replace(/^\//, '').split('/')[0];
  return id ? <One id={id} key={id} /> : <List />;
}
