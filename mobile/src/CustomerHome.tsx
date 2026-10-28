import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import type { Booking, MatchRow, User } from './types';
import { Avatar, Badge, Btn, Icon, type IconName, SectionHead, s } from './ui';
import { C, inr, niceDate } from './theme';
import { useGroundPhoto } from './photo';

const hhmm = (ms: number): string => new Date(ms + 330 * 60000).toISOString().slice(11, 16);
const greeting = (): string => { const h = new Date(Date.now() + 330 * 60000).getUTCHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
export type CustomerGo = 'book' | 'me' | 'academy' | 'live' | 'ask' | 'profile';

/** The customer's first screen: a greeting, quick ways in (book, nets, academy, live score) and their next game at Daji. */
export function CustomerHome({ user, aiName, go }: { user: User | null; aiName: string; go: (to: CustomerGo) => void }) {
  const pic = useGroundPhoto();
  const [next, setNext] = useState<Booking | null | undefined>(undefined);
  const [upcoming, setUpcoming] = useState(0);
  const [live, setLive] = useState<(MatchRow & { summary?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    await Promise.all([
      user ? api<{ items: Booking[] }>('/api/bookings?limit=50&group=1').then((r) => {
        const ahead = r.items.filter((b) => (b.status === 'confirmed' || b.status === 'held') && b.endAt > Date.now()).sort((a, b) => a.startAt - b.startAt);
        setUpcoming(ahead.length); setNext(ahead[0] ?? null);
      }).catch(() => setNext(null)) : null,
      api<{ items: (MatchRow & { summary?: string })[] }>('/api/matches').then((r) => setLive(r.items.find((m) => m.status === 'live') ?? null)).catch(() => setLive(null)),
    ]);
    setBusy(false);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const first = user ? user.name.trim().split(/\s+/)[0] || user.name : '';
  const tiles: [IconName, string, CustomerGo][] = [['calendar-outline', 'Book a Ground', 'book'], ['baseball-outline', 'Book Nets', 'book'], ['school-outline', 'Academy', 'academy']];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 0 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.onBg} />}>
      <View style={{ marginHorizontal: -18, paddingHorizontal: 18, paddingTop: 58, paddingBottom: 18, marginBottom: 14, overflow: 'hidden' }}>
        {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} />}
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <Image source={require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 104, height: 36 }} />
          {user && <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => go('profile')}><Avatar name={user.name} url={user.avatarUrl} size={42} /></Pressable>}
        </View>
        <Text style={{ color: C.head, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 14 }}>{greeting()}{first ? ',' : ''}</Text>
        {!!first && <Text style={{ color: C.head, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 }}>{first}</Text>}
        <Text style={[s.note, { fontSize: 15, marginTop: 2 }]}>Ready for some cricket?</Text>
        <Pressable accessibilityRole="search" onPress={() => go('book')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginTop: 16 }}>
          <Icon name="search-outline" size={18} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 15 }}>Find a ground, net or time…</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {tiles.map(([icon, label, to]) => (
          <Pressable key={label} accessibilityRole="button" onPress={() => go(to)} style={tileStyle()}>
            <Icon name={icon} size={26} color={C.onBg} />
            <Text style={{ color: C.head, fontSize: 13, fontWeight: '700', marginTop: 10 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={() => go('live')} style={[tileStyle(), { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, paddingVertical: 16 }]}>
        <Icon name="radio-outline" size={26} color={C.onBg} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.head, fontSize: 15, fontWeight: '700' }}>Live Scores</Text>
          <Text style={s.note} numberOfLines={1}>{live ? `${live.teamA} v ${live.teamB}${live.summary ? ` · ${live.summary}` : ''}` : 'Matches scored at the ground'}</Text>
        </View>
        {live ? <Badge tone="danger" label="LIVE" /> : <Icon name="chevron-forward" size={18} color={C.headMuted} />}
      </Pressable>

      {user && (<>
        <SectionHead title="Today at Daji" action={upcoming ? 'All bookings' : undefined} onAction={() => go('me')} />
        <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Icon name="calendar-outline" size={20} color={C.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: '700' }]}>{upcoming} booking{upcoming === 1 ? '' : 's'}</Text>
              <Text style={s.muted}>upcoming</Text>
            </View>
            {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={{ width: 92, height: 52, borderRadius: 10 }} />}
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: C.line, padding: 14 }}>
            {next === undefined ? <Text style={s.muted}>Loading…</Text> : next ? (<>
              <Text style={s.muted}>Your next booking</Text>
              <Text style={[s.text, { fontWeight: '800', fontSize: 17, marginTop: 2 }]}>{next.groundName}</Text>
              <Text style={s.muted}>{niceDate(next.date)} · {hhmm(next.startAt)} – {hhmm(next.endAt)}{next.balancePaise > 0 ? ` · ${inr(next.balancePaise)} at the ground` : ''}</Text>
              <View style={[s.row, { marginTop: 8 }]}>
                <Badge tone={next.status === 'confirmed' ? 'ok' : 'warn'} label={next.status === 'confirmed' ? 'Confirmed' : 'Waiting for payment'} />
                <Btn label="View details" onPress={() => go('me')} style={{ marginBottom: 0, paddingVertical: 9, backgroundColor: C.gold, borderColor: C.gold }} />
              </View>
            </>) : (<>
              <Text style={s.muted}>Nothing booked yet. Pick a free slot and the time is yours.</Text>
              <Btn label="Book a slot" onPress={() => go('book')} style={{ marginTop: 10, marginBottom: 0 }} />
            </>)}
          </View>
        </View>
      </>)}
      {!!user && <Pressable accessibilityRole="button" onPress={() => go('ask')} style={[tileStyle(), { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 0 }]}>
        <Icon name="sparkles-outline" size={22} color={C.onBg} />
        <View style={{ flex: 1 }}><Text style={{ color: C.head, fontSize: 15, fontWeight: '700' }}>{aiName}</Text><Text style={s.note}>Slots, prices or your bookings</Text></View>
        <Icon name="chevron-forward" size={18} color={C.headMuted} />
      </Pressable>}
    </ScrollView>
  );
}
const tileStyle = () => ({ flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(227,194,122,0.28)', borderWidth: 1, borderRadius: 16, padding: 14 });
