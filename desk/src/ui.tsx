import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// ---------- icons (1.6px line, gold via currentColor) ----------
const P: Record<string, string> = {
  filter: 'M3 5h18l-7 8.2V20l-4-2v-4.8z',
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  map: 'M9 4l6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14',
  warehouse: 'M3 21V9l9-6 9 6v12M7 21v-8h10v8M7 17h10',
  tenants: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  lease: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  billing: 'M4 4h16v16l-3-2-3 2-3-2-3 2-2-2zM8 9h8M8 13h6',
  payments: 'M2 7h20v12H2zM2 11h20M6 16h4',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  users: 'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM5 21v-1a7 7 0 0 1 14 0v1',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  audit: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM9 12h6M9 16h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  land: 'M3 20l6-12 4 7 3-4 5 9zM16 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  fuel: 'M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M3 22h12M6 7h6M15 10h2a2 2 0 0 1 2 2v5a1 1 0 0 0 2 0V9l-3-3',
  accounts: 'M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6',
  payroll: 'M6 4h12M6 9h12M6 4h3a5 5 0 0 1 0 10H6l8 7',
  camera: 'M23 7l-7 5 7 5V7zM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  ai: 'M12 3l1.9 5.8L20 10.7l-5.1 3.7L16.8 21 12 17.3 7.2 21l1.9-6.6L4 10.7l6.1-1.9z',
  vault: 'M3 5h18v14H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 9V7M12 17v-2M7 19v2M17 19v2',
  plus: 'M12 5v14M5 12h14', x: 'M18 6L6 18M6 6l12 12', menu: 'M3 6h18M3 12h18M3 18h18',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  play: 'M5 3l14 9-14 9z', check: 'M20 6L9 17l-5-5', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  back: 'M19 12H5M12 19l-7-7 7-7', mail: 'M4 4h16v16H4zM4 4l8 8 8-8',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6c3 2.4 3 10.4 0 12.8M18.4 5.6c-3 2.4-3 10.4 0 12.8',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z',
  card: 'M2 5h20v14H2zM2 10h20M6 15h4',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  grad: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1 3 3 6 3s6-2 6-3v-5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  chevron: 'M9 6l6 6-6 6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.3l6.9-1z',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  pie: 'M21 12A9 9 0 1 1 12 3v9zM15 3.5A9 9 0 0 1 20.5 9H15z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v7H2v-7z',
  pulse: 'M3 12h4l3-7 4 14 3-7h4',
};
/** The Filters button used on every list that can be narrowed: it opens and closes the filter controls and shows how many are on. `inline` keeps the controls in the row they sit in. */
export function Filters({ active = 0, children, startOpen, inline = true }: { active?: number; children: ReactNode; startOpen?: boolean; inline?: boolean }) {
  const [open, setOpen] = useState(startOpen ?? active > 0);
  return (
    <>
      <button type="button" className={`btn sm filter-btn${open ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="filter" size={15} />Filters{active > 0 && <span className="filter-n">{active}</span>}</button>
      {open && (inline ? <span className="filter-body">{children}</span> : <div className="filter-panel">{children}</div>)}
    </>
  );
}
export function Icon({ name, size }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={size ? { width: size, height: size } : undefined}><path d={P[name] || P.dashboard} /></svg>
  );
}

/** The Daji logo (gold wordmark and emblem). */
export function Logo({ width = 190 }: { width?: number }) {
  return <img src="assets/logo.svg" alt="Daji Cricket Ground" className="brand-logo" style={{ width, maxWidth: '100%' }} />;
}
/** The small emblem, used in empty states and the loading screen. */
export function Crest({ size = 44 }: { size?: number }) {
  return <img src="assets/icon.svg" alt="" width={size} height={size} />;
}

// ---------- status chips ----------
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'gold' | 'mute';
/** A small coloured chip with a dot. `tone` picks the colour; pass a label map to turn a status code into words. */
export function Chip({ tone = 'mute', children }: { tone?: Tone; children: ReactNode }) { return <span className={`badge b-${tone}`}>{children}</span>; }
/** Looks a status up in a map of code -> [tone, label]; unknown codes show as plain grey text. */
export function Status({ s, map }: { s: string; map: Record<string, [Tone, string]> }) { const [t, l] = map[s] || ['mute', s]; return <Chip tone={t}>{l}</Chip>; }

// ---------- layout pieces ----------
export function PageHead({ eyebrow, title, lede, children }: { eyebrow?: string; title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{lede && <div className="lede">{lede}</div>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
export function Stat({ label, value, foot, meter }: { label: string; value: ReactNode; foot?: ReactNode; meter?: number }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {meter != null && <div className="meter" role="meter" aria-valuenow={Math.round(meter)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} /></div>}
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}
export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="empty"><div className="crest"><Crest size={40} /></div>{children}</div>
);
export const Loading = ({ h = 220 }: { h?: number }) => <div className="shimmer" style={{ height: h }} aria-label="Loading" />;
export const ErrorBox = ({ msg }: { msg: string | null }) => (msg ? <div className="err" role="alert">{msg}</div> : null);

export function Field({ label, hint, children, full }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return <label className={`f${full ? ' full' : ''}`}><span>{label}</span>{children}{hint && <div className="hint">{hint}</div>}</label>;
}

/** "Asha Rao" becomes first "Asha", last "Rao"; the last word is the surname. */
export function splitName(full: string): { first: string; last: string } {
  const p = (full || '').trim().split(/\s+/).filter(Boolean);
  return p.length < 2 ? { first: p[0] || '', last: '' } : { first: p.slice(0, -1).join(' '), last: p[p.length - 1]! };
}
export const joinName = (first: string, last: string) => `${first.trim()} ${last.trim()}`.trim();

/** First name and last name as two fields, for any form that asks for a person. */
export function NameFields({ first, last, onFirst, onLast, firstLabel = 'First name', lastLabel = 'Last name', autoFocus }: { first: string; last: string; onFirst: (v: string) => void; onLast: (v: string) => void; firstLabel?: string; lastLabel?: string; autoFocus?: boolean }) {
  return (<>
    <Field label={firstLabel}><input className="inp" maxLength={40} autoComplete="given-name" autoFocus={autoFocus} value={first} onChange={(e) => onFirst(e.target.value)} /></Field>
    <Field label={lastLabel}><input className="inp" maxLength={40} autoComplete="family-name" value={last} onChange={(e) => onLast(e.target.value)} /></Field>
  </>);
}

/** Drop-in for a single "Name" field: shows First name and Last name, and reports the full name. */
export function NameField({ value, onChange, autoFocus, firstLabel = 'First name', lastLabel = 'Last name' }: { value: string; onChange: (full: string) => void; autoFocus?: boolean; firstLabel?: string; lastLabel?: string }) {
  const [p, setP] = useState(() => splitName(value));
  useEffect(() => { if (joinName(p.first, p.last) !== (value || '').trim()) setP(splitName(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: 'first' | 'last') => (v: string) => { const n = { ...p, [k]: v }; setP(n); onChange(joinName(n.first, n.last)); };
  return <NameFields first={p.first} last={p.last} onFirst={set('first')} onLast={set('last')} autoFocus={autoFocus} firstLabel={firstLabel} lastLabel={lastLabel} />;
}

export function Modal({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

// ---------- toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t); }, [msg]);
  return <ToastCtx.Provider value={setMsg}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Simple form state helper. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [v, setV] = useState<T>(initial);
  const bind = (k: keyof T) => ({ value: v[k] ?? '', onChange: (e: any) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })) });
  return { v, setV, bind };
}

// ---------- tables and tabs ----------
export interface Col<T> { head: string; cell: (row: T) => ReactNode; num?: boolean; width?: number | string }
/** The standard table: sticky header, optional row click, empty message. */
export function Table<T>({ rows, cols, onRow, empty, key }: { rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; empty?: ReactNode; key?: (r: T, i: number) => string | number }) {
  if (!rows.length) return <Empty>{empty ?? 'Nothing here yet.'}</Empty>;
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr>{cols.map((c, i) => <th key={i} className={c.num ? 'num right' : ''} style={c.width ? { width: c.width } : undefined}>{c.head}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={key ? key(r, i) : i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>
          {cols.map((c, j) => <td key={j} className={c.num ? 'num right' : ''}>{c.cell(r)}</td>)}
        </tr>))}</tbody>
    </table></div>
  );
}
/** Pill tabs (the .seg control). */
export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: [T, string][]; label?: string }) {
  return <div className="seg" role="group" aria-label={label}>{items.map(([k, l]) => <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
/** A button that asks "are you sure" inline before doing something that cannot easily be undone. */
export function Confirm({ label, ask, onYes, className = 'btn sm' }: { label: ReactNode; ask: string; onYes: () => void; className?: string }) {
  const [on, setOn] = useState(false);
  if (!on) return <button className={className} onClick={() => setOn(true)}>{label}</button>;
  return <span className="row" style={{ gap: 6 }}><span className="small muted">{ask}</span><button className="btn sm primary" onClick={() => { setOn(false); onYes(); }}>Yes</button><button className="btn sm ghost" onClick={() => setOn(false)}>No</button></span>;
}

// ---------- dates the Indian way: dd/mm/yyyy ----------
const showDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const isoDate = (txt: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt); if (!m) return null;
  const d = +m[1]!, mo = +m[2]!, y = +m[3]!, dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const maskDate = (raw: string) => { const d = raw.replace(/\D/g, '').slice(0, 8); return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

/** A date field that reads and writes dd/mm/yyyy, with a calendar to pick from. Same props as the browser's date input; value stays yyyy-mm-dd. */
export function DateInput({ value, onChange, min, max, disabled, className, style, id, autoFocus, 'aria-label': ariaLabel }: {
  value?: string; onChange?: (e: { target: { value: string; type: string } }) => void; min?: string; max?: string; disabled?: boolean;
  className?: string; style?: CSSProperties; id?: string; autoFocus?: boolean; 'aria-label'?: string;
}) {
  const [txt, setTxt] = useState(showDate(value || '')); const [bad, setBad] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { if ((isoDate(txt) ?? '') !== (value || '') && !(txt.length > 0 && txt.length < 10)) setTxt(showDate(value || '')); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const emit = (v: string) => onChange?.({ target: { value: v, type: 'date' } });
  const type = (raw: string) => {
    const t = maskDate(raw); setTxt(t);
    if (!t) { setBad(''); emit(''); return; }
    if (t.length < 10) { setBad(''); return; }
    const iso = isoDate(t);
    if (!iso) { setBad('Not a real date'); return; }
    if ((min && iso < min) || (max && iso > max)) { setBad('That day is outside the dates allowed'); return; }
    setBad(''); emit(iso);
  };
  const w = style && style.width ? { width: style.width } : undefined;
  return (
    <span className="dx" style={{ position: 'relative', display: w ? 'inline-block' : 'block', ...w }}>
      <input className={className} style={{ ...style, width: '100%', paddingRight: 34, ...(bad ? { borderColor: 'var(--bad)' } : null) }} id={id} type="text" inputMode="numeric" autoComplete="off" maxLength={10}
        placeholder="dd/mm/yyyy" title={bad || undefined} aria-label={ariaLabel} aria-invalid={bad ? true : undefined} autoFocus={autoFocus} disabled={disabled} value={txt}
        onChange={(e) => type(e.target.value)} onBlur={() => { if (bad || (txt && txt.length < 10)) { setTxt(showDate(value || '')); setBad(''); } }} />
      <button type="button" className="dx-b" aria-label="Open calendar" disabled={disabled} onClick={() => { try { picker.current?.showPicker?.(); } catch { /* no native picker */ } }}
        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, display: 'grid', placeItems: 'center', border: 0, background: 'none', color: 'inherit', opacity: disabled ? 0.3 : 0.7, cursor: disabled ? 'default' : 'pointer' }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" value={value || ''} min={min} max={max} disabled={disabled}
        onChange={(e) => { setTxt(showDate(e.target.value)); setBad(''); emit(e.target.value); }}
        style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }} />
    </span>
  );
}
