import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import type { ProgressCard, Student } from './types';
import { Badge, Btn, Chip, Field, KV, Loading, Section, Segmented, s, NameFields, DateField, ScreenHead, Empty } from './ui';
import { C, formatPhone } from './theme';

type Tab = 'attendance' | 'students' | 'progress';
const today = (): string => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const thisMonth = (): string => today().slice(0, 7);

/** Coaches: mark attendance, keep the student list, and write monthly report cards for parents. */
export function AcademyScreen() {
  const [tab, setTab] = useState<Tab>('attendance');
  return (
    <View style={s.screen}>
      <View style={{ paddingTop: 60, paddingHorizontal: 18 }}>
        <ScreenHead eyebrow="MP13 Academy" title="Academy" />
        <Segmented items={[['attendance', 'Attendance'], ['students', 'Students'], ['progress', 'Report cards']] as [Tab, string][]} value={tab} onChange={setTab} />
      </View>
      {tab === 'attendance' ? <Attendance /> : tab === 'students' ? <Students /> : <Progress />}
    </View>
  );
}

function Attendance() {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<{ studentId: string; name: string; present: boolean | null }[] | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setErr(''); setNote('');
    try { setRows((await api<{ items: { studentId: string; name: string; present: boolean | null }[] }>(`/api/staff/academy/attendance?date=${date}`)).items); } catch (e: any) { setErr(e.message); setRows([]); }
  }, [date]);
  useEffect(() => { void load(); }, [load]);
  const set = (id: string, present: boolean) => setRows((r) => (r ?? []).map((x) => (x.studentId === id ? { ...x, present } : x)));
  const save = async () => {
    const marks = (rows ?? []).filter((x) => x.present !== null).map((x) => ({ studentId: x.studentId, present: x.present as boolean }));
    if (!marks.length) { setErr('Mark at least one student.'); return; }
    setBusy(true); setErr('');
    try { const r = await api<{ saved: number }>('/api/staff/academy/attendance', { method: 'POST', body: { date, marks } }); setNote(`Saved for ${r.saved} students.`); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const markAll = (p: boolean) => setRows((r) => (r ?? []).map((x) => ({ ...x, present: p })));
  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <DateField label="Day" value={date} onChange={setDate} />
      <View style={{ flexDirection: 'row' }}><Chip label="All present" onPress={() => markAll(true)} /><Chip label="All absent" onPress={() => markAll(false)} /></View>
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      {rows === null ? <Loading /> : !rows.length ? <Empty icon="people-outline" text="No active students for this day." /> : rows.map((r) => (
        <View key={r.studentId} style={s.row}>
          <Text style={s.text}>{r.name}</Text>
          <View style={{ flexDirection: 'row' }}><Chip label="Present" on={r.present === true} onPress={() => set(r.studentId, true)} /><Chip label="Absent" on={r.present === false} onPress={() => set(r.studentId, false)} /></View>
        </View>
      ))}
      <Btn label="Save attendance" onPress={save} busy={busy} disabled={!rows?.length} style={{ marginTop: 12 }} />
    </ScrollView>
  );
}

function Students() {
  const [items, setItems] = useState<Student[] | null>(null); const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false); const [f, setF] = useState({ name: '', guardianName: '', guardianEmail: '', guardianPhone: '', batch: '', bornOn: '' });
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setItems((await api<{ items: Student[] }>(`/api/staff/academy/students${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)).items); } catch (e: any) { setErr(e.message); setItems([]); }
  }, [q]);
  useEffect(() => { void load(); }, [load]);
  const add = async () => {
    setErr(''); setNote(''); setBusy(true);
    try {
      const body: Record<string, string> = {}; for (const [k, v] of Object.entries(f)) if (v.trim()) body[k] = v.trim();
      await api('/api/staff/academy/students', { method: 'POST', body }); setNote('Student added.'); setF({ name: '', guardianName: '', guardianEmail: '', guardianPhone: '', batch: '', bornOn: '' }); setAdding(false); void load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const patch = async (id: string, body: object, ok: string) => { setErr(''); setNote(''); try { await api(`/api/staff/academy/students/${id}`, { method: 'PATCH', body }); setNote(ok); void load(); } catch (e: any) { setErr(e.message); } };
  const link = async (st: Student) => {
    if (!st.guardianEmail) { setErr('Add the parent\'s email first.'); return; }
    setErr(''); try { await api(`/api/staff/academy/students/${st.id}/link-guardian`, { method: 'POST', body: { email: st.guardianEmail } }); setNote('Linked. The parent now sees attendance and published report cards.'); void load(); } catch (e: any) { setErr(e.message); }
  };
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.gold} />}>
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      <Btn kind="outline" label={adding ? 'Close' : 'Add a student'} onPress={() => setAdding(!adding)} />
      {adding && (<View style={s.card}>
        <NameFields value={f.name} onChange={set('name')} firstLabel="Student first name" lastLabel="Student last name" /><NameFields value={f.guardianName} onChange={set('guardianName')} firstLabel="Parent first name" lastLabel="Parent last name" />
        <Field label="Parent email" value={f.guardianEmail} onChangeText={set('guardianEmail')} keyboardType="email-address" /><Field label="Parent phone" value={f.guardianPhone} onChangeText={set('guardianPhone')} keyboardType="phone-pad" />
        <Field label="Batch" value={f.batch} onChangeText={set('batch')} autoCapitalize="words" /><DateField label="Born on" value={f.bornOn} onChange={set('bornOn')} />
        <Btn label="Save student" onPress={add} busy={busy} />
      </View>)}
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name" />
      {items === null ? <Loading /> : !items.length ? <Empty icon="school-outline" text="No students yet." /> : items.map((st) => (
        <View key={st.id} style={s.card}>
          <View style={s.row}><Text style={s.h2}>{st.name}</Text><View style={{ flexDirection: 'row' }}>{st.linked && <Badge tone="ok" label="Parent linked" />}{st.status === 'left' && <Badge label="Left" />}</View></View>
          <KV k="Batch" v={st.batch ?? '—'} /><KV k="Parent" v={`${st.guardianName}${st.guardianPhone ? ' · ' + formatPhone(st.guardianPhone) : ''}`} />
          {st.guardianEmail && <KV k="Email" v={st.guardianEmail} />}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
            {!st.linked && st.guardianEmail && <Chip label="Link parent account" onPress={() => link(st)} />}
            <Chip label={st.status === 'active' ? 'Mark as left' : 'Re-join'} onPress={() => patch(st.id, { status: st.status === 'active' ? 'left' : 'active' }, st.status === 'active' ? 'Marked as left.' : 'Welcome back.')} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Progress() {
  const [students, setStudents] = useState<Student[]>([]); const [sid, setSid] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [skills, setSkills] = useState<string[]>([]); const [rating, setRating] = useState<Record<string, number>>({}); const [comment, setComment] = useState('');
  const [card, setCard] = useState<ProgressCard | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ items: Student[] }>('/api/staff/academy/students?status=active').then((r) => { setStudents(r.items); setSid((c) => c || r.items[0]?.id || ''); }).catch((e) => setErr(e.message)); }, []);
  const load = useCallback(async () => {
    if (!sid) return;
    setErr(''); setNote('');
    try {
      const r = await api<{ items: ProgressCard[]; skills: string[] }>(`/api/staff/academy/students/${sid}/progress`);
      setSkills(r.skills); const c = r.items.find((x) => x.month === month) ?? null; setCard(c);
      setRating(c ? Object.fromEntries(c.ratings.map((x) => [x.skill, x.rating])) : Object.fromEntries(r.skills.map((k) => [k, 3]))); setComment(c?.comment ?? '');
    } catch (e: any) { setErr(e.message); }
  }, [sid, month]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setErr(''); setNote(''); setBusy(true);
    try { const c = await api<ProgressCard>(`/api/staff/academy/students/${sid}/progress/${month}`, { method: 'PUT', body: { ratings: rating, comment: comment.trim() || undefined } }); setCard(c); setNote('Saved. Publish it when it is ready for the parent.'); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const publish = async (p: boolean) => {
    setErr(''); try { setCard(await api<ProgressCard>(`/api/staff/academy/students/${sid}/progress/${month}/publish`, { method: 'POST', body: { published: p } })); setNote(p ? 'Published. The parent can see it now.' : 'Hidden from the parent.'); } catch (e: any) { setErr(e.message); }
  };
  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{students.map((st) => <Chip key={st.id} label={st.name} on={st.id === sid} onPress={() => setSid(st.id)} />)}</View>
      {!students.length && <Text style={s.muted}>Add students first.</Text>}
      <Field label="Month (YYYY-MM)" value={month} onChangeText={setMonth} />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      {sid && skills.length > 0 && (<>
        <Section>Ratings, 1 to 5</Section>
        {skills.map((k) => (<View key={k} style={{ marginBottom: 6 }}><Text style={s.text}>{k}</Text><View style={{ flexDirection: 'row' }}>{[1, 2, 3, 4, 5].map((n) => <Chip key={n} label={String(n)} on={rating[k] === n} onPress={() => setRating({ ...rating, [k]: n })} />)}</View></View>))}
        <Field label="Coach's comment" value={comment} onChangeText={setComment} multiline autoCapitalize="sentences" style={[s.input, { minHeight: 80 }]} />
        <Btn label="Save report card" onPress={save} busy={busy} />
        {card && <Btn kind="outline" label={card.published ? 'Hide from parent' : 'Publish to parent'} onPress={() => publish(!card.published)} />}
        {card && <Text style={s.muted}>{card.published ? 'Visible to the parent.' : 'Not yet visible to the parent.'}</Text>}
      </>)}
    </ScrollView>
  );
}
