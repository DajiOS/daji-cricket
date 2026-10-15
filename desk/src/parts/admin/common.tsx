// Small pieces shared by the Settings, Team, Platform and Promos pages.
import { useState, type ReactNode } from 'react';
import { ApiError, go } from '../../lib';
import { Tabs } from '../../ui';

/** One readable line out of an API error: field messages when the server sent them, otherwise its message. */
export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const f = (e.details as any)?.fields;
    if (Array.isArray(f) && f.length) return f.map((x: any) => (x.field && x.field !== '(body)' ? `${x.field}: ${x.message}` : x.message)).join('  ·  ');
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Pill tabs whose current section lives in the address (#/settings/prices), so a section can be linked to and survives a reload. */
export function SectionTabs<T extends string>({ base, sub, items }: { base: string; sub: string; items: [T, string][] }) {
  const key = (items.find(([k]) => k === sub.replace(/^\//, '').split('/')[0]) || items[0])![0];
  return <div className="tabs-scroll"><Tabs value={key} onChange={(k) => go(`${base}/${k}`)} items={items} label="Sections" /></div>;
}
export const sectionOf = (sub: string, items: string[]) => (items.find((k) => k === sub.replace(/^\//, '').split('/')[0]) || items[0])!;

/** A card with a heading, an optional note and a body. */
export function Panel({ title, note, children, actions }: { title: string; note?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card">
      <div className="card-head"><div><h3>{title}</h3>{note && <div className="hint" style={{ marginTop: 3 }}>{note}</div>}</div>{actions && <div className="row">{actions}</div>}</div>
      <div className="card-pad">{children}</div>
    </div>
  );
}

/** A toggle pill (a day of the week, a scope). */
export function Pill({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return <button type="button" className={`pill${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} title={title}>{children}</button>;
}

/** Runs an async action, reports a failure through `fail`, and tells the caller when it is busy. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, fail: (m: string) => void) => { setBusy(true); try { await fn(); } catch (e) { fail(errText(e)); } setBusy(false); };
  return [busy, run] as const;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const pad = (n: number) => String(n).padStart(2, '0');
/** "19:00" -> "7 pm", "27:00" -> "3 am (next day)" */
export function hourLabel(t: string): string {
  const [h, m] = t.split(':').map(Number) as [number, number];
  const hh = h % 24, s = `${hh % 12 || 12}${m ? ':' + pad(m) : ''} ${hh < 12 ? 'am' : 'pm'}`;
  return h >= 24 ? `${s} (next day)` : s;
}
export const slotTimes = (from: number, to: number) => { const o: string[] = []; for (let m = from; m <= to; m += 30) o.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`); return o; };
