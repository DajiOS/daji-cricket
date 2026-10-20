import { createContext, useContext, useEffect, useRef, useState, Suspense } from 'react';
import { api, can, go, roleLabel, setIsSuper, setToken, setUnauthorizedHandler, setViewOwner, getViewOwner, useApi, useRoute, getToken, type Me } from './lib';
import { Icon, ToastHost, Loading, Crest } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { Intro } from './Intro';
import { HOME, NAV, PAGES, RAIL, BLURBS, railOf, itemFor, navVisible, type NavItem, type RailItem } from './registry';
import { CommandSearch, openSearch } from './CommandSearch';
import { GroundPicker } from './GroundPicker';

// ---------- session shared by every page ----------
export interface Owner { id: string; name: string; businessName: string | null }
interface Session { me: Me; owners: Owner[]; ownerId: string | null; setOwner: (id: string) => void; refreshCounts: () => void }
const SessionCtx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(SessionCtx);

const signInPage = () => { location.replace('./#login'); };

function initialsOf(name: string) {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

function Shell({ route }: { route: string }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const [fly, setFly] = useState<{ key: string; top: number } | null>(null);
  const flyTimer = useRef<number | undefined>(undefined);
  const phone = () => matchMedia('(max-width: 900px)').matches;
  const show = (key: string, el: HTMLElement) => { clearTimeout(flyTimer.current); setFly({ key, top: Math.max(8, Math.min(el.getBoundingClientRect().top - 10, innerHeight - 560)) }); };
  const hide = () => { clearTimeout(flyTimer.current); flyTimer.current = window.setTimeout(() => setFly(null), 160); };
  useEffect(() => { setOpen(false); setFly(null); setMeOpen(false); }, [route]);
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFly(null); setMeOpen(false); } }; addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  const visible = (i: NavItem) => navVisible(s.me, i);
  const allowed = (r: RailItem) => can(s.me, r.perm) && (!r.anyPerm || r.anyPerm.some((p) => can(s.me, p))) && (!r.ownerOnly || s.me.role !== 'staff');
  // the one menu item for this address (the longest match), and the rail button it sits under
  const active = itemFor(route, NAV.flatMap((g) => g.items));
  const here = railOf(route);
  const jobsOf = (sec?: string) => NAV.filter((g) => g.section === sec).map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length);
  const rail = RAIL.map((r) => {
    const jobs = r.section ? jobsOf(r.section) : [];
    return { ...r, jobs, first: r.to ?? (r.hub ? `/hub/${r.section}` : jobs[0]?.items[0]?.to) };
  }).filter((r) => (r.to ? allowed(r) : r.jobs.length > 0));

  const hit = PAGES.find((p) => route === p.path || route.startsWith(p.path + '/'));
  const Page = hit ? hit.page : HOME;
  const sub = hit ? route.slice(hit.path.length + 1) : '';

  const [counts, , reloadCounts] = useApi<{ count: number }>(can(s.me, 'manage_accounting') && s.ownerId ? '/api/accounting/approvals/count' : null, [route, s.ownerId]);
  const waiting = counts?.count ?? 0;
  s.refreshCounts = reloadCounts;
  const signOut = () => { const t = getToken(); const done = () => { setToken(null); location.href = './'; }; if (!t) return done(); fetch(((window as any).DAJI_API || '').replace(/\/$/, '') + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + t } }).catch(() => {}).finally(done); };
  const owner = s.owners.find((o) => o.id === s.ownerId);
  const groundLabel = owner?.businessName || s.me.businessName || 'Daji Cricket Ground';
  // the section bar above a department page: the department, where the page sits and the other pages in that job
  const job = active ? NAV.find((g) => g.items.includes(active)) : undefined;
  const bar = here?.section && job ? { rail: here, job, pages: job.items.filter(visible) } : null;

  return (
    <div className="dapp">
      <nav className={`drail${open ? ' open' : ''}`} aria-label="Menu" id="main-menu" onScroll={() => setFly(null)}>
        <a className="drail-mark" href="./" aria-label="Daji Cricket Ground, back to the website"><Crest size={40} /></a>
        <div className="drail-items">
          {rail.map((r) => {
            const on = here?.key === r.key, hasSubs = r.jobs.length > 0, isOpen = fly?.key === r.key;
            return (
              <div key={r.key} className="drail-item" onMouseEnter={(e) => { if (hasSubs && !phone()) show(r.key, e.currentTarget); }} onMouseLeave={hide}>
                {r.sep && <span className="drail-sep">{r.sep}</span>}
                <a href={`#${r.first}`} className={`drail-btn${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} aria-haspopup={hasSubs || undefined} aria-expanded={hasSubs ? isOpen : undefined} title={r.label}
                  onFocus={(e) => { if (hasSubs && !phone()) show(r.key, e.currentTarget.parentElement!); }}
                  onClick={(e) => { if (hasSubs && phone()) { e.preventDefault(); if (isOpen) setFly(null); else show(r.key, e.currentTarget.parentElement!); } }}>
                  <Icon name={r.icon} size={22} /><span>{r.short}</span>
                  {r.key === 'approvals' && waiting > 0 && <span className="drail-n" aria-label={`${waiting} waiting`}>{waiting}</span>}
                </a>
                {isOpen && (
                  <div className="drail-fly" style={{ top: fly!.top }} onMouseEnter={() => clearTimeout(flyTimer.current)}>
                    <div role="menu" aria-label={r.label} className="drail-panel" style={{ maxHeight: `min(86vh, ${innerHeight - fly!.top - 12}px)` }}>
                      <span className="drail-title">{r.label}</span>
                      {r.jobs.map((g) => (
                        <div key={g.group} className={`drail-grp${job === g ? ' on' : ''}`}>
                          <a role="menuitem" href={`#${g.items[0]!.to}`} className="drail-gname"><b>{g.group} ›</b><span>{BLURBS[g.group]}</span></a>
                          <div className="drail-pages">
                            {g.items.map((i) => <a key={i.to} role="menuitem" href={`#${i.to}`} className={`drail-page${active === i ? ' on' : ''}`} aria-current={active === i ? 'page' : undefined}>{i.label}{i.count === 'approvals' && waiting > 0 ? ` · ${waiting}` : ''}</a>)}
                          </div>
                        </div>))}
                    </div>
                  </div>)}
              </div>);
          })}
        </div>
        <div className="drail-foot">
          <button type="button" className="drail-me" onClick={() => setMeOpen(!meOpen)} aria-expanded={meOpen} aria-haspopup="menu" title={`${s.me.name} · ${roleLabel(s.me)} · ${groundLabel}`}>{initialsOf(s.me.name || s.me.email || '')}</button>
          <span className="drail-hotel">{groundLabel}</span>
          {meOpen && (
            <div className="drail-mepop" role="menu">
              <b>{s.me.name}</b>
              <span className="muted small">{roleLabel(s.me)}</span>
              <a role="menuitem" href="./">View website</a>
              <button type="button" role="menuitem" className="link" onClick={signOut}>Sign out</button>
            </div>)}
        </div>
      </nav>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="dmain">
        <header className="dtop">
          <button type="button" className="dround dburger" onClick={() => setOpen(true)} aria-label="Open the menu" aria-controls="main-menu" aria-expanded={open}><Icon name="menu" size={18} /></button>
          <CommandSearch me={s.me} visible={visible} />
          <GroundPicker />
          <ThemeToggle />
          <a className="dround" href="#/activity" aria-label="What happened" title="What happened"><Icon name="bell" size={18} /></a>
          <button type="button" className="dconcierge" onClick={openSearch}><Icon name="ai" size={16} /><span>Assistant</span></button>
        </header>
        <main className="main dcontent">
          {bar && (
            <div className="dsechead no-print">
              <div className="dsec-title"><span className="eyebrow">{bar.rail.eyebrow}</span><h1>{bar.rail.label}</h1>{bar.rail.desc && <span className="muted">{bar.rail.desc}</span>}</div>
              <div className="dsection">
                <span className="dcrumb">{bar.rail.label}{'  ›  '}{bar.job.group}</span>
                {bar.pages.length > 1 && <div role="tablist" className="dtabs">{bar.pages.map((p) => <a key={p.to} role="tab" aria-selected={active === p} href={`#${p.to}`} className={`dchip${active === p ? ' on' : ''}`}>{p.label}</a>)}</div>}
              </div>
            </div>)}
          <div className="page" key={route}><Suspense fallback={<p className="muted" style={{ padding: 24 }}>Loading…</p>}><Page sub={sub} /></Suspense></div>
        </main>
      </div>
    </div>
  );
}

interface Terms { version: number; sha256: string; title: string; body: string; accepted: unknown }

/** Team members read and accept the current terms before the desk opens. The server refuses everything else until they do. */
function TermsGate({ terms, onDone, onSignOut }: { terms: Terms; onDone: () => void; onSignOut: () => void }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function accept() {
    setBusy(true); setErr(null);
    try { await api('/api/legal/staff-terms/accept', { method: 'POST', body: { version: terms.version, sha256: terms.sha256 } }); onDone(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 720, width: '100%' }}>
        <div className="card-head"><h3>{terms.title}</h3></div>
        <div className="card-pad">
          <p className="small muted">Please read these terms. You need to accept them once before you can use the desk. Your acceptance is saved with the time and your device address.</p>
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', maxHeight: '45vh', overflow: 'auto', padding: 12, border: '1px solid var(--line, #ddd)', borderRadius: 8 }}>{terms.body}</pre>
          <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I accept these terms</span></label>
          {err && <p style={{ color: 'var(--bad)' }}>{err}</p>}
          <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <button className="btn ghost" onClick={onSignOut}>Sign out</button>
            <button className="btn primary" disabled={!agree || busy} onClick={accept}>Accept and continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [terms, setTerms] = useState<Terms | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  useEffect(() => {
    setUnauthorizedHandler(signInPage);
    if (!getToken()) { signInPage(); return; }
    api<{ user: Me }>('/api/me').then(async (r) => {
      const u = r.user;
      if (u.role === 'customer') { location.replace('./'); return; }
      setIsSuper(u.role === 'super_admin');
      if (u.role === 'super_admin') {
        const list = await api<{ items: Owner[] }>('/api/admin/users?role=owner&limit=100').then((x) => x.items).catch(() => []);
        setOwners(list);
        const keep = getViewOwner();
        const pick = list.find((o) => o.id === keep)?.id ?? list[0]?.id ?? null;
        setViewOwner(pick); setOwnerId(pick);
      } else { setOwnerId(u.ownerId ?? u.id); setOwners([{ id: u.ownerId ?? u.id, name: u.name, businessName: u.businessName }]); }
      if (u.role === 'staff') {
        const t = await api<Terms & { accepted: unknown }>('/api/legal/staff-terms').catch(() => null);
        if (t && !t.accepted) setTerms(t);
      }
      setMe(u);
    }).catch(signInPage);
  }, []);
  if (me === undefined) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><Crest size={72} /></div>;
  if (!me) return null;
  if (terms) return <TermsGate terms={terms} onDone={() => setTerms(null)} onSignOut={() => { const t = getToken(); fetch(((window as any).DAJI_API || '').replace(/\/$/, '') + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + (t ?? '') } }).catch(() => {}).finally(() => { setToken(null); location.href = './'; }); }} />;
  const setOwner = (id: string) => { setViewOwner(id); setOwnerId(id); };
  // the key makes every page reload its data when a super admin switches business
  return (
    <ToastHost>
      <SessionCtx.Provider value={{ me, owners, ownerId, setOwner, refreshCounts: () => {} }}>
        <Shell key={ownerId ?? 'none'} route={route} />
      </SessionCtx.Provider>
    </ToastHost>
  );
}
export { go, Loading };
