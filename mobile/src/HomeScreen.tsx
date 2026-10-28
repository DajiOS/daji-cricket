import React, { useCallback, useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { api } from './api';
import type { StaffBooking, Task, User, MatchRow } from './types';
import { ActionTile, Avatar, Badge, Icon, type IconName, SectionHead, StatTile, s } from './ui';
import { C, mode, niceDate } from './theme';
import { useGroundPhoto } from './photo';

const hhmm = (ms: number): string => new Date(ms + 330 * 60000).toISOString().slice(11, 16);
const greeting = (): string => { const h = new Date(Date.now() + 330 * 60000).getUTCHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
export type HomeGo = 'bookings' | 'payments' | 'block' | 'tasks' | 'accounts' | 'matches' | 'team' | 'ask' | 'profile';

/** The team's first screen: a greeting on the ground's photo, today's figures, quick actions and what is booked next. Each part shows only what this login may use. */
export function HomeScreen({ user, aiName, go }: { user: User; aiName: string; go: (to: HomeGo) => void }) {
  const perm = (p: string) => user.role !== 'staff' || (user.permissions ?? []).includes(p);
  const bookingsOk = perm('manage_bookings') || perm('verify_payments') || perm('record_payments');
  const boss = user.role === 'owner' || user.role === 'super_admin';
  const pic = useGroundPhoto();
  const [today, setToday] = useState<{ bookings: StaffBooking[]; awaitingVerification: number } | null>(null);
  const [tasks, setTasks] = useState<number | null>(null); const [live, setLive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    await Promise.all([
      bookingsOk ? api<{ bookings: StaffBooking[]; awaitingVerification: number }>('/api/staff/today').then(setToday).catch(() => setToday({ bookings: [], awaitingVerification: 0 })) : null,
      api<{ items: Task[] }>('/api/tasks?status=open').then((r) => setTasks(r.items.length)).catch(() => setTasks(null)),
      perm('manage_matches') ? api<{ items: MatchRow[] }>('/api/staff/matches').then((r) => setLive(r.items.filter((m) => m.status === 'live').length)).catch(() => setLive(null)) : null,
    ]);
    setBusy(false);
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const first = user.name.trim().split(/\s+/)[0] || user.name;
  const upcoming = (today?.bookings ?? []).filter((b) => b.endAt > Date.now()).slice(0, 5);
  const actions: [IconName, string, HomeGo][] = [
    ...(bookingsOk ? [['calendar-outline', 'Bookings', 'bookings'] as [IconName, string, HomeGo]] : []),
    ...(perm('verify_payments') ? [['card-outline', 'Payments', 'payments'] as [IconName, string, HomeGo]] : []),
    ['checkbox-outline', 'Tasks', 'tasks'],
    ...(perm('manage_matches') ? [['trophy-outline', 'Matches', 'matches'] as [IconName, string, HomeGo]] : []),
    ...(perm('manage_accounting') || perm('view_reports') ? [['wallet-outline', 'Books', 'accounts'] as [IconName, string, HomeGo]] : []),
    ...(boss ? [['people-outline', 'Team', 'team'] as [IconName, string, HomeGo]] : []),
    ...(perm('manage_bookings') ? [['albums-outline', 'Multi-day', 'block'] as [IconName, string, HomeGo]] : []),
    ['sparkles-outline', aiName.length > 10 ? `${aiName.slice(0, 9)}…` : aiName, 'ask'],
  ];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <View style={[s.row, { marginBottom: 12 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <Image source={mode === 'light' ? require('../assets/logo-green.png') : require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 112, height: 38 }} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => go('profile')}><Avatar name={user.name} url={user.avatarUrl} size={40} /></Pressable>
      </View>

      <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: '#123D24', minHeight: 150, justifyContent: 'flex-end', padding: 18, marginBottom: 14 }}>
        {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: pic ? 'rgba(6,22,13,.5)' : 'transparent' }]} />
        <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: -0.4 }}>{greeting()}, {first}</Text>
        <Text style={{ color: 'rgba(255,255,255,.88)', fontSize: 14, marginTop: 2 }}>{user.businessName || 'Daji Cricket Ground'} · {niceDate(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10))}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
        {bookingsOk && <StatTile icon="calendar-outline" value={today ? String(today.bookings.length) : '–'} label="Bookings today" onPress={() => go('bookings')} />}
        {bookingsOk && <StatTile icon="card-outline" value={today ? String(today.awaitingVerification) : '–'} label="Payments to check" tone={today?.awaitingVerification ? 'warn' : undefined} onPress={() => go('payments')} />}
        {live != null && live > 0 ? <StatTile icon="radio-outline" value={String(live)} label="Live now" tone="danger" onPress={() => go('matches')} />
          : <StatTile icon="checkbox-outline" value={tasks == null ? '–' : String(tasks)} label="Open tasks" onPress={() => go('tasks')} />}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {actions.slice(0, 8).map(([icon, label, to]) => <ActionTile key={to} icon={icon} label={label} onPress={() => go(to)} />)}
      </View>

      {bookingsOk && (<>
        <SectionHead title="Coming up today" action="See all" onAction={() => go('bookings')} />
        {today === null ? null : !upcoming.length ? <Text style={[s.muted, { marginBottom: 12 }]}>Nothing more booked today.</Text> : upcoming.map((b) => (
          <Pressable key={b.id} accessibilityRole="button" onPress={() => go('bookings')} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10 }]}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Icon name="time-outline" size={20} color={C.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: '700' }]} numberOfLines={1}>{b.customerName}</Text>
              <Text style={s.muted} numberOfLines={1}>{b.groundName}{b.formatLabel ? ` · ${b.formatLabel}` : ''}</Text>
              <Text style={[s.muted, { fontSize: 12 }]}>{hhmm(b.startAt)} – {hhmm(b.endAt)}</Text>
            </View>
            <Badge tone={b.approval === 'pending' ? 'gold' : b.balancePaise > 0 ? 'warn' : 'ok'} label={b.approval === 'pending' ? 'Approve' : b.balancePaise > 0 ? 'Balance due' : 'Confirmed'} />
          </Pressable>
        ))}
      </>)}
    </ScrollView>
  );
}
