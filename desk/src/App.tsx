import { createContext, useContext, useEffect, useRef, useState, Suspense } from 'react';
import { api, can, go, roleLabel, setAiName, setIsSuper, setToken, setUnauthorizedHandler, setViewOwner, getViewOwner, useApi, useRoute, getToken, type Me } from './lib';
import { Icon, ToastHost, Loading, Crest, ErrorBox } from './ui';
import { ThemeToggle } from './ThemeToggle';
import { Intro } from './Intro';
import { HOME, PAGES, SIDE, sideOf, navItem, itemFor, navVisible, hrefOf, type NavItem } from './registry';
import { resolveRoute } from './routes';
import { NotBuilt } from './parts/NotBuilt';
import { CommandSearch, askAssistant } from './CommandSearch';
import { AskPanel } from './AskPanel';
import { GroundPicker } from './GroundPicker';
import { AiNamePrefs } from './parts/admin/AiNamePrefs';

// ---------- session shared by every page ----------
export interface Owner { id: string; name: string; businessName: string | null }
interface Session { me: Me; owners: Owner[]; ownerId: string | null; setOwner: (id: string) => void; refreshCounts: () => void; updateMe?: (me: Me) => void }
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
  const [prefs, setPrefs] = useState(false);
  const meBox = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); setMeOpen(false); }, [route]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMeOpen(false); setOpen(false); } };
    const away = (e: MouseEvent) => { if (meBox.current && !meBox.current.contains(e.target as Node)) setMeOpen(false); };
    addEventListener('keydown', esc); addEventListener('mousedown', away);
    return () => { removeEventListener('keydown', esc); removeEventListener('mousedown', away); };
  }, []);
  const visible = (i: NavItem) => navVisible(s.me, i);
  // the one menu item for this address (the longest match), and the sidebar entry it sits under
  const active = itemFor(route);
  const here = sideOf(route);
  const side = SIDE.map((x) => {
    const pages = (x.pages ?? []).map(navItem).filter((i): i is NavItem => !!i && visible(i));
    return { ...x, list: pages, first: x.to ?? (pages[0] ? hrefOf(pages[0]) : undefined) };
  }).filter((x) => x.action || (x.to ? (!x.anyPerm || x.anyPerm.some((p) => can(s.me, p))) : x.list.length > 0));

  // a register address (/finance/gst) opens the page that serves it (/accounting/gst) and keeps its own address in the bar
  const res = resolveRoute(route);
  const hit = PAGES.find((p) => res.path === p.path || res.path.startsWith(p.path + '/'));
  const Page = hit ? hit.page : HOME;
  const sub = hit ? res.path.slice(hit.path.length + 1) : '';

  const [counts, , reloadCounts] = useApi<{ count: number }>(can(s.me, 'manage_accounting') && s.ownerId ? '/api/accounting/approvals/count' : null, [route, s.ownerId]);
  const [today, , reloadToday] = useApi<{ awaitingVerification: number; needsReview: number }>(can(s.me, 'manage_bookings') && s.ownerId ? '/api/staff/today' : null, [s.ownerId]);
  const waiting = counts?.count ?? 0;
  const alerts = waiting + (today?.awaitingVerification ?? 0) + (today?.needsReview ?? 0);
  s.refreshCounts = () => { reloadCounts(); reloadToday(); };
  const signOut = () => { const t = getToken(); const done = () => { setToken(null); location.href = './'; }; if (!t) return done(); fetch(((window as any).DAJI_API || '').replace(/\/$/, '') + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + t } }).catch(() => {}).finally(done); };
  const owner = s.owners.find((o) => o.id === s.ownerId);
  const groundLabel = owner?.businessName || s.me.businessName || 'Daji Cricket Ground';
  // the pages that sit with this one, as chips above it (the same list the sidebar shows under its entry)
  const siblings = here && !here.to ? side.find((x) => x.key === here.key)?.list ?? [] : [];

  return (
    <div className="dapp">
      <nav className={`dside${open ? ' open' : ''}`} aria-label="Menu" id="main-menu">
        <a className="dside-brand" href="./" aria-label="Daji Cricket Ground, back to the website">
          <span className="dside-word">Daji<img src="assets/icon.svg" alt="" width={30} height={30} /></span>
          <span className="dside-name">Cricket Ground</span>
          <span className="dside-tag">Play · Practice · Grow</span>
        </a>
        <div className="dside-items">
          {side.map((x) => {
            const on = here?.key === x.key;
            if (x.action === 'ask') return <button key={x.key} type="button" className="dside-item" onClick={() => { setOpen(false); askAssistant(); }}><Icon name={x.icon} size={20} /><span>{x.label}</span></button>;
            return (
              <div key={x.key} className={`dside-grp${on ? ' on' : ''}`}>
                <a href={`#${x.first}`} className={`dside-item${on ? ' on' : ''}`} aria-current={on && (x.to || x.list.length < 2) ? 'page' : undefined}>
                  <Icon name={x.icon} size={20} /><span>{x.label}</span>
                  {x.count === 'approvals' && waiting > 0 && <span className="dside-n" aria-label={`${waiting} waiting`}>{waiting}</span>}
                </a>
                {on && x.list.length > 1 && (
                  <div className="dside-subs">
                    {x.list.map((i) => <a key={hrefOf(i)} href={`#${hrefOf(i)}`} className={`dside-sub${active === i ? ' on' : ''}`} aria-current={active === i ? 'page' : undefined}>{i.label}</a>)}
                  </div>)}
              </div>);
          })}
        </div>
        <div className="dside-foot">
          <button type="button" className="dside-item" onClick={signOut}><Icon name="logout" size={20} /><span>Sign out</span></button>
        </div>
      </nav>
      <AskPanel />
      {prefs && <AiNamePrefs onClose={() => setPrefs(false)} onSaved={(m) => s.updateMe?.(m)} />}
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="dmain">
        <header className="dtop">
          <button type="button" className="dround dburger" onClick={() => setOpen(true)} aria-label="Open the menu" aria-controls="main-menu" aria-expanded={open}><Icon name="menu" size={18} /></button>
          <CommandSearch me={s.me} visible={visible} />
          <span className="dtop-gap" />
          <GroundPicker />
          <ThemeToggle />
          <a className="dround dbell" href={alerts && can(s.me, 'manage_bookings') ? '#/' : '#/activity'} aria-label={alerts ? `${alerts} things need you` : 'What happened'} title={alerts ? `${alerts} things need you` : 'What happened'}>
            <Icon name="bell" size={19} />{alerts > 0 && <span className="dbell-n">{alerts > 99 ? '99+' : alerts}</span>}
          </a>
          <div className="duser-box" ref={meBox}>
            <button type="button" className="duser" onClick={() => setMeOpen(!meOpen)} aria-expanded={meOpen} aria-haspopup="menu">
              <span className="duser-av">{initialsOf(s.me.name || s.me.email || '')}</span>
              <span className="duser-txt"><b>{s.me.name}</b><span>{roleLabel(s.me)}</span></span>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {meOpen && (
              <div className="duser-pop" role="menu">
                <b>{s.me.name}</b>
                <span className="muted small">{roleLabel(s.me)} · {groundLabel}</span>
                <button type="button" role="menuitem" className="link" onClick={() => { setMeOpen(false); setPrefs(true); }}>Preferences</button>
                <a role="menuitem" href="./">View website</a>
                <button type="button" role="menuitem" className="link" onClick={signOut}>Sign out</button>
              </div>)}
          </div>
        </header>
        <main className="main dcontent">
          {siblings.length > 1 && (
            <div role="tablist" aria-label={here!.label} className="dtabs no-print">
              {siblings.map((p) => <a key={hrefOf(p)} role="tab" aria-selected={active === p} href={`#${hrefOf(p)}`} className={`dchip${active === p ? ' on' : ''}`}>{p.label}</a>)}
            </div>)}
          <div className="page" key={route}><Suspense fallback={<p className="muted" style={{ padding: 24 }}>Loading…</p>}>{res.unserved ? <NotBuilt row={res.unserved} /> : <Page sub={sub} />}</Suspense></div>
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
          <ErrorBox msg={err} />
          <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <button className="btn ghost" onClick={onSignOut}>Sign out</button>
            <button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={() => (agree ? accept() : setErr('Tick “I accept these terms” first, then press Accept and continue.'))}>Accept and continue</button>
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
      setAiName(u.aiName);
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
      <SessionCtx.Provider value={{ me, owners, ownerId, setOwner, refreshCounts: () => {}, updateMe: (m) => setMe({ ...me, ...m }) }}>
        <Shell key={ownerId ?? 'none'} route={route} />
      </SessionCtx.Provider>
    </ToastHost>
  );
}
export { go, Loading };
