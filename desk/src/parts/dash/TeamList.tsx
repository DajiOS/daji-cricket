// A booking's team list: who is playing, who checked in at the ground (and how), add a player or a guest, check someone in by hand,
// undo a check-in that looks wrong, see whether the check-in selfie matched the player's enrolled face, reset a wrong enrolment, release a player's phone.
// With the face check on (Amazon Rekognition, Settings › Connections) no face photo is kept, so there is nothing to look at here: only the answer and its score.
// A game counts toward a player's waitlist tier only when they checked in.
import { useState } from 'react';
import { Modal, Field, ErrorBox, Table, Load, useToast } from '../../ui';
import { useApi, post, fmtDateTime } from '../../lib';
import { errText } from './common';

interface Player {
  id: string | null; name: string; hasProfile: boolean; isBooker: boolean; avatarUrl: string | null; checkedIn: boolean; checkedInAt: number | null;
  via: 'phone' | 'staff' | 'history' | null; distanceM: number | null; undone: boolean; undoReason: string | null; earns: boolean; userId: string | null;
  faceEnrolled: boolean; faceMatched: boolean; faceScore: number | null;
}
interface Team { players: Player[]; canEdit: boolean; checkIn: { open: boolean; opensAt: number; closesAt: number; groundHasLocation: boolean; radiusM: number; maxPlayers: number; faceCheck: boolean } }
type Act = { kind: 'checkin' | 'undo' | 'reset' | 'release'; p: Player } | null;

const VIA: Record<string, string> = { phone: 'on their phone', staff: 'by staff', history: 'before check-in existed' };

export function TeamList({ bookingId }: { bookingId: string }) {
  const base = `/api/staff/bookings/${encodeURIComponent(bookingId)}/players`;
  const [d, err, reload, status] = useApi<Team>(base);
  const [adding, setAdding] = useState(false);
  const [act, setAct] = useState<Act>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useToast();
  async function remove(p: Player) {
    setMsg(null);
    try { await post(`${base}/${encodeURIComponent(p.id!)}/remove`, {}); toast(`${p.name} is off the list.`); reload(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Load data={d} error={err} status={status} retry={reload}>{(t) => {
      const checked = t.players.filter((p) => p.checkedIn).length;
      return (
        <div className="stack" style={{ gap: 10 }}>
          <div className="small muted">
            {checked} of {t.players.length} checked in. Players check in on their own phone in the Daji app, within {t.checkIn.radiusM} m of the ground, from {fmtDateTime(t.checkIn.opensAt)}.
            {' '}Only checked-in players with a profile earn the game toward their waitlist tier. Guests are for the live score only.
            {t.checkIn.faceCheck ? ' Each player\'s check-in selfie must match the face they enrolled; no photo is kept.' : ' The face check is off (Settings › Connections).'}
            {!t.checkIn.groundHasLocation && <b> This ground has no check-in point yet (Settings › Check-in), so only staff can check people in.</b>}
          </div>
          <ErrorBox msg={msg} />
          <div className="card"><Table rows={t.players} rowKey={(p) => p.id ?? 'booker'} empty="Nobody on the list yet." cols={[
            { head: 'Player', cell: (p) => <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              {p.avatarUrl ? <img src={p.avatarUrl} alt="" width={32} height={32} style={{ borderRadius: 16, objectFit: 'cover' }} /> : <span className="avatar sm" aria-hidden>{p.name.slice(0, 1)}</span>}
              <div><b>{p.name}</b><div className="small muted">{p.isBooker ? 'Booked it' : p.hasProfile ? 'Has a profile' : 'Guest, no profile'}</div></div></div> },
            { head: 'Check-in', cell: (p) => p.undone ? <span className="err-text">Undone{p.undoReason ? `: ${p.undoReason}` : ''}</span>
              : p.checkedIn ? <>Checked in {p.via ? VIA[p.via] : ''}<div className="small muted">{p.checkedInAt ? fmtDateTime(p.checkedInAt) : ''}{p.distanceM != null ? `, ${p.distanceM} m from the pin` : ''}</div></> : <span className="muted">Not yet</span> },
            ...(t.checkIn.faceCheck ? [{ head: 'Face', cell: (p: Player) => !p.hasProfile ? <span className="muted small">Guest</span>
              : !p.faceEnrolled ? <span className="muted small">Not enrolled yet</span>
              : p.faceMatched ? <span className="ok-text">Matched{p.faceScore != null ? ` ${p.faceScore}%` : ''}</span>
              : p.checkedIn && p.via === 'phone' ? <span className="muted small">Checked in before the face check</span> : <span className="muted small">Enrolled</span> }] : []),
            { head: 'Earns the game', cell: (p) => (p.earns ? 'Yes' : p.hasProfile ? 'Not unless checked in' : 'No (guest)') },
            { head: '', cell: (p) => <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              {p.id && !p.checkedIn && <button className="btn sm" onClick={() => setAct({ kind: 'checkin', p })}>Check in</button>}
              {p.id && p.checkedIn && <button className="btn sm ghost" onClick={() => setAct({ kind: 'undo', p })}>Undo check-in</button>}
              {p.userId && p.faceEnrolled && <button className="btn sm ghost" onClick={() => setAct({ kind: 'reset', p })}>Reset face</button>}
              {p.userId && <button className="btn sm ghost" onClick={() => setAct({ kind: 'release', p })}>Release phone</button>}
              {p.id && !p.isBooker && !p.checkedInAt && t.canEdit && <button className="btn sm ghost" onClick={() => remove(p)}>Remove</button>}
            </div> },
          ]} /></div>
          {t.canEdit && t.players.length < t.checkIn.maxPlayers && <div><button className="btn sm" onClick={() => setAdding(true)}>Add a player</button></div>}
          {adding && <AddPlayer base={base} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
          {act && <ReasonDialog base={base} act={act} onClose={() => setAct(null)} onDone={() => { setAct(null); reload(); }} />}
        </div>
      );
    }}</Load>
  );
}

function AddPlayer({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function save() {
    setMsg(null);
    if (name.trim().length < 2) return setMsg('Enter the player\'s name.');
    setBusy(true);
    try {
      const r = await post<{ profile: boolean; note: string | null }>(base, { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) });
      toast(r.profile ? 'Added. The game will count for them once they check in.' : r.note ?? 'Added as a guest.'); onDone();
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  return (
    <Modal title="Add a player" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Add</button></>}>
      <div className="form-grid">
        <Field label="Name" required><input className="inp" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mobile" hint="With a Daji profile on this number they can check in and earn the game. Leave it empty for a guest."><input className="inp" inputMode="tel" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <ErrorBox msg={msg} />
    </Modal>
  );
}

const KINDS: Record<NonNullable<Act>['kind'], { title: (n: string) => string; button: string; note: string; example: string; done: (n: string) => string }> = {
  checkin: { title: (n) => `Check ${n} in`, button: 'Check in', note: 'Use this when their phone could not check in. It counts like a check-in on their phone, and is logged with your name.', example: 'Phone battery dead', done: (n) => `${n} is checked in.` },
  undo: { title: (n) => `Undo ${n}'s check-in`, button: 'Undo check-in', note: 'Use this when someone else played on this profile, or the check-in is wrong. The record is kept; the game no longer counts for them.', example: 'Not the person on the profile', done: (n) => `${n}'s check-in is undone. This game will not count for them.` },
  reset: { title: (n) => `Reset ${n}'s enrolled face`, button: 'Reset face', note: 'Use this when someone else enrolled their face on this profile. Their face is deleted at the face service; they enrol again in the app before their next check-in.', example: 'Brother enrolled on his profile', done: (n) => `${n}'s face is reset. They enrol again in the app.` },
  release: { title: (n) => `Release ${n}'s phone`, button: 'Release phone', note: 'Use this when they changed phones, or gave their phone to someone. Their profile can then check in on a new phone, and the old phone can check in someone else.', example: 'New phone', done: (n) => `${n}'s phone is released.` },
};

function ReasonDialog({ base, act, onClose, onDone }: { base: string; act: NonNullable<Act>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const k = KINDS[act.kind];
  async function save() {
    setMsg(null);
    if (reason.trim().length < 3) return setMsg('Say why, in a few words.');
    setBusy(true);
    const path = act.kind === 'reset' ? `/api/staff/players/${encodeURIComponent(act.p.userId!)}/face-reset` : act.kind === 'release' ? `/api/staff/players/${encodeURIComponent(act.p.userId!)}/release-phone`
      : `${base}/${encodeURIComponent(act.p.id!)}/${act.kind === 'undo' ? 'undo-check-in' : 'check-in'}`;
    try { await post(path, { reason: reason.trim() }); toast(k.done(act.p.name)); onDone(); }
    catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  return (
    <Modal title={k.title(act.p.name)} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{k.button}</button></>}>
      <p className="small muted">{k.note}</p>
      <Field label="Reason" required><input className="inp" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={k.example} /></Field>
      <ErrorBox msg={msg} />
    </Modal>
  );
}
