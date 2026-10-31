import React, { useCallback, useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { api } from './api';
import type { StaffBooking, Task, User, MatchRow } from './types';
import { ActionGrid, ActionTile, Avatar, Badge, Glow, Icon, type IconName, SectionHead, s } from './ui';
import { C, HUES, niceDate } from './theme';
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
  const today_ = niceDate(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
  const mini = (icon: IconName, value: string, label: string, to: HomeGo, hot?: boolean) => (
    <Pressable key={label} accessibilityRole="button" onPress={() => go(to)} style={({ pressed }) => ({ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 12, opacity: pressed ? 0.75 : 1 })}>
      <Icon name={icon} size={16} color={hot ? '#F2B544' : 'rgba(255,255,255,0.7)'} />
      <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.6, marginTop: 6 }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.62)', fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <View style={[s.row, { marginBottom: 18 }]}>
        <Image source={require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 104, height: 36 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => go('profile')}><Avatar name={user.name} url={user.avatarUrl} size={42} /></Pressable>
      </View>
      <Text style={[s.muted, { fontSize: 14, fontWeight: '600' }]}>{greeting()}</Text>
      <Text style={[s.h1, { marginBottom: 18 }]}>{first}</Text>

      <View style={{ borderRadius: 30, overflow: 'hidden', backgroundColor: C.ink, padding: 20, marginBottom: 22, shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 }}>
        {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
        {!!pic && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,12,11,.72)' }]} />}
        <Glow color="#D9A94A" size={260} top={-120} right={-90} opacity={0.5} />
        <Glow color="#4C9BF5" size={200} bottom={-120} left={-70} opacity={0.3} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>Today · {today_}</Text>
          {live != null && live > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(240,121,110,0.22)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#F0796E' }} /><Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{live} live</Text></View>}
        </View>
        {bookingsOk ? (<Pressable accessibilityRole="button" onPress={() => go('bookings')}>
          <Text style={{ color: '#FFFFFF', fontSize: 64, fontWeight: '800', letterSpacing: -3, marginTop: 6 }}>{today ? String(today.bookings.length) : '–'}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600', marginTop: -6 }}>{today?.bookings.length === 1 ? 'booking' : 'bookings'} at {user.businessName || 'Daji Cricket Ground'}</Text>
        </Pressable>) : <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 10 }}>{user.businessName || 'Daji Cricket Ground'}</Text>}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          {bookingsOk && mini('card', today ? String(today.awaitingVerification) : '–', 'Payments to check', 'payments', !!today?.awaitingVerification)}
          {mini('checkbox', tasks == null ? '–' : String(tasks), 'Open tasks', 'tasks')}
        </View>
      </View>

      <ActionGrid>
        {actions.slice(0, 8).map(([icon, label, to], i) => <ActionTile key={to} hue={i} icon={icon} label={label} onPress={() => go(to)} />)}
      </ActionGrid>

      {bookingsOk && (<>
        <SectionHead title="Coming up" action="See all" onAction={() => go('bookings')} />
        {today === null ? null : !upcoming.length ? <View style={s.card}><Text style={s.muted}>Nothing more booked today.</Text></View> : (
          <View style={[s.card, { paddingVertical: 6 }]}>
            {upcoming.map((b, i) => (
              <Pressable key={b.id} accessibilityRole="button" onPress={() => go('bookings')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: i === upcoming.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: C.line, opacity: pressed ? 0.7 : 1 })}>
                <View style={{ width: 54 }}>
                  <Text style={{ color: C.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.4 }}>{hhmm(b.startAt)}</Text>
                  <Text style={[s.muted, { fontSize: 12 }]}>{hhmm(b.endAt)}</Text>
                </View>
                <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: b.approval === 'pending' ? HUES[0] : b.balancePaise > 0 ? C.warn : C.ok }} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.text, { fontWeight: '700' }]} numberOfLines={1}>{b.customerName}</Text>
                  <Text style={[s.muted, { fontSize: 12.5 }]} numberOfLines={1}>{b.groundName}{b.formatLabel ? ` · ${b.formatLabel}` : ''}</Text>
                </View>
                <Badge tone={b.approval === 'pending' ? 'gold' : b.balancePaise > 0 ? 'warn' : 'ok'} label={b.approval === 'pending' ? 'Approve' : b.balancePaise > 0 ? 'Balance due' : 'Confirmed'} />
              </Pressable>
            ))}
          </View>
        )}
      </>)}
    </ScrollView>
  );
}
