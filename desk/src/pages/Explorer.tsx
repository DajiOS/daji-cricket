import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../App';
import { PageHead, ErrorBox, Icon, Chip, useToast } from '../ui';
import { api, patch, go, can, inr, fmtDateTime, formatPhone, type Me } from '../lib';

// The starter kit's explorer and inspector: a tree of everything in the business on the left, the picked record on the right.
// A vendor's details can be filled from a pasted email signature, as in the kit.
type Kind = 'grounds' | 'plans' | 'vendors' | 'customers' | 'team';
interface Node { id: string; label: string; hint?: string; data: any }
interface Branch { kind: Kind; title: string; icon: string; show: (me: Me) => boolean; load: (q: string, ownerId: string | null) => Promise<Node[]> }

const BRANCHES: Branch[] = [
  { kind: 'grounds', title: 'Grounds', icon: 'ball', show: () => true,
    load: async (_q, owner) => (await api<{ items: any[] }>('/api/grounds')).items.filter((g) => g.ownerId === owner).map((g) => ({ id: g.id, label: g.name, hint: g.surface ?? undefined, data: g })) },
  { kind: 'plans', title: 'Membership plans', icon: 'card', show: (me) => can(me, 'manage_bookings'),
    load: async () => (await api<{ items: any[] }>('/api/desk/memberships/plans')).items.map((p) => ({ id: p.id, label: p.name, hint: `${p.members} member${p.members === 1 ? '' : 's'}`, data: p })) },
  { kind: 'vendors', title: 'Vendors', icon: 'warehouse', show: (me) => can(me, 'manage_accounting'),
    load: async (q) => (await api<{ items: any[] }>(`/api/accounting/vendors${q ? `?q=${encodeURIComponent(q)}` : ''}`)).items.map((v) => ({ id: v.id, label: v.name, hint: `${v.billCount} bill${v.billCount === 1 ? '' : 's'}`, data: v })) },
  { kind: 'customers', title: 'Customers', icon: 'users', show: (me) => can(me, 'view_customers'),
    load: async (q) => (await api<{ items: any[] }>(`/api/staff/customers?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`)).items.map((c) => ({ id: c.id, label: c.name, hint: `${c.bookings} booking${c.bookings === 1 ? '' : 's'}`, data: c })) },
  { kind: 'team', title: 'Team', icon: 'shield', show: (me) => me.role !== 'staff',
    load: async () => (await api<{ items: any[] }>('/api/staff/team')).items.map((m) => ({ id: m.id, label: m.name, hint: m.active ? undefined : 'switched off', data: m })) },
];

export default function Explorer({ sub }: { sub: string }) {
  const { me, ownerId } = useSession();
  const [kind0, id] = sub.split('/') as [Kind | undefined, string | undefined];
  const branches = BRANCHES.filter((b) => b.show(me));
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const [open, setOpen] = useState<Kind[]>(() => [kind0 ?? 'grounds']);
  const [nodes, setNodes] = useState<Partial<Record<Kind, Node[] | string>>>({});
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let live = true;
    for (const b of branches) b.load(dq, ownerId).then((xs) => live && setNodes((n) => ({ ...n, [b.kind]: xs }))).catch((e) => live && setNodes((n) => ({ ...n, [b.kind]: e.message })));
    return () => { live = false; };
  }, [dq, ownerId, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const filt = (xs: Node[]) => (dq ? xs.filter((x) => `${x.label} ${x.hint ?? ''}`.toLowerCase().includes(dq.toLowerCase())) : xs);
  const picked = kind0 && id ? (Array.isArray(nodes[kind0]) ? (nodes[kind0] as Node[]).find((x) => x.id === id) : undefined) : undefined;
  const toggle = (k: Kind) => setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));

  return (
    <div className="stack">
      <PageHead eyebrow="Everything in one tree" title="Explorer" lede="Grounds, plans, vendors, customers and the team, each opening on the right with its details and the place to change it." />
      <div className="xp">
        <nav className="card xp-tree" aria-label="Explorer">
          <div className="xp-search"><Icon name="search" size={15} /><input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter the tree" aria-label="Filter the tree" /></div>
          <ul role="tree">
            {branches.map((b) => {
              const xs = nodes[b.kind];
              const list = Array.isArray(xs) ? filt(xs) : null;
              const isOpen = open.includes(b.kind) || !!dq;
              return (
                <li key={b.kind} role="treeitem" aria-expanded={isOpen}>
                  <button className="xp-branch" onClick={() => toggle(b.kind)}>
                    <span className={`xp-caret${isOpen ? ' open' : ''}`} aria-hidden="true"><Icon name="chevron" size={12} /></span>
                    <Icon name={b.icon} size={16} /><span>{b.title}</span><span className="xp-n small muted">{list ? list.length : ''}</span>
                  </button>
                  {isOpen && (typeof xs === 'string' ? <p className="small err" style={{ margin: '2px 12px 8px 34px' }}>{xs}</p> : !list ? <p className="small muted xp-leafmsg">Loading…</p> : !list.length ? <p className="small muted xp-leafmsg">{dq ? 'Nothing matches' : 'None yet'}</p> : (
                    <ul role="group">{list.map((x) => (
                      <li key={x.id} role="treeitem" aria-selected={kind0 === b.kind && id === x.id}>
                        <a href={`#/explore/${b.kind}/${x.id}`} className={`xp-leaf${kind0 === b.kind && id === x.id ? ' on' : ''}`}><span>{x.label}</span>{x.hint && <span className="small muted">{x.hint}</span>}</a>
                      </li>))}</ul>))}
                </li>);
            })}
          </ul>
        </nav>
        <section className="card xp-insp" aria-live="polite">
          {!picked ? <div className="card-pad muted xp-empty"><Icon name="list" size={28} /><p>Pick something in the tree to see it here.</p></div>
            : <Inspector kind={kind0!} node={picked} me={me} onSaved={() => setRev((r) => r + 1)} />}
        </section>
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="xp-rows">{rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function Inspector({ kind, node, me, onSaved }: { kind: Kind; node: Node; me: Me; onSaved: () => void }) {
  const d = node.data;
  const head = (eyebrow: string, extra?: React.ReactNode) => <div className="card-head"><div><div className="eyebrow">{eyebrow}</div><h2 style={{ margin: '2px 0 0' }}>{node.label}</h2></div>{extra}</div>;
  if (kind === 'grounds') return (<>
    {head('Ground')}
    <div className="card-pad">
      {d.description && <p style={{ marginTop: 0 }}>{d.description}</p>}
      <Rows rows={[['Surface', d.surface], ['Open', d.openTime && `${d.openTime} to ${d.closeTime}`], ['Winter hours', d.winterOpenTime && `${d.winterOpenTime} to ${d.winterCloseTime}`], ['Place', [d.area, d.city].filter(Boolean).join(', ')], ['Facilities', (d.facilities ?? []).join(', ')]]} />
      <div className="row" style={{ marginTop: 16 }}>
        {can(me, 'manage_bookings') && <button className="btn primary" onClick={() => go('/bookings/day')}>Day view</button>}
        {me.role !== 'staff' && <button className="btn" onClick={() => go('/settings/prices')}>Prices and timings</button>}
        {can(me, 'manage_bookings') && <button className="btn" onClick={() => go('/compare/grounds')}>Compare the grounds</button>}
      </div>
    </div></>);
  if (kind === 'plans') return (<>
    {head('Membership plan', <Chip tone={d.active ? 'good' : 'mute'}>{d.active ? 'On sale' : 'Not on sale'}</Chip>)}
    <div className="card-pad">
      <Rows rows={[['Price', inr(d.pricePaise)], ['Lasts', `${d.durationDays} days`], ['Members', d.members], ['Perks', d.perks]]} />
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => go('/memberships')}>Members</button><button className="btn" onClick={() => go('/memberships/plans')}>Edit plans</button></div>
    </div></>);
  if (kind === 'customers') return (<>
    {head('Customer')}
    <div className="card-pad">
      <Rows rows={[['Phone', formatPhone(d.phone)], ['Email', d.email], ['Bookings', d.bookings], ['Played', d.played], ['Paid in all', can(me, 'view_revenue') && d.paidPaise != null ? inr(d.paidPaise) : null], ['Last booking', d.lastBookingAt ? fmtDateTime(d.lastBookingAt) : null]]} />
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => go('/contacts')}>Open in Contacts</button></div>
    </div></>);
  if (kind === 'team') return (<>
    {head('Team member', <Chip tone={d.active ? 'good' : 'mute'}>{d.active ? 'Active' : 'Switched off'}</Chip>)}
    <div className="card-pad">
      <Rows rows={[['Email', d.email], ['Phone', formatPhone(d.phone)], ['Can', d.permissions?.length ? d.permissions.map((p: string) => p.replace(/_/g, ' ')).join(', ') : 'Nothing yet']]} />
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => go('/team')}>Users & Access</button></div>
    </div></>);
  return <VendorInspector node={node} onSaved={onSaved} head={head} />;
}

/** Finds a phone, UPI ID, GSTIN, email and website in a pasted email signature. Lines it cannot place go to the notes. */
export function readSignature(text: string): { phone?: string; upiId?: string; gstin?: string; email?: string; rest: string[] } {
  const out: ReturnType<typeof readSignature> = { rest: [] };
  const gst = text.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/);
  if (gst) out.gstin = gst[0];
  const ph = text.match(/(?:\+?91[\s-]*)?\b[6-9]\d{2}[\s-]?\d{2}[\s-]?\d{5}\b|(?:\+?91[\s-]*)?\b[6-9]\d{4}[\s-]?\d{5}\b/);
  if (ph) { const digits = ph[0].replace(/\D/g, '').slice(-10); if (digits.length === 10) out.phone = digits; }
  const at = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g) ?? [];
  for (const a of at) { if (/@[\w-]+\.[a-z]{2,}/i.test(a)) out.email ??= a; else out.upiId ??= a; }
  const skip = /^(regards|thanks|thank you|best|warm regards|sent from|--)/i;
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (skip.test(line)) continue;
    const bare = line.replace(/(phone|mobile|mob|tel|email|e-mail|gstin?|gst no\.?|upi)\s*[:.-]?\s*/gi, '').trim();
    if ((out.phone && bare.replace(/\D/g, '').endsWith(out.phone)) || (out.gstin && bare.toUpperCase() === out.gstin) || (out.email && bare === out.email) || (out.upiId && bare === out.upiId) || !bare) continue;
    out.rest.push(line);
  }
  return out;
}

function VendorInspector({ node, onSaved, head }: { node: Node; onSaved: () => void; head: (e: string, x?: React.ReactNode) => React.ReactNode }) {
  const toast = useToast();
  const d = node.data;
  const blank = useMemo(() => ({ name: d.name ?? '', phone: d.phone ?? '', upiId: d.upiId ?? '', gstin: d.gstin ?? '', notes: d.notes ?? '' }), [d]);
  const [f, setF] = useState(blank);
  useEffect(() => setF(blank), [blank]);
  const [sig, setSig] = useState<string | null>(null);
  const [found, setFound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const changed = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== blank[k]);

  function capture() {
    const r = readSignature(sig ?? '');
    const extra = [r.email && `Email: ${r.email}`, ...r.rest.filter((l) => l.toLowerCase() !== f.name.toLowerCase())].filter(Boolean) as string[];
    const notes = [f.notes, ...extra.filter((l) => !f.notes.includes(l))].filter(Boolean).join('\n').slice(0, 500);
    setF({ ...f, phone: f.phone || r.phone || '', upiId: f.upiId || r.upiId || '', gstin: f.gstin || r.gstin || '', notes });
    setFound([r.phone && 'phone', r.upiId && 'UPI ID', r.gstin && 'GSTIN', r.email && 'email', extra.length > (r.email ? 1 : 0) && 'address and other lines'].filter(Boolean) as string[]);
    setSig(null);
  }
  async function save() {
    setBusy(true); setErr(null);
    try { await patch(`/api/accounting/vendors/${d.id}`, f); toast('Vendor saved'); setFound([]); onSaved(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (<>
    {head('Vendor', d.openPaise > 0 ? <Chip tone="warn">{inr(d.openPaise)} open</Chip> : undefined)}
    <div className="card-pad stack" style={{ gap: 12 }}>
      <div className="small muted">{d.billCount} bill{d.billCount === 1 ? '' : 's'} entered{d.openPaise > 0 ? `, ${inr(d.openPaise)} still to pay` : ''}.</div>
      {sig === null
        ? <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSig('')}><Icon name="inbox" />Fill from an email signature</button>
        : <div className="xp-sig">
            <label className="f full"><span>Paste the signature from the vendor's email</span><textarea className="inp" rows={6} autoFocus value={sig} onChange={(e) => setSig(e.target.value)} placeholder={'Ramesh Patel\nSurat Turf Supplies\n+91 98250 12345\nGSTIN 24ABCDE1234F1Z5\nramesh@surat-turf.in'} /></label>
            <div className="row"><button className="btn primary sm" onClick={() => (sig.trim() ? capture() : setErr('Paste the signature from the vendor’s email first.'))}>Read it</button><button className="btn ghost sm" onClick={() => setSig(null)}>Cancel</button></div>
          </div>}
      {found.length > 0 && <p className="small" style={{ margin: 0, color: 'var(--i-green)' }}>Found {found.join(', ')}. Check the fields, then save. Fields that already had a value were kept.</p>}
      <div className="grid g2">
        <label className="f"><span>Name</span><input className="inp" value={f.name} onChange={set('name')} /></label>
        <label className="f"><span>Phone</span><input className="inp" value={f.phone} onChange={set('phone')} inputMode="tel" /></label>
        <label className="f"><span>UPI ID</span><input className="inp" value={f.upiId} onChange={set('upiId')} placeholder="name@bank" /></label>
        <label className="f"><span>GSTIN</span><input className="inp" value={f.gstin} onChange={set('gstin')} maxLength={15} /></label>
      </div>
      <label className="f full"><span>Notes</span><textarea className="inp" rows={4} value={f.notes} onChange={set('notes')} maxLength={500} /></label>
      <ErrorBox msg={err} />
      <div className="row">
        <button className="btn primary" disabled={!changed || busy} onClick={save}>Save</button>
        {changed && <button className="btn ghost" onClick={() => { setF(blank); setFound([]); }}>Undo changes</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => go('/bills/vendors')}>Vendors and their bills</button>
      </div>
    </div></>);
}
