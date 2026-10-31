import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import type { Booking, MatchRow, User } from './types';
import { Avatar, Badge, Btn, Icon, type IconName, SectionHead, s } from './ui';
import { C, inr, niceDate, tint } from './theme';
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
  const tiles: [IconName, string, CustomerGo][] = [['calendar-outline', t('home.bookGround'), 'book'], ['baseball-outline', t('home.bookNets'), 'book'], ['school-outline', t('home.academy'), 'academy']];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 0 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.onBg} />}>
      <View style={{ marginHorizontal: -18, paddingHorizontal: 18, paddingTop: 58, paddingBottom: 18, marginBottom: 14, overflow: 'hidden' }}>
        {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} />}
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <Image source={require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 104, height: 36 }} />
          {user && <Pressable accessibilityRole="button" accessibilityLabel={t('home.yourProfile')} onPress={() => go('profile')}><Avatar name={user.name} url={user.avatarUrl} size={42} /></Pressable>}
        </View>
        <Text style={{ color: C.head, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginTop: 14 }}>{greeting(t)}{first ? ',' : ''}</Text>
        {!!first && <Text style={{ color: C.head, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 }}>{first}</Text>}
        <Text style={[s.note, { fontSize: 15, marginTop: 2 }]}>{t('home.ready')}</Text>
        <Pressable accessibilityRole="search" onPress={() => go('book')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginTop: 16 }}>
          <Icon name="search-outline" size={18} color={C.muted} />
          <Text style={{ color: C.muted, fontSize: 15 }}>{t('home.search')}</Text>
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
          <Text style={{ color: C.head, fontSize: 15, fontWeight: '700' }}>{t('home.liveScores')}</Text>
          <Text style={s.note} numberOfLines={1}>{live ? `${live.teamA} v ${live.teamB}${live.summary ? ` · ${live.summary}` : ''}` : t('home.liveNone')}</Text>
        </View>
        {live ? <Badge tone="danger" label={t('home.liveBadge')} /> : <Icon name="chevron-forward" size={18} color={C.headMuted} />}
      </Pressable>
      {hosted && <Pressable accessibilityRole="button" onPress={() => go('auctions')} style={[tileStyle(), { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, paddingVertical: 16 }]}>
        <Icon name="trophy-outline" size={26} color={C.onBg} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.head, fontSize: 15, fontWeight: '700' }}>{t('home.tournaments')}</Text>
          <Text style={s.note} numberOfLines={1}>{t('home.tournamentsSub')}</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={C.headMuted} />
      </Pressable>}
      {user && <Pressable accessibilityRole="button" onPress={() => go('fantasy')} style={[tileStyle(), { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, paddingVertical: 16 }]}>
        <Icon name="podium-outline" size={26} color={C.onBg} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.head, fontSize: 15, fontWeight: '700' }}>{t('home.fantasy')}</Text>
          <Text style={s.note} numberOfLines={1}>{t('home.fantasySub')}</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={C.headMuted} />
      </Pressable>}

      {user && (<>
        <SectionHead title={t('home.today')} action={upcoming ? t('home.allBookings') : undefined} onAction={() => go('me')} />
        <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Icon name="calendar-outline" size={20} color={C.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: '700' }]}>{t(upcoming === 1 ? 'home.countOne' : 'home.countMany', { n: upcoming })}</Text>
              <Text style={s.muted}>{t('home.upcoming')}</Text>
            </View>
            {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={{ width: 92, height: 52, borderRadius: 10 }} />}
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: C.line, padding: 14 }}>
            {next === undefined ? <Text style={s.muted}>{t('common.loading')}</Text> : next ? (<>
              <Text style={s.muted}>{t('home.next')}</Text>
              <Text style={[s.text, { fontWeight: '800', fontSize: 17, marginTop: 2 }]}>{next.groundName}</Text>
              <Text style={s.muted}>{niceDate(next.date)} · {hhmm(next.startAt)} – {hhmm(next.endAt)}{next.balancePaise > 0 ? ` · ${t('home.atGround', { amount: inr(next.balancePaise) })}` : ''}</Text>
              <View style={[s.row, { marginTop: 8 }]}>
                <Badge tone={next.status === 'confirmed' ? 'ok' : 'warn'} label={next.status === 'confirmed' ? t('status.confirmed') : t('status.waitingPayment')} />
                <Btn label={t('home.viewDetails')} onPress={() => go('me')} style={{ marginBottom: 0, paddingVertical: 9, backgroundColor: C.gold, borderColor: C.gold }} />
              </View>
            </>) : (<>
              <Text style={s.muted}>{t('home.nothing')}</Text>
              <Btn label={t('home.bookSlot')} onPress={() => go('book')} style={{ marginTop: 10, marginBottom: 0 }} />
            </>)}
          </View>
        </View>
      </>)}
      {!user && (<View accessibilityRole="radiogroup" accessibilityLabel={t('common.language')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        {UI_LANGUAGES.map((l) => (
          <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} onPress={() => setLang(l)}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: lang === l ? C.gold : tint(C.gold, 0.28), backgroundColor: lang === l ? tint(C.gold, 0.16) : 'transparent' }}>
            <Text style={{ color: C.head, fontSize: 15, fontWeight: lang === l ? '800' : '600' }}>{UI_LANGUAGE_NAMES[l]}</Text>
          </Pressable>
        ))}
      </View>)}
      {!!user && <Pressable accessibilityRole="button" onPress={() => go('ask')} style={[tileStyle(), { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 0 }]}>
        <Icon name="sparkles-outline" size={22} color={C.onBg} />
        <View style={{ flex: 1 }}><Text style={{ color: C.head, fontSize: 15, fontWeight: '700' }}>{aiName}</Text><Text style={s.note}>{t('home.askSub')}</Text></View>
        <Icon name="chevron-forward" size={18} color={C.headMuted} />
      </Pressable>}
    </ScrollView>
  );
}
const tileStyle = () => ({ flex: 1, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 14 });
