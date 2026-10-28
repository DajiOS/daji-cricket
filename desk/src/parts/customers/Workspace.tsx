// One customer's workspace: who they are and what they agreed to be sent, their bookings, their money with this ground, and what happened.
// Everything comes from GET /api/staff/customers/:id; the credit balance is the server's ledger, not a sum made here.
import { useState } from 'react';
import { Chip, ErrorBox, Field, Load, Modal, NameFields, PageHead, Status, Table, useToast } from '../../ui';
import { useApi, fmtDateTime, fmtDay, formatPhone, inr, patch } from '../../lib';
import { useSession } from '../../App';
import { errText } from '../admin/common';
import { LinkedDocs } from '../docs/LinkedDocs';
import { type Booking, BookingChip, METHOD_LABEL, PAY_STATUS, timeRange } from '../dash/common';
import CareerView, { type CareerData } from '../club/Career';

interface Pay { id: string; bookingId: string | null; method: string; status: string; amountPaise: number; createdAt: number }
interface Enq { id: string; status: string; preferredDate: string | null; message: string | null; createdAt: number; groundName: string | null }
interface Detail {
  customer: { id: string; name: string; firstName?: string; lastName?: string; phone: string | null; email: string | null; consent?: { email: boolean; sms: boolean; whatsapp: boolean } | null };
  bookings: Booking[]; payments: Pay[]; enquiries: Enq[]; creditBalancePaise: number;
}
export const CUSTOMER_TABS: [string, string][] = [['overview', 'Overview'], ['bookings', 'Bookings'], ['money', 'Money'], ['cricket', 'Cricket'], ['documents', 'Documents'], ['activity', 'Activity']];

export function CustomerWorkspace({ id, tab: tabIn }: { id: string; tab?: string }) {
  const [d, err, reload, status] = useApi<Detail>(`/api/staff/customers/${encodeURIComponent(id)}`);
  const [tab, setTab] = useState(CUSTOMER_TABS.some(([k]) => k === tabIn) ? tabIn! : 'overview');
  const base = `#/customers/${encodeURIComponent(id)}`;
  const { me } = useSession();
  const owner = me.role === 'owner' || me.role === 'super_admin';
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  return (
    <div className="stack">
      <PageHead eyebrow="Customer" title={d?.customer.name ?? (err ? 'Customer' : 'Loading…')} lede={d ? [d.customer.phone && formatPhone(d.customer.phone), d.customer.email].filter(Boolean).join(' · ') : undefined}>
        {owner && d && <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>}
        <a className="btn ghost" href="#/customers">All customers</a>
      </PageHead>
      {editing && d && <EditCustomer c={d.customer} onClose={() => setEditing(false)} onSaved={(msg) => { setEditing(false); toast(msg); reload(); }} />}
      <div role="tablist" aria-label="Customer workspace" className="dtabs ws-tabs">
        {CUSTOMER_TABS.map(([k, l]) => {
          const href = k === 'overview' ? base : `${base}/${k}`;
          return <a key={k} role="tab" aria-selected={tab === k} className={`dchip${tab === k ? ' on' : ''}`} href={href} onClick={(e) => { e.preventDefault(); setTab(k); history.replaceState(null, '', href); }}>{l}</a>;
        })}
      </div>
      <Load data={d} error={err} status={status} retry={reload}>{(x) => (
        <>
          {tab === 'overview' && (
            <div className="grid g2">
              <div className="card card-pad stack" style={{ gap: 10 }}>
                <div className="eyebrow">Contact</div>
                <div className="facts">
                  <div><span>Phone</span><b>{x.customer.phone ? formatPhone(x.customer.phone) : '—'}</b></div>
                  <div><span>Email</span><b>{x.customer.email ?? '—'}</b></div>
                </div>
                <div className="row" style={{ gap: 6 }} aria-label="Agreed to be sent">
                  {x.customer.consent ? (['whatsapp', 'email', 'sms'] as const).map((k) => [k, x.customer.consent![k]] as const).map(([k, v]) => <Chip key={k} tone={v ? 'good' : 'mute'}>{k === 'sms' ? 'SMS' : k[0]!.toUpperCase() + k.slice(1)}{v ? '' : ': no'}</Chip>) : <span className="small muted">No consent recorded.</span>}
                </div>
              </div>
              <div className="card card-pad stack" style={{ gap: 10 }}>
                <div className="eyebrow">With this ground</div>
                <div className="facts">
                  <div><span>Account credit</span><b className="gold">{inr(x.creditBalancePaise)}</b></div>
                  <div><span>Latest booking</span><b>{x.bookings[0] ? `${fmtDay(x.bookings[0].date)}, ${x.bookings[0].groundName}` : '—'}</b></div>
                  <div><span>Open enquiries</span><b>{x.enquiries.filter((e) => e.status !== 'converted' && e.status !== 'closed').length}</b></div>
                </div>
              </div>
            </div>)}
          {tab === 'bookings' && (
            <div className="card"><Table rows={x.bookings} rowKey={(b) => b.id} empty="No bookings." onRow={(b) => { location.hash = `/bookings/${b.id}`; }} cols={[
              { head: 'Ref', cell: (b) => <span className="strong">{b.ref}</span> },
              { head: 'When', cell: (b) => b.block ? <>{fmtDay(b.block.fromDate)} – {fmtDay(b.block.toDate)}<div className="small muted">{b.block.days} days · {timeRange(b)} daily</div></> : <>{fmtDay(b.date)}<div className="small muted">{timeRange(b)}</div></> },
              { head: 'Ground', cell: (b) => b.groundName },
              { head: 'Status', cell: (b) => <BookingChip b={b} /> },
              { head: 'Total', num: true, cell: (b) => inr(b.block ? b.block.totalPaise : b.totalPaise) },
              { head: 'Balance', num: true, cell: (b) => (b.block ? (b.block.cancelled ? '—' : inr(b.block.balancePaise)) : b.status === 'cancelled' || b.status === 'expired' ? '—' : inr(b.balancePaise)) },
            ]} /></div>)}
          {tab === 'money' && (
            <div className="stack">
              <div className="grid g3"><div className="miniStat"><span>Account credit</span><b className="gold">{inr(x.creditBalancePaise)}</b></div></div>
              <div className="card"><div className="card-head"><h3>Payments</h3></div><Table rows={x.payments} rowKey={(p) => p.id} empty="No payments." cols={[
                { head: 'When', cell: (p) => fmtDateTime(p.createdAt) },
                { head: 'Method', cell: (p) => METHOD_LABEL[p.method] || p.method },
                { head: 'Status', cell: (p) => <Status s={p.status} map={PAY_STATUS} /> },
                { head: 'Booking', cell: (p) => (p.bookingId ? <a href={`#/bookings/${p.bookingId}/money`}>Open</a> : '—') },
                { head: 'Amount', num: true, cell: (p) => inr(p.amountPaise) },
              ]} /></div>
            </div>)}
          {tab === 'cricket' && <Cricket id={id} />}
          {tab === 'documents' && <div className="card card-pad"><LinkedDocs kind="customer" id={id} /></div>}
          {tab === 'activity' && <Activity d={x} />}
        </>)}</Load>
    </div>
  );
}

/** Their career record from matches scored at this business (playerStats.ts on the server). */
function Cricket({ id }: { id: string }) {
  const [d, err, reload, status] = useApi<CareerData>(`/api/staff/customers/${encodeURIComponent(id)}/cricket`);
  return <Load data={d} error={err} status={status} retry={reload}>{(x) => <CareerView d={x} />}</Load>;
}

/** Bookings made, payments and enquiries, newest first. */
function Activity({ d }: { d: Detail }) {
  const rows = [
    ...d.bookings.map((b) => ({ at: b.createdAt, key: 'b' + b.id, text: b.block ? `Booked ${b.groundName} for ${fmtDay(b.block.fromDate)} – ${fmtDay(b.block.toDate)} (${b.block.days} days)` : `Booked ${b.groundName} for ${fmtDay(b.date)}`, href: `#/bookings/${b.id}` })),
    ...d.payments.map((p) => ({ at: p.createdAt, key: 'p' + p.id, text: `${METHOD_LABEL[p.method] || p.method} payment of ${inr(p.amountPaise)} (${(PAY_STATUS[p.status]?.[1] ?? p.status).toLowerCase()})`, href: p.bookingId ? `#/bookings/${p.bookingId}/money` : null })),
    ...d.enquiries.map((e) => ({ at: e.createdAt, key: 'e' + e.id, text: `Enquiry${e.groundName ? ` for ${e.groundName}` : ''} (${e.status.replace('_', ' ')})`, href: `#/enquiries/${e.id}` })),
  ].sort((a, b) => b.at - a.at);
  if (!rows.length) return <div data-state="empty" className="small muted">Nothing yet.</div>;
  return <ol className="timeline">{rows.map((r) => <li key={r.key} className="small"><span className="muted">{fmtDateTime(r.at)}</span> · {r.href ? <a href={r.href}>{r.text}</a> : r.text}</li>)}</ol>;
}

/** The owner corrects a customer's name, email, mobile or sets a new password (which ends every sign-in they have). */
function EditCustomer({ c, onClose, onSaved }: { c: Detail['customer']; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ first: c.firstName ?? '', last: c.lastName ?? '', email: c.email ?? '', phone: c.phone ?? '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: 'email' | 'phone' | 'password') => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    if (!f.first.trim()) { setErr('Type their first name.'); return; }
    setErr(null); setBusy(true);
    const body: Record<string, unknown> = {};
    if (f.first.trim() !== (c.firstName ?? '') || f.last.trim() !== (c.lastName ?? '')) { body.firstName = f.first.trim(); body.lastName = f.last.trim(); }
    if (f.email.trim() && f.email.trim() !== (c.email ?? '')) body.email = f.email.trim();
    if (f.phone.trim() && f.phone.trim() !== (c.phone ?? '')) body.phone = f.phone.trim();
    if (f.password) body.password = f.password;
    if (!Object.keys(body).length) { onClose(); return; }
    try { await patch(`/api/staff/customers/${encodeURIComponent(c.id)}`, body); onSaved(f.password ? 'Saved. Their old sign-ins have ended: they sign in again with the new password.' : 'Saved'); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  }
  return (
    <Modal title={`Edit ${c.name}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        <NameFields first={f.first} last={f.last} onFirst={(v) => setF((s) => ({ ...s, first: v }))} onLast={(v) => setF((s) => ({ ...s, last: v }))} required />
        <Field label="Email"><input className="inp" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Mobile number"><input className="inp" type="tel" placeholder="10 digit mobile number" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Set a new password" hint="Leave empty to keep their password. A new one signs them out everywhere."><input className="inp" type="text" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
      </div>
      <div style={{ marginTop: 10 }}><ErrorBox msg={err} /></div>
    </Modal>
  );
}
