import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import type { AppConfig, Availability, Ball, Ground, HoldQuote, HoldResponse, RateOption, RepeatFrequency, Slot } from './types';
import { Btn, Chip, Field, GuppiMark, Icon, type IconName, KV, Loading, MonthBar, RoundBtn, Segmented, Steps, s } from './ui';
import { useGroundPhoto } from './photo';
import { C, inr } from './theme';
import { GuppiBookScreen } from './GuppiBookScreen';
import { useT } from './lang';

const istToday = (): string => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (d: string, n: number): string => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const balls_ = (t: ReturnType<typeof useT>): Record<Ball, string> => ({ leather: t('book.ball.leather'), tennis: t('book.ball.tennis'), practice: t('book.ball.practice') });
const repeatNames = (t: ReturnType<typeof useT>): Record<RepeatFrequency, string> => ({ daily: t('book.repeat.daily'), weekly: t('book.repeat.weekly'), monthly: t('book.repeat.monthly'), yearly: t('book.repeat.yearly') });
const REPEATS: Record<RepeatFrequency, { word: string; def: number; max: number }> = { daily: { word: 'every day', def: 5, max: 60 }, weekly: { word: 'every week', def: 4, max: 52 }, monthly: { word: 'every month', def: 3, max: 12 }, yearly: { word: 'every year', def: 2, max: 3 } };
const hm = (ms: number): string => new Date(ms + 330 * 60000).toISOString().slice(11, 16);

/** The opening card: the ground's own photo (uploaded in the desk) under a dark wash, the same ink card as the home screens. */
function Hero() {
  const pic = useGroundPhoto(); const t = useT();
  return (
    <View style={{ borderRadius: 32, overflow: 'hidden', backgroundColor: C.ink, padding: 22, paddingTop: 26, marginBottom: 8 }}>
      {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
      {!!pic && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,12,11,.68)' }]} />}
      <Text style={{ color: 'rgba(255,255,255,.7)', fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Daji Cricket Ground · Surat</Text>
      <Text style={{ color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '700', letterSpacing: -0.8 }}>Play. Practice.{'\n'}<Text style={{ color: C.gold }}>Grow.</Text></Text>
      <Text style={{ color: 'rgba(255,255,255,.8)', fontSize: 13.5, lineHeight: 19, marginTop: 8 }}>{t('book.hero')}</Text>
    </View>
  );
}
/** One time or session to pick: its time and price on the left and whether it is free on the right; the chosen one is outlined in gold. */
function SlotTile({ title, line, price, on, disabled, wide, onPress }: { title: string; line?: string; price: string; on: boolean; disabled: boolean; wide?: boolean; onPress: () => void }) {
  const t = useT();
  const pill = on ? null : disabled ? [t('book.unavailable'), C.danger] : [t('book.available'), C.ok];
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ flexBasis: wide ? '100%' : '47%', flexGrow: 1, borderRadius: 22, backgroundColor: on ? C.strong : C.panel, padding: 14, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: on ? C.onStrong : C.text, fontSize: wide ? 16 : 18, fontWeight: '700', letterSpacing: -0.3, flexShrink: 1 }} numberOfLines={1}>{title}</Text>
        {on ? <Icon name="checkmark-circle" size={20} color={C.gold} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pill![1] }} accessibilityLabel={pill![0]} />}
      </View>
      {!!line && <Text style={{ color: on ? C.onStrong : C.muted, opacity: on ? 0.75 : 1, fontSize: 13, marginTop: 2 }}>{line}</Text>}
      <Text style={{ color: on ? C.onStrong : disabled ? C.muted : C.text, fontSize: 13, fontWeight: '600', marginTop: 6, textTransform: 'capitalize' }}>{price}</Text>
    </Pressable>
  );
}
/** The next open days as a row of pills (day name over the date), with the full month a tap away. */
function DayStrip({ open, value, onPick }: { open: string[]; value: string; onPick: (d: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginBottom: 8 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
      {open.slice(0, 21).map((d) => {
        const on = d === value; const dow = new Date(d + 'T00:00:00Z').getUTCDay();
        return (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={d} onPress={() => onPick(d)}
            style={({ pressed }) => ({ width: 58, height: 76, borderRadius: 22, backgroundColor: on ? C.strong : C.panel, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <Text style={{ color: on ? C.onStrong : C.muted, fontSize: 12, fontWeight: '600', opacity: on ? 0.75 : 1 }}>{DOW[dow]}</Text>
            <Text style={{ color: on ? C.onStrong : C.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.4, marginTop: 2 }}>{Number(d.slice(8))}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
const Label = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 }}>
    <Text style={{ color: C.head, fontSize: 20, fontWeight: '600', letterSpacing: -0.3 }}>{children}</Text>{right}
  </View>
);

const AMENITY_ICON: [RegExp, IconName][] = [[/flood|light/i, 'bulb-outline'], [/turf|wicket|pitch/i, 'grid-outline'], [/pavilion|seat|stand/i, 'home-outline'], [/park/i, 'car-outline'], [/wash|toilet|change/i, 'water-outline'], [/net/i, 'baseball-outline']];
/** A ground as a photo card: its picture, name and place, a few amenities, and a pill when it is the one chosen. */
function GroundCard({ g, on, onPress }: { g: Ground; on: boolean; onPress: () => void }) {
  const pic = useGroundPhoto(); const t = useT();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={({ pressed }) => ({ borderRadius: 28, overflow: 'hidden', backgroundColor: C.panel, borderWidth: 2, borderColor: on ? C.strong : 'transparent', marginBottom: 12, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <View style={{ height: 140, backgroundColor: C.ink }}>
        {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
        <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: on ? C.strong : 'rgba(255,255,255,0.92)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
          <Text style={{ color: on ? C.onStrong : '#1E8A4C', fontSize: 11, fontWeight: '800' }}>{on ? t('book.selected') : t('book.available')}</Text>
        </View>
      </View>
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>{g.name}</Text>
            {!!g.city && <Text style={s.muted}>{g.city}</Text>}
          </View>
          <Icon name={on ? 'checkmark-circle' : 'chevron-forward-circle-outline'} size={26} color={on ? C.goldDark : C.muted} />
        </View>
        {!!g.amenities?.length && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
            {g.amenities.slice(0, 3).map((a) => <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name={AMENITY_ICON.find(([re]) => re.test(a))?.[1] ?? 'checkmark-outline'} size={14} color={C.muted} /><Text style={[s.muted, { fontSize: 12 }]}>{a}</Text></View>)}
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** A month at a time. Only the days in `open` can be picked. */
function DayPicker({ open, value, onPick }: { open: string[]; value: string; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(value.slice(0, 7));
  useEffect(() => { setMonth(value.slice(0, 7)); }, [value]);
  const ok = new Set(open);
  const firstDow = new Date(month + '-01T00:00:00Z').getUTCDay();
  const inMonth = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: inMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  return (
    <View style={[s.card, { paddingVertical: 6, paddingHorizontal: 8 }]}>
      <MonthBar month={month} onChange={setMonth} max={open[open.length - 1]?.slice(0, 7)} />
      <View style={{ flexDirection: 'row' }}>{DOW.map((d) => <Text key={d} style={[s.muted, { width: '14.28%', textAlign: 'center', fontSize: 11 }]}>{d[0]}</Text>)}</View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => {
          if (!d) return <View key={'x' + i} style={{ width: '14.28%', height: 42 }} />;
          const on = d === value, can = ok.has(d);
          return (
            <Pressable key={d} disabled={!can} onPress={() => onPick(d)} accessibilityRole="button" accessibilityLabel={d} style={{ width: '14.28%', height: 42, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.strong : 'transparent' }}>
                <Text style={{ color: on ? C.onStrong : can ? C.text : C.line, fontWeight: on ? '700' : '400' }}>{Number(d.slice(8))}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function BookScreen({ onHold, onNeedSignIn }: { onHold: (h: HoldResponse) => void; onNeedSignIn?: () => void }) {
  const t = useT(); const BALLS = balls_(t); const REPEAT_NAME = repeatNames(t);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [gid, setGid] = useState(''); const [date, setDate] = useState(istToday()); const [cal, setCal] = useState(false);
  const [av, setAv] = useState<Availability | null>(null);
  const [ball, setBall] = useState<Ball | null>(null);
  const [win, setWin] = useState<string | null>(null);                       // a fixed session: its rule id
  const [hr, setHr] = useState<{ ruleId: string; idx: number[] } | null>(null); // some hours of an hourly price
  const [pick, setPick] = useState<number[]>([]);                            // grounds without a price list: start times of the slots
  const [credit, setCredit] = useState(0); const [useCredit, setUseCredit] = useState(false);
  const [promo, setPromo] = useState('');
  const [rep, setRep] = useState<{ f: RepeatFrequency; n: number } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [guppi, setGuppi] = useState(false); // the Guppi booking screen (any language), when the release switch is on
  const [sent, setSent] = useState('');
  const sendKey = useRef<{ what: string; id: string } | null>(null);
  // prices are given on enquiry (Settings): slots show no price, and the picked slot is sent to the ground, which replies with the price
  const enq = !!cfg?.pricesOnEnquiry;
  const price = (p: number) => (enq ? 'Available' : inr(p));

  const loadGrounds = useCallback(async () => {
    setErr('');
    try {
      const [c, g] = await Promise.all([api<AppConfig>('/api/config'), api<{ items: Ground[] }>('/api/grounds')]);
      setCfg(c); setDate(c.bookingsOpenFrom && c.bookingsOpenFrom > istToday() ? c.bookingsOpenFrom : istToday()); setGrounds(g.items); if (g.items[0]) setGid(g.items[0].id);
      try { const d = await api<{ creditPaise: number }>('/api/my/dashboard'); setCredit(d.creditPaise); } catch { /* credit is a convenience */ }
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { void loadGrounds(); }, [loadGrounds]);

  const ground = grounds.find((g) => g.id === gid);
  const hasRates = !!ground?.rates?.length;
  const maxSlots = ground?.maxSlots ?? 6;

  const loadSlots = useCallback(async () => {
    if (!gid) return;
    setAv(null); setPick([]); setWin(null); setHr(null); setErr('');
    // a failed load stays an error with a way to retry; it is never drawn as a day with no slots
    try { setAv(await api<Availability>(`/api/grounds/${gid}/availability?date=${date}`)); } catch (e: any) { setErr(e.message); setAv(null); }
  }, [gid, date]);
  useEffect(() => { void loadSlots(); }, [loadSlots]);

  const balls = (['leather', 'tennis', 'practice'] as Ball[]).filter((b) => ground?.rates?.some((r) => r.ball === b));
  useEffect(() => { if (hasRates && (!ball || !balls.includes(ball))) setBall(balls.length === 1 ? balls[0]! : null); }, [gid, hasRates]);

  // days inside the booking window, skipping days the ground has switched off for online booking and its weekly closed days
  const first = cfg?.bookingsOpenFrom && cfg.bookingsOpenFrom > istToday() ? cfg.bookingsOpenFrom : istToday();
  const shut = new Set(cfg?.closedDates?.ground ?? []);
  const weekly = new Set(ground?.closedDays ?? []);
  const days = Array.from({ length: Math.min(cfg?.maxDaysAhead ?? 30, 366) }, (_, i) => addDays(first, i))
    .filter((d) => !(cfg?.bookingsCloseFrom && d >= cfg.bookingsCloseFrom) && !shut.has(d) && !weekly.has(new Date(d + 'T00:00:00Z').getUTCDay()));
  // a day that cannot be booked (a weekly closed day, say) is never left chosen; the next open day is
  useEffect(() => { if (days.length && !days.includes(date)) setDate(days[0]!); }, [days.join(), date]); // eslint-disable-line react-hooks/exhaustive-deps

  // what the customer has chosen, in one shape for both kinds of ground
  let chosenText = '', body: Record<string, unknown> | null = null;
  const opts: RateOption[] = (av?.rates ?? []).filter((o) => o.ball === ball);
  if (hasRates) {
    if (win) {
      const o = opts.find((x) => x.ruleId === win && x.state === 'available');
      if (o) { chosenText = `${o.label} · ${o.time} – ${o.endTime}`; body = { ruleId: o.ruleId, startTime: o.time }; }
    } else if (hr) {
      const o = opts.find((x) => x.ruleId === hr.ruleId); const sl = hr.idx.map((i) => o?.slots?.[i]).filter(Boolean) as Slot[];
      if (o && sl.length && sl.every((x) => x.state === 'available')) { chosenText = `${sl.length} hour${sl.length > 1 ? 's' : ''} · ${sl[0]!.time} – ${hm(sl[sl.length - 1]!.end)}`; body = { ruleId: o.ruleId, startTime: sl[0]!.time, slots: sl.length }; }
    }
  } else {
    const chosen = (av?.slots ?? []).filter((x) => pick.includes(x.start));
    if (chosen.length) { chosenText = `${chosen.length} slot${chosen.length > 1 ? 's' : ''}`; body = { startTime: chosen[0]!.time, slots: chosen.length }; }
  }

  // what holding this costs now (price, promo, advance or full payment, credit), from the server; the app repeats none of those rules
  const [quote, setQuote] = useState<HoldQuote | null>(null); const [quoteErr, setQuoteErr] = useState('');
  const quoteKey = body ? JSON.stringify({ groundId: gid, date, ...body, useCredit: useCredit && credit > 0, promoCode: promo.trim() }) : '';
  useEffect(() => {
    setQuote(null); setQuoteErr('');
    if (!quoteKey || enq) return;
    let live = true;
    const t = setTimeout(() => {
      const q = JSON.parse(quoteKey) as Record<string, unknown>;
      if (!q.promoCode) delete q.promoCode; if (!q.useCredit) delete q.useCredit;
      api<{ quote: HoldQuote }>('/api/bookings/quote', { method: 'POST', body: q }).then((r) => { if (live) setQuote(r.quote); }).catch((e: any) => { if (live) setQuoteErr(e.message); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [quoteKey]);

  const isRun = (starts: number[]): boolean => !!av && starts.every((st, i) => i === 0 || av.slots.find((x) => x.start === starts[i - 1])?.end === st);
  const toggleSlot = (sl: Slot) => {
    if (sl.state !== 'available') return;
    setPick((cur) => {
      if (cur.includes(sl.start)) { const rest = cur.filter((x) => x !== sl.start); return isRun(rest) ? rest : []; }
      const next = [...cur, sl.start].sort((a, b) => a - b);
      return isRun(next) && next.length <= maxSlots ? next : [sl.start];
    });
  };
  const toggleHour = (o: RateOption, i: number) => {
    setWin(null);
    setHr((cur) => {
      const idx = cur && cur.ruleId === o.ruleId ? cur.idx : [];
      const free = (k: number) => o.slots?.[k]?.state === 'available';
      let next: number[];
      if (!idx.length) next = [i];
      else {
        const lo = idx[0]!, hi = idx[idx.length - 1]!;
        if (idx.includes(i)) next = i === lo || i === hi ? idx.filter((x) => x !== i) : [i];
        else if (i === hi + 1 && free(i) && idx.length < maxSlots) next = [...idx, i];
        else if (i === lo - 1 && free(i) && idx.length < maxSlots) next = [i, ...idx];
        else next = [i];
      }
      return next.length ? { ruleId: o.ruleId, idx: next } : null;
    });
  };

  // the slot as a pricing enquiry: the day, the start, how many of the ground's slots and the session's name
  const enquire = async () => {
    if (!body) return;
    if (onNeedSignIn) { onNeedSignIn(); return; }
    // one key per slot asked about: pressing again after a lost answer files the enquiry once
    const what = `${gid}|${date}|${JSON.stringify(body)}`;
    if (!sendKey.current || sendKey.current.what !== what) sendKey.current = { what, id: `enq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
    const o = hasRates ? opts.find((x) => x.ruleId === (win ?? hr?.ruleId)) : undefined;
    const mins = (a: string, b: string) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); const d = (h2! * 60 + m2!) - (h1! * 60 + m1!); return d > 0 ? d : d + 1440; };
    const slots = typeof body.slots === 'number' ? body.slots : o ? Math.max(1, Math.round(mins(o.time, o.endTime) / (ground?.slotMinutes || 60))) : 1;
    setErr(''); setBusy(true);
    try {
      await api('/api/enquiries', { method: 'POST', body: { groundId: gid, preferredDate: date, preferredTime: String(body.startTime), preferredSlots: slots, ...(o ? { preferredLabel: o.label } : {}), message: `Please send me the price for ${chosenText} on ${date}.` }, headers: { 'Idempotency-Key': sendKey.current.id } });
      sendKey.current = null;
      setSent(`Sent. ${ground?.name ?? 'The ground'} has your slot (${chosenText}) and will reply with the price.`);
      setPick([]); setWin(null); setHr(null); void loadSlots();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const hold = async () => {
    if (!body) return;
    if (enq) { await enquire(); return; }
    setErr(''); setBusy(true);
    try {
      onHold(await api<HoldResponse>('/api/bookings', { method: 'POST', body: { groundId: gid, date, ...body, useCredit: useCredit && credit > 0, ...(promo.trim() ? { promoCode: promo.trim() } : {}), ...(rep ? { repeat: { frequency: rep.f, count: rep.n } } : {}) } }));
    } catch (e: any) { if (e.status === 401 && onNeedSignIn) { onNeedSignIn(); return; } setErr(e.message); void loadSlots(); } finally { setBusy(false); }
  };

  if (!cfg) return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]}>
      <Hero />
      {err ? (<><Text style={s.err}>{err}</Text><Btn label={t('common.tryAgain')} onPress={() => void loadGrounds()} style={{ marginTop: 16 }} /></>) : (<><Loading /><Text style={[s.note, { textAlign: 'center' }]}>{t('book.loadingSlots')}</Text></>)}
    </ScrollView>
  );
  if (guppi && cfg.guppiBookingEnabled) return <View style={s.screen}><GuppiBookScreen onHold={onHold} onBack={() => setGuppi(false)} signedIn={!onNeedSignIn} onNeedSignIn={onNeedSignIn} /></View>;
  const fixed = opts.filter((o) => o.mode === 'fixed'), hourly = opts.filter((o) => o.mode === 'hourly');
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]}>
      <Hero />
      <Steps at={body ? 2 : 1} />
      {!!cfg.guppiBookingEnabled && (
        <Pressable accessibilityRole="button" onPress={() => setGuppi(true)} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 4 }]}>
          <GuppiMark />
          <View style={{ flex: 1 }}><Text style={[s.text, { fontWeight: '700' }]}>Book with DCG</Text><Text style={s.muted}>{t('book.withAssistant')}</Text></View>
          <Icon name="chevron-forward" size={18} color={C.muted} />
        </Pressable>
      )}
      <Label>{t('book.chooseGround')}</Label>
      {grounds.map((g) => <GroundCard key={g.id} g={g} on={g.id === gid} onPress={() => setGid(g.id)} />)}
      <Label right={<RoundBtn icon={cal ? 'close' : 'calendar-outline'} label={cal ? 'Hide the month' : 'Show the whole month'} onPress={() => setCal(!cal)} size={40} />}>{t('book.day')}</Label>
      {cal ? <DayPicker open={days} value={date} onPick={(d) => { setDate(d); setCal(false); }} /> : <DayStrip open={days} value={date} onPick={setDate} />}
      {weekly.size > 0 && <Text style={[s.note, { marginTop: -6, marginBottom: 6 }]}>{ground?.name ?? 'The ground'} is closed on {[...weekly].sort().map((n) => DOW_LONG[n]).join(' and ')}.</Text>}

      {av === null ? (err ? <Btn kind="outline" label={t('common.tryAgain')} onPress={() => void loadSlots()} /> : <Loading />) : av.closed ? <Text style={s.note}>{t('book.closedDay')}</Text> : hasRates ? (<>
        <Label>{t('book.playWith')}</Label>
        <Segmented items={balls.map((b) => [b, BALLS[b]] as [Ball, string])} value={ball as Ball} onChange={(b) => { setBall(b); setWin(null); setHr(null); }} />
        {!ball ? <Text style={s.note}>{t('book.chooseBall')}</Text> : !opts.length ? <Text style={s.note}>{t('book.nothingForBall')}</Text> : (<>
          {fixed.length > 0 && <Label>{t('book.sessions')}</Label>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {fixed.map((o) => <SlotTile key={o.ruleId} wide title={o.label} line={`${o.time} – ${o.endTime}`} price={o.state === 'available' ? `${price(o.pricePaise)}${o.proRated ? ' · part session' : ''}` : o.state} on={win === o.ruleId} disabled={o.state !== 'available'} onPress={() => { setWin(o.ruleId); setHr(null); }} />)}
          </View>
          {hourly.map((o) => (
            <View key={o.ruleId}>
              <Text style={[s.note, { marginVertical: 6 }]}>{o.label}{enq ? '' : ` · ${inr(o.pricePaise)} per hour`} · up to {maxSlots} hours in a row</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {(o.slots ?? []).map((sl, i) => <SlotTile key={sl.start} title={sl.time} price={sl.state === 'available' ? price(sl.pricePaise) : sl.state} on={!!hr && hr.ruleId === o.ruleId && hr.idx.includes(i)} disabled={sl.state !== 'available'} onPress={() => toggleHour(o, i)} />)}
              </View>
            </View>
          ))}
        </>)}
        {!!ground?.ratesNote && <Text style={[s.note, { marginTop: 10 }]}>{ground.ratesNote}</Text>}
      </>) : (<>
        <Label>{t('book.time')}</Label>
        <Text style={[s.note, { marginBottom: 10 }]}>{t('book.upTo', { n: maxSlots })}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {av.slots.map((sl) => <SlotTile key={sl.start} title={sl.time} price={sl.state === 'available' ? price(sl.pricePaise) : sl.state} on={pick.includes(sl.start)} disabled={sl.state !== 'available'} onPress={() => toggleSlot(sl)} />)}
          {!av.slots.length && <Text style={s.note}>{t('book.noSlots')}</Text>}
        </View>
      </>)}

      {!!body && !enq && (<>
        <Label>{t('book.repeat')}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label={t('book.noRepeat')} on={!rep} onPress={() => setRep(null)} />
          {(Object.keys(REPEATS) as RepeatFrequency[]).map((f) => <Chip key={f} label={REPEAT_NAME[f]} on={rep?.f === f} onPress={() => setRep({ f, n: REPEATS[f].def })} />)}
        </View>
        {rep && (<>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Chip label="−" onPress={() => setRep({ ...rep, n: Math.max(2, rep.n - 1) })} />
            <Text style={[s.text, { color: C.head, marginRight: 8, marginBottom: 8 }]}>{t('book.timesInAll', { n: rep.n })}</Text>
            <Chip label="+" onPress={() => setRep({ ...rep, n: Math.min(REPEATS[rep.f].max, rep.n + 1) })} />
          </View>
          <Text style={s.note}>Repeats {REPEATS[rep.f].word}. You pay for the first date now; the other {rep.n - 1} are reserved for you and their balance is paid at the ground{cfg?.autoDebitEnabled ? ' (or by auto-debit)' : ''}. Closed or taken dates are left out.</Text>
        </>)}
      </>)}
      {!enq && <View style={{ marginTop: 14 }}><Field label={t('book.promo')} value={promo} onChangeText={setPromo} autoCapitalize="characters" placeholder={t('book.promoHint')} /></View>}
      {credit > 0 && !enq && <Chip label={`${useCredit ? '✓ ' : ''}${t('book.useCredit', { amount: inr(credit) })}`} on={useCredit} onPress={() => setUseCredit(!useCredit)} />}
      {!!err && <Text style={s.err}>{err}</Text>}
      {!!sent && <Text style={[s.note, { marginTop: 10 }]}>{sent}</Text>}
      {!!body && enq && <View style={s.card}><KV k={chosenText} v="On enquiry" /><Text style={s.note}>Prices are given on enquiry. Send this slot to the ground and they will reply with the price. Nothing is charged now.</Text></View>}
      {!!body && !enq && (
        <View style={s.card}>
          {quote ? (<>
            <KV k={t('book.price')} v={inr(quote.fullPricePaise)} />
            {quote.discountPaise > 0 && <KV k={`Promo ${quote.promoCode}`} v={`− ${inr(quote.discountPaise)}`} />}
            <KV k={quote.payNow === 'full' ? t('book.fullPayment', { hours: quote.fullPaymentWithinHours }) : quote.advancePercent != null ? t('book.advancePct', { pct: quote.advancePercent }) : t('book.advance')} v={inr(quote.payNowPaise)} />
            {quote.creditUsedPaise > 0 && <KV k={t('book.creditUsed')} v={`− ${inr(quote.creditUsedPaise)}`} />}
            <KV k={t('book.dueNow')} v={inr(quote.dueNowPaise)} bold />
          </>) : quoteErr ? <Text style={s.err}>We could not work out the price just now: {quoteErr}</Text> : <Text style={s.muted}>{t('book.working')}</Text>}
        </View>
      )}
      <Btn label={body ? (enq ? 'Send enquiry for this slot' : `${t('book.hold')} · ${chosenText}${quote ? ` · ${inr(quote.fullPricePaise)}` : ''}`) : hasRates ? t('book.chooseBallSession') : t('book.chooseSlots')} onPress={hold} disabled={!body} busy={busy} style={{ marginTop: 16 }} />
      {!!cfg && <Text style={[s.note, { textAlign: 'center' }]}>{t('book.freeCancel', { hours: cfg.freeCancelHours })}</Text>}
    </ScrollView>
  );
}
