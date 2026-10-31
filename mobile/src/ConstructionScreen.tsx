import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { BackBar, Badge, Btn, Chip, DateField, Field, Loading, Segmented, Stat, Stats, s, todayIST, ScreenHead, Empty } from './ui';
import { C, inr, niceDate } from './theme';
import type { User } from './types';

// Construction (server/src/construction.ts) on the phone: the same projects as the desk, which are the projects of Tasks. The site
// receives goods and records measured work against approved orders, raises and closes defects, and sees the current drawings. The
// owner signs orders here with the same step as the Approvals board. Bills, RA bills and the BOQ stay on the desk. Amounts come back
// empty (null) for people who may not see money, so they show as "Restricted".

type Phase = 'planning' | 'active' | 'on_hold' | 'completed';
type PoStatus = 'draft' | 'pending_approval' | 'approved' | 'partly_received' | 'received' | 'closed' | 'cancelled';
interface Figures { budgetPaise: number; committedPaise: number; receivedPaise: number; measuredPaise: number; billedPaise: number; paidPaise: number; outstandingPaise: number; retentionHeldPaise: number; overBudget: boolean }
interface Project {
  id: string; name: string; code: string; site: string | null; phase: Phase; targetEndDate: string | null; areaName: string | null;
  counts: { orders: number; ordersWaiting: number; openDefects: number; drawings: number; jobs: number; jobsDone: number; milestones: number; milestonesOverdue: number };
  figures: Figures | null; canManage?: boolean;
}
interface Order { id: string; poNo: string; kind: 'supply' | 'work'; status: PoStatus; vendorName: string; totalPaise: number | null; progress: { receivedPct: number } }
interface Line { id: string; description: string; unit: string; quantity: string; receivedQty: string; toComeQty: string; measuredQty: string }
interface OrderCtx { order: Order; lines: Line[]; receipts: { id: string; grnNo: string; date: string; byName: string | null }[]; measurements: { id: string; description: string; unit: string; date: string; quantity: string; location: string | null; status: string }[]; canManage: boolean }
interface Report { date: string; notes: { id: string; authorName: string | null; workers: number | null; body: string; issues: string | null }[]; done: { id: string; title: string; proofPhotos: number; signedOff: boolean }[]; overdue: { id: string; title: string }[]; proofPhotos: number }
interface Site { report: Report; jobs: { id: string; title: string; status: string; assignedName: string | null; overdue: boolean }[]; defects: { id: string; title: string; location: string | null; severity: 'minor' | 'major' | 'critical'; vendorName: string | null; status: 'open' | 'fixed' | 'closed' }[] }
interface Doc { id: string; title: string; kind: 'drawing' | 'document'; drawingNo: string | null; revision: string | null; current: boolean }
interface Req { id: string; kind: string; entityId: string; canSign: boolean; whyNot: string | null }

const PHASE: Record<Phase, string> = { planning: 'Planning', active: 'Under way', on_hold: 'On hold', completed: 'Completed' };
const PO: Record<PoStatus, [string, 'muted' | 'warn' | 'gold' | 'ok' | 'danger']> = { draft: ['Draft', 'muted'], pending_approval: ['Waiting for approval', 'warn'], approved: ['Approved', 'gold'], partly_received: ['Part done', 'gold'], received: ['Complete', 'ok'], closed: ['Closed', 'muted'], cancelled: ['Cancelled', 'danger'] };
const money = (p: number | null | undefined) => (p == null ? 'Restricted' : inr(p));
const enc = encodeURIComponent;
const key = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const OPEN: PoStatus[] = ['approved', 'partly_received'];

/** The projects this person can see, then one project. */
export function ConstructionScreen({ user }: { user: User }) {
  const [data, setData] = useState<{ items: Project[]; seesMoney: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api('/api/construction')); setErr(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (open) return <ProjectView id={open} boss={user.role !== 'staff'} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Construction" title="Projects" about="The same projects as Tasks, with their orders, site and drawings. Start a project and keep the BOQ and bills on the desk." />
      {!!err && <Text style={s.err}>{err}</Text>}
      {data === null ? (err ? null : <Loading />) : !data.items.length ? <Empty icon="construct-outline" text="No construction projects you can see." /> : data.items.map((p) => (
        <Pressable key={p.id} accessibilityRole="button" onPress={() => setOpen(p.id)} style={s.card}>
          <View style={[s.row, { marginBottom: 4 }]}><Text style={[s.text, { fontWeight: '700', flex: 1 }]}>{p.name}</Text><Text style={s.muted}>{p.code}</Text></View>
          <Text style={s.muted}>{[PHASE[p.phase], p.areaName, p.targetEndDate ? `due ${niceDate(p.targetEndDate)}` : null].filter(Boolean).join(' · ')}</Text>
          {data.seesMoney && p.figures && <Text style={[s.text, { marginTop: 4 }]}>{inr(p.figures.committedPaise)} committed of {inr(p.figures.budgetPaise)}</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {p.counts.ordersWaiting > 0 && <Badge tone="warn" label={`${p.counts.ordersWaiting} to approve`} />}
            {p.counts.openDefects > 0 && <Badge tone="danger" label={`${p.counts.openDefects} open defect${p.counts.openDefects === 1 ? '' : 's'}`} />}
            {p.counts.milestonesOverdue > 0 && <Badge tone="danger" label={`${p.counts.milestonesOverdue} late milestone${p.counts.milestonesOverdue === 1 ? '' : 's'}`} />}
            <Badge label={`Jobs ${p.counts.jobsDone} of ${p.counts.jobs}`} />
          </View>
        </Pressable>))}
    </ScrollView>
  );
}

type Tab = 'overview' | 'orders' | 'site' | 'drawings';

function ProjectView({ id, boss, onBack }: { id: string; boss: boolean; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [p, setP] = useState<Project | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [order, setOrder] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const base = `/api/construction/projects/${enc(id)}`;
      const [proj, o, st, d] = await Promise.all([api<Project>(base), api<{ items: Order[] }>(`${base}/orders`), api<Site>(`${base}/site`), api<{ items: Doc[] }>(`${base}/documents`)]);
      setP(proj); setOrders(o.items); setSite(st); setDocs(d.items);
      // orders waiting on a sign-off this person may give (the owner, or someone who keeps the books)
      setReqs(await api<{ items: Req[] }>('/api/accounting/approvals/requests').then((r) => r.items.filter((x) => x.kind === 'purchase_order')).catch(() => []));
      setErr('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const changed = (m: string) => { setNote(m); void load(); };

  if (order) return <OrderView id={order} req={reqs.find((r) => r.entityId === order) ?? null} onBack={() => { setOrder(null); void load(); }} />;
  if (raising) return <RaiseDefect projectId={id} onClose={() => setRaising(false)} onDone={() => { setRaising(false); changed('Defect raised.'); }} />;
  const setDefect = async (defectId: string, status: 'fixed' | 'closed') => {
    try { await api(`/api/construction/defects/${enc(defectId)}`, { method: 'PATCH', body: { status } }); changed(status === 'fixed' ? 'Marked fixed.' : 'Closed.'); } catch (e: any) { setErr(e.message); }
  };
  const f = p?.figures;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <BackBar title={p ? p.name : 'Project'} onBack={onBack} />
      {p && <Text style={[s.muted, { marginBottom: 10 }]}>{[p.code, p.site, PHASE[p.phase]].filter(Boolean).join(' · ')}</Text>}
      <Segmented value={tab} onChange={setTab} items={[['overview', 'Overview'], ['orders', 'Orders'], ['site', 'Site'], ['drawings', 'Drawings']]} />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      {!p ? (err ? null : <Loading />) : tab === 'overview' ? (
        <Stats>
          <Stat label="Jobs done" value={`${p.counts.jobsDone} of ${p.counts.jobs}`} foot="From Tasks" />
          <Stat label="Open defects" value={String(p.counts.openDefects)} tone={p.counts.openDefects ? 'danger' : undefined} />
          <Stat label="Orders" value={String(p.counts.orders)} foot={p.counts.ordersWaiting ? `${p.counts.ordersWaiting} waiting for approval` : 'None waiting'} />
          <Stat label="Milestones" value={String(p.counts.milestones)} foot={p.counts.milestonesOverdue ? `${p.counts.milestonesOverdue} overdue` : 'None overdue'} tone={p.counts.milestonesOverdue ? 'danger' : undefined} />
          {f && <Stat label="Budget (BOQ)" value={inr(f.budgetPaise)} />}
          {f && <Stat label="Committed" value={inr(f.committedPaise)} foot={f.overBudget ? 'Over budget' : 'Approved orders, before tax'} tone={f.overBudget ? 'danger' : undefined} />}
          {f && <Stat label="Billed" value={inr(f.billedPaise)} foot={`${inr(f.paidPaise)} paid`} />}
          {f && <Stat label="Retention held" value={inr(f.retentionHeldPaise)} />}
        </Stats>
      ) : tab === 'orders' ? (
        !orders?.length ? <Text style={s.muted}>No orders yet. Orders are raised on the desk.</Text> : orders.map((o) => {
          const r = reqs.find((x) => x.entityId === o.id);
          return (
            <Pressable key={o.id} accessibilityRole="button" onPress={() => setOrder(o.id)} style={s.card}>
              <View style={s.row}><Text style={[s.text, { fontWeight: '700' }]}>{o.poNo}</Text><Text style={s.text}>{money(o.totalPaise)}</Text></View>
              <Text style={s.muted}>{o.vendorName} · {o.kind === 'work' ? 'Work order' : 'Purchase order'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                <Badge tone={PO[o.status][1]} label={PO[o.status][0]} />
                {OPEN.includes(o.status) && <Badge label={`${o.progress.receivedPct}% done`} />}
                {r && boss && <Badge tone="warn" label="Waiting on you" />}
              </View>
            </Pressable>);
        })
      ) : tab === 'site' ? (
        <>
          <Text style={[s.text, { fontWeight: '700', marginTop: 6 }]}>Today's site report</Text>
          <Text style={[s.muted, { marginBottom: 6 }]}>The same report as Tasks › Site report, where notes are written.</Text>
          {site && (
            <View style={s.card}>
              {site.report.notes.length ? site.report.notes.map((n) => (
                <Text key={n.id} style={[s.text, { marginBottom: 4 }]}>{n.authorName ?? 'Team'}{n.workers !== null ? ` · ${n.workers} working` : ''}: {n.body}{n.issues ? ` Problems: ${n.issues}` : ''}</Text>
              )) : <Text style={s.muted}>No notes yet today.</Text>}
              <Text style={s.muted}>{site.report.done.length} job{site.report.done.length === 1 ? '' : 's'} finished, {site.report.proofPhotos} proof photo{site.report.proofPhotos === 1 ? '' : 's'}, {site.report.overdue.length} overdue</Text>
            </View>
          )}
          <Text style={[s.text, { fontWeight: '700', marginTop: 12 }]}>Defects</Text>
          {p.canManage && <Btn label="Raise a defect" onPress={() => setRaising(true)} />}
          {!site?.defects.length ? <Text style={s.muted}>No defects.</Text> : site.defects.map((d) => (
            <View key={d.id} style={s.card}>
              <Text style={[s.text, { fontWeight: '700' }]}>{d.title}</Text>
              <Text style={s.muted}>{[d.location, d.vendorName].filter(Boolean).join(' · ') || 'No location given'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <Badge tone={d.severity === 'minor' ? 'muted' : d.severity === 'major' ? 'warn' : 'danger'} label={d.severity === 'minor' ? 'Minor' : d.severity === 'major' ? 'Major' : 'Critical'} />
                <Badge tone={d.status === 'closed' ? 'ok' : d.status === 'fixed' ? 'gold' : 'warn'} label={d.status === 'open' ? 'Open' : d.status === 'fixed' ? 'Fixed' : 'Closed'} />
                {p.canManage && d.status === 'open' && <Chip label="Mark fixed" onPress={() => void setDefect(d.id, 'fixed')} />}
                {p.canManage && d.status !== 'closed' && <Chip label="Close" onPress={() => void setDefect(d.id, 'closed')} />}
              </View>
            </View>))}
          <Text style={[s.text, { fontWeight: '700', marginTop: 12 }]}>Jobs</Text>
          <Text style={[s.muted, { marginBottom: 6 }]}>Closed on Tasks with camera proof.</Text>
          {!site?.jobs.length ? <Text style={s.muted}>No jobs on this project yet.</Text> : site.jobs.map((j) => (
            <View key={j.id} style={[s.card, s.row]}><Text style={[s.text, { flex: 1 }]}>{j.title}</Text><Badge tone={j.status === 'done' ? 'ok' : j.overdue ? 'danger' : 'muted'} label={j.status === 'done' ? 'Done' : j.overdue ? 'Overdue' : j.assignedName ?? 'Open'} /></View>))}
        </>
      ) : (
        !docs?.filter((d) => d.current).length ? <Text style={s.muted}>No drawings or documents on this project yet. Add them on the desk.</Text> : docs.filter((d) => d.current).map((d) => (
          <View key={d.id} style={s.card}>
            <Text style={[s.text, { fontWeight: '700' }]}>{d.kind === 'drawing' && d.drawingNo ? `${d.drawingNo}${d.revision ? ` rev ${d.revision}` : ''}` : d.title}</Text>
            {d.kind === 'drawing' && <Text style={s.muted}>{d.title}</Text>}
            <Text style={s.muted}>Current {d.kind}. Open it on the desk to download.</Text>
          </View>))
      )}
    </ScrollView>
  );
}

/** One order: its lines, and receiving goods or recording measured work. The owner can sign or send back an order waiting on them. */
function OrderView({ id, req, onBack }: { id: string; req: Req | null; onBack: () => void }) {
  const [ctx, setCtx] = useState<OrderCtx | null>(null);
  const [mode, setMode] = useState<null | 'receive' | 'measure' | 'sign' | 'back'>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const load = useCallback(async () => {
    try { setCtx(await api(`/api/construction/orders/${enc(id)}`)); setErr(''); } catch (e: any) { setErr(e.message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const done = (m: string) => { setMode(null); setNote(m); void load(); };
  if (ctx && mode === 'receive') return <Receive ctx={ctx} onClose={() => setMode(null)} onDone={() => done('Goods received.')} />;
  if (ctx && mode === 'measure') return <Measure ctx={ctx} onClose={() => setMode(null)} onDone={() => done('Measurement saved.')} />;
  if (ctx && req && (mode === 'sign' || mode === 'back')) return <Decide o={ctx.order} req={req} back={mode === 'back'} onClose={() => setMode(null)} onDone={(m) => { done(m); }} />;
  const o = ctx?.order;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <BackBar title={o ? o.poNo : 'Order'} onBack={onBack} />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      {!ctx || !o ? (err ? null : <Loading />) : (
        <>
          <Text style={s.muted}>{o.vendorName} · {o.kind === 'work' ? 'Work order' : 'Purchase order'} · {money(o.totalPaise)}</Text>
          <View style={{ flexDirection: 'row', marginVertical: 8 }}><Badge tone={PO[o.status][1]} label={PO[o.status][0]} /></View>
          {req && <><Btn label="Sign this order" onPress={() => setMode('sign')} /><Btn kind="outline" label="Send back" onPress={() => setMode('back')} /></>}
          {ctx.canManage && OPEN.includes(o.status) && (o.kind === 'supply' ? <Btn label="Receive goods" onPress={() => setMode('receive')} /> : <Btn label="Record measured work" onPress={() => setMode('measure')} />)}
          {ctx.lines.map((l) => (
            <View key={l.id} style={s.card}>
              <Text style={[s.text, { fontWeight: '700' }]}>{l.description}</Text>
              <Text style={s.muted}>{o.kind === 'supply' ? `Ordered ${l.quantity} ${l.unit} · received ${l.receivedQty} · still to come ${l.toComeQty}` : `Ordered ${l.quantity} ${l.unit} · measured ${l.measuredQty}`}</Text>
            </View>))}
          {o.kind === 'supply' ? ctx.receipts.map((g) => <Text key={g.id} style={s.muted}>{g.grnNo} · {niceDate(g.date)}{g.byName ? ` · ${g.byName}` : ''}</Text>)
            : ctx.measurements.filter((m) => m.status !== 'superseded').map((m) => <Text key={m.id} style={s.muted}>{niceDate(m.date)} · {m.quantity} {m.unit}{m.location ? ` · ${m.location}` : ''} · {m.status}</Text>)}
        </>
      )}
    </ScrollView>
  );
}

function Receive({ ctx, onClose, onDone }: { ctx: OrderCtx; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, { got: string; rejected: string; reason: string }>>({});
  const [date, setDate] = useState(todayIST());
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [idem] = useState(key);
  const set = (lineId: string, k: 'got' | 'rejected' | 'reason', v: string) => setQty({ ...qty, [lineId]: { ...(qty[lineId] ?? { got: '', rejected: '', reason: '' }), [k]: v } });
  const save = async () => {
    const lines = Object.entries(qty).filter(([, v]) => v.got.trim()).map(([lineId, v]) => ({ lineId, receivedQty: v.got.trim(), rejectedQty: v.rejected.trim() || undefined, rejectionReason: v.reason.trim() || undefined }));
    if (!lines.length) return setErr('Type what arrived on at least one line.');
    setBusy(true);
    try { await api(`/api/construction/orders/${enc(ctx.order.id)}/receipts`, { method: 'POST', body: { date, lines }, headers: { 'Idempotency-Key': idem } }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <BackBar title={`Receive goods · ${ctx.order.poNo}`} onBack={onClose} />
      <DateField label="Day received" value={date} onChange={setDate} />
      {ctx.lines.filter((l) => Number(l.toComeQty) > 0).map((l) => (
        <View key={l.id} style={s.card}>
          <Text style={[s.text, { fontWeight: '700' }]}>{l.description}</Text>
          <Text style={[s.muted, { marginBottom: 6 }]}>Still to come: {l.toComeQty} {l.unit}</Text>
          <Field label={`Arrived (${l.unit})`} value={qty[l.id]?.got ?? ''} onChangeText={(v) => set(l.id, 'got', v)} keyboardType="decimal-pad" />
          <Field label="Of those, turned away" value={qty[l.id]?.rejected ?? ''} onChangeText={(v) => set(l.id, 'rejected', v)} keyboardType="decimal-pad" />
          {!!qty[l.id]?.rejected?.trim() && <Field label="Why turned away" value={qty[l.id]?.reason ?? ''} onChangeText={(v) => set(l.id, 'reason', v)} maxLength={200} />}
        </View>))}
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Save what arrived" busy={busy} onPress={save} />
    </ScrollView>
  );
}

function Measure({ ctx, onClose, onDone }: { ctx: OrderCtx; onClose: () => void; onDone: () => void }) {
  const [lineId, setLineId] = useState(ctx.lines[0]?.id ?? '');
  const [quantity, setQuantity] = useState(''); const [location, setLocation] = useState('');
  const [date, setDate] = useState(todayIST());
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [idem] = useState(key);
  const save = async () => {
    if (!lineId) return setErr('Pick the work that was measured.');
    if (!quantity.trim()) return setErr('Type the quantity measured.');
    setBusy(true);
    try { await api(`/api/construction/orders/${enc(ctx.order.id)}/measurements`, { method: 'POST', body: { lineId, quantity: quantity.trim(), date, location: location.trim() || undefined }, headers: { 'Idempotency-Key': idem } }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <BackBar title={`Measured work · ${ctx.order.poNo}`} onBack={onClose} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{ctx.lines.map((l) => <Chip key={l.id} label={l.description} on={lineId === l.id} onPress={() => setLineId(l.id)} />)}</View>
      <Field label={`Quantity (${ctx.lines.find((l) => l.id === lineId)?.unit ?? ''})`} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
      <Field label="Where (optional)" value={location} onChangeText={setLocation} maxLength={120} />
      <DateField label="Day measured" value={date} onChange={setDate} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Save the measurement" busy={busy} onPress={save} />
    </ScrollView>
  );
}

function RaiseDefect({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(''); const [location, setLocation] = useState('');
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('minor');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (title.trim().length < 3) return setErr('Say what is wrong.');
    setBusy(true);
    try { await api(`/api/construction/projects/${enc(projectId)}/defects`, { method: 'POST', body: { title: title.trim(), location: location.trim() || undefined, severity } }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <BackBar title="Raise a defect" onBack={onClose} />
      <Field label="What is wrong" value={title} onChangeText={setTitle} maxLength={200} />
      <Field label="Where (optional)" value={location} onChangeText={setLocation} maxLength={120} />
      <Segmented value={severity} onChange={setSeverity} items={[['minor', 'Minor'], ['major', 'Major'], ['critical', 'Critical']]} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Raise the defect" busy={busy} onPress={save} />
    </ScrollView>
  );
}

/** Sign or send back one order: the same step as the Approvals board (routes/approvals.ts), so the same rules apply. */
function Decide({ o, req, back, onClose, onDone }: { o: Order; req: Req; back: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!req.canSign) return setErr(req.whyNot ?? 'You cannot sign this.');
    if (back && note.trim().length < 3) return setErr('Say why it goes back.');
    setBusy(true);
    try { await api(`/api/accounting/approvals/requests/${enc(req.id)}/${back ? 'send-back' : 'approve'}`, { method: 'POST', body: note.trim() ? { note: note.trim() } : {} }); onDone(back ? 'Sent back.' : 'Signed.'); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <BackBar title={back ? 'Send back this order' : 'Sign this order'} onBack={onClose} />
      <View style={s.card}><Text style={[s.text, { fontWeight: '700' }]}>{o.poNo} · {money(o.totalPaise)}</Text><Text style={s.muted}>{o.vendorName}</Text></View>
      <Field label={back ? 'Why it goes back' : 'Note (optional)'} value={note} onChangeText={setNote} maxLength={300} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label={back ? 'Send back' : 'Sign'} busy={busy} onPress={go} />
    </ScrollView>
  );
}
