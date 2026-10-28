// Settings, Waitlist: the owner's weekly waitlist deal (Sunday leather ball unless changed). Every value is checked again by the server.
import { useState } from 'react';
import { useApi, put } from '../../lib';
import { Loading, ErrorBox, Field } from '../../ui';
import { Panel, errText } from './common';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BALLS: [string, string][] = [['leather', 'Leather ball'], ['combo', 'Red and white ball'], ['tennis', 'Tennis ball']];
interface Tier { name: string; minGames: number }
interface S { waitlistEnabled: boolean; waitlistDay: number; waitlistBall: string; waitlistConfirmHours: number; waitlistTierPriority: boolean; waitlistWaveMinutes: number; waitlistTiers: Tier[] }

function Form({ s }: { s: S }) {
  const [v, setV] = useState<S>(s);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof S>(k: K, x: S[K]) => setV({ ...v, [k]: x });
  const setTier = (i: number, t: Partial<Tier>) => set('waitlistTiers', v.waitlistTiers.map((x, j) => (j === i ? { ...x, ...t } : x)));
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await put<S>('/api/admin/settings', { waitlistEnabled: v.waitlistEnabled, waitlistDay: v.waitlistDay, waitlistBall: v.waitlistBall, waitlistConfirmHours: v.waitlistConfirmHours, waitlistTierPriority: v.waitlistTierPriority, waitlistWaveMinutes: v.waitlistWaveMinutes, waitlistTiers: v.waitlistTiers });
      setV(r); setMsg({ ok: true, text: r.waitlistEnabled ? 'Saved. Customers can join the waitlist.' : 'Saved. The waitlist is switched off.' });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  }
  return (
    <div className="stack">
      <Panel title="Waitlist" note="Customers ask for a whole session on one day of the week. If it is booked, they move to the next week, for up to a year. A session still free the set hours before it starts is offered to everyone waiting; the first to accept books it at the normal price.">
        <div className="stack" style={{ gap: 12 }}>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.waitlistEnabled} onChange={(e) => set('waitlistEnabled', e.target.checked)} /> <b>Waitlist switched on</b></label>
          <div className="form-grid">
            <Field label="Day of the week"><select className="inp" value={v.waitlistDay} onChange={(e) => set('waitlistDay', Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
            <Field label="Ball" hint="Whole sessions of this ball on the price list for that day"><select className="inp" value={v.waitlistBall} onChange={(e) => set('waitlistBall', e.target.value)}>{BALLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Offer it this many hours before" hint="1 to 336 hours. Until then the session stays open to normal bookings."><input className="inp" type="number" min={1} max={336} value={v.waitlistConfirmHours} onChange={(e) => set('waitlistConfirmHours', Number(e.target.value))} /></Field>
          </div>
        </div>
      </Panel>
      <Panel title="Priority for regular players" note="Off: everyone waiting hears at once. On: players who have played most here in the last 12 months hear first, one group at a time. No-shows and cancellations do not count.">
        <div className="stack" style={{ gap: 12 }}>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.waitlistTierPriority} onChange={(e) => set('waitlistTierPriority', e.target.checked)} /> <b>Tier priority switched on</b></label>
          <Field label="Minutes each group has before the next is told" hint="5 to 1440. Shortened by itself when the session is close."><input className="inp" type="number" min={5} max={1440} value={v.waitlistWaveMinutes} onChange={(e) => set('waitlistWaveMinutes', Number(e.target.value))} style={{ maxWidth: 160 }} /></Field>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Tier</th><th>Games in the last 12 months</th><th /></tr></thead>
            <tbody>
              {v.waitlistTiers.map((t, i) => (
                <tr key={i}>
                  <td><input className="inp" aria-label={`Tier ${i + 1} name`} maxLength={30} value={t.name} onChange={(e) => setTier(i, { name: e.target.value })} /></td>
                  <td><input className="inp" aria-label={`Tier ${i + 1} games`} type="number" min={1} max={500} value={t.minGames} onChange={(e) => setTier(i, { minGames: Number(e.target.value) })} style={{ maxWidth: 120 }} /> or more</td>
                  <td><button className="btn sm ghost" onClick={() => set('waitlistTiers', v.waitlistTiers.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>))}
              <tr><td colSpan={3} className="muted small">Everyone else hears last.</td></tr>
            </tbody>
          </table></div>
          {v.waitlistTiers.length < 5 && <div><button className="btn sm" onClick={() => set('waitlistTiers', [...v.waitlistTiers, { name: '', minGames: 1 }])}>Add a tier</button></div>}
        </div>
      </Panel>
      <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>{msg && <span className={msg.ok ? 'ok-text' : 'err-text'}>{msg.text}</span>}</div>
    </div>
  );
}

export default function WaitlistSettings() {
  const [s, error] = useApi<S>('/api/admin/settings');
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading />;
  return <Form s={s} />;
}
