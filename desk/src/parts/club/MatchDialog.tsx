import { useState } from 'react';
import { Field, Modal, useToast } from '../../ui';
import { patch, post } from '../../lib';
import { Select, errMsg } from './common';

export interface Match { id: string; title: string; teamA: string; teamB: string; overs: number; playersPerSide?: number; battingFirst?: 'a' | 'b'; status: string; result: string | null; isPublic: boolean; youtubeId?: string | null }

export default function MatchDialog({ m, onClose, onSaved }: { m: Match | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: m?.title || '', teamA: m?.teamA || '', teamB: m?.teamB || '', overs: String(m?.overs || 10), players: String(m?.playersPerSide || 11), first: m?.battingFirst || 'a', yt: m?.youtubeId ? `https://youtu.be/${m.youtubeId}` : '', pub: m ? m.isPublic !== false : true });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    setErr(null);
    const body = m ? { title: f.title.trim(), youtubeUrl: f.yt.trim() || null, isPublic: f.pub }
      : { title: f.title.trim(), teamA: f.teamA.trim(), teamB: f.teamB.trim(), overs: Number(f.overs), playersPerSide: Number(f.players), battingFirst: f.first, youtubeUrl: f.yt.trim() || undefined, isPublic: f.pub };
    try { await (m ? patch('/api/staff/matches/' + m.id, body) : post('/api/staff/matches', body)); toast('Saved.'); onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={m ? 'Match settings' : 'New match'} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Title" full><input className="inp" placeholder="Sunday friendly" value={f.title} onChange={set('title')} /></Field>
        {!m && <>
          <Field label="Team A"><input className="inp" value={f.teamA} onChange={set('teamA')} /></Field>
          <Field label="Team B"><input className="inp" value={f.teamB} onChange={set('teamB')} /></Field>
          <Field label="Overs per side"><input className="inp" type="number" min={1} max={50} value={f.overs} onChange={set('overs')} /></Field>
          <Field label="Players per side"><input className="inp" type="number" min={2} max={11} value={f.players} onChange={set('players')} /></Field>
          <Field label="Who bats first"><Select value={f.first} onChange={(v) => setF((x) => ({ ...x, first: v as 'a' | 'b' }))} options={[['a', 'Team A bats first'], ['b', 'Team B bats first']]} /></Field>
        </>}
        <Field label="YouTube live or video link (optional)" full><input className="inp" placeholder="https://www.youtube.com/watch?v=…" value={f.yt} onChange={set('yt')} /></Field>
        <label className="check full"><input type="checkbox" checked={f.pub} onChange={set('pub')} /> Show on the public live scores page</label>
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}
