import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import type { Booking, MatchRow, User } from './types';
import { ActionGrid, ActionTile, Avatar, Badge, Chip, Icon, type IconName, ListCard, ListRow, RoundBtn, SectionHead, s } from './ui';
import { C, inr, niceDate } from './theme';
import { useGroundPhoto } from './photo';
import { UI_LANGUAGES, UI_LANGUAGE_NAMES, useLang, type T } from './lang';

const hhmm = (ms: number): string => new Date(ms + 330 * 60000).toISOString().slice(11, 16);
const greeting = (t: T): string => { const h = new Date(Date.now() + 330 * 60000).getUTCHours(); return h < 12 ? t('home.morning') : h < 17 ? t('home.afternoon') : t('home.evening'); };
export type CustomerGo = 'book' | 'me' | 'academy' | 'live' | 'ask' | 'profile' | 'auctions' | 'fantasy';

/** The customer's first screen: a greeting, quick ways in (book, nets, academy, live score) and their next game at Daji. */
export function CustomerHome({ user, aiName, go }: { user: User | null; aiName: string; go: (to: CustomerGo) => void }) {
  const pic = useGroundPhoto();
  const { t, lang, setLang } = useLang();
  const [next, setNext] = useState<Booking | null | undefined>(undefined);
  const [upcoming, setUpcoming] = useState(0);
  const [live, setLive] = useState<(MatchRow & { summary?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [hosted, setHosted] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    await Promise.all([
      user ? api<{ auctionsEnabled?: boolean }>('/api/config').then((c) => setHosted(c.auctionsEnabled !== false)).catch(() => setHosted(false)) : null,
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
  const short = (x: string) => (x.length > 11 ? `${x.slice(0, 10)}…` : x);
  const actions: [IconName, string, CustomerGo][] = [
    ['calendar-outline', t('home.bookGround'), 'book'], ['baseball-outline', t('home.bookNets'), 'book'], ['school-outline', t('home.academy'), 'academy'],
    ['radio-outline', t('home.liveScores'), 'live'],
    ...(hosted ? [['trophy-outline', t('home.tournaments'), 'auctions'] as [IconName, string, CustomerGo]] : []),
    ...(user ? [['podium-outline', t('home.fantasy'), 'fantasy'] as [IconName, string, CustomerGo], ['sparkles-outline', short(aiName), 'ask'] as [IconName, string, CustomerGo]] : []),
  ];
  const W = 'rgba(255,255,255,';
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <View style={[s.row, { marginBottom: 18 }]}>
        <Image source={require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 104, height: 36 }} />
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <RoundBtn icon="search-outline" label={t('home.search')} onPress={() => go('book')} />
          {!!user && <RoundBtn icon="sparkles-outline" label={aiName} onPress={() => go('ask')} />}
          {!!user && <Pressable accessibilityRole="button" accessibilityLabel={t('home.yourProfile')} onPress={() => go('profile')}><Avatar name={user.name} url={user.avatarUrl} size={46} /></Pressable>}
        </View>
      </View>
      <Text style={[s.muted, { fontSize: 14, fontWeight: '600' }]}>{greeting(t)}</Text>
      <Text style={[s.h1, { marginBottom: 4 }]}>{first || 'Daji Cricket Ground'}</Text>
      <Text style={[s.muted, { fontSize: 14.5, marginBottom: 18 }]}>{t('home.ready')}</Text>

      <View style={{ borderRadius: 32, overflow: 'hidden', backgroundColor: C.ink, padding: 22, marginBottom: 22 }}>
        {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
        {!!pic && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,12,11,.72)' }]} />}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: `${W}0.7)`, fontSize: 14, fontWeight: '500' }}>{user ? t('home.next') : t('home.today')}</Text>
          {!!live && <Pressable accessibilityRole="button" onPress={() => go('live')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(240,121,110,0.22)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#F0796E' }} /><Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{t('home.liveBadge')}</Text></Pressable>}
        </View>
        {user && next ? (<Pressable accessibilityRole="button" onPress={() => go('me')}>
          <Text style={{ color: '#FFFFFF', fontSize: 44, fontWeight: '600', letterSpacing: -1.2, marginTop: 8 }}>{hhmm(next.startAt)}</Text>
          <Text style={{ color: `${W}0.85)`, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{next.groundName}</Text>
          <Text style={{ color: `${W}0.62)`, fontSize: 13.5, marginTop: 2 }} numberOfLines={1}>{niceDate(next.date)} · {hhmm(next.startAt)} – {hhmm(next.endAt)}{next.balancePaise > 0 ? ` · ${t('home.atGround', { amount: inr(next.balancePaise) })}` : ''}</Text>
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, backgroundColor: `${W}0.12)`, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: next.status === 'confirmed' ? C.ok : C.gold }} />
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>{next.status === 'confirmed' ? t('status.confirmed') : t('status.waitingPayment')}</Text>
          </View>
        </Pressable>) : (<View>
          <Text style={{ color: '#FFFFFF', fontSize: 19, fontWeight: '700', letterSpacing: -0.3, lineHeight: 25, marginTop: 10 }}>{user && next === undefined ? t('common.loading') : t('home.nothing')}</Text>
        </View>)}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          {user && <Pressable accessibilityRole="button" onPress={() => go('me')} style={({ pressed }) => ({ flex: 1, backgroundColor: `${W}0.1)`, borderRadius: 22, padding: 14, opacity: pressed ? 0.75 : 1 })}>
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', letterSpacing: -0.4 }} numberOfLines={1}>{t(upcoming === 1 ? 'home.countOne' : 'home.countMany', { n: upcoming })}</Text>
            <Text numberOfLines={1} style={{ color: `${W}0.62)`, fontSize: 12, fontWeight: '600' }}>{t('home.upcoming')}</Text>
          </Pressable>}
          <Pressable accessibilityRole="button" onPress={() => go(user && next ? 'me' : 'book')} style={({ pressed }) => ({ flex: 1, backgroundColor: C.gold, borderRadius: 22, padding: 14, justifyContent: 'space-between', opacity: pressed ? 0.85 : 1 })}>
            <Icon name={user && next ? 'arrow-forward' : 'calendar-outline'} size={18} color="#FFFFFF" />
            <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700', marginTop: 10 }}>{user && next ? t('home.viewDetails') : t('home.bookSlot')}</Text>
          </Pressable>
        </View>
      </View>

      <ActionGrid>
        {actions.slice(0, 8).map(([icon, label, to], i) => <ActionTile key={`${to}${i}`} icon={icon} label={label} onPress={() => go(to)} />)}
      </ActionGrid>

      <SectionHead title={t('home.liveScores')} action={user && upcoming ? t('home.allBookings') : undefined} onAction={() => go('me')} />
      <ListCard>
        <ListRow icon="radio-outline" title={live ? `${live.teamA} v ${live.teamB}` : t('home.liveScores')} sub={live ? live.summary || t('home.liveBadge') : t('home.liveNone')} onPress={() => go('live')} right={live ? <Badge tone="danger" label={t('home.liveBadge')} /> : undefined} last={!hosted && !user} />
        {hosted && <ListRow icon="trophy-outline" title={t('home.tournaments')} sub={t('home.tournamentsSub')} onPress={() => go('auctions')} last={!user} />}
        {!!user && <ListRow icon="podium-outline" title={t('home.fantasy')} sub={t('home.fantasySub')} onPress={() => go('fantasy')} />}
        {!!user && <ListRow icon="sparkles-outline" title={aiName} sub={t('home.askSub')} onPress={() => go('ask')} last />}
      </ListCard>

      {!user && (<View accessibilityRole="radiogroup" accessibilityLabel={t('common.language')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        {UI_LANGUAGES.map((l) => <Chip key={l} label={UI_LANGUAGE_NAMES[l]} on={lang === l} onPress={() => setLang(l)} />)}
      </View>)}
    </ScrollView>
  );
}
