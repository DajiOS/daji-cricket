import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Badge, Btn, Field, s } from './ui';
import { C } from './theme';
import { NeedsFace, NeedsMoveCode, checkInAtGround, enrolMyFace, removeMyFace, sendMoveCode } from './checkin';

// A booking's team list in the app: who is playing, adding players (the person who booked), and checking yourself in at the ground.
// Every player who checks in earns the game toward the waitlist tiers; guests (no Daji profile) can be on the list for the live score only.
interface Player { id: string | null; name: string; hasProfile: boolean; isBooker: boolean; isYou: boolean; checkedIn: boolean; undone: boolean; earns: boolean; faceEnrolled: boolean }
interface Team { players: Player[]; canEdit: boolean; checkIn: { open: boolean; opensAt: number; closesAt: number; groundHasLocation: boolean; radiusM: number; maxPlayers: number; faceCheck: boolean } }

const hhmm = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(11, 16);

export function TeamList({ bookingId }: { bookingId: string }) {
  const [t, setT] = useState<Team | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [move, setMove] = useState<{ message: string; sentTo?: string } | null>(null); const [code, setCode] = useState('');
  const [askFace, setAskFace] = useState(false);
  const load = useCallback(async () => { try { setT(await api<Team>(`/api/bookings/${bookingId}/players`)); } catch (e: any) { setErr(e.message); } }, [bookingId]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const act = async (fn: () => Promise<void>) => { setErr(''); setNote(''); setBusy(true); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); void load(); } };
  const doCheckIn = (moveCode?: string) => act(async () => {
    try {
      const r = await checkInAtGround(bookingId, !!t?.checkIn.faceCheck, moveCode);
      if (r === 'cancelled') return;
      setMove(null); setCode('');
      setNote(r === 'already' ? 'You are already checked in.' : 'Checked in. This game counts for you once it is played.');
    } catch (e) {
      if (e instanceof NeedsMoveCode) { setMove({ message: e.message }); return; }
      if (e instanceof NeedsFace) { setAskFace(true); return; }
      throw e;
    }
  });
  const enrol = () => act(async () => { if ((await enrolMyFace()) === 'done') { setAskFace(false); setNote('Your face is added. Now check in.'); } });
  const forget = () => act(async () => { await removeMyFace(); setNote('Your face is removed from the face check. You will need to add it again before your next check-in.'); });
  const askCode = () => act(async () => { const r = await sendMoveCode(); setMove((m) => ({ message: m?.message ?? '', sentTo: r.to })); if (r.devCode) setCode(r.devCode); });
  const add = () => act(async () => {
    if (name.trim().length < 2) throw new Error('Enter the player\'s name.');
    const r = await api<{ profile: boolean; note: string | null }>(`/api/bookings/${bookingId}/players`, { method: 'POST', body: { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) } });
    setName(''); setPhone('');
    setNote(r.profile ? 'Added. The game counts for them when they check in on their own phone.' : r.note ?? 'Added as a guest.');
  });
  const remove = (p: Player) => act(async () => { await api(`/api/bookings/${bookingId}/players/${p.id}/remove`, { method: 'POST', body: {} }); setNote(`${p.name} is off the list.`); });

  if (!open) return <Btn kind="ghost" label="Team list and check-in" onPress={() => setOpen(true)} style={{ marginBottom: 0 }} />;
  if (!t) return <View style={{ marginTop: 8 }}>{err ? <Text style={s.err}>{err}</Text> : <Text style={s.muted}>Loading the team list…</Text>}</View>;
  const me = t.players.find((p) => p.isYou);
  return (
    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 }}>
      <Text style={[s.text, { fontWeight: '700' }]}>Team list ({t.players.length})</Text>
      {t.players.map((p) => (
        <View key={p.id ?? 'booker'} style={[s.row, { alignItems: 'center', marginTop: 6 }]}>
          <Text style={[s.text, { flex: 1 }]}>{p.name}{p.isYou ? ' (you)' : ''}{!p.hasProfile ? ' · guest' : ''}</Text>
          {p.checkedIn ? <Badge label="Checked in" tone="ok" /> : p.undone ? <Badge label="Undone by staff" tone="danger" /> : <Badge label="Not yet" />}
          {t.canEdit && p.id && !p.isBooker && !p.checkedIn && !p.undone && <Btn kind="link" label="Remove" disabled={busy} onPress={() => remove(p)} style={{ marginBottom: 0, marginLeft: 6 }} />}
        </View>
      ))}
      {me && !me.checkedIn && !me.undone && (t.checkIn.open
        ? <Btn label="Check in at the ground" busy={busy} onPress={() => doCheckIn()} style={{ marginTop: 12, marginBottom: 0 }} />
        : <Text style={[s.muted, { marginTop: 10 }]}>Check-in opens at {hhmm(t.checkIn.opensAt)} on the day, at the ground. You will unlock your phone{t.checkIn.faceCheck ? ', take a selfie' : ''} and share your location once.</Text>)}
      {t.checkIn.faceCheck && me && !askFace && (me.faceEnrolled
        ? <Btn kind="link" label="Remove my face from the face check" disabled={busy} onPress={forget} style={{ marginTop: 6, marginBottom: 0 }} />
        : !me.checkedIn && <Btn kind="link" label="Add my face for check-in" disabled={busy} onPress={() => setAskFace(true)} style={{ marginTop: 6, marginBottom: 0 }} />)}
      {askFace && (
        <View style={[s.card, { borderColor: C.gold, marginTop: 10, marginBottom: 0 }]}>
          <Text style={[s.text, { fontWeight: '700' }]}>Add your face for check-in (once)</Text>
          <Text style={[s.muted, { marginTop: 4 }]}>So nobody else can check in on your profile, each check-in selfie is compared with this one. Daji keeps no photo: the face service keeps a face pattern, and each selfie is checked once and dropped. You can remove your face here at any time, and it is deleted if you delete your account.</Text>
          <Btn label="I agree, take my selfie" busy={busy} onPress={enrol} style={{ marginTop: 10, marginBottom: 0 }} />
          <Btn kind="link" label="Not now" disabled={busy} onPress={() => setAskFace(false)} style={{ marginBottom: 0 }} />
        </View>
      )}
      {move && (
        <View style={[s.card, { borderColor: C.gold, marginTop: 10, marginBottom: 0 }]}>
          <Text style={s.text}>{move.message}</Text>
          {!move.sentTo ? <Btn label="Text me the code" busy={busy} onPress={askCode} style={{ marginTop: 10, marginBottom: 0 }} /> : (<>
            <Field label={`Code sent to ${move.sentTo}`} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
            <Btn label="Use this phone and check in" busy={busy} onPress={() => doCheckIn(code.trim())} style={{ marginBottom: 0 }} />
          </>)}
        </View>
      )}
      {t.canEdit && t.players.length < t.checkIn.maxPlayers && (
        <View style={{ marginTop: 12 }}>
          <Text style={s.muted}>Add a player. With their mobile number and a Daji profile, the game counts for them too. Without one they are a guest (fine for the live score).</Text>
          <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
          <Field label="Mobile (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} />
          <Btn kind="outline" label="Add to the team list" busy={busy} onPress={add} style={{ marginBottom: 0 }} />
        </View>
      )}
      {!!err && <Text style={[s.err, { marginTop: 8 }]}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginTop: 8 }]}>{note}</Text>}
    </View>
  );
}

/** Games other people booked that you are on the team list for, so you can find them and check in. */
export function MyTeamGames() {
  const [items, setItems] = useState<{ id: string; ref: string; groundName: string; bookedBy: string; startAt: number; endAt: number; checkedIn: boolean }[] | null>(null);
  useEffect(() => { api<{ items: NonNullable<typeof items> }>('/api/my/team-games').then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  if (!items?.length) return null;
  return (
    <View>
      <Text style={[s.h2, { marginTop: 10, color: C.head }]}>Games you are playing in</Text>
      {items.map((g) => (
        <View key={g.id} style={s.card}>
          <View style={s.row}><Text style={[s.text, { fontWeight: '800', flex: 1 }]}>{g.groundName}</Text>{g.checkedIn && <Badge label="Checked in" tone="ok" />}</View>
          <Text style={s.text}>{new Date(g.startAt + 330 * 60000).toISOString().slice(0, 10)} · {hhmm(g.startAt)} – {hhmm(g.endAt)}</Text>
          <Text style={s.muted}>Booked by {g.bookedBy} · Ref {g.ref}</Text>
          <TeamList bookingId={g.id} />
        </View>
      ))}
    </View>
  );
}
