import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, can, fmtDate, go, inr, type Me } from './lib';
import { Icon } from './ui';
import { NAV, SUBS, SUB_ICONS, subHref, seesMoney, type NavItem } from './registry';

// The starter kit's command search: type to jump to any page, to do something, or to ask a question about the business.
// It lists only the pages and records the person can already open. Ctrl+K or ⌘K (or "/") opens it from anywhere in the desk.

interface Hit { key: string; kind: 'Go to' | 'Do' | 'Booking' | 'Bill' | 'Vendor' | 'Ask'; label: string; hint?: string; icon: string; run: () => void }

/** Things people do often, each opening the page or form that does it. */
const ACTIONS: (NavItem & { words: string })[] = [
  { to: '/bookings/new', label: 'New booking', icon: 'plus', perm: 'manage_bookings', words: 'add book session walk in' },
  { to: '/bookings/block', label: 'Multi-day or tournament booking', icon: 'calendar', perm: 'manage_bookings', words: 'block several days' },
  { to: '/bookings/payments', label: 'Verify UPI payments', icon: 'payments', perm: 'verify_payments', words: 'check upi money received' },
  { to: '/approvals', label: 'Approve bills and bookings', icon: 'check', perm: 'manage_accounting', words: 'approval waiting sign' },
  { to: '/bills', label: 'Enter a bill', icon: 'billing', perm: 'manage_accounting', words: 'vendor invoice expense pay' },
  { to: '/bank', label: 'Import a bank statement', icon: 'upload', perm: 'manage_accounting', words: 'upload csv pdf statement' },
  { to: '/close', label: 'Close the month', icon: 'lock', perm: 'view_revenue', check: seesMoney, words: 'month end sign off lock' },
  { to: '/payroll/run', label: 'Run payroll', icon: 'payroll', ownerOnly: true, words: 'salary wages pay staff' },
  { to: '/reminders', label: 'Send WhatsApp reminders', icon: 'chat', perm: 'send_broadcasts', words: 'message remind due' },
  { to: '/tasks', label: 'Give someone a job', icon: 'tasks', perm: 'manage_tasks', words: 'task assign job' },
  { to: '/memberships/expiring', label: 'Renew memberships ending soon', icon: 'bell', perm: 'manage_bookings', words: 'expire renew member' },
  { to: '/calendar', label: 'Open the operations calendar', icon: 'calendar', words: 'month dates schedule' },
  { to: '/money', label: 'See where the money went', icon: 'swap', check: seesMoney, words: 'money flow earned collected banked paid' },
];

const section = (h: Hit) => (h.kind === 'Go to' ? 'Pages' : h.kind === 'Do' ? 'Shortcuts' : h.kind === 'Ask' ? 'Ask' : 'Records');
const fold = (t: string) => t.toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ');
function score(text: string, q: string): number {
  const t = fold(text), words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return 1;
  let s = 0;
  for (const w of words) { const i = t.indexOf(w); if (i < 0) return 0; s += i === 0 || t[i - 1] === ' ' ? 3 : 1; }
  return s;
}

/** Opens the search with a question already asked: the assistant box in the top bar and on Home use this. */
export const askAssistant = (question = '') => dispatchEvent(new CustomEvent('daji:ask', { detail: question }));

/** The starter kit's assistant box: type a question about the business and the answer opens in the search. */
export function AskBox({ className = '', placeholder = 'Ask about the ground…' }: { className?: string; placeholder?: string }) {
  const [q, setQ] = useState('');
  return (
    <form className={`ask-box ${className}`} role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) { askAssistant(q.trim()); setQ(''); } }}>
      <Icon name="ai" size={16} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Ask a question about the business" />
      <button type="submit" className="ask-go" aria-label="Ask" disabled={q.trim().length < 3}><Icon name="chevron" size={14} /></button>
    </form>
  );
}

/** Opens the search with nothing typed: the assistant button in the top bar uses this. */
export const openSearch = () => dispatchEvent(new Event('daji:open'));

export function CommandSearch({ me, visible }: { me: Me; visible: (i: NavItem) => boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const o = () => setOpen(true);
    addEventListener('daji:open', o); return () => removeEventListener('daji:open', o);
  }, []);
  const mac = useMemo(() => /Mac|iPhone|iPad/.test(navigator.platform), []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === '/' && !typing && !document.querySelector('.overlay')) { e.preventDefault(); setOpen(true); }
    };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, []);
  return (
    <>
      <div className="dsearch">
        <button type="button" className="dsearch-btn" onClick={() => setOpen(true)} aria-label="Search, jump or ask" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}>
          <Icon name="search" size={16} /><span>Search pages, bookings, bills… or ask a question</span><kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </div>
      {/* the top bar blurs what is behind it, which would trap a fixed overlay inside it, so the search opens on the page body */}
      {open && createPortal(<Palette me={me} visible={visible} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Palette({ me, visible, onClose }: { me: Me; visible: (i: NavItem) => boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const [found, setFound] = useState<Hit[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const jump = (to: string) => { onClose(); go(to); };

  // every page and section this person can open, and the shortcuts they are allowed to use
  const places = useMemo(() => {
    const out: (Hit & { text: string })[] = [];
    // a page can be both a menu item and a section of another item, so each address is listed once
    const seen = new Set(NAV.flatMap((g) => g.items.map((i) => i.to)));
    for (const g of NAV) for (const i of g.items.filter(visible)) {
      out.push({ key: i.to, kind: 'Go to', label: i.label, hint: g.group, icon: i.icon, run: () => jump(i.to), text: `${i.label} ${g.group}` });
      for (const [k, l] of SUBS[i.to] ?? []) if (k && !seen.has(subHref(i.to, k)) && seen.add(subHref(i.to, k))) out.push({ key: `${i.to}/${k}`, kind: 'Go to', label: l, hint: `${g.group} › ${i.label}`, icon: SUB_ICONS[`${i.to}:${k}`] ?? 'chevron', run: () => jump(subHref(i.to, k)), text: `${l} ${i.label} ${g.group}` });
    }
    const acts = ACTIONS.filter(visible).map((a) => ({ key: 'do:' + a.to, kind: 'Do' as const, label: a.label, icon: a.icon, run: () => jump(a.to), text: `${a.label} ${a.words}` }));
    return { pages: out, acts };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // records: bookings by reference, name or phone, and bills and vendors by name or number
  useEffect(() => {
    setFound([]);
    const t = q.trim();
    if (t.length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const enc = encodeURIComponent(t);
      const jobs: Promise<Hit[]>[] = [];
      if (can(me, 'manage_bookings')) jobs.push(api<{ items: any[] }>(`/api/staff/bookings?q=${enc}&limit=5`).then((r) => r.items.map((b) => ({ key: 'b:' + b.id, kind: 'Booking' as const, label: `${b.ref} · ${b.customerName}`, hint: `${fmtDate(b.date)} · ${b.groundName}`, icon: 'calendar', run: () => jump(`/bookings/${b.id}`) }))).catch(() => []));
      if (seesMoney(me)) {
        jobs.push(api<{ items: any[] }>(`/api/accounting/bills?q=${enc}`).then((r) => r.items.slice(0, 5).map((b) => ({ key: 'bill:' + b.id, kind: 'Bill' as const, label: `${b.vendorName}${b.billNo ? ' · ' + b.billNo : ''}`, hint: `${inr(b.amountPaise)} · due ${fmtDate(b.dueDate)}`, icon: 'billing', run: () => jump(`/bills/${b.id}`) }))).catch(() => []));
        jobs.push(api<{ items: any[] }>(`/api/accounting/vendors?q=${enc}`).then((r) => r.items.slice(0, 3).map((v) => ({ key: 'v:' + v.id, kind: 'Vendor' as const, label: v.name, hint: 'Vendors', icon: 'warehouse', run: () => jump('/bills/vendors') }))).catch(() => []));
      }
      const all = (await Promise.all(jobs)).flat();
      if (live) setFound(all);
    }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const hits: Hit[] = useMemo(() => {
    const t = q.trim();
    const rank = <T extends { text: string }>(xs: T[], n: number) => xs.map((x) => [x, score(x.text, t)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([x]) => x);
    const askRow: Hit[] = t.length >= 3 ? [{ key: 'ask', kind: 'Ask', label: t.endsWith('?') ? t : `${t}?`, hint: 'Asks Guppi', icon: 'ai', run: () => { onClose(); askAssistant(t); } }] : [];
    const pages = rank(places.pages, t ? 8 : 6), acts = rank(places.acts, t ? 5 : 6);
    // a question goes first; otherwise the closest page or shortcut
    return t.endsWith('?') ? [...askRow, ...acts, ...pages, ...found] : [...acts, ...pages, ...found, ...askRow];
  }, [q, places, found]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [at]);
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [onClose]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && hits[at]) { e.preventDefault(); hits[at]!.run(); }
  };

  return (
    <div className="overlay cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search, jump or ask">
        <div className="cmdk-input">
          <Icon name="search" size={19} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Type a page, a booking reference, a vendor, or ask a question…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="cmdk-list"
            aria-activedescendant={hits[at] ? `cmdk-${at}` : undefined} />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={list}>
          {hits.length === 0 && <p className="muted" style={{ padding: '14px 18px', margin: 0 }}>Nothing matches. End with a question mark to ask instead.</p>}
          {hits.map((h, i) => {
            const head = i === 0 || section(hits[i - 1]!) !== section(h);
            return (
              <div key={h.key}>
                {head && <div className="cmdk-group" role="presentation">{section(h)}</div>}
                <div id={`cmdk-${i}`} role="option" aria-selected={i === at} className="cmdk-row" onMouseMove={() => setAt(i)} onClick={() => h.run()}>
                  <Icon name={h.icon} size={17} />
                  <span className="cmdk-label">{h.label}{h.hint && <span className="muted"> · {h.hint}</span>}</span>
                  <span className="cmdk-kind">{h.kind}</span>
                </div>
              </div>);
          })}
        </div>
        <div className="cmdk-foot small muted"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span>End with <kbd>?</kbd> to ask</span></div>
      </div>
    </div>
  );
}
