import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api, authImage, upload } from './api';
import { takeCardPhoto } from './camera';
import { BackBar, Badge, Btn, Chip, DateField, Empty, Field, Loading, RoundBtn, Segmented, Stat, Stats, s, todayIST, ScreenHead } from './ui';
import { C, inr, niceDate } from './theme';
import type { User } from './types';

// Cash (server/src/cashbook.ts): cash the owner hands to a team member to spend for the business. The holder enters each spend
// with a photo of the receipt (read for them when the AI connection is set up) and counts the cash in hand; the owner hands
// cash out and signs each spend, the same sign-off as the Approvals board on the desk. Nothing here is posted to the books.

interface LastCount { countedPaise: number; expectedPaise: number; differencePaise: number; at: number; byName: string | null }
interface Balance { holderId: string; holderName: string | null; givenPaise: number; spentWaitingPaise: number; expectedPaise: number; confirmedPaise: number; waiting: number; missingReceipts: number; uncertain: number; lastCount: LastCount | null }
interface Entry { id: string; kind: 'advance' | 'return' | 'expense'; amountPaise: number; date: string; description: string; payee: string | null; areaName: string | null; projectName: string | null; hasReceipt: boolean; uncertain: boolean; uncertainNote: string | null; status: 'confirmed' | 'waiting' | 'sent_back' | 'withdrawn'; decidedNote: string | null; hidden: boolean }
interface Draft { amountPaise: number | null; date: string | null; payee: string; description: string; sure: boolean; readable: boolean }
interface Req { id: string; kind: string; entityId: string; canSign: boolean; whyNot: string | null }

const STATUS: Record<Entry['status'], [string, 'ok' | 'warn' | 'danger' | 'muted']> = { confirmed: ['Confirmed', 'ok'], waiting: ['Waiting for sign-off', 'warn'], sent_back: ['Sent back', 'danger'], withdrawn: ['Taken back', 'muted'] };
const diffWords = (d: number) => (d === 0 ? 'matches' : d < 0 ? `${inr(-d)} short` : `${inr(d)} over`);
const toPaise = (t: string): number | null => { const v = t.replace(/[₹,\s]/g, ''); return /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : null; };
const key = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The owner's list of who holds cash, or the holder's own cash. `startSpend` opens the spend form (a voice shortcut). */
export function CashScreen({ user, startSpend }: { user: User; startSpend?: number }) {
  const boss = user.role !== 'staff';
  const [wallets, setWallets] = useState<Balance[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [giving, setGiving] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setWallets((await api<{ items: Balance[] }>('/api/cash/wallets')).items); setErr(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (giving) return <GiveCash onClose={() => setGiving(false)} onDone={() => { setGiving(false); void load(); }} />;
  const holder = boss ? wallets?.find((w) => w.holderId === open) : wallets?.[0] ?? { holderId: user.id, holderName: user.name, givenPaise: 0, spentWaitingPaise: 0, expectedPaise: 0, confirmedPaise: 0, waiting: 0, missingReceipts: 0, uncertain: 0, lastCount: null };
  if (holder && (!boss || open)) return <Wallet b={holder} boss={boss} startSpend={startSpend} onBack={boss ? () => { setOpen(null); void load(); } : undefined} onChanged={load} />;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Money" title="Cash" about="Cash you hand to your team to spend for the business. You sign every spend. These records are not posted to the books." right={<RoundBtn dark icon="add" label="Hand out cash" onPress={() => setGiving(true)} size={42} />} />
      {!!err && <Text style={s.err}>{err}</Text>}
      {wallets === null ? (err ? null : <Loading />) : !wallets.length ? <Empty icon="cash-outline" text="No one holds cash yet. Tap + to hand out cash." /> : wallets.map((w) => (
        <Pressable key={w.holderId} accessibilityRole="button" onPress={() => setOpen(w.holderId)} style={s.card}>
          <View style={[s.row, { marginBottom: 4 }]}><Text style={[s.text, { fontWeight: '700' }]}>{w.holderName}</Text><Text style={[s.text, { fontWeight: '700' }]}>{inr(w.expectedPaise)}</Text></View>
          <Text style={s.muted}>Should have in hand · {inr(w.confirmedPaise)} confirmed</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {w.waiting > 0 && <Badge tone="warn" label={`${w.waiting} waiting for you`} />}
            {w.missingReceipts > 0 && <Badge tone="danger" label={`${w.missingReceipts} no receipt`} />}
            {w.uncertain > 0 && <Badge tone="gold" label={`${w.uncertain} uncertain`} />}
            {w.lastCount && <Badge label={`Last count ${diffWords(w.lastCount.differencePaise)}`} />}
          </View>
        </Pressable>))}
    </ScrollView>
  );
}

function Wallet({ b, boss, startSpend, onBack, onChanged }: { b: Balance; boss: boolean; startSpend?: number; onBack?: () => void; onChanged: () => void }) {
  const [queue, setQueue] = useState<'' | 'waiting' | 'uncertain' | 'no_receipt'>('');
  const [data, setData] = useState<{ items: Entry[]; balance: Balance } | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [mode, setMode] = useState<null | 'spend' | 'count'>(startSpend ? 'spend' : null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<{ e: Entry; back: boolean } | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api(`/api/cash/wallets/${encodeURIComponent(b.holderId)}/entries${queue ? `?queue=${queue}` : ''}`));
      if (boss) setReqs((await api<{ items: Req[] }>('/api/accounting/approvals/requests')).items.filter((r) => r.kind === 'cash'));
      setErr('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [b.holderId, queue, boss]);
  useEffect(() => { void load(); }, [load]);
  const changed = (msg: string) => { setNote(msg); void load(); onChanged(); };

  if (mode === 'spend') return <Spend holderId={boss ? b.holderId : null} onClose={() => setMode(null)} onDone={() => { setMode(null); changed('Spend sent for sign-off.'); }} />;
  if (mode === 'count') return <Count holderId={boss ? b.holderId : null} expected={(data?.balance ?? b).expectedPaise} onClose={() => setMode(null)} onDone={() => { setMode(null); changed('Count saved.'); }} />;
  if (deciding) return <Decide e={deciding.e} back={deciding.back} req={reqs.find((r) => r.entityId === deciding.e.id) ?? null} onClose={() => setDeciding(null)} onDone={(m) => { setDeciding(null); changed(m); }} />;
  const bal = data?.balance ?? b;
  const addReceipt = async (e: Entry) => {
    setErr(''); setNote('');
    try { const shot = await takeCardPhoto(); if (!shot) return; await upload(`/api/cash/entries/${encodeURIComponent(e.id)}/receipt`, shot.uri); changed('Receipt added.'); } catch (x: any) { setErr(x.message); }
  };
  const takeBack = async (e: Entry) => { try { await api(`/api/cash/expenses/${encodeURIComponent(e.id)}/withdraw`, { method: 'POST', body: {} }); changed('Taken back.'); } catch (x: any) { setErr(x.message); } };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: onBack ? 0 : 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      {onBack ? <BackBar title={`${b.holderName ?? 'Team member'}'s cash`} onBack={onBack} /> : <><ScreenHead eyebrow="Money" title="Your cash" /></>}
      <Stats>
        <Stat label="Should have in hand" value={inr(bal.expectedPaise)} foot={bal.spentWaitingPaise ? `${inr(bal.spentWaitingPaise)} not signed yet` : 'Every spend is signed'} />
        <Stat label="Confirmed" value={inr(bal.confirmedPaise)} foot="Signed spends only" />
        <Stat label="Handed over" value={inr(bal.givenPaise)} />
        <Stat label="Last count" value={bal.lastCount ? inr(bal.lastCount.countedPaise) : 'Not counted'} foot={bal.lastCount ? diffWords(bal.lastCount.differencePaise) : undefined} tone={bal.lastCount && bal.lastCount.differencePaise < 0 ? 'danger' : undefined} />
      </Stats>
      <Btn label={boss ? 'Enter a spend for them' : 'Enter a spend'} onPress={() => setMode('spend')} />
      <Btn kind="outline" label="Count the cash" onPress={() => setMode('count')} />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      <Segmented value={queue} onChange={setQueue} items={[['', 'All'], ['waiting', `Waiting ${bal.waiting}`], ['uncertain', `Unsure ${bal.uncertain}`], ['no_receipt', `No receipt ${bal.missingReceipts}`]]} />
      {!data ? (err ? null : <Loading />) : !data.items.length ? <Text style={[s.muted, { marginTop: 10 }]}>Nothing here.</Text> : data.items.map((e) => (
        <View key={e.id} style={s.card}>
          <View style={s.row}><Text style={[s.text, { fontWeight: '700' }]}>{e.kind === 'advance' ? '+' : '−'}{inr(e.amountPaise)}</Text><Text style={s.muted}>{niceDate(e.date)}</Text></View>
          <Text style={[s.text, { marginTop: 4 }]}>{e.kind === 'expense' ? [e.payee, e.description].filter(Boolean).join(' · ') : `${e.kind === 'advance' ? 'Cash handed over' : 'Cash taken back'} · ${e.description}`}</Text>
          {!!(e.areaName || e.projectName) && <Text style={s.muted}>{[e.areaName, e.projectName].filter(Boolean).join(' › ')}</Text>}
          {e.uncertain && <Text style={[s.muted, { color: C.gold }]}>Uncertain{e.uncertainNote ? `: ${e.uncertainNote}` : ''}</Text>}
          {!!e.decidedNote && <Text style={s.muted}>“{e.decidedNote}”</Text>}
          {e.hasReceipt && <Image source={authImage(`/api/cash/entries/${e.id}/receipt`)} style={{ width: '100%', height: 140, borderRadius: 10, backgroundColor: C.line, marginTop: 8 }} resizeMode="contain" />}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
            {e.hidden ? <Badge label="Hidden" /> : e.kind === 'expense' ? <Badge tone={STATUS[e.status][1]} label={STATUS[e.status][0]} /> : <Badge tone="ok" label="Done" />}
            {e.kind === 'expense' && !e.hasReceipt && (boss || e.status === 'waiting') && <Chip label="Add receipt" onPress={() => void addReceipt(e)} />}
            {e.status === 'waiting' && boss && <Chip label="Sign" on onPress={() => setDeciding({ e, back: false })} />}
            {e.status === 'waiting' && boss && <Chip label="Send back" onPress={() => setDeciding({ e, back: true })} />}
            {e.status === 'waiting' && !boss && <Chip label="Take back" onPress={() => void takeBack(e)} />}
          </View>
        </View>))}
    </ScrollView>
  );
}

/** Sign or send back one spend: the same step as the Approvals board (routes/approvals.ts), so the same rules apply. */
function Decide({ e, back, req, onClose, onDone }: { e: Entry; back: boolean; req: Req | null; onClose: () => void; onDone: (m: string) => void }) {
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!req) return setErr('This spend is not waiting on you. Pull to refresh.');
    if (!req.canSign) return setErr(req.whyNot ?? 'You cannot sign this.');
    if (back && note.trim().length < 3) return setErr('Say why it goes back.');
    setBusy(true);
    try { await api(`/api/accounting/approvals/requests/${encodeURIComponent(req.id)}/${back ? 'send-back' : 'approve'}`, { method: 'POST', body: note.trim() ? { note: note.trim() } : {} }); onDone(back ? 'Sent back.' : 'Signed.'); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <BackBar title={back ? 'Send back this spend' : 'Sign this spend'} onBack={onClose} />
      <View style={s.card}><Text style={[s.text, { fontWeight: '700' }]}>{inr(e.amountPaise)}</Text><Text style={s.text}>{[e.payee, e.description].filter(Boolean).join(' · ')}</Text><Text style={s.muted}>{niceDate(e.date)}{e.hasReceipt ? '' : ' · no receipt'}{e.uncertain ? ' · uncertain' : ''}</Text></View>
      <Field label={back ? 'Why it goes back' : 'Note (optional)'} value={note} onChangeText={setNote} maxLength={300} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label={back ? 'Send back' : 'Sign'} busy={busy} onPress={go} />
    </ScrollView>
  );
}

function GiveCash({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [people, setPeople] = useState<{ id: string; name: string }[] | null>(null);
  const [who, setWho] = useState(''); const [amount, setAmount] = useState(''); const [date, setDate] = useState(todayIST()); const [desc, setDesc] = useState('Cash for the week');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [k] = useState(key);
  useEffect(() => { api<{ items: { id: string; name: string }[] }>('/api/cash/people').then((r) => setPeople(r.items)).catch((e) => setErr(e.message)); }, []);
  const save = async () => {
    const p = toPaise(amount);
    if (!who) return setErr('Pick the person.');
    if (!p || p < 100) return setErr('Type the amount, at least ₹1.');
    setBusy(true);
    try { await api('/api/cash/advances', { method: 'POST', body: { holderId: who, amountPaise: p, date, description: desc.trim() || 'Cash handed over', clientKey: k } }); onDone(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <BackBar title="Hand out cash" onBack={onClose} />
      <Text style={s.muted}>To</Text>
      {!people ? <Loading /> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}>{people.map((p) => <Chip key={p.id} label={p.name} on={who === p.id} onPress={() => setWho(p.id)} />)}</View>}
      <Field label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="5000" />
      <DateField label="Day" value={date} onChange={setDate} />
      <Field label="Note" value={desc} onChangeText={setDesc} maxLength={200} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Hand over" busy={busy} onPress={save} />
    </ScrollView>
  );
}

/** A spend: the receipt photo first (read for you when the AI connection is set up), then the details to check, then sign-off. */
function Spend({ holderId, onClose, onDone }: { holderId: string | null; onClose: () => void; onDone: () => void }) {
  const [ocr, setOcr] = useState(false);
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; areaId: string | null; status: string }[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [f, setF] = useState({ amount: '', date: todayIST(), payee: '', description: '', areaId: '', projectId: '', uncertain: false, uncertainNote: '' });
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [reading, setReading] = useState(false); const [k] = useState(key);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  useEffect(() => {
    api<{ ocr: boolean }>('/api/cash/status').then((r) => setOcr(r.ocr)).catch(() => {});
    api<{ items: { id: string; name: string; archived: boolean }[] }>('/api/areas').then((r) => setAreas(r.items.filter((a) => !a.archived))).catch(() => {});
    api<{ items: { id: string; name: string; areaId: string | null; status: string }[] }>('/api/projects').then((r) => setProjects(r.items.filter((p) => p.status === 'active'))).catch(() => {});
  }, []);
  const snap = async () => {
    setErr(''); setNote('');
    try {
      const shot = await takeCardPhoto(); if (!shot) return;
      setPhoto(shot.uri);
      if (!ocr) return;
      setReading(true);
      const d = await upload<Draft>('/api/cash/receipts/read', shot.uri);
      if (!d.readable) { setNote('Could not read that receipt. Type the details in.'); return; }
      setF((x) => ({ ...x, amount: d.amountPaise ? (d.amountPaise / 100).toFixed(2) : x.amount, date: d.date ?? x.date, payee: d.payee || x.payee, description: d.description || x.description, ...(d.sure ? {} : { uncertain: true, uncertainNote: 'The receipt was hard to read; check the figures.' }) }));
      setNote(d.sure ? 'Read the receipt. Check the details.' : 'Read the receipt, but not sure of everything. Check the details.');
    } catch (x: any) { setErr(x.message); } finally { setReading(false); }
  };
  const save = async () => {
    const p = toPaise(f.amount);
    if (!p || p < 100) return setErr('Type the amount spent, at least ₹1.');
    if (f.description.trim().length < 2) return setErr('Say what it was for.');
    setBusy(true); setErr('');
    try {
      const e = await api<{ id: string }>('/api/cash/expenses', { method: 'POST', body: { ...(holderId ? { holderId } : {}), amountPaise: p, date: f.date, description: f.description.trim(), payee: f.payee.trim() || undefined, areaId: f.areaId || null, projectId: f.projectId || null, uncertain: f.uncertain, uncertainNote: f.uncertain ? f.uncertainNote.trim() || undefined : undefined, clientKey: k } });
      if (photo) { try { await upload(`/api/cash/entries/${encodeURIComponent(e.id)}/receipt`, photo); } catch (x: any) { setErr(`The spend is saved, but the receipt was not: ${x.message} Add it from the list.`); setBusy(false); return; } }
      onDone();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  const projs = projects.filter((p) => !f.areaId || p.areaId === f.areaId);
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <BackBar title="Enter a spend" onBack={onClose} />
      <Btn kind="outline" label={reading ? 'Reading the receipt…' : photo ? 'Retake the receipt photo' : 'Take the receipt photo'} busy={reading} onPress={snap} />
      {!ocr && <Text style={[s.muted, { marginBottom: 8 }]}>Type the details in. Reading receipts needs the AI connection (Settings › Connections).</Text>}
      {!!photo && <Image source={{ uri: photo }} style={{ width: '100%', height: 160, borderRadius: 10, backgroundColor: C.line, marginBottom: 8 }} resizeMode="contain" />}
      {!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      <Field label="Amount (₹)" keyboardType="decimal-pad" value={f.amount} onChangeText={(v) => set({ amount: v })} placeholder="250" />
      <DateField label="Day" value={f.date} onChange={(d) => set({ date: d })} />
      <Field label="Paid to" value={f.payee} onChangeText={(v) => set({ payee: v })} maxLength={120} placeholder="Shop or person" />
      <Field label="For" value={f.description} onChangeText={(v) => set({ description: v })} maxLength={200} placeholder="Cement bags" />
      {areas.length > 0 && <><Text style={s.muted}>Branch</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}><Chip label="None" on={!f.areaId} onPress={() => set({ areaId: '', projectId: '' })} />{areas.map((a) => <Chip key={a.id} label={a.name} on={f.areaId === a.id} onPress={() => set({ areaId: a.id, projectId: '' })} />)}</View></>}
      {projs.length > 0 && <><Text style={s.muted}>Project</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}><Chip label="None" on={!f.projectId} onPress={() => set({ projectId: '' })} />{projs.map((p) => <Chip key={p.id} label={p.name} on={f.projectId === p.id} onPress={() => set({ projectId: p.id })} />)}</View></>}
      <Chip label={f.uncertain ? 'Not sure of something ✓' : 'Not sure of something'} on={f.uncertain} onPress={() => set({ uncertain: !f.uncertain })} />
      {f.uncertain && <Field label="What is uncertain" value={f.uncertainNote} onChangeText={(v) => set({ uncertainNote: v })} maxLength={300} />}
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Send for sign-off" busy={busy} onPress={save} />
    </ScrollView>
  );
}

function Count({ holderId, expected, onClose, onDone }: { holderId: string | null; expected: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(''); const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    const p = toPaise(amount);
    if (p === null) return setErr('Type the cash counted, in rupees.');
    setBusy(true);
    try { await api('/api/cash/counts', { method: 'POST', body: { ...(holderId ? { holderId } : {}), countedPaise: p, note: note.trim() || undefined } }); onDone(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <BackBar title="Count the cash" onBack={onClose} />
      <Text style={[s.muted, { marginBottom: 8 }]}>Count the notes and coins in hand. It is kept beside what should be there ({inr(expected)}), so any difference shows.</Text>
      <Field label="Cash counted (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      <Field label="Note" value={note} onChangeText={setNote} maxLength={300} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Save the count" busy={busy} onPress={save} />
    </ScrollView>
  );
}
