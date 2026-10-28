// The two squads of a match: the names the scorer uses, each linked to a player's Daji profile (their runs, wickets and catches then go on
// their career record) or a guest. Filled from a booking's team list or one by one with a mobile number. Everything is checked on the server.
import { useState } from 'react';
import { Chip, Field, Modal, useToast } from '../../ui';
import { del, patch, post } from '../../lib';
import { Select, errMsg } from './common';

export interface SquadPlayer { id: string; side: 'a' | 'b'; name: string; hasProfile: boolean; linkedVia: 'phone' | 'team_list' | null; profileName: string | null; saidNotThem: boolean; inUse: boolean }
export interface SquadData { matchId: string; status: string; maxPerSide: number; sides: { side: 'a' | 'b'; team: string; players: SquadPlayer[] }[] }

export default function Squads({ id, data, onChange }: { id: string; data: SquadData; onChange: (d: SquadData) => void }) {
  const toast = useToast();
  const [side, setSide] = useState<'a' | 'b'>('a');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [ref, setRef] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState<SquadPlayer | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const add = () => run(async () => {
    if (!name.trim()) throw new Error('Type the name the scorer will use.');
    const r = await post<{ note: string | null; squads: SquadData }>(`/api/staff/matches/${id}/players`, { side, name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) });
    onChange(r.squads); setName(''); setPhone(''); if (r.note) toast(r.note);
  });
  const bring = () => run(async () => {
    if (!ref.trim()) throw new Error('Type the booking reference.');
    const r = await post<{ added: number; skipped: { name: string; why: string }[]; squads: SquadData }>(`/api/staff/matches/${id}/players/import`, { side, bookingRef: ref.trim() });
    onChange(r.squads); setRef('');
    toast(`${r.added} added${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped.map((s) => s.name).join(', ')})` : ''}.`);
  });
  const unlink = (p: SquadPlayer) => run(async () => { onChange(await patch<SquadData>(`/api/staff/matches/${id}/players/${p.id}`, { phone: null })); toast(`${p.name} is a guest now.`); });
  const remove = (p: SquadPlayer) => run(async () => { onChange(await del<SquadData>(`/api/staff/matches/${id}/players/${p.id}`)); });
  return (
    <div className="card">
      <div className="card-head"><h3>Squads</h3><span className="muted small">Players with a Daji profile get the runs, wickets and catches on their career record. Guests do not.</span></div>
      <div className="grid g2 card-pad">
        {data.sides.map((s) => (
          <div key={s.side} className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">{s.team} · {s.players.length} of {data.maxPerSide}</div>
            {!s.players.length && <div className="small muted">No squad yet: the scorer can type any name for this team.</div>}
            {s.players.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                <span><span className="strong">{p.name}</span>{p.profileName && p.profileName !== p.name ? <span className="muted small"> ({p.profileName})</span> : null}{' '}
                  {p.hasProfile ? <Chip tone="good">{p.linkedVia === 'team_list' ? 'Profile, from team list' : 'Profile'}</Chip> : p.saidNotThem ? <Chip tone="warn">Said it was not them</Chip> : <Chip>Guest</Chip>}</span>
                <span className="row" style={{ gap: 4 }}>
                  {p.hasProfile ? <button className="btn ghost sm" disabled={busy} onClick={() => unlink(p)}>Unlink</button> : <button className="btn ghost sm" disabled={busy} onClick={() => setLinking(p)}>Link profile</button>}
                  {!p.inUse && <button className="btn ghost sm" disabled={busy} onClick={() => remove(p)} aria-label={`Remove ${p.name}`}>Remove</button>}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="card-pad stack" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="form-grid">
          <Field label="Team"><Select value={side} onChange={(v) => setSide(v as 'a' | 'b')} options={data.sides.map((s) => [s.side, s.team] as [string, string])} /></Field>
          <Field label="Name on the scorecard"><input className="inp" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Amit" /></Field>
          <Field label="Mobile number" hint="Links their Daji profile. Leave empty for a guest."><input className="inp" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 digit mobile" /></Field>
        </div>
        <div><button className="btn primary sm" disabled={busy} onClick={add}>Add to squad</button></div>
        <div className="form-grid">
          <Field label="Or bring in a booking's team list" hint="Everyone on that booking's team list joins the team picked above."><input className="inp" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Booking reference" /></Field>
        </div>
        <div><button className="btn sm" disabled={busy} onClick={bring}>Bring in the team list</button></div>
        {err && <div className="err" role="alert">{err}</div>}
      </div>
      {linking && <LinkDialog id={id} p={linking} onClose={() => setLinking(null)} onDone={(d) => { onChange(d); setLinking(null); toast('Profile linked.'); }} />}
    </div>
  );
}

function LinkDialog({ id, p, onClose, onDone }: { id: string; p: SquadPlayer; onClose: () => void; onDone: (d: SquadData) => void }) {
  const [phone, setPhone] = useState(''); const [err, setErr] = useState<string | null>(null);
  const save = async () => { setErr(null); try { onDone(await patch<SquadData>(`/api/staff/matches/${id}/players/${p.id}`, { phone: phone.trim() })); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Modal title={`Link ${p.name} to a profile`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Link</button></>}>
      <Field label="Their mobile number" hint="The number on their Daji profile. Their runs, wickets and catches in this match go on their record."><input className="inp" type="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      {err && <div className="err" role="alert" style={{ marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}
