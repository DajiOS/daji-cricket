import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api, authImage, upload } from './api';
import { takeProofPhoto } from './camera';
import type { Task, TaskRepeat, TeamMember, User } from './types';
import { Avatar, Badge, Btn, Chip, DateField, Field, Icon, Loading, MiniStat, Progress, RoundBtn, ScreenHead, SearchBox, Segmented, s } from './ui';
import { C, niceDate } from './theme';
import { Requests, SiteNote, TaskExtras } from './TaskWork';

const REPEATS: [TaskRepeat | '', string][] = [['', 'Once'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const Label = ({ children }: { children: string }) => <Text style={[s.muted, { marginTop: 4, marginBottom: 8, fontSize: 12.5, fontWeight: '600' }]}>{children}</Text>;
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const when = (ms: number): string => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Jobs for the team. A task is closed with photos taken with the camera on the spot (never from the gallery).
 *  A job can repeat (closing it adds the next one) and carry a checklist the team ticks off step by step. */
/** `draftTitle` comes from a voice shortcut ("create a task"): the form starts filled in, and nothing is saved until Add is pressed. */
export function TasksScreen({ user, draftTitle }: { user: User; draftTitle?: string }) {
  const manager = user.role !== 'staff' || (user.permissions ?? []).includes('manage_tasks');
  const [filter, setFilter] = useState<'open' | 'done' | 'cancelled' | 'requests' | 'report'>('open');
  const [items, setItems] = useState<Task[] | null>(null); const [team, setTeam] = useState<TeamMember[]>([]);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [working, setWorking] = useState('');
  const [title, setTitle] = useState(draftTitle ?? ''); const [details, setDetails] = useState(''); const [need, setNeed] = useState('1'); const [who, setWho] = useState('');
  const [due, setDue] = useState(''); const [repeat, setRepeat] = useState<TaskRepeat | ''>(''); const [prio, setPrio] = useState<(typeof PRIORITIES)[number]>('medium'); const [steps, setSteps] = useState(''); const [q, setQ] = useState('');
  const [adding, setAdding] = useState(!!draftTitle); const [expanded, setExpanded] = useState('');

  const load = useCallback(async () => {
    if (filter === 'requests' || filter === 'report') { setItems([]); return; }
    setBusy(true);
    try { setItems((await api<{ items: Task[] }>(`/api/tasks?status=${filter}`)).items); setErr(''); } catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (manager) api<{ items: TeamMember[] }>('/api/tasks/people').then((r) => setTeam(r.items)).catch(() => {}); }, [manager]);

  const act = async (id: string, what: 'complete' | 'cancel') => {
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
      setTitle(''); setDetails(''); setDue(''); setRepeat(''); setPrio('medium'); setSteps(''); setAdding(false); setNote('Task added.'); setFilter('open'); void load();
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };

  const needle = q.trim().toLowerCase();
  const shown = items && (needle ? items.filter((t) => [t.title, t.details, t.assignedName, ...(t.checklist ?? []).map((c) => c.text)].some((v) => v?.toLowerCase().includes(needle))) : items);

  const open = shown && filter === 'open' ? shown : [];
  const overdueN = open.filter((t) => t.overdue).length;
  const mineN = open.filter((t) => t.assignedTo === user.id).length;
  const FILTERS: ['open' | 'done' | 'cancelled' | 'requests' | 'report', string][] = [['open', 'Open'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['requests', 'Requests'], ['report', 'Site report']];

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />} keyboardShouldPersistTaps="handled">
      <ScreenHead eyebrow="Team" title="Tasks"
        about="Close a task with photos taken right now. The camera opens, and a photo is only accepted if it was taken in the last 5 minutes. Gallery pictures and old photos are turned away."
        right={manager && !adding ? <RoundBtn dark icon="add" label="New task" onPress={() => { setAdding(true); setNote(''); }} /> : undefined} />

      {manager && adding && (
        <View style={s.card}>
          <View style={[s.row, { paddingVertical: 0, marginBottom: 12 }]}><Text style={[s.h2, { marginBottom: 0 }]}>New task</Text><RoundBtn icon="close" label="Close the new task form" size={36} onPress={() => setAdding(false)} /></View>
          <Field label="What needs doing" value={title} onChangeText={setTitle} placeholder="e.g. Roll the pitch" autoCapitalize="sentences" />
          <Field label="Details (optional)" value={details} onChangeText={setDetails} autoCapitalize="sentences" />
          <Field label="Checklist (optional, one step per line)" value={steps} onChangeText={setSteps} multiline autoCapitalize="sentences" placeholder={'Sweep the crease\nWater the pitch\nRoll both ends'} style={{ minHeight: 84, textAlignVertical: 'top' }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Photos needed" value={need} onChangeText={setNeed} keyboardType="numeric" /></View>
            <View style={{ flex: 1.4 }}><DateField label={repeat ? 'First due day' : 'Due day'} value={due} onChange={setDue} /></View>
          </View>
          <Label>Repeats</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{REPEATS.map(([k, label]) => <Chip key={k || 'once'} label={label} on={repeat === k} onPress={() => setRepeat(k)} />)}</View>
          {!!repeat && <Text style={[s.muted, { marginBottom: 8 }]}>When it is closed, the next one is added with the next due day.</Text>}
          <Label>Priority</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{PRIORITIES.map((p) => <Chip key={p} label={cap(p)} on={prio === p} onPress={() => setPrio(p)} />)}</View>
          <Label>For</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}><Chip label="Anyone" on={!who} onPress={() => setWho('')} />{team.map((m) => <Chip key={m.id} label={m.name} on={who === m.id} onPress={() => setWho(m.id)} />)}</View>
          <Btn label="Add task" icon="add" onPress={add} disabled={title.trim().length < 3} style={{ marginBottom: 0 }} />
        </View>
      )}

      <Segmented items={FILTERS} value={filter} onChange={setFilter} />
      {filter === 'requests' ? <Requests manager={manager} meId={user.id} team={team} /> : filter === 'report' ? <SiteNote /> : (<>
      {filter === 'open' && (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <MiniStat n={shown === null ? '–' : String(open.length)} label="Open" hue={0} />
          <MiniStat n={shown === null ? '–' : String(overdueN)} label="Overdue" hue={4} />
          <MiniStat n={shown === null ? '–' : String(mineN)} label="For me" hue={6} />
        </View>
      )}
      <SearchBox value={q} onChangeText={setQ} placeholder="Search title, step or person" />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      {shown === null ? <Loading /> : !shown.length ? (
        <View style={[s.card, { alignItems: 'center', paddingVertical: 30 }]}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}><Icon name="checkbox-outline" size={26} color={C.muted} /></View>
          <Text style={[s.text, { fontWeight: '600' }]}>{q.trim() ? 'No task matches the search.' : filter === 'open' ? 'Nothing to do right now.' : 'Nothing here yet.'}</Text>
        </View>
      ) : shown.map((t) => {
        const counted = t.proofCounted ?? t.photos.length;
        const missing = Math.max(0, t.photosRequired - counted);
        const list = t.checklist ?? []; const ticked = list.filter((c) => c.done).length;
        const canTick = t.status === 'open' && (manager || !t.assignedTo || t.assignedTo === user.id || (t.helpers ?? []).some((x) => x.id === user.id));
        const isOpen = expanded === t.id;
        const ring = t.status === 'done' ? C.ok : t.overdue || t.priority === 'urgent' ? C.danger : t.priority === 'high' ? C.warn : C.line;
        const meta = [t.assignedName ? t.assignedName : 'Whole team', t.dueDate ? `Due ${niceDate(t.dueDate)}` : '', t.repeat ? REPEATS.find(([k]) => k === t.repeat)?.[1] ?? '' : ''].filter(Boolean).join('  ·  ');
        return (
          <View key={t.id} style={[s.card, { padding: 16 }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} accessibilityLabel={`${t.title}, ${isOpen ? 'close' : 'open'}`} onPress={() => setExpanded(isOpen ? '' : t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: ring, backgroundColor: t.status === 'done' ? C.ok : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {t.status === 'done' ? <Icon name="checkmark" size={20} color={C.panel} /> : t.assignedName ? <Avatar name={t.assignedName} size={32} /> : <Icon name="people-outline" size={18} color={C.muted} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 }} numberOfLines={isOpen ? undefined : 2}>{t.title}</Text>
                <Text style={[s.muted, { fontSize: 12.5, marginTop: 2 }]} numberOfLines={1}>{meta}</Text>
              </View>
              <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
            </Pressable>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginBottom: -4 }}>
              {t.overdue && <Badge tone="danger" label="Overdue" />}{(t.priority === 'high' || t.priority === 'urgent') && <Badge tone={t.priority === 'urgent' ? 'danger' : 'warn'} label={cap(t.priority)} />}
              {t.photosRequired > 0 && <Badge tone={missing ? 'muted' : 'ok'} label={`${counted}/${t.photosRequired} photos`} />}
              {list.length > 0 && <Badge tone={ticked === list.length ? 'ok' : 'muted'} label={`${ticked}/${list.length} steps`} />}
            </View>
            {list.length > 0 && !isOpen && <View style={{ marginTop: 10 }}><Progress done={ticked} total={list.length} color={ticked === list.length ? C.ok : C.gold} /></View>}
            {isOpen && (<>
            {!!t.details && <Text style={[s.text, { color: C.muted, marginTop: 12, lineHeight: 21 }]}>{t.details}</Text>}
            {list.length > 0 && (
              <View style={{ marginTop: 10, backgroundColor: C.soft, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 4 }}>
                {list.map((c, i) => (
                  <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: c.done, disabled: !canTick }} disabled={!canTick} onPress={() => tick(t, i, !c.done)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i === list.length - 1 ? 0 : 1, borderBottomColor: C.line }}>
                    <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: c.done ? C.ok : C.muted, backgroundColor: c.done ? C.ok : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      {c.done && <Icon name="checkmark" size={14} color={C.panel} />}
                    </View>
                    <Text style={[s.text, { flex: 1 }, c.done ? { color: C.muted, textDecorationLine: 'line-through' } : null]}>{c.text}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {t.photos.length > 0 && <Text style={[s.muted, { fontSize: 12, fontWeight: '600', marginTop: 12 }]}>Proof photos{t.photos.length > counted ? ` (${t.photos.length - counted} from before it was reopened no longer count)` : ''}</Text>}
            {t.photos.length > 0 && <ScrollView horizontal style={{ marginVertical: 8 }}>{t.photos.map((p) => <View key={p.id} style={{ marginRight: 8 }}><Image source={authImage(p.url)} style={{ width: 92, height: 92, borderRadius: 16, backgroundColor: C.line }} /><Text style={[s.muted, { fontSize: 10, marginTop: 2 }]}>{when(p.takenAt)}</Text></View>)}</ScrollView>}
            {t.status === 'done' && <Text style={[s.muted, { marginTop: 10 }]}>Done {t.completedAt ? when(t.completedAt) : ''}{t.completedByName ? ` by ${t.completedByName}` : ''}</Text>}
            {t.status === 'open' && (<>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                <Btn kind="ghost" icon="camera-outline" label="Take photo" busy={working === t.id} onPress={() => photo(t)} style={{ flex: 1, marginBottom: 0 }} />
                <Btn icon="checkmark" label="Mark done" disabled={missing > 0} onPress={() => act(t.id, 'complete')} style={{ flex: 1, marginBottom: 0 }} />
              </View>
              {missing > 0 && <Text style={[s.muted, { marginTop: 8, textAlign: 'center' }]}>Take {missing} more photo{missing === 1 ? '' : 's'} to finish.</Text>}
              {manager && <Btn kind="link" label="Cancel task" onPress={() => act(t.id, 'cancel')} style={{ marginTop: 6, marginBottom: 0 }} />}
            </>)}
            <TaskExtras t={t} user={user} manager={manager} team={team} onChanged={load} setErr={setErr} setNote={setNote} />
            </>)}
          </View>
        );
      })}
      </>)}
    </ScrollView>
  );
}
