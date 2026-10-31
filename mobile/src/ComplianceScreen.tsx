import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Badge, Btn, Chip, Loading, s, ScreenHead } from './ui';
import { C } from './theme';

interface Item { code: string; title: string; authority: string; rule: string; currentValue: string; reviewEveryDays: number; lastReviewedOn: string; nextReviewOn: string; status: 'ok' | 'soon' | 'due'; daysToReview: number }
interface Change { id: string; code: string; changedOn: string; summary: string; oldValue: string | null; newValue: string | null; source: string | null }
interface Alert { id: string; source: 'feed' | 'manual'; title: string; summary: string | null; publishedOn: string; codes: string[]; status: 'new' | 'reviewed' | 'not_relevant' }
interface Feed { connected: boolean; lastRun: { ranOn: string; ok: boolean; message: string } | null }
interface Reg { items: Item[]; changes: Change[]; checks: { ranOn: string; dueCount: number }[]; alerts: Alert[]; feed: Feed }
const LABEL: Record<Item['status'], [string, 'ok' | 'gold' | 'danger']> = { ok: ['Up to date', 'ok'], soon: ['Review soon', 'gold'], due: ['Review overdue', 'danger'] };
const day = (iso: string) => iso.split('-').reverse().join('/');

/** The Indian rules the software enforces, when each was last checked, and the log of changes in the law. */
export function ComplianceScreen() {
  const [reg, setReg] = useState<Reg | null>(null); const [tab, setTab] = useState<'rules' | 'updates' | 'changes'>('rules');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [working, setWorking] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    try { setReg(await api<Reg>('/api/compliance')); setErr(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const review = async (code: string) => {
    setErr(''); setNote(''); setWorking(code);
    try { await api(`/api/compliance/${code}/review`, { method: 'POST', body: {} }); setNote('Marked as reviewed.'); void load(); } catch (e: any) { setErr(e.message); } finally { setWorking(''); }
  };
  const check = async () => {
    setErr(''); setNote(''); setWorking('check');
    try { const r = await api<{ dueCount: number }>('/api/compliance/check', { method: 'POST', body: {} }); setNote(r.dueCount ? `${r.dueCount} rule${r.dueCount === 1 ? '' : 's'} need a review.` : 'Everything is up to date.'); void load(); } catch (e: any) { setErr(e.message); } finally { setWorking(''); }
  };
  const handle = async (id: string, status: 'reviewed' | 'not_relevant') => {
    setErr(''); setNote(''); setWorking(id);
    try { await api(`/api/compliance/alerts/${id}/handle`, { method: 'POST', body: { status } }); setNote(status === 'reviewed' ? 'Marked as reviewed.' : 'Marked as not relevant.'); } catch (e: any) { setErr(e.message); } finally { setWorking(''); void load(); }
  };
  // overdue first, then the ones coming up
  const items = reg ? [...reg.items].sort((a, b) => a.daysToReview - b.daysToReview) : [];
  const due = items.filter((i) => i.status === 'due').length;
  const waiting = reg ? reg.alerts.filter((a) => a.status === 'new') : [];
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Money" title="Compliance" about="The Indian rules this software enforces and when each was last checked. Before you mark a rule reviewed, look up the current rule on the official source and note any change on the desk." />
      <View style={{ flexDirection: 'row', marginVertical: 10 }}>
        <Chip label={due ? `Rules (${due} overdue)` : 'Rules'} on={tab === 'rules'} onPress={() => setTab('rules')} />
        <Chip label={waiting.length ? `Law updates (${waiting.length})` : 'Law updates'} on={tab === 'updates'} onPress={() => setTab('updates')} />
        <Chip label="Law-change log" on={tab === 'changes'} onPress={() => setTab('changes')} />
      </View>
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      {!reg ? (err ? null : <Loading />) : tab === 'rules' ? (<>
        <Text style={[s.muted, { marginBottom: 8 }]}>A check runs every day.{reg.checks[0] ? ` Last run ${day(reg.checks[0].ranOn)}.` : ''}</Text>
        <Btn kind="outline" label="Run the check now" busy={working === 'check'} onPress={check} />
        {items.map((i) => (
          <View key={i.code} style={s.card}>
            <Text style={[s.text, { fontWeight: '700' }]}>{i.title}</Text>
            <Text style={[s.muted, { fontSize: 12, marginBottom: 6 }]}>{i.authority}</Text>
            <Text style={[s.text, { fontSize: 14 }]}>{i.rule}</Text>
            <Text style={[s.muted, { marginTop: 6 }]}>Set as: {i.currentValue}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}><Badge label={LABEL[i.status][0]} tone={LABEL[i.status][1]} /><Badge label={`Next ${day(i.nextReviewOn)}`} /></View>
            <Text style={s.muted}>Last reviewed {day(i.lastReviewedOn)}, every {i.reviewEveryDays} days</Text>
            <Btn kind="ghost" label="Reviewed" busy={working === i.code} onPress={() => review(i.code)} style={{ marginTop: 6, marginBottom: 0 }} />
          </View>
        ))}
      </>) : tab === 'updates' ? (<>
        <Text style={[s.muted, { marginBottom: 8 }]}>{reg.feed.connected ? `Read from the updates feed once a day.${reg.feed.lastRun ? ` Last read ${day(reg.feed.lastRun.ranOn)}.` : ''}` : 'No updates feed is connected. Updates added by hand on the desk show here.'}</Text>
        {reg.feed.lastRun && !reg.feed.lastRun.ok && <Text style={s.err}>The feed could not be read: {reg.feed.lastRun.message}</Text>}
        {!waiting.length && <Text style={s.muted}>No law updates waiting.</Text>}
        {waiting.map((a) => (
          <View key={a.id} style={s.card}>
            <Text style={[s.muted, { fontSize: 12 }]}>{day(a.publishedOn)}  ·  {a.source === 'feed' ? 'From the feed' : 'Added by hand'}</Text>
            <Text style={[s.text, { fontWeight: '700', marginTop: 4 }]}>{a.title}</Text>
            {!!a.summary && <Text style={[s.text, { fontSize: 14, marginTop: 4 }]}>{a.summary}</Text>}
            {a.codes.length > 0 && <Text style={[s.muted, { marginTop: 4 }]}>About: {a.codes.map((c) => reg.items.find((i) => i.code === c)?.title ?? c).join(', ')}</Text>}
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              <Btn kind="ghost" label="Reviewed" busy={working === a.id} onPress={() => handle(a.id, 'reviewed')} style={{ marginRight: 8, marginBottom: 0 }} />
              <Btn kind="ghost" label="Not relevant" busy={working === a.id} onPress={() => handle(a.id, 'not_relevant')} style={{ marginBottom: 0 }} />
            </View>
          </View>
        ))}
      </>) : (<>
        {!reg.changes.length && <Text style={s.muted}>No changes logged yet.</Text>}
        {reg.changes.map((c) => (
          <View key={c.id} style={s.card}>
            <Text style={[s.muted, { fontSize: 12 }]}>{day(c.changedOn)}  ·  {reg.items.find((i) => i.code === c.code)?.title ?? c.code}</Text>
            <Text style={[s.text, { marginTop: 4 }]}>{c.summary}</Text>
            {(c.oldValue || c.newValue) && <Text style={[s.muted, { marginTop: 4 }]}>{c.oldValue ?? '-'}  to  {c.newValue ?? '-'}</Text>}
            {!!c.source && <Text style={[s.muted, { fontSize: 12, marginTop: 4 }]}>Source: {c.source}</Text>}
          </View>
        ))}
      </>)}
    </ScrollView>
  );
}
