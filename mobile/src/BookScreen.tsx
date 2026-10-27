import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from './api';
import type { AppConfig, Availability, Ball, Ground, HoldResponse, RateOption, RepeatFrequency, Slot } from './types';
import { Btn, Chip, Field, Loading, MonthBar, s } from './ui';
import { C, inr, MON } from './theme';

const istToday = (): string => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (d: string, n: number): string => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BALLS: Record<Ball, string> = { leather: 'Leather ball', tennis: 'Tennis ball', practice: 'Practice nets' };
const REPEATS: Record<RepeatFrequency, { word: string; def: number; max: number }> = { daily: { word: 'every day', def: 5, max: 60 }, weekly: { word: 'every week', def: 4, max: 52 }, monthly: { word: 'every month', def: 3, max: 12 }, yearly: { word: 'every year', def: 2, max: 3 } };
const hm = (ms: number): string => new Date(ms + 330 * 60000).toISOString().slice(11, 16);

/** A month at a time. Only the days in `open` can be picked. */
function DayPicker({ open, value, onPick }: { open: string[]; value: string; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(value.slice(0, 7));
  useEffect(() => { setMonth(value.slice(0, 7)); }, [value]);
  const ok = new Set(open);
  const firstDow = new Date(month + '-01T00:00:00Z').getUTCDay();
  const inMonth = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: inMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  return (
    <View style={{ marginVertical: 8 }}>
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
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [gid, setGid] = useState(''); const [date, setDate] = useState(istToday());
  const [av, setAv] = useState<Availability | null>(null);
  const [ball, setBall] = useState<Ball | null>(null);
  const [win, setWin] = useState<string | null>(null);                       // a fixed session: its rule id
  const [hr, setHr] = useState<{ ruleId: string; idx: number[] } | null>(null); // some hours of an hourly price
  const [pick, setPick] = useState<number[]>([]);                            // grounds without a price list: start times of the slots
  const [credit, setCredit] = useState(0); const [useCredit, setUseCredit] = useState(false);
  const [promo, setPromo] = useState('');
  const [rep, setRep] = useState<{ f: RepeatFrequency; n: number } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [cal, setCal] = useState(false); // the month calendar for dates further ahead

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
    try { setAv(await api<Availability>(`/api/grounds/${gid}/availability?date=${date}`)); } catch (e: any) { setErr(e.message); setAv({ slots: [] }); }
  }, [gid, date]);
  useEffect(() => { void loadSlots(); }, [loadSlots]);

  const balls = (['leather', 'tennis', 'practice'] as Ball[]).filter((b) => ground?.rates?.some((r) => r.ball === b));
  useEffect(() => { if (hasRates && (!ball || !balls.includes(ball))) setBall(balls.length === 1 ? balls[0]! : null); }, [gid, hasRates]);

  // what the customer has chosen, in one shape for both kinds of ground
  let chosenText = '', total = 0, body: Record<string, unknown> | null = null;
  const opts: RateOption[] = (av?.rates ?? []).filter((o) => o.ball === ball);
  if (hasRates) {
    if (win) {
      const o = opts.find((x) => x.ruleId === win && x.state === 'available');
      if (o) { total = o.pricePaise; chosenText = `${o.label} · ${o.time} – ${o.endTime}`; body = { ruleId: o.ruleId, startTime: o.time }; }
    } else if (hr) {
      const o = opts.find((x) => x.ruleId === hr.ruleId); const sl = hr.idx.map((i) => o?.slots?.[i]).filter(Boolean) as Slot[];
      if (o && sl.length && sl.every((x) => x.state === 'available')) { total = sl.reduce((t, x) => t + x.pricePaise, 0); chosenText = `${sl.length} hour${sl.length > 1 ? 's' : ''} · ${sl[0]!.time} – ${hm(sl[sl.length - 1]!.end)}`; body = { ruleId: o.ruleId, startTime: sl[0]!.time, slots: sl.length }; }
    }
  } else {
    const chosen = (av?.slots ?? []).filter((x) => pick.includes(x.start));
    if (chosen.length) { total = chosen.reduce((t, x) => t + x.pricePaise, 0); chosenText = `${chosen.length} slot${chosen.length > 1 ? 's' : ''}`; body = { startTime: chosen[0]!.time, slots: chosen.length }; }
  }

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

  const hold = async () => {
    if (!body) return;
    setErr(''); setBusy(true);
    try {
      onHold(await api<HoldResponse>('/api/bookings', { method: 'POST', body: { groundId: gid, date, ...body, useCredit: useCredit && credit > 0, ...(promo.trim() ? { promoCode: promo.trim() } : {}), ...(rep ? { repeat: { frequency: rep.f, count: rep.n } } : {}) } }));
    } catch (e: any) { if (e.status === 401 && onNeedSignIn) { onNeedSignIn(); return; } setErr(e.message); void loadSlots(); } finally { setBusy(false); }
  };

  if (!cfg) return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]}>
      <Text style={s.eyebrow}>Reserve</Text>
      <Text style={s.h1}>Book the ground</Text>
      {err ? (<><Text style={s.err}>{err}</Text><Btn label="Try again" onPress={() => void loadGrounds()} style={{ marginTop: 16 }} /></>) : (<><Loading /><Text style={[s.muted, { textAlign: 'center' }]}>Loading today's slots…</Text></>)}
    </ScrollView>
  );
  // days inside the booking window, skipping days the ground has switched off for online booking
  const first = cfg?.bookingsOpenFrom && cfg.bookingsOpenFrom > istToday() ? cfg.bookingsOpenFrom : istToday();
  const shut = new Set(cfg?.closedDates?.ground ?? []);
  const days = Array.from({ length: Math.min(cfg?.maxDaysAhead ?? 30, 366) }, (_, i) => addDays(first, i)).filter((d) => !(cfg?.bookingsCloseFrom && d >= cfg.bookingsCloseFrom) && !shut.has(d));
  const fixed = opts.filter((o) => o.mode === 'fixed'), hourly = opts.filter((o) => o.mode === 'hourly');
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]}>
      <Text style={s.eyebrow}>Reserve</Text>
      <Text style={s.h1}>Book the ground</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>{grounds.map((g) => <Chip key={g.id} label={g.name} on={g.id === gid} onPress={() => setGid(g.id)} />)}</View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
        {days.slice(0, 14).map((d) => { const dt = new Date(d + 'T00:00:00Z'); return <Chip key={d} on={d === date} onPress={() => setDate(d)} label={`${DOW[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`} />; })}
        <Chip label={cal ? 'Hide calendar' : 'More dates…'} on={cal} onPress={() => setCal(!cal)} />
      </ScrollView>
      {cal && <DayPicker open={days} value={date} onPick={(d) => { setDate(d); setCal(false); }} />}

      {av === null ? <Loading /> : av.closed ? <Text style={s.muted}>The ground is closed on this day. Please pick another day.</Text> : hasRates ? (<>
        <Text style={[s.muted, { marginBottom: 6 }]}>Play with</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{balls.map((b) => <Chip key={b} label={BALLS[b]} on={b === ball} onPress={() => { setBall(b); setWin(null); setHr(null); }} />)}</View>
        {!ball ? <Text style={s.muted}>Choose the ball you want to play with.</Text> : !opts.length ? <Text style={s.muted}>Nothing is on sale for this ball on this day. Pick another day, or call us.</Text> : (<>
          {fixed.length > 0 && <Text style={[s.muted, { marginVertical: 6 }]}>Sessions</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {fixed.map((o) => <Chip key={o.ruleId} label={`${o.label}\n${o.time} – ${o.endTime}\n${o.state === 'available' ? inr(o.pricePaise) : o.state}${o.proRated ? '\n(part session)' : ''}`} on={win === o.ruleId} disabled={o.state !== 'available'} onPress={() => { setWin(o.ruleId); setHr(null); }} />)}
          </View>
          {hourly.map((o) => (
            <View key={o.ruleId}>
              <Text style={[s.muted, { marginVertical: 6 }]}>{o.label} · {inr(o.pricePaise)} per hour · up to {maxSlots} hours in a row</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {(o.slots ?? []).map((sl, i) => <Chip key={sl.start} label={`${sl.time}\n${sl.state === 'available' ? inr(sl.pricePaise) : sl.state}`} on={!!hr && hr.ruleId === o.ruleId && hr.idx.includes(i)} disabled={sl.state !== 'available'} onPress={() => toggleHour(o, i)} />)}
              </View>
            </View>
          ))}
        </>)}
        {!!ground?.ratesNote && <Text style={s.muted}>{ground.ratesNote}</Text>}
      </>) : (<>
        <Text style={[s.muted, { marginBottom: 10 }]}>Choose up to {maxSlots} slots in a row.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {av.slots.map((sl) => (
            <View key={sl.start} style={{ width: '23%' }}><Chip label={`${sl.time}\n${inr(sl.pricePaise)}`} on={pick.includes(sl.start)} disabled={sl.state !== 'available'} onPress={() => toggleSlot(sl)} /></View>
          ))}
          {!av.slots.length && <Text style={s.muted}>No slots on this day.</Text>}
        </View>
      </>)}

      {!!body && (<>
        <Text style={[s.muted, { marginTop: 14, marginBottom: 6 }]}>Repeat this booking</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="Does not repeat" on={!rep} onPress={() => setRep(null)} />
          {(Object.keys(REPEATS) as RepeatFrequency[]).map((f) => <Chip key={f} label={f[0]!.toUpperCase() + f.slice(1)} on={rep?.f === f} onPress={() => setRep({ f, n: REPEATS[f].def })} />)}
        </View>
        {rep && (<>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Chip label="−" onPress={() => setRep({ ...rep, n: Math.max(2, rep.n - 1) })} />
            <Text style={[s.text, { marginRight: 8, marginBottom: 8 }]}>{rep.n} times in all</Text>
            <Chip label="+" onPress={() => setRep({ ...rep, n: Math.min(REPEATS[rep.f].max, rep.n + 1) })} />
          </View>
          <Text style={s.muted}>Repeats {REPEATS[rep.f].word}. You pay for the first date now; the other {rep.n - 1} are reserved for you and their balance is paid at the ground{cfg?.autoDebitEnabled ? ' (or by auto-debit)' : ''}. Closed or taken dates are left out.</Text>
        </>)}
      </>)}
      <Field label="Promo code" value={promo} onChangeText={setPromo} autoCapitalize="characters" placeholder="Have a code?" />
      {credit > 0 && <Chip label={`${useCredit ? '✓ ' : ''}Use my ${inr(credit)} account credit`} on={useCredit} onPress={() => setUseCredit(!useCredit)} />}
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label={body ? `Hold · ${chosenText} · ${inr(total)}` : hasRates ? 'Choose ball and session' : 'Choose your slots'} onPress={hold} disabled={!body} busy={busy} style={{ marginTop: 16 }} />
      <Text style={[s.muted, { textAlign: 'center', color: C.muted }]}>Free cancellation more than {cfg?.freeCancelHours ?? 24} hours before the start.</Text>
    </ScrollView>
  );
}
