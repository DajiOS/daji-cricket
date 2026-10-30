import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { api, authImage, upload } from './api';
import { pickReferencePhoto } from './camera';
import type { Task, TaskRef, User } from './types';
import { Badge, Btn, Chip, DateField, Field, Loading, s } from './ui';
import { C } from './theme';

// The tasks upgrade on the phone: references kept apart from proof, accepting a job, its next action, helpers, sign-off and
// reopening with a reason, the requests inbox, raising a request, and the day's site note.

const when = (ms: number): string => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
type Msg = (m: string) => void;

/** References: pictures from the gallery or WhatsApp, quotes and links. They explain a job and never count as proof. */
function Refs({ t, mayHide, onChanged, setErr, setNote }: { t: Task; mayHide: (r: TaskRef) => boolean; onChanged: () => void; setErr: Msg; setNote: Msg }) {
  const [busy, setBusy] = useState(false); const [link, setLink] = useState(''); const [showLink, setShowLink] = useState(false);
  const refs = t.references ?? [];
  const addPic = async () => {
    setErr(''); setNote(''); setBusy(true);
    try {
      const pic = await pickReferencePhoto(); if (!pic) return;
      await upload(`/api/tasks/${t.id}/references?name=${encodeURIComponent(pic.name)}`, pic.uri);
      setNote('Reference added. It is not proof.'); onChanged();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const addLink = async () => {
    setErr(''); setNote('');
    try { await api(`/api/tasks/${t.id}/links`, { method: 'POST', body: { url: link.trim() } }); setLink(''); setShowLink(false); setNote('Link added.'); onChanged(); } catch (e: any) { setErr(e.message); }
  };
  const hide = async (r: TaskRef) => {
    setErr(''); setNote('');
    try { await api(`/api/tasks/refs/${r.id}/hide`, { method: 'POST', body: {} }); setNote('Reference taken off. It stays on record.'); onChanged(); } catch (e: any) { setErr(e.message); }
  };
  const live = t.status !== 'cancelled';
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[s.muted, { fontSize: 12, fontWeight: '600' }]}>References ({refs.length}), not proof</Text>
      {refs.map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          {r.kind === 'file' && r.mime?.startsWith('image/') ? <Image source={authImage(r.url)} style={{ width: 48, height: 48, borderRadius: 6, backgroundColor: C.line, marginRight: 8 }} /> : null}
          <Pressable style={{ flex: 1 }} accessibilityRole={r.kind === 'link' ? 'link' : 'text'} onPress={() => { if (r.kind === 'link') Linking.openURL(r.url).catch(() => setErr('This phone cannot open that link.')); }}>
            <Text style={[s.text, r.kind === 'link' ? { color: C.gold } : null]} numberOfLines={1}>{r.name}</Text>
            <Text style={[s.muted, { fontSize: 11 }]}>{r.kind === 'file' && r.mime === 'application/pdf' ? 'PDF, open it on the desk · ' : ''}{r.addedByName ?? ''} {when(r.addedAt)}</Text>
          </Pressable>
          {live && mayHide(r) && <Btn kind="link" label="Take off" onPress={() => hide(r)} />}
        </View>
      ))}
      {live && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
          <Btn kind="outline" label="Add picture" busy={busy} onPress={addPic} style={{ marginRight: 8 }} />
          {!showLink && <Btn kind="ghost" label="Add link" onPress={() => setShowLink(true)} />}
        </View>
      )}
      {showLink && (<><Field label="Link" value={link} onChangeText={setLink} placeholder="https://" autoCapitalize="none" keyboardType="url" /><Btn kind="outline" label="Add link" onPress={addLink} /></>)}
    </View>
  );
}

/** The extra parts of a job card: status lines, accept, next action, helpers, sign-off, reopen with a reason, references. */
export function TaskExtras({ t, user, manager, team, onChanged, setErr, setNote }: { t: Task; user: User; manager: boolean; team: { id: string; name: string }[]; onChanged: () => void; setErr: Msg; setNote: Msg }) {
  const [next, setNext] = useState(t.nextAction ?? ''); const [why, setWhy] = useState(''); const [asking, setAsking] = useState(false);
  const [helpers, setHelpers] = useState<string[]>((t.helpers ?? []).map((h) => h.id));
  const call = async (path: string, body: unknown, done: string) => {
    setErr(''); setNote('');
    try { await api(`/api/tasks/${t.id}/${path}`, { method: 'POST', body }); setNote(done); onChanged(); } catch (e: any) { setErr(e.message); }
  };
  const open = t.status === 'open';
  const mine = t.assignedTo ? t.assignedTo === user.id : true;
  const helperChange = helpers.slice().sort().join() !== (t.helpers ?? []).map((h) => h.id).sort().join();
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {!!t.acknowledgedAt && <Badge label={`Accepted by ${t.acknowledgedByName ?? 'the team'}`} />}
        {t.status === 'done' && <Badge tone={t.signedOffAt ? 'ok' : 'muted'} label={t.signedOffAt ? `Signed off by ${t.signedOffByName ?? 'a manager'}` : 'Not signed off yet'} />}
        {(t.helpers ?? []).length > 0 && <Badge label={`Helping: ${(t.helpers ?? []).map((h) => h.name).join(', ')}`} />}
      </View>
      {!!t.reopenNote && open && <Text style={[s.muted, { marginTop: 4 }]}>Reopened: {t.reopenNote}</Text>}
      {!!t.nextAction && open && <Text style={[s.text, { marginTop: 4 }]}>Next: {t.nextAction}</Text>}
      {open && mine && !t.acknowledgedAt && <Btn kind="outline" label="I've got it" onPress={() => call('accept', {}, 'Accepted.')} />}
      {open && (
        <View style={{ marginTop: 6 }}>
          <Field label="Next action" value={next} onChangeText={setNext} placeholder="e.g. Buy green felt" autoCapitalize="sentences" maxLength={200} />
          {next.trim() !== (t.nextAction ?? '') && <Btn kind="outline" label="Save next action" onPress={() => call('next', { text: next.trim() }, 'Next action saved.')} />}
        </View>
      )}
      {manager && open && team.length > 0 && (
        <View style={{ marginTop: 6 }}>
          <Text style={[s.muted, { marginBottom: 6, fontSize: 12, fontWeight: '600' }]}>Helpers</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{team.filter((m) => m.id !== t.assignedTo).map((m) => { const on = helpers.includes(m.id); return <Chip key={m.id} label={m.name} on={on} onPress={() => setHelpers((h) => (on ? h.filter((x) => x !== m.id) : [...h, m.id]))} />; })}</View>
          {helperChange && <Btn kind="outline" label="Save helpers" onPress={() => call('helpers', { userIds: helpers }, 'Helpers saved.')} />}
        </View>
      )}
      <Refs t={t} mayHide={(r) => manager || r.addedById === user.id} onChanged={onChanged} setErr={setErr} setNote={setNote} />
      {manager && t.status === 'done' && !t.signedOffAt && <Btn label="Sign off the work" onPress={() => call('signoff', {}, 'Signed off.')} />}
      {manager && t.status !== 'open' && (asking
        ? (<><Field label="Why it needs more work (optional)" value={why} onChangeText={setWhy} autoCapitalize="sentences" maxLength={300} /><Btn kind="outline" label="Reopen" onPress={() => { setAsking(false); call('reopen', why.trim() ? { reason: why.trim() } : {}, 'Reopened.'); }} /></>)
        : <Btn kind="ghost" label="Reopen" onPress={() => setAsking(true)} />)}
    </View>
  );
}

/** Requests the team raised. A manager takes one in (for someone, with photos needed) or turns it down with a reason. Anyone can raise one. */
export function Requests({ manager, meId, team }: { manager: boolean; meId: string; team: { id: string; name: string }[] }) {
  const [items, setItems] = useState<Task[] | null>(null); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [title, setTitle] = useState(''); const [details, setDetails] = useState('');
  const [pick, setPick] = useState<Record<string, { who: string; need: string; why: string }>>({});
  const key = useRef('req-' + Math.random().toString(36).slice(2));
  const load = async () => { try { setItems((await api<{ items: Task[] }>('/api/tasks/inbox')).items); } catch (e: any) { setErr(e.message); setItems([]); } };
  useEffect(() => { void load(); }, []);
  const v = (id: string) => pick[id] ?? { who: '', need: '1', why: '' };
  const set = (id: string, k: 'who' | 'need' | 'why', x: string) => setPick((p) => ({ ...p, [id]: { ...v(id), [k]: x } }));
  const raise = async () => {
    setErr(''); setNote('');
    try {
      await api('/api/tasks/requests', { method: 'POST', body: { title: title.trim(), details: details.trim() || undefined, clientKey: key.current } });
      key.current = 'req-' + Math.random().toString(36).slice(2); setTitle(''); setDetails(''); setNote('Request sent. A manager will take it from here.'); void load();
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  const decide = async (t: Task, accept: boolean) => {
    setErr(''); setNote('');
    const x = v(t.id);
    try {
      await api(`/api/tasks/${t.id}/decide`, { method: 'POST', body: accept ? { accept, assignedTo: x.who || null, photosRequired: Number(x.need) || 0 } : { accept, note: x.why.trim() } });
      setNote(accept ? 'Taken in. It is under Open now.' : 'Turned down.'); void load();
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  return (
    <View>
      <View style={[s.card, { marginTop: 4 }]}>
        <Field label="Raise a request" value={title} onChangeText={setTitle} placeholder="e.g. Fix the nets at lane 2" autoCapitalize="sentences" maxLength={120} />
        <Field label="Details (optional)" value={details} onChangeText={setDetails} autoCapitalize="sentences" maxLength={1000} />
        <Btn label="Send request" onPress={raise} />
        <Text style={s.muted}>Once it is sent, add pictures or a quote to it below as references.</Text>
      </View>
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      {items === null ? <Loading /> : !items.length ? <Text style={s.note}>No requests waiting.</Text> : items.map((t) => (
        <View key={t.id} style={s.card}>
          <Text style={s.h2}>{t.title}</Text>
          <Text style={s.muted}>From {t.intake?.byName ?? 'the team'}{t.createdAt ? ` · ${when(t.createdAt)}` : ''}</Text>
          {!!t.details && <Text style={[s.muted, { marginVertical: 6 }]}>{t.details}</Text>}
          <Refs t={t} mayHide={(r) => manager || r.addedById === meId} onChanged={load} setErr={setErr} setNote={setNote} />
          {manager && (
            <View style={{ marginTop: 8 }}>
              <Text style={[s.muted, { marginBottom: 6, fontSize: 12, fontWeight: '600' }]}>For</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}><Chip label="Anyone" on={!v(t.id).who} onPress={() => set(t.id, 'who', '')} />{team.map((m) => <Chip key={m.id} label={m.name} on={v(t.id).who === m.id} onPress={() => set(t.id, 'who', m.id)} />)}</View>
              <Field label="Photos needed" value={v(t.id).need} onChangeText={(x) => set(t.id, 'need', x)} keyboardType="numeric" />
              <Btn label="Take in" onPress={() => decide(t, true)} />
              <Field label="Reason, to turn it down" value={v(t.id).why} onChangeText={(x) => set(t.id, 'why', x)} autoCapitalize="sentences" maxLength={300} />
              <Btn kind="ghost" label="Turn down" onPress={() => decide(t, false)} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

interface Report { date: string; notes: { id: string; authorName: string | null; workers: number | null; body: string; issues: string | null; mine: boolean }[]; done: { title: string; proofPhotos: number }[]; overdue: { title: string }[]; started: { title: string }[]; proofPhotos: number; references: number }

/** Today's site note (or a day in the last week): people working, what was done, problems; with the day's jobs from the board. */
export function SiteNote() {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today); const [r, setR] = useState<Report | null>(null);
  const [workers, setWorkers] = useState(''); const [body, setBody] = useState(''); const [issues, setIssues] = useState('');
  const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const fill = (x: Report) => { setR(x); const m = x.notes.find((n) => n.mine); setWorkers(m?.workers != null ? String(m.workers) : ''); setBody(m?.body ?? ''); setIssues(m?.issues ?? ''); };
  useEffect(() => { setR(null); api<Report>(`/api/site-reports?date=${date || today}`).then(fill).catch((e) => setErr(e.message)); }, [date]);
  const save = async () => {
    setErr(''); setNote('');
    try { fill(await api<Report>('/api/site-reports', { method: 'POST', body: { date: date || today, workers: workers === '' ? undefined : Number(workers), body: body.trim(), issues: issues.trim() || undefined } })); setNote('Site note saved.'); } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  return (
    <View>
      <DateField label="Day" value={date} onChange={setDate} />
      {r === null ? <Loading /> : (
        <View style={s.card}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Badge tone="ok" label={`${r.done.length} finished`} /><Badge label={`${r.started.length} started`} />{r.overdue.length > 0 && <Badge tone="danger" label={`${r.overdue.length} overdue`} />}
            <Badge tone="gold" label={`${r.proofPhotos} proof photos`} /><Badge label={`${r.references} references`} />
          </View>
          {r.done.map((d, i) => <Text key={i} style={s.text}>✓ {d.title} · {d.proofPhotos} proof photo{d.proofPhotos === 1 ? '' : 's'}</Text>)}
          {r.notes.filter((n) => !n.mine).map((n) => <Text key={n.id} style={[s.muted, { marginTop: 6 }]}>{n.authorName ?? 'Team member'}: {n.body}{n.issues ? ` · Problems: ${n.issues}` : ''}</Text>)}
          <Field label="People working" value={workers} onChangeText={setWorkers} keyboardType="numeric" />
          <Field label="What was done" value={body} onChangeText={setBody} multiline autoCapitalize="sentences" maxLength={2000} style={[s.input, { minHeight: 84, textAlignVertical: 'top' }]} />
          <Field label="Problems (optional)" value={issues} onChangeText={setIssues} multiline autoCapitalize="sentences" maxLength={1000} />
          <Btn label={r.notes.some((n) => n.mine) ? 'Update my note' : 'Save my note'} onPress={save} />
        </View>
      )}
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
    </View>
  );
}
