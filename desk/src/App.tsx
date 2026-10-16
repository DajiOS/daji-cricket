import { createContext, useContext, useEffect, useRef, useState, Fragment } from 'react';
import { api, can, go, roleLabel, setIsSuper, setToken, setUnauthorizedHandler, setViewOwner, getViewOwner, useApi, useRoute, getToken, type Me } from './lib';
import { Icon, Logo, ToastHost, Loading, Crest } from './ui';
import { HOME, NAV, PAGES, SUBS, subHref, type NavItem } from './registry';

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
  const [openGroups, setOpenGroups] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('daji.deskGroups') || '["Ground","Finance"]'); } catch { return ['Ground', 'Finance']; } });
  const toggleGroup = (g: string) => setOpenGroups((gs) => { const n = gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]; try { localStorage.setItem('daji.deskGroups', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  useEffect(() => { setOpen(false); setFly(null); }, [route]);
  // The menu can fold into a narrow icon rail (remembered in this browser). In the rail, a group opens as a pop-up list beside it.
  const [rail, setRail] = useState<boolean>(() => { try { return localStorage.getItem('daji.deskRail') === '1'; } catch { return false; } });
  const setRailSaved = (v: boolean) => { setRail(v); setFly(null); try { localStorage.setItem('daji.deskRail', v ? '1' : '0'); } catch { /* ignore */ } };
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 860px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 860px)'); const f = () => setNarrow(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const collapsed = rail && !narrow;
  const [fly, setFly] = useState<{ group: string; top: number } | null>(null);
  const flyTimer = useRef<number | undefined>(undefined);
  const openFly = (group: string, el: HTMLElement) => { clearTimeout(flyTimer.current); setFly({ group, top: Math.max(8, Math.min(el.getBoundingClientRect().top, innerHeight - 80)) }); };
  const closeFlySoon = () => { clearTimeout(flyTimer.current); flyTimer.current = window.setTimeout(() => setFly(null), 180); };
  useEffect(() => { if (!fly) return; const f = (e: KeyboardEvent) => e.key === 'Escape' && setFly(null); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [fly]);
  /** Which section of a page is showing (the first one when the address is just the page). */
  const subOn = (to: string, k: string) => { const first = SUBS[to]![0]![0]; const rest = route === to ? '' : route.startsWith(to + '/') ? route.slice(to.length + 1).split('/')[0]! : null; return rest !== null && (rest === k || (!SUBS[to]!.some(([x]) => x === rest) && k === first) || (rest === '' && k === first)); };
  const isOn = (to: string) => (to === '/' ? route === '/' || route === '' : route === to || route.startsWith(to + '/'));
  const visible = (i: NavItem) => can(s.me, i.perm) && (!i.ownerOnly || s.me.role !== 'staff') && (!i.superOnly || s.me.role === 'super_admin');

  const hit = PAGES.find((p) => route === p.path || route.startsWith(p.path + '/'));
  const Page = hit ? hit.page : HOME;
  const sub = hit ? route.slice(hit.path.length + 1) : '';

  const [counts, , reloadCounts] = useApi<{ count: number }>(can(s.me, 'manage_accounting') && s.ownerId ? '/api/accounting/approvals/count' : null, [route, s.ownerId]);
  const waiting = counts?.count ?? 0;
  s.refreshCounts = reloadCounts;
  const signOut = () => { setToken(null); location.href = './'; };
  const all = NAV.flatMap((g) => g.items);
  const bottom = ['/', '/bookings', '/bills', '/approvals', '/settings'].map((to) => all.find((i) => i.to === to)).filter((i): i is NavItem => !!i && visible(i));
  const owner = s.owners.find((o) => o.id === s.ownerId);

  return (
    <div className={`shell${collapsed ? ' rail' : ''}`}>
      <aside className={`side${open ? ' open' : ''}`} aria-label="Main navigation">
        <a className="brand" href="./" aria-label="Daji Cricket Ground, back to the website">{collapsed ? <Crest size={36} /> : <Logo width={196} />}</a>
        {collapsed ? (
          <nav className="nav rail-nav" aria-label="Menu groups">
            {NAV.map((g) => {
              const items = g.items.filter(visible);
              if (!items.length) return null;
              const active = items.some((i) => isOn(i.to));
              const waitingHere = items.some((i) => i.count === 'approvals') && waiting > 0;
              if ((items.length === 1 && !SUBS[items[0]!.to]) || g.group === 'Portfolio') return items.map((i) => (
                <a key={i.to} href={`#${i.to}`} className={`rail-btn${isOn(i.to) ? ' on' : ''}`} title={i.label} aria-label={i.label}><Icon name={i.icon} /></a>));
              return (
                <button key={g.group} className={`rail-btn${active ? ' on' : ''}`} aria-haspopup="true" aria-expanded={fly?.group === g.group} aria-label={g.group} title={g.group}
                  onMouseEnter={(e) => openFly(g.group, e.currentTarget)} onMouseLeave={closeFlySoon} onFocus={(e) => openFly(g.group, e.currentTarget)}
                  onClick={(e) => openFly(g.group, e.currentTarget)}>
                  <Icon name={items[0]!.icon} />{waitingHere && <span className="rail-dot" aria-hidden="true" />}
                </button>);
            })}
          </nav>
        ) : (
        <nav className="nav">
          {NAV.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            const active = items.some((i) => isOn(i.to));
            const shown = g.group === 'Portfolio' || active || openGroups.includes(g.group);
            return (
              <div key={g.group}>
                {g.group === 'Portfolio' ? <div className="nav-group">{g.group}</div>
                  : <button className="nav-group nav-toggle" onClick={() => !active && toggleGroup(g.group)} aria-expanded={shown}>{g.group} <span aria-hidden="true">{shown ? '▾' : '▸'}</span>{!shown && <span className="soon-n">{items.length}</span>}</button>}
                {shown && items.map((i) => (
                  <Fragment key={i.to}>
                    <a href={`#${i.to}`} className={isOn(i.to) ? 'on' : ''}>
                      <Icon name={i.icon} />{i.label}
                      {i.count === 'approvals' && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
                    </a>
                    {SUBS[i.to] && isOn(i.to) && SUBS[i.to]!.map(([k, l]) => <a key={k} href={`#${subHref(i.to, k)}`} className={`sub${subOn(i.to, k) ? ' on' : ''}`}>{l}</a>)}
                  </Fragment>))}
              </div>);
          })}
        </nav>
        )}
        <div className="side-foot">
          {collapsed ? <button className="rail-btn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="logout" /></button> : <>
            <div style={{ color: 'var(--ivory)', fontWeight: 700 }}>{s.me.name}</div>
            <div className="small">{roleLabel(s.me)}</div>
            <button className="btn ghost sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={signOut}><Icon name="logout" />Sign out</button></>}
        </div>
      </aside>
      {collapsed && fly && (() => {
        const g = NAV.find((x) => x.group === fly.group); const items = g ? g.items.filter(visible) : [];
        return (
          <div className="flyout" role="menu" aria-label={fly.group} style={{ top: fly.top }} onMouseEnter={() => clearTimeout(flyTimer.current)} onMouseLeave={closeFlySoon}>
            <div className="nav-group">{fly.group}</div>
            {items.map((i) => (
              <Fragment key={i.to}>
                <a href={`#${i.to}`} role="menuitem" className={isOn(i.to) ? 'on' : ''} onClick={() => setFly(null)}>
                  <Icon name={i.icon} />{i.label}
                  {i.count === 'approvals' && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
                </a>
                {SUBS[i.to]?.map(([k, l]) => <a key={k} href={`#${subHref(i.to, k)}`} role="menuitem" className={`sub${isOn(i.to) && subOn(i.to, k) ? ' on' : ''}`} onClick={() => setFly(null)}>{l}</a>)}
              </Fragment>))}
          </div>);
      })()}
      {open && <div className="overlay" style={{ zIndex: 35, padding: 0 }} onClick={() => setOpen(false)} />}
      <main className="main">
        <header className="top">
          <button className="btn ghost sm menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <button className="btn ghost sm rail-toggle" onClick={() => setRailSaved(!rail)} aria-label={rail ? 'Show the full menu' : 'Fold the menu'} aria-pressed={rail} title={rail ? 'Show the full menu' : 'Fold the menu'}><Icon name="menu" /></button>
          {s.me.role === 'super_admin'
            ? <div className="seg hide-sm" role="group" aria-label="Business">{s.owners.map((o) => <button key={o.id} className={o.id === s.ownerId ? 'on' : ''} onClick={() => s.setOwner(o.id)}>{o.businessName || o.name}</button>)}</div>
            : <div className="seg hide-sm" role="group" aria-label="Business"><button className="on">{owner?.businessName || s.me.businessName || 'Daji Cricket Ground'}</button></div>}
          <div className="spacer" />
          <a className="btn ghost sm hide-sm" href="./">View website</a>
          <span className="badge b-gold hide-sm">{roleLabel(s.me)}</span>
        </header>
        <div className="page" key={route}><Page sub={sub} /></div>
      </main>
      <nav className="bottom-nav" aria-label="Quick navigation">
        {bottom.map((i) => <a key={i.to} href={`#${i.to}`} className={isOn(i.to) ? 'on' : ''}><Icon name={i.icon} />{i.label}</a>)}
      </nav>
    </div>
  );
}

export function App() {
  const route = useRoute();
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
      setMe(u);
    }).catch(signInPage);
  }, []);
  if (me === undefined) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><Crest size={72} /></div>;
  if (!me) return null;
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
