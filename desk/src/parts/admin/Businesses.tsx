// The software owner's customers: every business on the software (Daji Cricket Ground first), how far each is set up, its booking
// page and web address, and which one the main website shows. Never a business's takings or its customers: those stay in its own desk.
import { useState } from 'react';
import { useApi, post, put, del, fmtDateTime, formatPhone } from '../../lib';
import { Loading, ErrorBox, Chip, Field, Empty, useToast } from '../../ui';
import { Panel, errText } from './common';

interface Business {
  id: string; businessName: string; ownerName: string; email: string | null; phone: string | null; active: boolean; canSignIn: boolean;
  grounds: number; activeGrounds: number; team: number; createdAt: number; siteDomain: string | null; slug: string; mainSite: boolean; hasLogo: boolean; hasAppLogo: boolean;
}
interface List { mainSiteBusinessId: string | null; items: Business[] }

const API = ((window as any).DAJI_API || location.origin).replace(/\/$/, '');

function AddBusiness({ onAdded }: { onAdded: () => void }) {
  const toast = useToast();
  const blank = { businessName: '', ownerName: '', phone: '', email: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function add() {
    setBusy(true); setMsg(null);
    try { const b = await post<Business>('/api/admin/businesses', f); toast(`${b.businessName} added. Nothing was sent to ${b.ownerName}.`); setF(blank); onAdded(); }
    catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  return (
    <Panel title="Add a customer business" note="Makes the owner's account with no password. Nothing is sent to them: when you are ready, they set a password with Forgot password, using this email.">
      <div className="form-grid">
        <Field label="Business name" required><input className="inp" value={f.businessName} onChange={set('businessName')} placeholder="Antroli Cricket Ground" /></Field>
        <Field label="Owner's name" required><input className="inp" autoComplete="off" value={f.ownerName} onChange={set('ownerName')} /></Field>
        <Field label="Owner's mobile" required><input className="inp" inputMode="tel" autoComplete="off" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Owner's email" required><input className="inp" type="email" autoComplete="off" value={f.email} onChange={set('email')} /></Field>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" disabled={busy} onClick={add}>Add business</button>
        {msg && <span className="err-text" role="alert">{msg}</span>}
      </div>
    </Panel>
  );
}

interface Person { userId: string; name: string; businessName: string; addedAt: number }

// Portfolio: other business owners whose own sign-in also opens this business (each switches to it at the top of the desk).
// It shares nothing between the businesses; removing someone splits them again at once.
function Portfolio({ b, all }: { b: Business; all: Business[] }) {
  const toast = useToast();
  const [data, error, reload] = useApi<{ items: Person[] }>(`/api/admin/businesses/${encodeURIComponent(b.id)}/portfolio`);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox msg={error} />;
  if (!data) return null;
  const have = new Set(data.items.map((p) => p.userId));
  const others = all.filter((o) => o.id !== b.id && !have.has(o.id));
  async function add() {
    if (!pick) return toast('Choose whose portfolio to add it to');
    const who = all.find((o) => o.id === pick);
    if (!window.confirm(`Let ${who?.ownerName} (${who?.businessName}) open ${b.businessName} with their own sign-in, with an owner's full access to it?`)) return;
    setBusy(true);
    try { await post(`/api/admin/businesses/${encodeURIComponent(b.id)}/portfolio`, { userId: pick }); toast(`${b.businessName} is now in ${who?.ownerName}'s portfolio.`); setPick(''); reload(); } catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  async function remove(p: Person) {
    if (!window.confirm(`Take ${b.businessName} out of ${p.name}'s portfolio? They cannot open it from their next click.`)) return;
    setBusy(true);
    try { await del(`/api/admin/businesses/${encodeURIComponent(b.id)}/portfolio/${encodeURIComponent(p.userId)}`); toast('Removed.'); reload(); } catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div className="small muted">Also opened by (portfolio): {data.items.length ? '' : 'nobody else'}</div>
      {data.items.map((p) => (
        <div key={p.userId} className="row" style={{ alignItems: 'center' }}>
          <span>{p.name} <span className="small muted">({p.businessName}) · since {fmtDateTime(p.addedAt)}</span></span>
          <button className="btn sm ghost" disabled={busy} onClick={() => remove(p)}>Remove</button>
        </div>))}
      {others.length > 0 && (
        <div className="row" style={{ alignItems: 'center', marginTop: 4 }}>
          <select className="inp" aria-label={`Add ${b.businessName} to someone's portfolio`} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add to the portfolio of…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.ownerName} ({o.businessName})</option>)}
          </select>
          <button className="btn sm" disabled={busy} onClick={add}>Add</button>
        </div>)}
    </div>
  );
}

function Row({ b, all, onSaved }: { b: Business; all: Business[]; onSaved: () => void }) {
  const toast = useToast();
  const [slug, setSlug] = useState(b.slug);
  const [domain, setDomain] = useState(b.siteDomain ?? '');
  const [busy, setBusy] = useState(false);
  const page = `${API}/b/${b.slug}`;
  async function save() {
    setBusy(true);
    try { await put(`/api/desk/brand?ownerId=${encodeURIComponent(b.id)}`, { slug: slug.trim(), siteDomain: domain.trim() }); toast('Saved.'); onSaved(); }
    catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  async function makeMain() {
    if (!window.confirm(`Show ${b.businessName}'s grounds on the main website instead of the business shown there now?`)) return;
    setBusy(true);
    try { await put('/api/admin/settings', { mainSiteBusinessId: b.id }); toast(`The main website now shows ${b.businessName}.`); onSaved(); }
    catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  return (
    <div className="dl-person">
      <div className="row">
        <b>{b.businessName}</b>
        {b.mainSite && <Chip tone="good">Main website</Chip>}
        {!b.active && <Chip tone="bad">Switched off</Chip>}
        <Chip tone={b.canSignIn ? 'good' : 'warn'}>{b.canSignIn ? 'Owner can sign in' : 'No password yet'}</Chip>
        <Chip tone={b.activeGrounds ? 'good' : 'mute'}>{b.activeGrounds ? `${b.activeGrounds} ground${b.activeGrounds === 1 ? '' : 's'} live` : 'No grounds yet'}</Chip>
        {b.hasLogo ? <Chip tone="info">Logo</Chip> : <Chip tone="mute">No logo</Chip>}
      </div>
      <div className="small muted" style={{ margin: '4px 0 8px' }}>
        {b.ownerName}{b.phone ? ` · ${formatPhone(b.phone)}` : ''}{b.email ? ` · ${b.email}` : ''} · team of {b.team} · added {fmtDateTime(b.createdAt)}
      </div>
      <div className="fields">
        <label className="f"><span>Booking page address</span><input className="inp" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} aria-describedby={`pg-${b.id}`} /><div className="hint" id={`pg-${b.id}`}>{b.mainSite ? 'The main website is this business\'s booking site.' : <a href={page} target="_blank" rel="noopener">{page}</a>}</div></label>
        <label className="f"><span>Its own web address</span><input className="inp" value={domain} placeholder="Not yet" onChange={(e) => setDomain(e.target.value)} /><div className="hint">When the business has a domain, point it at this server, then enter it here.</div></label>
      </div>
      <div className="row">
        <button className="btn sm" disabled={busy} onClick={save}>Save</button>
        {!b.mainSite && <button className="btn sm ghost" disabled={busy} onClick={makeMain}>Show on the main website instead</button>}
      </div>
      <Portfolio b={b} all={all} />
    </div>
  );
}

export default function Businesses() {
  const [data, error, reload] = useApi<List>('/api/admin/businesses');
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <Panel title="Businesses" note="Each business here has its own name, logo, grounds, customers, team and money, kept apart from every other business. This list shows who they are and how far they are set up, never their figures.">
        {data.items.map((b) => <Row key={b.id} b={b} all={data.items} onSaved={reload} />)}
        {!data.items.length && <Empty>No customer businesses yet.</Empty>}
        {!data.mainSiteBusinessId && data.items.length > 0 && <p className="small muted">The main website shows every business's grounds until you choose one with "Show on the main website". Adding a second business chooses the first one for you.</p>}
      </Panel>
      <AddBusiness onAdded={reload} />
    </div>
  );
}
