import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { Badge, Btn, Chip, DateField, Field, Loading, MonthBar, Stat, Stats, monthName, s, todayIST, ScreenHead } from './ui';
import { C, inr } from './theme';

const P = '/api/accounting/payroll';
type Mark = 'present' | 'half' | 'absent' | 'leave';
const MARKS: [Mark, string][] = [['present', 'Present'], ['half', 'Half day'], ['absent', 'Absent'], ['leave', 'Leave']];
const METHODS: [string, string][] = [['upi', 'UPI'], ['cash', 'Cash'], ['bank', 'Bank transfer'], ['cheque', 'Cheque'], ['other', 'Other']];
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface Line { id: string | null; staffId: string; staffName: string; staffRole: string; payType: string; ratePaise: number; daysInMonth: number; paidDays: number; unmarked: number; grossPaise: number; bonusPaise: number; advancePaise: number; deductionPaise: number; esiEmployeePaise: number; ptPaise: number; tdsPaise: number; netPaise: number; paidOn: string | null; paidMethod: string | null; paidRef: string | null }
interface Run { month: string; status: 'open' | 'final'; finalisedAt: number | null; lines: Line[]; summary: { headcount: number; grossPaise: number; bonusPaise: number; advancePaise: number; deductionPaise: number; netPaise: number; paidPaise: number; outstandingPaise: number; paidCount: number; unmarkedDays: number; presentDays: number; absentDays: number; leaveDays: number; shortfallPaise: number } }
interface Sheet { month: string; locked: boolean; today: string; staff: { id: string; name: string; role: string; active: boolean; marks: Record<string, Mark> }[] }

/** Staff pay for the owner: today's attendance, the month's pay worked out from it, finalising the month and marking each salary paid. */
export function PayrollScreen() {
  const today = todayIST();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [run, setRun] = useState<Run | null>(null); const [sheet, setSheet] = useState<Sheet | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<Line | null>(null); const [sure, setSure] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [r, a] = await Promise.all([api<Run>(`${P}/runs/${month}`), month === today.slice(0, 7) ? api<Sheet>(`${P}/attendance?month=${month}`) : Promise.resolve(null)]);
      setRun(r); setSheet(a); setErr('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [month, today]);
  useEffect(() => { setRun(null); setPaying(null); setSure(false); void load(); }, [load]);

  const mark = async (staffId: string, status: Mark) => {
    setErr(''); setNote('');
    const was = sheet?.staff.find((x) => x.id === staffId)?.marks[today.slice(8)];
    const next = was === status ? null : status; // tapping the chosen mark again clears it
    try { await api(`${P}/attendance`, { method: 'PUT', body: { staffId, date: today, status: next } }); void load(); } catch (e: any) { setErr(e.message); }
  };
  const act = async (what: 'finalise' | 'reopen') => {
    setErr(''); setNote(''); setSure(false);
    try { await api(`${P}/runs/${month}/${what}`, { method: 'POST', body: {} }); setNote(what === 'finalise' ? `${monthName(month)} is finalised and locked.` : `${monthName(month)} is open again.`); void load(); } catch (e: any) { setErr(e.message); }
  };

  const final = run?.status === 'final';
  const sm = run?.summary;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Money" title="Staff pay" about="Pay is worked out from attendance, advances and deductions. Finalise the month to lock it, then mark each salary paid. Marking paid records the payment in the books; it does not move money." />
      <MonthBar month={month} onChange={setMonth} max={today.slice(0, 7)} />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}

      {sheet && sheet.staff.some((x) => x.active) && (
        <View style={s.card}>
          <Text style={s.h2}>Attendance today</Text>
          {sheet.locked && <Text style={s.muted}>This month is locked. Reopen it to change attendance.</Text>}
          {sheet.staff.filter((x) => x.active).map((p) => {
            const on = p.marks[today.slice(8)];
            return (
              <View key={p.id} style={{ marginTop: 10 }}>
                <Text style={s.text}>{p.name} <Text style={s.muted}>{p.role}</Text></Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                  {MARKS.map(([k, label]) => <Chip key={k} label={label} on={on === k} disabled={sheet.locked} onPress={() => mark(p.id, k)} />)}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {!run || !sm ? (err ? null : <Loading />) : (<>
        <Stats>
          <Stat label="Net pay" value={inr(sm.netPaise)} foot={`${sm.headcount} on payroll`} />
          <Stat label="Paid" value={inr(sm.paidPaise)} foot={`${sm.paidCount} of ${sm.headcount} paid`} />
          <Stat label="Still to pay" value={inr(sm.outstandingPaise)} foot={final ? `${sm.headcount - sm.paidCount} open` : 'Finalise to pay'} tone={sm.outstandingPaise > 0 && final ? 'danger' : undefined} />
          <Stat label="Advances, deductions" value={inr(sm.advancePaise + sm.deductionPaise)} foot={`${days(sm.presentDays)} present, ${sm.absentDays} absent, ${sm.leaveDays} leave`} />
        </Stats>
        {!final && sm.unmarkedDays > 0 && <Text style={[s.muted, { color: C.danger, marginBottom: 6 }]}>{sm.unmarkedDays} day{sm.unmarkedDays === 1 ? '' : 's'} have no attendance mark and will not be paid.</Text>}
        {sm.shortfallPaise > 0 && <Text style={[s.muted, { color: C.danger, marginBottom: 6 }]}>{inr(sm.shortfallPaise)} of advances and deductions is more than the pay earned; net pay is held at zero for those people.</Text>}

        <View style={[s.row, { marginTop: 8 }]}>
          <Text style={[s.h2, { marginBottom: 0 }]}>{monthName(month)}</Text>
          <Badge label={final ? 'Finalised' : 'Open'} tone={final ? 'ok' : 'gold'} />
        </View>
        {run.lines.length > 0 && (sure
          ? (<View style={[s.card, { marginTop: 8 }]}>
              <Text style={[s.text, { marginBottom: 10 }]}>{final ? `Unlock ${monthName(month)}? Attendance and adjustments can change again.` : `Lock ${monthName(month)}? Attendance, advances and deductions can no longer change.`}</Text>
              <Btn label={final ? 'Reopen month' : 'Finalise and lock'} onPress={() => act(final ? 'reopen' : 'finalise')} /><Btn kind="ghost" label="Not now" onPress={() => setSure(false)} />
            </View>)
          : <Btn kind={final ? 'outline' : 'primary'} label={final ? 'Reopen month' : 'Finalise and lock month'} onPress={() => setSure(true)} style={{ marginTop: 8 }} />)}

        {!run.lines.length && <Text style={[s.muted, { marginTop: 8 }]}>Nobody is on the payroll for this month yet. Add staff under Staff & payroll on the desk.</Text>}
        {run.lines.map((l) => {
          const taxes = l.esiEmployeePaise + l.ptPaise + l.tdsPaise;
          return (
            <View key={l.staffId} style={s.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, marginRight: 8 }}><Text style={[s.text, { fontWeight: '700' }]}>{l.staffName}</Text><Text style={s.muted}>{l.staffRole}, {inr(l.ratePaise)} {l.payType === 'monthly' ? 'a month' : 'a day'}</Text></View>
                <Text style={[s.text, { fontWeight: '700', fontSize: 18 }]}>{inr(l.netPaise)}</Text>
              </View>
              <Text style={[s.muted, { marginTop: 6 }]}>
                {days(l.paidDays)}{l.payType === 'monthly' ? ` of ${l.daysInMonth}` : ''} day{l.paidDays === 1 && l.payType !== 'monthly' ? '' : 's'} paid, earned {inr(l.grossPaise)}
                {l.bonusPaise ? `, bonus +${inr(l.bonusPaise)}` : ''}{l.advancePaise ? `, advance -${inr(l.advancePaise)}` : ''}{l.deductionPaise ? `, deduction -${inr(l.deductionPaise)}` : ''}{taxes ? `, ESI/PT/TDS -${inr(taxes)}` : ''}
              </Text>
              {!final && l.unmarked > 0 && <Text style={[s.muted, { color: C.danger }]}>{l.unmarked} day{l.unmarked === 1 ? '' : 's'} unmarked</Text>}
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                {!final ? <Badge label="Not finalised" /> : l.paidOn ? <Badge tone="ok" label="Paid" /> : <Badge tone="danger" label="Due" />}
              </View>
              {final && l.paidOn && <Text style={s.muted}>Paid {l.paidOn.split('-').reverse().join('/')}, {METHODS.find(([k]) => k === l.paidMethod)?.[1] ?? l.paidMethod}{l.paidRef ? `, ${l.paidRef}` : ''}</Text>}
              {final && !l.paidOn && l.id && (paying?.staffId === l.staffId
                ? <PayForm month={month} line={l} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); setNote(`${l.staffName} marked paid.`); void load(); }} />
                : <Btn label="Mark paid" onPress={() => setPaying(l)} style={{ marginTop: 8 }} />)}
            </View>
          );
        })}
      </>)}
    </ScrollView>
  );
}

function PayForm({ month, line, onClose, onSaved }: { month: string; line: Line; onClose: () => void; onSaved: () => void }) {
  const [paidOn, setPaidOn] = useState(todayIST()); const [method, setMethod] = useState('upi'); const [ref, setRef] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api(`${P}/runs/${month}/lines/${line.id}/pay`, { method: 'POST', body: { paidOn, method, reference: ref.trim() || undefined } }); onSaved(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <View style={{ marginTop: 10 }}>
      <DateField label="Date paid" value={paidOn} onChange={setPaidOn} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>{METHODS.map(([k, label]) => <Chip key={k} label={label} on={method === k} onPress={() => setMethod(k)} />)}</View>
      <Field label="Reference (optional)" value={ref} onChangeText={setRef} placeholder="UPI reference or cheque number" />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label={`Mark ${inr(line.netPaise)} paid`} busy={busy} disabled={!paidOn} onPress={save} />
      <Pressable onPress={onClose} style={{ alignItems: 'center', padding: 8 }}><Text style={{ color: C.gold }}>Cancel</Text></Pressable>
    </View>
  );
}
