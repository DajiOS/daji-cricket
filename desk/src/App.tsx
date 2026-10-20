import { createContext, useContext, useEffect, useRef, useState, Suspense } from 'react';
import { api, can, go, roleLabel, setIsSuper, setToken, setUnauthorizedHandler, setViewOwner, getViewOwner, useApi, useRoute, getToken, type Me } from './lib';
import { Icon, Logo, ToastHost, Loading, Crest } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { Intro } from './Intro';
import { HOME, NAV, PAGES, SECTIONS, itemFor, navVisible, type NavItem } from './registry';
import { CommandSearch, AskBox } from './CommandSearch';
import { GroundPicker } from './GroundPicker';

// ---------- session shared by every page ----------
export interface Owner { id: string; name: string; businessName: string | null }
interface Session { me: Me; owners: Owner[]; ownerId: string | null; setOwner: (id: string) => void; refreshCounts: () => void }
const SessionCtx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(SessionCtx);

const signInPage = () => { location.replace('./#login'); };

function Shell({ route }: { route: string }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  // Menu groups fold away; the group holding the current page is always open. Choices are remembered in this browser.
  const [openGroups, setOpenGroups] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('daji.deskSections') || '[]'); } catch { return []; } });
  const toggleGroup = (g: string) => setOpenGroups((gs) => { const n = gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]; try { localStorage.setItem('daji.deskSections', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  useEffect(() => { setOpen(false); setFly(null); }, [route]);
  // The menu starts as a narrow icon rail and the three-line button opens the full menu with names (the choice is remembered in this browser). In the rail, a group opens as a pop-up list beside it.
  const [rail, setRail] = useState<boolean>(() => { try { return localStorage.getItem('daji.deskRail2') !== '0'; } catch { return true; } });
  const setRailSaved = (v: boolean) => { setRail(v); setFly(null); try { localStorage.setItem('daji.deskRail2', v ? '1' : '0'); } catch { /* ignore */ } };
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 860px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 860px)'); const f = () => setNarrow(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const collapsed = rail && !narrow;
  const [fly, setFly] = useState<{ key: string; top: number } | null>(null);
  const flyTimer = useRef<number | undefined>(undefined);
  const openFly = (key: string, el: HTMLElement) => { clearTimeout(flyTimer.current); setFly({ key, top: Math.max(8, Math.min(el.getBoundingClientRect().top, innerHeight - 80)) }); };
  const closeFlySoon = () => { clearTimeout(flyTimer.current); flyTimer.current = window.setTimeout(() => setFly(null), 180); };
  useEffect(() => { if (!fly) return; const f = (e: KeyboardEvent) => e.key === 'Escape' && setFly(null); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [fly]);
  const visible = (i: NavItem) => navVisible(s.me, i);
  // the one menu item for this address (the longest match), and the section it sits in
  const active = itemFor(route, NAV.flatMap((g) => g.items));
  const activeSection = active ? NAV.find((g) => g.items.includes(active))!.section : null;
  const isOn = (to: string) => active?.to === to;
  const jobsOf = (key: string) => NAV.filter((g) => g.section === key).map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length);

  const hit = PAGES.find((p) => route === p.path || route.startsWith(p.path + '/'));
  const Page = hit ? hit.page : HOME;
  const sub = hit ? route.slice(hit.path.length + 1) : '';

  const [counts, , reloadCounts] = useApi<{ count: number }>(can(s.me, 'manage_accounting') && s.ownerId ? '/api/accounting/approvals/count' : null, [route, s.ownerId]);
  const waiting = counts?.count ?? 0;
  s.refreshCounts = reloadCounts;
  const signOut = () => { const t = getToken(); const done = () => { setToken(null); location.href = './'; }; if (!t) return done(); fetch(((window as any).DAJI_API || '').replace(/\/$/, '') + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + t } }).catch(() => {}).finally(done); };
  const all = NAV.flatMap((g) => g.items);
  const bottom = ([['/', 'Home'], ['/bookings', 'Bookings'], ['/bills', 'Bills'], ['/approvals', 'Approvals'], ['/settings', 'Settings']] as const).map(([to, label]): NavItem | null => { const i = all.find((x) => x.to === to); return i && visible(i) ? { ...i, label } : null; }).filter((i): i is NavItem => !!i);
  const under = (to: string) => (to === '/' ? !route || route === '/' : route === to || route.startsWith(to + '/'));

  return (
    <div className={`shell${collapsed ? ' rail' : ''}`}>
      <aside className={`side${open ? ' open' : ''}`} aria-label="Main navigation">
        <a className="brand" href="./" aria-label="Daji Cricket Ground, back to the website">{collapsed ? <Crest size={36} /> : <Logo width={196} />}</a>
        <button className="rail-toggle side-toggle" onClick={() => setRailSaved(!rail)} aria-label={rail ? 'Open the menu' : 'Fold the menu'} aria-pressed={rail} title={rail ? 'Open the menu' : 'Fold the menu'}><Icon name="menu" />{collapsed ? <span className="rail-label" aria-hidden="true">Menu</span> : <span>Fold menu</span>}</button>
        {collapsed ? (
          <nav className="nav rail-nav" aria-label="Menu">
            {SECTIONS.map((sec) => {
              const jobs = jobsOf(sec.key);
              if (!jobs.length) return null;
              const on = activeSection === sec.key;
              const dot = jobs.some((g) => g.items.some((i) => i.count === 'approvals')) && waiting > 0;
              const only = jobs.length === 1 && jobs[0]!.items.length === 1 ? jobs[0]!.items[0]! : null;
              if (only) return <a key={sec.key} href={`#${only.to}`} className={`rail-btn${on ? ' on' : ''}`} title={sec.title} aria-label={sec.title}><Icon name={sec.icon} /><span className="rail-label" aria-hidden="true">{sec.title}</span></a>;
              return (
                <button key={sec.key} className={`rail-btn${on ? ' on' : ''}`} aria-haspopup="true" aria-expanded={fly?.key === sec.key} aria-label={sec.title} title={sec.title}
                  onMouseEnter={(e) => openFly(sec.key, e.currentTarget)} onMouseLeave={closeFlySoon} onFocus={(e) => openFly(sec.key, e.currentTarget)}
                  onClick={(e) => openFly(sec.key, e.currentTarget)}>
                  <Icon name={sec.icon} /><span className="rail-label" aria-hidden="true">{sec.title}</span>{dot && <span className="rail-dot" aria-hidden="true" />}
                </button>);
            })}
          </nav>
        ) : (
        <nav className="nav">
          {SECTIONS.map((sec) => {
            const jobs = jobsOf(sec.key);
            if (!jobs.length) return null;
            const only = jobs.length === 1 && jobs[0]!.items.length === 1 ? jobs[0]!.items[0]! : null;
            if (only) return <a key={sec.key} href={`#${only.to}`} className={`nav-sec${isOn(only.to) ? ' on' : ''}`}><Icon name={sec.icon} />{sec.title}</a>;
            const here = activeSection === sec.key;
            const shown = here || openGroups.includes(sec.key);
            return (
              <div key={sec.key}>
                <button className={`nav-sec nav-toggle${here ? ' here' : ''}`} onClick={() => !here && toggleGroup(sec.key)} aria-expanded={shown}><Icon name={sec.icon} />{sec.title}<span className="spacer" /><span aria-hidden="true">{shown ? '▾' : '▸'}</span></button>
                {shown && jobs.map((g) => (
                  <div key={g.group} className="nav-job">
                    <div className="nav-group">{g.group}</div>
                    {g.items.map((i) => (
                      <a key={i.to} href={`#${i.to}`} className={isOn(i.to) ? 'on' : ''}>
                        <Icon name={i.icon} />{i.label}
                        {i.count === 'approvals' && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
                      </a>))}
                  </div>))}
              </div>);
          })}
        </nav>
        )}
        <div className="side-foot">
          {collapsed ? <button className="rail-btn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="logout" /><span className="rail-label" aria-hidden="true">Sign out</span></button> : <>
            <div style={{ color: 'var(--ivory)', fontWeight: 700 }}>{s.me.name}</div>
            <div className="small">{roleLabel(s.me)}</div>
            <button className="btn ghost sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={signOut}><Icon name="logout" />Sign out</button></>}
        </div>
      </aside>
      {collapsed && fly && (() => {
        const sec = SECTIONS.find((x) => x.key === fly.key);
        const jobs = sec ? jobsOf(sec.key) : [];
        if (!sec || !jobs.length) return null;
        return (
          <div className={`flyout${jobs.length > 2 ? ' wide' : ''}`} role="menu" aria-label={sec.title} style={{ top: Math.min(fly.top, innerHeight - (jobs.length > 2 ? 360 : 260)) }} onMouseEnter={() => clearTimeout(flyTimer.current)} onMouseLeave={closeFlySoon}>
            <div className="fly-title">{sec.title}</div>
            <div className="fly-jobs">
              {jobs.map((g) => (
                <div key={g.group} className="fly-job">
                  <div className="nav-group">{g.group}</div>
                  {g.items.map((i) => (
                    <a key={i.to} href={`#${i.to}`} role="menuitem" className={isOn(i.to) ? 'on' : ''} onClick={() => setFly(null)}>
                      <Icon name={i.icon} />{i.label}
                      {i.count === 'approvals' && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
                    </a>))}
                </div>))}
            </div>
          </div>);
      })()}
      {open && <div className="overlay" style={{ zIndex: 35, padding: 0 }} onClick={() => setOpen(false)} />}
      <main className="main">
        <header className="top">
          <button className="btn ghost sm menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <GroundPicker />
          <div className="spacer" />
          <CommandSearch me={s.me} visible={visible} />
          <AskBox className="hide-md" />
          <a className="btn ghost sm hide-sm" href="./">View website</a>
          <span className="badge b-gold hide-sm">{roleLabel(s.me)}</span>
          <ThemeToggle />
        </header>
        <div className="page" key={route}><Suspense fallback={<p className="muted" style={{ padding: 24 }}>Loading…</p>}><Page sub={sub} /></Suspense></div>
      </main>
      <nav className="bottom-nav" aria-label="Quick navigation">
        {bottom.map((i) => <a key={i.to} href={`#${i.to}`} className={under(i.to) ? 'on' : ''}><Icon name={i.icon} />{i.label}</a>)}
      </nav>
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
