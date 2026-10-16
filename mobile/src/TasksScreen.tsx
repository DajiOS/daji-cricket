import React, { useCallback, useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, authImage, upload } from './api';
import { takeProofPhoto } from './camera';
import type { Task, TeamMember, User } from './types';
import { Badge, Btn, Chip, Field, Loading, s } from './ui';
import { C, niceDate } from './theme';

const when = (ms: number): string => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Jobs for the team. A task is closed with photos taken with the camera on the spot (never from the gallery). */
export function TasksScreen({ user }: { user: User }) {
  const manager = user.role !== 'staff' || (user.permissions ?? []).includes('manage_tasks');
  const [filter, setFilter] = useState<'open' | 'done' | 'cancelled'>('open');
  const [items, setItems] = useState<Task[] | null>(null); const [team, setTeam] = useState<TeamMember[]>([]);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [working, setWorking] = useState('');
  const [title, setTitle] = useState(''); const [details, setDetails] = useState(''); const [need, setNeed] = useState('1'); const [who, setWho] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try { setItems((await api<{ items: Task[] }>(`/api/tasks?status=${filter}`)).items); setErr(''); } catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (manager) api<{ items: TeamMember[] }>('/api/staff/team').then((r) => setTeam(r.items.filter((m) => m.active !== false))).catch(() => {}); }, [manager]);

  const act = async (id: string, what: 'complete' | 'cancel' | 'reopen') => {
    setErr(''); setNote('');
    try { await api(`/api/tasks/${id}/${what}`, { method: 'POST', body: {} }); setNote(what === 'complete' ? 'Task done.' : 'Saved.'); void load(); } catch (e: any) { setErr(e.message); }
  };
  const photo = async (t: Task) => {
    setErr(''); setNote(''); setWorking(t.id);
    try {
      const shot = await takeProofPhoto(); if (!shot) return;
      await upload(`/api/tasks/${t.id}/photos`, shot.uri, { 'x-app-shot-at': String(shot.shotAt) });
      setNote('Photo added.'); void load();
    } catch (e: any) { setErr(e.message); } finally { setWorking(''); }
  };
  const add = async () => {
    setErr(''); setNote('');
    try {
      await api('/api/tasks', { method: 'POST', body: { title: title.trim(), details: details.trim() || undefined, assignedTo: who || null, photosRequired: Number(need) || 0 } });
      setTitle(''); setDetails(''); setNote('Task added.'); setFilter('open'); void load();
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <Text style={s.eyebrow}>Team</Text><Text style={s.h1}>Tasks</Text>
      <Text style={s.muted}>Close a task with photos taken right now. The camera opens, and a photo is only accepted if it was taken in the last 5 minutes. Gallery pictures and old photos are turned away.</Text>
      {manager && (
        <View style={[s.card, { marginTop: 14 }]}>
          <Field label="New task" value={title} onChangeText={setTitle} placeholder="e.g. Roll the pitch" autoCapitalize="sentences" />
          <Field label="Details (optional)" value={details} onChangeText={setDetails} autoCapitalize="sentences" />
          <Field label="Photos needed" value={need} onChangeText={setNeed} keyboardType="numeric" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}><Chip label="Anyone" on={!who} onPress={() => setWho('')} />{team.map((m) => <Chip key={m.id} label={m.name} on={who === m.id} onPress={() => setWho(m.id)} />)}</View>
          <Btn label="Add task" onPress={add} disabled={title.trim().length < 3} />
        </View>
      )}
      <View style={{ flexDirection: 'row', marginVertical: 10 }}>{(['open', 'done', 'cancelled'] as const).map((f) => <Chip key={f} label={f === 'open' ? 'Open' : f === 'done' ? 'Done' : 'Cancelled'} on={filter === f} onPress={() => setFilter(f)} />)}</View>
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      {items === null ? <Loading /> : !items.length ? <Text style={s.muted}>{filter === 'open' ? 'Nothing to do right now.' : 'Nothing here yet.'}</Text> : items.map((t) => {
        const missing = Math.max(0, t.photosRequired - t.photos.length);
        return (
          <View key={t.id} style={s.card}>
            <Text style={s.h2}>{t.title}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {t.status === 'done' && <Badge tone="ok" label="Done" />}{t.overdue && <Badge tone="danger" label="Overdue" />}{t.dueDate && <Badge label={`Due ${niceDate(t.dueDate)}`} />}
              <Badge tone="gold" label={`${t.photos.length} of ${t.photosRequired} photos`} /><Badge label={t.assignedName ? `For ${t.assignedName}` : 'Whole team'} />
            </View>
            {!!t.details && <Text style={[s.muted, { marginVertical: 6 }]}>{t.details}</Text>}
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
