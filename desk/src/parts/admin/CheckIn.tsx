// Settings, Check-in: how close a player's phone must be to the ground, when check-in opens, and each ground's check-in point.
// A game counts toward a player's waitlist tier only when they check in (players.ts). Every value is checked again by the server.
import { useState } from 'react';
import { useApi, put, patch } from '../../lib';
import { Loading, ErrorBox, Field, useToast } from '../../ui';
import { Panel, errText } from './common';

interface S { checkInRadiusMeters: number; checkInOpensMinutes: number }
interface Ground { id: string; name: string; lat: number | null; lng: number | null }

/**
 * Reads a map point however it is pasted: "21.1815, 72.912556", the degrees Google Maps shows (21°10'53.4"N 72°54'45.2"E),
 * or a full Google Maps address with @lat,lng, !3d…!4d… or ?q=lat,lng in it. Short maps.app.goo.gl links carry no numbers.
 */
export function parsePoint(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  const ok = (lat: number, lng: number) => (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null);
  const dms = [...t.matchAll(/(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.]+)\s*(?:"|″|'')?\s*([NSEW])/gi)];
  if (dms.length === 2) {
    const v = dms.map((m) => (Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * (/[SW]/i.test(m[4]!) ? -1 : 1));
    const latFirst = /[NS]/i.test(dms[0]![4]!);
    return ok(latFirst ? v[0]! : v[1]!, latFirst ? v[1]! : v[0]!);
  }
  const d34 = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (d34) return ok(Number(d34[1]), Number(d34[2]));
  const at = t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return ok(Number(at[1]), Number(at[2]));
  const pair = t.match(/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (pair) return ok(Number(pair[1]), Number(pair[2]));
  return null;
}

function GroundPoint({ g }: { g: Ground }) {
  const toast = useToast();
  const [text, setText] = useState(g.lat != null && g.lng != null ? `${g.lat}, ${g.lng}` : '');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = parsePoint(text);
  async function save() {
    setMsg(null);
    if (!p) return setMsg(/goo\.gl/.test(text) ? 'A short Google Maps link has no numbers in it. In Google Maps, press and hold the pin and copy the numbers shown at the top.' : 'Paste the two numbers, like 21.1815, 72.912556, or the degrees Google Maps shows.');
    setBusy(true);
    try { await patch(`/api/staff/grounds/${encodeURIComponent(g.id)}`, { lat: p.lat, lng: p.lng }); toast(`${g.name}: check-in point saved.`); }
    catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Field label={g.name} hint={p ? `Reads as ${p.lat}, ${p.lng}` : 'Not set: players cannot check in here by phone; staff can still check them in.'}>
        <input className="inp" value={text} onChange={(e) => setText(e.target.value)} placeholder={`21°10'53.4"N 72°54'45.2"E`} />
      </Field>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save point'}</button>
        {p && <a className="btn sm ghost" href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">Check on the map</a>}
      </div>
      <ErrorBox msg={msg} />
    </div>
  );
}

function Form({ s }: { s: S }) {
  const [v, setV] = useState<S>(s);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [grounds, gErr] = useApi<{ items: Ground[] }>('/api/staff/grounds');
  async function save() {
    setBusy(true); setMsg(null);
    try { const r = await put<S>('/api/admin/settings', { checkInRadiusMeters: v.checkInRadiusMeters, checkInOpensMinutes: v.checkInOpensMinutes }); setV(r); setMsg({ ok: true, text: 'Saved.' }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  }
  return (
    <div className="stack">
      <Panel title="Check-in at the ground" note="Players check in on their own phone in the Daji app, signed in to their own profile, with the phone unlocked by its owner. A phone that checked in one player cannot check in another for 30 days. Only checked-in games count toward waitlist tiers.">
        <div className="form-grid">
          <Field label="How close to the ground (metres)" hint="50 to 2000. 150 m is about 500 feet."><input className="inp" type="number" min={50} max={2000} value={v.checkInRadiusMeters} onChange={(e) => setV({ ...v, checkInRadiusMeters: Number(e.target.value) })} /></Field>
          <Field label="Opens this many minutes before the start" hint="15 to 240. It closes when the game ends."><input className="inp" type="number" min={15} max={240} value={v.checkInOpensMinutes} onChange={(e) => setV({ ...v, checkInOpensMinutes: Number(e.target.value) })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>{msg && <span className={msg.ok ? 'ok-text' : 'err-text'}>{msg.text}</span>}</div>
      </Panel>
      <Panel title="Check-in point for each ground" note="Where the phone is measured from. In Google Maps, press and hold the pin, then paste the numbers it shows.">
        {gErr ? <ErrorBox msg={gErr} /> : !grounds ? <Loading /> : <div className="stack" style={{ gap: 14 }}>{grounds.items.map((g) => <GroundPoint key={g.id} g={g} />)}</div>}
      </Panel>
    </div>
  );
}

export default function CheckInSettings() {
  const [s, error] = useApi<S>('/api/admin/settings');
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading />;
  return <Form s={s} />;
}
