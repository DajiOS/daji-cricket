import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, authImage, upload } from './api';
import { takeProofPhoto } from './camera';
import type { Task, TaskRepeat, TeamMember, User } from './types';
import { Badge, Btn, Chip, DateField, Field, Loading, s } from './ui';
import { C, niceDate } from './theme';

const REPEATS: [TaskRepeat | '', string][] = [['', 'Once'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const when = (ms: number): string => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Jobs for the team. A task is closed with photos taken with the camera on the spot (never from the gallery).
 *  A job can repeat (closing it adds the next one) and carry a checklist the team ticks off step by step. */
export function TasksScreen({ user }: { user: User }) {
  const manager = user.role !== 'staff' || (user.permissions ?? []).includes('manage_tasks');
  const [filter, setFilter] = useState<'open' | 'done' | 'cancelled'>('open');
  const [items, setItems] = useState<Task[] | null>(null); const [team, setTeam] = useState<TeamMember[]>([]);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [working, setWorking] = useState('');
  const [title, setTitle] = useState(''); const [details, setDetails] = useState(''); const [need, setNeed] = useState('1'); const [who, setWho] = useState('');
  const [due, setDue] = useState(''); const [repeat, setRepeat] = useState<TaskRepeat | ''>(''); const [prio, setPrio] = useState<(typeof PRIORITIES)[number]>('medium'); const [steps, setSteps] = useState(''); const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await api<{ items: Task[] }>(`/api/tasks?status=${filter}`)).items); setErr(''); } catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (manager) api<{ items: TeamMember[] }>('/api/staff/team').then((r) => setTeam(r.items.filter((m) => m.active !== false))).catch(() => {}); }, [manager]);

  const act = async (id: string, what: 'complete' | 'cancel' | 'reopen') => {
    setErr(''); setNote('');
    try {
      const done = await api<Task>(`/api/tasks/${id}/${what}`, { method: 'POST', body: {} });
      setNote(what === 'complete' ? (done.repeat ? 'Task done. The next one is waiting under Open.' : 'Task done.') : 'Saved.'); void load();
    } catch (e: any) { setErr(e.message); }
  };
  const photo = async (t: Task) => {
    setErr(''); setNote(''); setWorking(t.id);
    try {
      const shot = await takeProofPhoto(); if (!shot) return;
      await upload(`/api/tasks/${t.id}/photos`, shot.uri, { 'x-app-shot-at': String(shot.shotAt) });
      setNote('Photo added.'); void load();
    } catch (e: any) { setErr(e.message); } finally { setWorking(''); }
  };
  // Ticks one step. The screen shows the tick at once and puts it back if the server says no.
  const tick = async (t: Task, index: number, done: boolean) => {
    setErr(''); setNote('');
    const swap = (list: Task['checklist']) => setItems((cur) => cur && cur.map((x) => (x.id === t.id ? { ...x, checklist: list } : x)));
    swap((t.checklist ?? []).map((c, i) => (i === index ? { ...c, done } : c)));
    try { swap((await api<Task>(`/api/tasks/${t.id}/checklist`, { method: 'POST', body: { index, done } })).checklist); } catch (e: any) { swap(t.checklist); setErr(e.message); }
  };
  const add = async () => {
    setErr(''); setNote('');
    try {
      const checklist = steps.split('\n').map((x) => x.trim()).filter(Boolean);
      await api('/api/tasks', { method: 'POST', body: { title: title.trim(), details: details.trim() || undefined, assignedTo: who || null, photosRequired: Number(need) || 0, priority: prio, dueDate: due || null, repeat: repeat || null, ...(checklist.length ? { checklist } : {}) } });
      setTitle(''); setDetails(''); setDue(''); setRepeat(''); setPrio('medium'); setSteps(''); setNote('Task added.'); setFilter('open'); void load();
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };

  const needle = q.trim().toLowerCase();
  const shown = items && (needle ? items.filter((t) => [t.title, t.details, t.assignedName, ...(t.checklist ?? []).map((c) => c.text)].some((v) => v?.toLowerCase().includes(needle))) : items);

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <Text style={s.eyebrow}>Team</Text><Text style={s.h1}>Tasks</Text>
      <Text style={s.muted}>Close a task with photos taken right now. The camera opens, and a photo is only accepted if it was taken in the last 5 minutes. Gallery pictures and old photos are turned away.</Text>
      {manager && (
        <View style={[s.card, { marginTop: 14 }]}>
          <Field label="New task" value={title} onChangeText={setTitle} placeholder="e.g. Roll the pitch" autoCapitalize="sentences" />
          <Field label="Details (optional)" value={details} onChangeText={setDetails} autoCapitalize="sentences" />
          <Field label="Checklist (optional, one step per line)" value={steps} onChangeText={setSteps} multiline autoCapitalize="sentences" placeholder={'Sweep the crease\nWater the pitch\nRoll both ends'} style={[s.input, { minHeight: 84, textAlignVertical: 'top' }]} />
          <Field label="Photos needed" value={need} onChangeText={setNeed} keyboardType="numeric" />
          <DateField label={repeat ? 'First due day' : 'Due day (optional)'} value={due} onChange={setDue} />
          <Text style={[s.muted, { marginBottom: 6, fontSize: 12, fontWeight: '600' }]}>Repeats</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{REPEATS.map(([k, label]) => <Chip key={k || 'once'} label={label} on={repeat === k} onPress={() => setRepeat(k)} />)}</View>
          {!!repeat && <Text style={[s.muted, { marginBottom: 8 }]}>When it is closed, the next one is added with the next due day.</Text>}
          <Text style={[s.muted, { marginBottom: 6, fontSize: 12, fontWeight: '600' }]}>Priority</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{PRIORITIES.map((p) => <Chip key={p} label={cap(p)} on={prio === p} onPress={() => setPrio(p)} />)}</View>
          <Text style={[s.muted, { marginBottom: 6, fontSize: 12, fontWeight: '600' }]}>For</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}><Chip label="Anyone" on={!who} onPress={() => setWho('')} />{team.map((m) => <Chip key={m.id} label={m.name} on={who === m.id} onPress={() => setWho(m.id)} />)}</View>
          <Btn label="Add task" onPress={add} disabled={title.trim().length < 3} />
        </View>
      )}
      <View style={{ flexDirection: 'row', marginVertical: 10 }}>{(['open', 'done', 'cancelled'] as const).map((f) => <Chip key={f} label={f === 'open' ? 'Open' : f === 'done' ? 'Done' : 'Cancelled'} on={filter === f} onPress={() => setFilter(f)} />)}</View>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Title, details, step or person" />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      {shown === null ? <Loading /> : !shown.length ? <Text style={s.muted}>{q.trim() ? 'No task matches the search.' : filter === 'open' ? 'Nothing to do right now.' : 'Nothing here yet.'}</Text> : shown.map((t) => {
        const missing = Math.max(0, t.photosRequired - t.photos.length);
        const list = t.checklist ?? []; const ticked = list.filter((c) => c.done).length;
        const canTick = t.status === 'open' && (manager || !t.assignedTo || t.assignedTo === user.id);
        return (
          <View key={t.id} style={s.card}>
            <Text style={s.h2}>{t.title}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {t.status === 'done' && <Badge tone="ok" label="Done" />}{t.overdue && <Badge tone="danger" label="Overdue" />}{(t.priority === 'high' || t.priority === 'urgent') && <Badge tone={t.priority === 'urgent' ? 'danger' : 'gold'} label={cap(t.priority)} />}{t.dueDate && <Badge label={`Due ${niceDate(t.dueDate)}`} />}
              {!!t.repeat && <Badge label={REPEATS.find(([k]) => k === t.repeat)?.[1] ?? t.repeat} />}{list.length > 0 && <Badge tone={ticked === list.length ? 'ok' : 'muted'} label={`Steps ${ticked}/${list.length}`} />}
              <Badge tone="gold" label={`${t.photos.length} of ${t.photosRequired} photos`} /><Badge label={t.assignedName ? `For ${t.assignedName}` : 'Whole team'} />
            </View>
            {!!t.details && <Text style={[s.muted, { marginVertical: 6 }]}>{t.details}</Text>}
            {list.length > 0 && (
              <View style={{ marginVertical: 6 }}>
                {list.map((c, i) => (
                  <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: c.done, disabled: !canTick }} disabled={!canTick} onPress={() => tick(t, i, !c.done)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.done ? C.ok : C.line, backgroundColor: c.done ? C.ok : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                      {c.done && <Text style={{ color: C.panel, fontSize: 13, fontWeight: '700' }}>✓</Text>}
                    </View>
                    <Text style={[s.text, { flex: 1 }, c.done ? { color: C.muted, textDecorationLine: 'line-through' } : null]}>{c.text}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {t.photos.length > 0 && <ScrollView horizontal style={{ marginVertical: 8 }}>{t.photos.map((p) => <View key={p.id} style={{ marginRight: 8 }}><Image source={authImage(p.url)} style={{ width: 92, height: 92, borderRadius: 8, backgroundColor: C.line }} /><Text style={[s.muted, { fontSize: 10, marginTop: 2 }]}>{when(p.takenAt)}</Text></View>)}</ScrollView>}
            {t.status === 'done' && <Text style={s.muted}>Done {t.completedAt ? when(t.completedAt) : ''}{t.completedByName ? ` by ${t.completedByName}` : ''}</Text>}
            {t.status === 'open' && (<>
              <Btn kind="outline" label="Take photo" busy={working === t.id} onPress={() => photo(t)} />
              <Btn label="Mark done" disabled={missing > 0} onPress={() => act(t.id, 'complete')} />
              {missing > 0 && <Text style={s.muted}>Take {missing} more photo{missing === 1 ? '' : 's'} to finish.</Text>}
              {manager && <Btn kind="ghost" label="Cancel task" onPress={() => act(t.id, 'cancel')} />}
            </>)}
            {manager && t.status !== 'open' && <Btn kind="ghost" label="Reopen" onPress={() => act(t.id, 'reopen')} />}
          </View>
        );
      })}
    </ScrollView>
  );
}
