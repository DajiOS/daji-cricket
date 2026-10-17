import { useEffect, useState } from 'react';
import { useApi, qs, inr, fmtDate, fmtDateTime, formatPhone, go } from '../lib';
import { PageHead, Stat, Tabs, Table, Chip, Empty, Loading, ErrorBox, Filters } from '../ui';
import PayDialog from '../parts/memberships/PayDialog';
import PlanDialog from '../parts/memberships/PlanDialog';
import MemberDialog from '../parts/memberships/MemberDialog';
import { StatusChip, leftText, methodLabel, type AuditRow, type Member, type Plan, type Stats } from '../parts/memberships/shared';

type Tab = 'members' | 'expiring' | 'plans' | 'activity';
const B = '/api/desk/memberships';

export default function Memberships({ sub }: { sub: string }) {
  const first = sub.replace(/^\//, '').split('/')[0] ?? '';
  const tab: Tab = (['members', 'expiring', 'plans', 'activity'] as string[]).includes(first) ? (first as Tab) : 'members';
  const setTab = (t: Tab) => go(t === 'members' ? '/memberships' : `/memberships/${t}`);
  const [stats, sErr, reloadStats] = useApi<Stats>(`${B}/stats`);
  const [plans, pErr, reloadPlans] = useApi<{ items: Plan[] }>(`${B}/plans`);
  const [sell, setSell] = useState<{ member?: Member } | null>(null);
  const [planDlg, setPlanDlg] = useState<{ plan?: Plan } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rev, setRev] = useState(0); // bumps to refresh every list after a change
  const changed = () => { reloadStats(); reloadPlans(); setRev((n) => n + 1); };
  const err = sErr || pErr;

  return (
    <div className="stack">
      <PageHead eyebrow="Members & Events" title="Memberships" lede="Plans, members and renewals for the club.">
        <button className="btn primary" onClick={() => setSell({})}>Sell membership</button>
      </PageHead>
      <ErrorBox msg={err} />
      <div className="grid g4">
        <Stat label="Active members" value={stats ? stats.active + stats.expiring : '—'} foot={stats ? `${stats.total} on record` : undefined} />
        <Stat label="Expiring in 14 days" value={stats ? stats.expiring : '—'} foot={stats && stats.expiring ? 'Call them to renew' : 'Nobody due'} />
        <Stat label="Expired" value={stats ? stats.expired : '—'} foot="Can be renewed any time" />
        <Stat label="Revenue this month" value={stats ? (stats.revenueMonthPaise == null ? 'Hidden' : inr(stats.revenueMonthPaise)) : '—'} foot={stats ? `${stats.salesThisMonth} sold, ${stats.renewalsThisMonth} renewed` : undefined} />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} label="Sections" items={[['members', 'Members'], ['expiring', 'Expiring soon'], ['plans', 'Plans'], ['activity', 'Activity']]} />
      {tab === 'members' && <MembersTab plans={plans?.items ?? []} rev={rev} onOpen={setOpenId} />}
      {tab === 'expiring' && <ExpiringTab rev={rev} onOpen={setOpenId} onRenew={(m) => setSell({ member: m })} />}
      {tab === 'plans' && <PlansTab plans={plans?.items ?? null} onNew={() => setPlanDlg({})} onEdit={(p) => setPlanDlg({ plan: p })} />}
      {tab === 'activity' && <ActivityTab rev={rev} />}

      {sell && <PayDialog plans={plans?.items ?? []} member={sell.member} onClose={() => setSell(null)} onDone={(m) => { setSell(null); changed(); if (!sell.member) setOpenId(m.id); }} />}
      {planDlg && <PlanDialog plan={planDlg.plan} onClose={() => setPlanDlg(null)} onDone={() => { setPlanDlg(null); changed(); }} />}
      {openId && <MemberDialog id={openId} onClose={() => setOpenId(null)} onChanged={changed} onRenew={(m) => { setOpenId(null); setSell({ member: m }); }} />}
    </div>
  );
}

function memberCols(onRenew?: (m: Member) => void) {
  return [
    { head: 'Member', cell: (m: Member) => <><div className="mem-name">{m.name}</div><div className="small muted">{formatPhone(m.phone) || m.phone}</div></> },
    { head: 'Plan', cell: (m: Member) => m.planName },
    { head: 'Start', cell: (m: Member) => fmtDate(m.startDate) },
    { head: 'End', cell: (m: Member) => <>{fmtDate(m.endDate)}<div className="small muted">{leftText(m)}</div></> },
    { head: 'Status', cell: (m: Member) => <StatusChip s={m.status} /> },
    ...(onRenew ? [{ head: '', cell: (m: Member) => <button className="btn sm" onClick={(e) => { e.stopPropagation(); onRenew(m); }}>Renew</button> }] : []),
  ];
}

function MembersTab({ plans, rev, onOpen }: { plans: Plan[]; rev: number; onOpen: (id: string) => void }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [status, setStatus] = useState(''); const [planId, setPlanId] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const [data, err] = useApi<{ items: Member[]; total: number }>(`${B}/members${qs({ q: dq, status, planId })}`, [rev]);
  return (
    <div className="card">
      <div className="mem-tools">
        <input className="inp grow" type="search" placeholder="Search name or mobile number" aria-label="Search members" value={q} onChange={(e) => setQ(e.target.value)} />
        <Filters active={[status, planId].filter(Boolean).length}>
        <select className="inp" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="active">Active</option><option value="expiring">Expiring</option><option value="expired">Expired</option>
        </select>
        <select className="inp" aria-label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">All plans</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        </Filters>
      </div>
      <ErrorBox msg={err} />
      {!data && !err ? <Loading h={200} /> : data && (
        <div className="mem-tbl"><Table rows={data.items} onRow={(m) => onOpen(m.id)} cols={memberCols()}
          empty={dq || status || planId ? 'No members match these filters.' : 'No members yet. Sell the first membership to get started.'} /></div>
      )}
    </div>
  );
}

function ExpiringTab({ rev, onOpen, onRenew }: { rev: number; onOpen: (id: string) => void; onRenew: (m: Member) => void }) {
  const [data, err] = useApi<{ items: Member[] }>(`${B}/expiring?days=14`, [rev]);
  return (
    <div className="card">
      <div className="card-head"><h3>Ending in the next 14 days</h3>{data && <Chip tone={data.items.length ? 'warn' : 'good'}>{data.items.length}</Chip>}</div>
      <ErrorBox msg={err} />
      {!data && !err ? <Loading h={160} /> : data && <div className="mem-tbl"><Table rows={data.items} onRow={(m) => onOpen(m.id)} cols={memberCols(onRenew)} empty="No memberships end in the next 14 days." /></div>}
    </div>
  );
}

function PlansTab({ plans, onNew, onEdit }: { plans: Plan[] | null; onNew: () => void; onEdit: (p: Plan) => void }) {
  if (!plans) return <Loading h={160} />;
  return (
    <div className="stack">
      <div className="row"><button className="btn" onClick={onNew}>New plan</button></div>
      {!plans.length ? <Empty>No plans yet. Add one, for example "Monthly nets, 30 days".</Empty> : (
        <div className="grid g3">
          {plans.map((p) => (
            <div key={p.id} className={`card plan-card${p.active ? '' : ' off'}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}><h3>{p.name}</h3><Chip tone={p.active ? 'good' : 'mute'}>{p.active ? 'On sale' : 'Off'}</Chip></div>
              <div className="price">{inr(p.pricePaise)}</div>
              <div className="small muted">{p.durationDays} days · {p.members} current member{p.members === 1 ? '' : 's'}</div>
              <div className="perks">{p.perks || 'No perks listed.'}</div>
              <div><button className="btn sm" onClick={() => onEdit(p)}>Edit</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const WHAT: Record<string, string> = { 'membership.sell': 'Sold', 'membership.renew': 'Renewed', 'membership.update': 'Edited member', 'membership.plan.create': 'Added plan', 'membership.plan.update': 'Edited plan', 'membership.plan.delete': 'Deleted plan' };
function ActivityTab({ rev }: { rev: number }) {
  const [data, err] = useApi<{ items: AuditRow[]; total: number }>(`${B}/audit?limit=100`, [rev]);
  return (
    <div className="card">
      <ErrorBox msg={err} />
      {!data && !err ? <Loading h={160} /> : data && (!data.items.length ? <Empty>Nothing has happened yet.</Empty> : data.items.map((a) => {
        const d = a.detail ?? {};
        const line = a.action === 'membership.sell' || a.action === 'membership.renew'
          ? `${d.name ?? ''} · ${d.plan ?? ''} · ${inr(d.amountPaise)} by ${methodLabel(String(d.method ?? ''))}${d.reference ? ` (${d.reference})` : ''}`
          : a.action.startsWith('membership.plan') ? String(d.name ?? '') : '';
        return (
          <div className="audit-line" key={a.id}>
            <div><Chip tone={a.action.includes('sell') ? 'gold' : a.action.includes('renew') ? 'info' : 'mute'}>{WHAT[a.action] ?? a.action}</Chip> <span className="small">{line}</span></div>
            <div className="small muted">{fmtDateTime(a.at)} · {a.actorRole ?? 'system'}</div>
          </div>
        );
      }))}
    </div>
  );
}
