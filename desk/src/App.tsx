import { createContext, useContext, useEffect, useState } from 'react';
import { api, can, go, roleLabel, setIsSuper, setToken, setUnauthorizedHandler, setViewOwner, getViewOwner, useApi, useRoute, getToken, type Me } from './lib';
import { Icon, Logo, ToastHost, Loading, Crest } from './ui';
import { HOME, NAV, PAGES, type NavItem } from './registry';

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
  useEffect(() => setOpen(false), [route]);
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
    <div className="shell">
      <aside className={`side${open ? ' open' : ''}`} aria-label="Main navigation">
        <a className="brand" href="./" aria-label="Daji Cricket Ground, back to the website"><Logo width={196} /></a>
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
                  <a key={i.to} href={`#${i.to}`} className={isOn(i.to) ? 'on' : ''}>
                    <Icon name={i.icon} />{i.label}
                    {i.count === 'approvals' && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
                  </a>))}
              </div>);
          })}
        </nav>
        <div className="side-foot">
          <div style={{ color: 'var(--ivory)', fontWeight: 700 }}>{s.me.name}</div>
          <div className="small">{roleLabel(s.me)}</div>
          <button className="btn ghost sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={signOut}><Icon name="logout" />Sign out</button>
        </div>
      </aside>
      {open && <div className="overlay" style={{ zIndex: 35, padding: 0 }} onClick={() => setOpen(false)} />}
      <main className="main">
        <header className="top">
          <button className="btn ghost sm menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
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
