// Construction (construction.ts, redesign step 8): the portfolio of construction projects, and for each project the workspace
// Overview · Plan · Commercial · Site · Plans & Documents · Finance. A construction project is the task board's own project, so
// its jobs and milestones are the ones on Work › Tasks. Orders are approved on the Approvals board, and supplier bills land in
// Revenue & Accounting › Bills, so nothing is entered twice. People who may not see money get quantities without amounts.
import { useState } from 'react';
import { download, go, inr, post, patch, sendFile, toPaise, todayISO, fmtDay, useApi } from '../lib';
import { useSession } from '../App';
import { Chip, DateInput, Field, Load, Modal, PageHead, Stat, Table, Tabs, useToast, type Tone } from '../ui';
import { Panel, SectionTabs, errText, sectionOf } from '../parts/admin/common';
import { SiteReportDialog } from '../parts/club/TaskWork';

type Phase = 'planning' | 'active' | 'on_hold' | 'completed';
interface Figures { budgetPaise: number; committedPaise: number; receivedPaise: number; measuredPaise: number; billedPaise: number; approvedBillsPaise: number; paidPaise: number; outstandingPaise: number; retentionHeldPaise: number; remainingBudgetPaise: number; overBudget: boolean }
interface Project {
  id: string; name: string; details: string | null; code: string; site: string | null; phase: Phase; startDate: string | null; targetEndDate: string | null; areaName: string | null; retentionPct: number; archived: boolean;
  counts: { boqItems: number; orders: number; ordersWaiting: number; openDefects: number; drawings: number; jobs: number; jobsDone: number; milestones: number; milestonesOverdue: number };
  figures: Figures | null; canManage?: boolean; keepsBooks?: boolean;
}
interface Portfolio { items: Project[]; canManage: boolean; seesMoney: boolean; candidates: { id: string; name: string; areaName: string | null }[]; totals: Figures | null }
type PoStatus = 'draft' | 'pending_approval' | 'approved' | 'partly_received' | 'received' | 'closed' | 'cancelled';
interface Order { id: string; poNo: string; kind: 'supply' | 'work'; status: PoStatus; vendorName: string; subtotalPaise: number | null; totalPaise: number | null; retentionPct: number; expectedDate: string | null; decidedNote: string | null; cancelledReason: string | null; createdByName: string | null; progress: { receivedPaise: number | null; measuredPaise: number | null; billedPaise: number | null; paidPaise: number | null; receivedPct: number } }
interface Line { id: string; boqItemCode: string | null; description: string; unit: string; quantity: string; ratePaise: number | null; taxPct: number; amountPaise: number | null; receivedQty: string; rejectedQty: string; toComeQty: string; measuredQty: string }
interface Meas { id: string; lineId: string; description: string; unit: string; date: string; quantity: string; location: string | null; notes: string | null; revision: number; status: 'draft' | 'billed' | 'certified' | 'superseded'; amountPaise: number | null; byName: string | null }
interface Ra { id: string; billNo: string; status: 'draft' | 'certified' | 'cancelled'; version: number; grossPaise: number | null; taxPaise: number | null; retentionPaise: number | null; netPaise: number | null; measurementIds: string[]; certifiedByName: string | null }
interface OrderCtx { order: Order; lines: Line[]; receipts: { id: string; grnNo: string; date: string; note: string | null; byName: string | null; lines: { description: string; received: string; rejected: string; reason: string | null }[] }[]; measurements: Meas[]; raBills: Ra[]; bills: { id: string; billNo: string | null; date: string; amountPaise: number; status: string; fromRaBill: boolean }[] | null; explain: string[] | null; canManage: boolean; keepsBooks: boolean }

const PHASE: Record<Phase, [Tone, string]> = { planning: ['info', 'Planning'], active: ['good', 'Under way'], on_hold: ['warn', 'On hold'], completed: ['mute', 'Completed'] };
const PO: Record<PoStatus, [Tone, string]> = { draft: ['mute', 'Draft'], pending_approval: ['warn', 'Waiting for approval'], approved: ['info', 'Approved'], partly_received: ['info', 'Part done'], received: ['good', 'Complete'], closed: ['mute', 'Closed'], cancelled: ['bad', 'Cancelled'] };
const TABS: [string, string][] = [['overview', 'Overview'], ['plan', 'Plan'], ['commercial', 'Commercial'], ['site', 'Site'], ['documents', 'Plans & Documents'], ['finance', 'Finance']];
const money = (p: number | null | undefined) => (p == null ? 'Restricted' : inr(p));
const enc = encodeURIComponent;

export default function Construction({ sub }: { sub: string }) {
  const id = sub.replace(/^\//, '').split('/')[0] ?? '';
  return id ? <Workspace id={id} sub={sub.replace(/^\/?[^/]+/, '')} /> : <PortfolioView />;
}

function PortfolioView() {
  const { ownerId } = useSession();
  const [data, err, reload, status] = useApi<Portfolio>('/api/construction', [ownerId]);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead eyebrow="Construction" title="Portfolio" lede="Every construction project you can see. A project here is the same project as on Work › Tasks, with its BOQ, orders, site and money added.">
        {data?.canManage && <button className="btn primary" onClick={() => setAdding(true)}>Start a construction project</button>}
      </PageHead>
      <Load data={data} error={err} status={status} retry={reload} isEmpty={(d) => !d.items.length} empty={data?.canManage ? 'No construction projects yet. Start one from an existing project or a new one.' : 'No construction projects you can see.'}>
        {(d) => (
          <div className="stack">
            {d.totals && (
              <div className="grid g4">
                <Stat label="Budget (BOQ)" value={inr(d.totals.budgetPaise)} foot={`${d.items.length} project${d.items.length === 1 ? '' : 's'}`} />
                <Stat label="Committed" value={inr(d.totals.committedPaise)} foot={d.totals.overBudget ? 'A project is over its budget' : 'Approved orders, before tax'} meter={d.totals.budgetPaise ? (d.totals.committedPaise * 100) / d.totals.budgetPaise : undefined} />
                <Stat label="Billed" value={inr(d.totals.billedPaise)} foot={`${inr(d.totals.paidPaise)} paid`} />
                <Stat label="Retention held" value={inr(d.totals.retentionHeldPaise)} foot="On certified RA bills" />
              </div>)}
            <Panel title="Projects" note={d.seesMoney ? undefined : 'Amounts are not shown to you.'}>
              <Table rows={d.items} rowKey={(p) => p.id} onRow={(p) => go(`/construction/${p.id}`)} cols={[
                { head: 'Project', cell: (p) => <span><b>{p.name}</b> <span className="muted small">{p.code}{p.areaName ? ` · ${p.areaName}` : ''}</span></span> },
                { head: 'Phase', cell: (p) => <Chip tone={PHASE[p.phase][0]}>{PHASE[p.phase][1]}</Chip> },
                { head: 'Due', cell: (p) => (p.targetEndDate ? fmtDay(p.targetEndDate) : '—') },
                { head: 'To look at', cell: (p) => <span className="row" style={{ flexWrap: 'wrap', gap: 4 }}>{p.counts.ordersWaiting > 0 && <Chip tone="warn">{p.counts.ordersWaiting} to approve</Chip>}{p.counts.openDefects > 0 && <Chip tone="bad">{p.counts.openDefects} open defect{p.counts.openDefects === 1 ? '' : 's'}</Chip>}{p.counts.milestonesOverdue > 0 && <Chip tone="bad">{p.counts.milestonesOverdue} late milestone{p.counts.milestonesOverdue === 1 ? '' : 's'}</Chip>}{!p.counts.ordersWaiting && !p.counts.openDefects && !p.counts.milestonesOverdue && <Chip tone="good">All clear</Chip>}</span> },
                { head: 'Committed', num: true, cell: (p) => money(p.figures?.committedPaise) },
                { head: 'Budget', num: true, cell: (p) => money(p.figures?.budgetPaise) },
              ]} />
            </Panel>
          </div>)}
      </Load>
      {adding && data && <StartProject candidates={data.candidates} onClose={() => setAdding(false)} onDone={(pid) => { setAdding(false); reload(); go(`/construction/${pid}`); }} />}
    </>
  );
}

function StartProject({ candidates, onClose, onDone }: { candidates: Portfolio['candidates']; onClose: () => void; onDone: (id: string) => void }) {
  const [from, setFrom] = useState(candidates[0]?.id ?? '');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [site, setSite] = useState('');
  const [end, setEnd] = useState('');
  const [retention, setRetention] = useState('5');
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    if (!from && name.trim().length < 2) return setMsg('Pick a project, or name the new one.');
    if (!code.trim()) return setMsg('Give the project a short code, like HOUSE-1.');
    try {
      const p = await post<Project>('/api/construction/projects', { ...(from ? { projectId: from } : { name: name.trim() }), code: code.trim(), site: site.trim() || undefined, targetEndDate: end || undefined, retentionPct: Number(retention) || 0 });
      onDone(p.id);
    } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title="Start a construction project" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Start</button></>}>
      <div className="stack">
        <Field label="Project" hint="Use a project you already run on Work › Tasks, so its jobs and milestones come with it.">
          <select className="inp" value={from} onChange={(e) => setFrom(e.target.value)}>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.areaName ? ` (${c.areaName})` : ''}</option>)}
            <option value="">A new project…</option>
          </select>
        </Field>
        {!from && <Field label="Name of the new project" required><input className="inp" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="House interior" /></Field>}
        <Field label="Code" required hint="Used in order numbers, like PO-HOUSE-1-001."><input className="inp" maxLength={20} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HOUSE-1" /></Field>
        <Field label="Site address"><input className="inp" maxLength={200} value={site} onChange={(e) => setSite(e.target.value)} /></Field>
        <Field label="Target end"><DateInput value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Retention on work orders (%)" hint="Kept back from each RA bill until the work is handed over."><input className="inp" inputMode="decimal" value={retention} onChange={(e) => setRetention(e.target.value)} /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function Workspace({ id, sub }: { id: string; sub: string }) {
  const { ownerId } = useSession();
  const [p, err, reload, status] = useApi<Project>(`/api/construction/projects/${enc(id)}`, [ownerId]);
  const tab = sectionOf(sub, TABS.map(([k]) => k));
  return (
    <>
      <PageHead eyebrow="Construction" title={p ? p.name : 'Project'} lede={p ? <span>{p.code}{p.site ? ` · ${p.site}` : ''}{p.areaName ? ` · ${p.areaName}` : ''} · <Chip tone={PHASE[p.phase][0]}>{PHASE[p.phase][1]}</Chip></span> : undefined}>
        <button className="btn ghost" onClick={() => go('/construction')}>All projects</button>
      </PageHead>
      <Load data={p} error={err} status={status} retry={reload}>
        {(proj) => (
          <div className="stack">
            <SectionTabs base={`/construction/${id}`} sub={sub} items={TABS} />
            {tab === 'overview' && <Overview p={proj} onChanged={reload} />}
            {tab === 'plan' && <PlanTab p={proj} />}
            {tab === 'commercial' && <Commercial p={proj} onChanged={reload} />}
            {tab === 'site' && <SiteTab p={proj} onChanged={reload} />}
            {tab === 'documents' && <DocsTab p={proj} />}
            {tab === 'finance' && <FinanceTab p={proj} />}
          </div>)}
      </Load>
    </>
  );
}

function Overview({ p, onChanged }: { p: Project; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const f = p.figures;
  const setPhase = async (phase: Phase) => { try { await patch(`/api/construction/projects/${enc(p.id)}`, { phase }); onChanged(); } catch (e) { toast(errText(e)); } };
  return (
    <>
      <div className="grid g4">
        <Stat label="Jobs done" value={`${p.counts.jobsDone} of ${p.counts.jobs}`} foot="From Work › Tasks" meter={p.counts.jobs ? (p.counts.jobsDone * 100) / p.counts.jobs : undefined} />
        <Stat label="Milestones" value={p.counts.milestones} foot={p.counts.milestonesOverdue ? `${p.counts.milestonesOverdue} overdue` : 'None overdue'} />
        <Stat label="Orders" value={p.counts.orders} foot={p.counts.ordersWaiting ? `${p.counts.ordersWaiting} waiting for approval` : 'None waiting'} />
        <Stat label="Open defects" value={p.counts.openDefects} foot={p.counts.openDefects ? 'Listed on the Site tab' : 'None open'} />
      </div>
      {f && (
        <div className="grid g4">
          <Stat label="Budget (BOQ)" value={inr(f.budgetPaise)} foot={f.overBudget ? 'Over budget' : `${inr(f.remainingBudgetPaise)} not committed`} />
          <Stat label="Committed" value={inr(f.committedPaise)} meter={f.budgetPaise ? (f.committedPaise * 100) / f.budgetPaise : undefined} foot="Approved orders, before tax" />
          <Stat label="Billed" value={inr(f.billedPaise)} foot={`${inr(f.outstandingPaise)} approved and unpaid`} />
          <Stat label="Paid" value={inr(f.paidPaise)} foot={`Of ${inr(f.billedPaise)} billed`} />
        </div>)}
      <Panel title="Project details" actions={p.canManage ? <button className="btn sm" onClick={() => setEditing(true)}>Change</button> : undefined}>
        <div className="stack">
          <div>{p.details ?? <span className="muted">No description.</span>}</div>
          <div className="small">Start {p.startDate ? fmtDay(p.startDate) : '—'} · Target end {p.targetEndDate ? fmtDay(p.targetEndDate) : '—'} · Retention {p.retentionPct}%</div>
          {p.canManage && <Tabs label="Phase" value={p.phase} onChange={(v) => void setPhase(v)} items={(Object.keys(PHASE) as Phase[]).map((k) => [k, PHASE[k][1]])} />}
          <div className="row"><button className="btn ghost sm" onClick={() => go(`/tasks?project=${enc(p.id)}`)}>Open the jobs on Work › Tasks</button></div>
        </div>
      </Panel>
      {editing && <EditDetails p={p} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChanged(); }} />}
    </>
  );
}

function EditDetails({ p, onClose, onDone }: { p: Project; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ code: p.code, site: p.site ?? '', startDate: p.startDate ?? '', targetEndDate: p.targetEndDate ?? '', retentionPct: String(p.retentionPct) });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  async function save() {
    try { await patch(`/api/construction/projects/${enc(p.id)}`, { code: v.code, site: v.site || null, startDate: v.startDate || null, targetEndDate: v.targetEndDate || null, retentionPct: Number(v.retentionPct) || 0 }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title="Project details" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="stack">
        <Field label="Code"><input className="inp" value={v.code} onChange={set('code')} /></Field>
        <Field label="Site address"><input className="inp" value={v.site} onChange={set('site')} /></Field>
        <Field label="Start"><DateInput value={v.startDate} onChange={set('startDate')} /></Field>
        <Field label="Target end"><DateInput value={v.targetEndDate} onChange={set('targetEndDate')} /></Field>
        <Field label="Retention on new work orders (%)"><input className="inp" inputMode="decimal" value={v.retentionPct} onChange={set('retentionPct')} /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

interface Boq { id: string; itemCode: string; description: string; unit: string; quantity: string; ratePaise: number | null; amountPaise: number | null; revision: number; orderedQty: string }
function PlanTab({ p }: { p: Project }) {
  const [data, err, reload, status] = useApi<{ boq: Boq[]; boqTotalPaise: number | null; milestones: { id: string; title: string; dueDate: string | null; done: boolean; overdue: boolean; jobs: number; jobsDone: number }[] }>(`/api/construction/projects/${enc(p.id)}/plan`);
  const [item, setItem] = useState<Boq | 'new' | null>(null);
  return (
    <Load data={data} error={err} status={status} retry={reload}>
      {(d) => (<div className="stack">
        <Panel title="Bill of quantities" note={d.boqTotalPaise != null ? `Total ${inr(d.boqTotalPaise)} before tax. A change makes a new revision; the earlier one stays on file.` : 'Amounts are not shown to you.'}
          actions={p.canManage && d.boqTotalPaise != null ? <button className="btn primary sm" onClick={() => setItem('new')}>Add an item</button> : undefined}>
          <Table rows={d.boq} rowKey={(b) => b.id} empty="No BOQ items yet." onRow={p.canManage && d.boqTotalPaise != null ? (b) => setItem(b) : undefined} cols={[
            { head: 'Item', cell: (b) => <span><b>{b.itemCode}</b> {b.description}{b.revision > 1 && <span className="muted small"> · rev {b.revision}</span>}</span> },
            { head: 'Quantity', num: true, cell: (b) => `${b.quantity} ${b.unit}` },
            { head: 'Ordered', num: true, cell: (b) => `${b.orderedQty} ${b.unit}` },
            { head: 'Rate', num: true, cell: (b) => money(b.ratePaise) },
            { head: 'Amount', num: true, cell: (b) => money(b.amountPaise) },
          ]} />
        </Panel>
        <Panel title="Milestones" note="Milestones and their jobs are kept on Work › Tasks.">
          <Table rows={d.milestones} rowKey={(m) => m.id} empty="No milestones yet. Add them on Work › Tasks." cols={[
            { head: 'Milestone', cell: (m) => <b>{m.title}</b> },
            { head: 'Due', cell: (m) => (m.dueDate ? fmtDay(m.dueDate) : '—') },
            { head: 'Jobs', num: true, cell: (m) => `${m.jobsDone} of ${m.jobs}` },
            { head: 'State', cell: (m) => (m.done ? <Chip tone="good">Done</Chip> : m.overdue ? <Chip tone="bad">Overdue</Chip> : <Chip>Open</Chip>) },
          ]} />
        </Panel>
        {item && <BoqForm projectId={p.id} item={item === 'new' ? null : item} onClose={() => setItem(null)} onDone={() => { setItem(null); reload(); }} />}
      </div>)}
    </Load>
  );
}

function BoqForm({ projectId, item, onClose, onDone }: { projectId: string; item: Boq | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ itemCode: item?.itemCode ?? '', description: item?.description ?? '', unit: item?.unit ?? '', quantity: item?.quantity ?? '', rate: item?.ratePaise != null ? String(item.ratePaise / 100) : '' });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  async function save() {
    const rate = toPaise(v.rate);
    if (rate == null) return setMsg('Type the rate in rupees.');
    const body = { description: v.description, unit: v.unit, quantity: v.quantity, ratePaise: rate };
    try { if (item) await patch(`/api/construction/boq/${enc(item.id)}`, body); else await post(`/api/construction/projects/${enc(projectId)}/boq`, { ...body, itemCode: v.itemCode }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title={item ? `Change ${item.itemCode}` : 'Add a BOQ item'} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{item ? 'Save as a new revision' : 'Add'}</button></>}>
      <div className="stack">
        {!item && <Field label="Item code" required><input className="inp" maxLength={20} value={v.itemCode} onChange={set('itemCode')} placeholder="C-01" /></Field>}
        <Field label="Description" required><input className="inp" maxLength={300} value={v.description} onChange={set('description')} /></Field>
        <Field label="Unit" required><input className="inp" maxLength={12} value={v.unit} onChange={set('unit')} placeholder="bag, sqm, kg" /></Field>
        <Field label="Quantity" required><input className="inp" inputMode="decimal" value={v.quantity} onChange={set('quantity')} /></Field>
        <Field label="Rate (₹)" required><input className="inp" inputMode="decimal" value={v.rate} onChange={set('rate')} /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function Commercial({ p, onChanged }: { p: Project; onChanged: () => void }) {
  const [filter, setFilter] = useState('');
  const [data, err, reload, status] = useApi<{ items: Order[] }>(`/api/construction/projects/${enc(p.id)}/orders${filter ? `?status=${filter}` : ''}`, [filter]);
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const changed = () => { reload(); onChanged(); };
  return (
    <Panel title="Orders" note="Purchase orders for goods, work orders for measured work. Each is approved on the Approvals board; supplier bills go to Revenue & Accounting › Bills."
      actions={p.canManage && p.figures ? <button className="btn primary sm" onClick={() => setMaking(true)}>New order</button> : undefined}>
      <div className="stack">
        <Tabs label="Show" value={filter} onChange={setFilter} items={[['', 'All'], ['pending_approval', 'Waiting'], ['approved,partly_received', 'Open'], ['received,closed', 'Done'], ['draft', 'Drafts']]} />
        <Load data={data} error={err} status={status} retry={reload}>
          {(d) => <Table rows={d.items} rowKey={(o) => o.id} onRow={(o) => setOpen(o.id)} empty="No orders here." cols={[
            { head: 'Order', cell: (o) => <span><b>{o.poNo}</b> <span className="muted small">{o.kind === 'work' ? 'Work order' : 'Purchase order'}</span></span> },
            { head: 'Supplier', cell: (o) => o.vendorName },
            { head: 'State', cell: (o) => <Chip tone={PO[o.status][0]}>{PO[o.status][1]}</Chip> },
            { head: 'Done', num: true, cell: (o) => `${o.progress.receivedPct}%` },
            { head: 'Total, with tax', num: true, cell: (o) => money(o.totalPaise) },
          ]} />}
        </Load>
      </div>
      {open && <OrderDrawer id={open} onClose={() => setOpen(null)} onChanged={changed} />}
      {making && <NewOrder projectId={p.id} onClose={() => setMaking(false)} onDone={(oid) => { setMaking(false); changed(); setOpen(oid); }} />}
    </Panel>
  );
}

interface DraftLine { boqItemId: string; description: string; unit: string; quantity: string; rate: string; taxPct: string }
function NewOrder({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: (id: string) => void }) {
  const [vendors] = useApi<{ items: { id: string; name: string }[] }>('/api/accounting/vendors');
  const [plan] = useApi<{ boq: Boq[] }>(`/api/construction/projects/${enc(projectId)}/plan`);
  const [kind, setKind] = useState<'supply' | 'work'>('supply');
  const [vendorId, setVendorId] = useState('');
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ boqItemId: '', description: '', unit: '', quantity: '', rate: '', taxPct: '18' }]);
  const [msg, setMsg] = useState<string | null>(null);
  const setLine = (i: number, k: keyof DraftLine, val: string) => setLines(lines.map((l, j) => {
    if (j !== i) return l;
    const b = k === 'boqItemId' ? plan?.boq.find((x) => x.id === val) : undefined;
    return { ...l, [k]: val, ...(b ? { description: b.description, unit: b.unit, rate: b.ratePaise != null ? String(b.ratePaise / 100) : l.rate } : {}) };
  }));
  async function save() {
    if (!vendorId) return setMsg('Pick the supplier.');
    const out = [];
    for (const [i, l] of lines.entries()) {
      const rate = toPaise(l.rate);
      if (!l.description.trim() || !l.unit.trim() || !l.quantity.trim() || rate == null) return setMsg(`Line ${i + 1}: fill in what, unit, quantity and rate.`);
      out.push({ boqItemId: l.boqItemId || undefined, description: l.description.trim(), unit: l.unit.trim(), quantity: l.quantity.trim(), ratePaise: rate, taxPct: Number(l.taxPct) || 0 });
    }
    try { const o = await post<Order>(`/api/construction/projects/${enc(projectId)}/orders`, { vendorId, kind, expectedDate: expected || undefined, lines: out }); onDone(o.id); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal wide title="New order" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save as draft</button></>}>
      <div className="stack">
        <Tabs label="Kind" value={kind} onChange={setKind} items={[['supply', 'Purchase order (goods)'], ['work', 'Work order (measured)']]} />
        <Field label="Supplier" required hint="Suppliers are the vendors in Revenue & Accounting › Bills.">
          <select className="inp" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Pick a supplier</option>{vendors?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        </Field>
        <Field label="Expected by"><DateInput value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        {lines.map((l, i) => (
          <div key={i} className="card card-pad stack">
            <div className="row" style={{ justifyContent: 'space-between' }}><b>Line {i + 1}</b>{lines.length > 1 && <button className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>}</div>
            <Field label="BOQ item"><select className="inp" value={l.boqItemId} onChange={(e) => setLine(i, 'boqItemId', e.target.value)}><option value="">Not on the BOQ</option>{plan?.boq.map((b) => <option key={b.id} value={b.id}>{b.itemCode} {b.description}</option>)}</select></Field>
            <Field label="What"><input className="inp" maxLength={300} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></Field>
            <div className="grid g4">
              <Field label="Unit"><input className="inp" maxLength={12} value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} /></Field>
              <Field label="Quantity"><input className="inp" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></Field>
              <Field label="Rate (₹)"><input className="inp" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, 'rate', e.target.value)} /></Field>
              <Field label="GST (%)"><input className="inp" inputMode="decimal" value={l.taxPct} onChange={(e) => setLine(i, 'taxPct', e.target.value)} /></Field>
            </div>
          </div>))}
        <div><button className="btn sm" onClick={() => setLines([...lines, { boqItemId: '', description: '', unit: '', quantity: '', rate: '', taxPct: '18' }])}>Add a line</button></div>
        <p className="hint">Totals are worked out by Daji from the lines, to the paisa.</p>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function OrderDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [data, err, reload, status] = useApi<OrderCtx>(`/api/construction/orders/${enc(id)}`);
  const [form, setForm] = useState<null | 'receive' | 'measure' | 'bill' | 'ra' | 'cancel' | 'close'>(null);
  const done = () => { setForm(null); reload(); onChanged(); };
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); reload(); onChanged(); } catch (e) { toast(errText(e)); } };
  return (
    <Modal wide title={data ? `${data.order.poNo} · ${data.order.vendorName}` : 'Order'} onClose={onClose}>
      <Load data={data} error={err} status={status} retry={reload}>
        {(d) => {
          const o = d.order, open = o.status === 'approved' || o.status === 'partly_received';
          return (
            <div className="stack">
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <Chip tone={PO[o.status][0]}>{PO[o.status][1]}</Chip>
                <span className="small muted">{o.kind === 'work' ? 'Work order' : 'Purchase order'} · raised by {o.createdByName ?? '—'}{o.expectedDate ? ` · expected ${fmtDay(o.expectedDate)}` : ''}{o.kind === 'work' ? ` · retention ${o.retentionPct}%` : ''}</span>
              </div>
              {o.decidedNote && <p className="hint">“{o.decidedNote}”</p>}
              {o.cancelledReason && <p className="hint">Cancelled: {o.cancelledReason}</p>}
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {d.canManage && o.status === 'draft' && <button className="btn primary sm" onClick={() => act(() => post(`/api/construction/orders/${enc(o.id)}/submit`), 'Sent for approval')}>Send for approval</button>}
                {o.status === 'pending_approval' && <button className="btn sm" onClick={() => go('/approvals')}>Open the Approvals board</button>}
                {d.canManage && open && o.kind === 'supply' && <button className="btn primary sm" onClick={() => setForm('receive')}>Record goods received</button>}
                {d.canManage && open && o.kind === 'work' && <button className="btn primary sm" onClick={() => setForm('measure')}>Record a measurement</button>}
                {d.keepsBooks && o.kind === 'supply' && ['approved', 'partly_received', 'received', 'closed'].includes(o.status) && <button className="btn sm" onClick={() => setForm('bill')}>Enter the supplier's bill</button>}
                {d.keepsBooks && o.kind === 'work' && d.measurements.some((m) => m.status === 'draft') && <button className="btn sm" onClick={() => setForm('ra')}>Make an RA bill</button>}
                {d.canManage && ['draft', 'pending_approval', 'approved'].includes(o.status) && <button className="btn ghost sm" onClick={() => setForm('cancel')}>Cancel the order</button>}
                {d.canManage && ['approved', 'partly_received', 'received'].includes(o.status) && <button className="btn ghost sm" onClick={() => setForm('close')}>Close the order</button>}
              </div>
              <Table rows={d.lines} rowKey={(l) => l.id} cols={[
                { head: 'What', cell: (l) => <span>{l.boqItemCode && <b>{l.boqItemCode} </b>}{l.description}</span> },
                { head: 'Ordered', num: true, cell: (l) => `${l.quantity} ${l.unit}` },
                { head: o.kind === 'work' ? 'Measured' : 'Received', num: true, cell: (l) => (o.kind === 'work' ? `${l.measuredQty} ${l.unit}` : `${l.receivedQty}${l.rejectedQty !== '0' ? ` (${l.rejectedQty} rejected)` : ''} ${l.unit}`) },
                { head: 'Rate', num: true, cell: (l) => money(l.ratePaise) },
                { head: 'Amount', num: true, cell: (l) => money(l.amountPaise) },
              ]} />
              {d.explain && <Panel title="Explain this number">{d.explain.map((x) => <div key={x} className="small">{x}</div>)}</Panel>}
              {d.receipts.length > 0 && <Panel title="Goods received">{d.receipts.map((g) => <div key={g.id} className="small"><b>{g.grnNo}</b> · {fmtDay(g.date)} · {g.byName ?? ''} · {g.lines.map((l) => `${l.description} ${l.received}${l.rejected !== '0' ? ` (${l.rejected} rejected: ${l.reason})` : ''}`).join('; ')}{g.note ? ` · ${g.note}` : ''}</div>)}</Panel>}
              {d.measurements.length > 0 && <Panel title="Measurements">
                <Table rows={d.measurements} rowKey={(m) => m.id} cols={[
                  { head: 'Day', cell: (m) => fmtDay(m.date) },
                  { head: 'What', cell: (m) => <span>{m.description}{m.location ? ` · ${m.location}` : ''}{m.revision > 1 && <span className="muted small"> · rev {m.revision}{m.notes ? `: ${m.notes}` : ''}</span>}</span> },
                  { head: 'Quantity', num: true, cell: (m) => `${m.quantity} ${m.unit}` },
                  { head: 'Amount', num: true, cell: (m) => money(m.amountPaise) },
                  { head: '', cell: (m) => <Chip tone={m.status === 'certified' ? 'good' : m.status === 'superseded' ? 'mute' : m.status === 'billed' ? 'info' : 'warn'}>{m.status === 'draft' ? 'Not billed' : m.status === 'billed' ? 'On an RA bill' : m.status === 'certified' ? 'Certified' : 'Corrected'}</Chip> },
                ]} />
              </Panel>}
              {d.raBills.length > 0 && <Panel title="RA bills">
                <Table rows={d.raBills} rowKey={(b) => b.id} cols={[
                  { head: 'Bill', cell: (b) => <b>{b.billNo}</b> },
                  { head: 'Gross', num: true, cell: (b) => money(b.grossPaise) },
                  { head: 'Retention', num: true, cell: (b) => money(b.retentionPaise) },
                  { head: 'Net', num: true, cell: (b) => money(b.netPaise) },
                  { head: '', cell: (b) => b.status === 'draft' && d.keepsBooks ? <span className="row" style={{ gap: 4 }}>
                    <button className="btn primary sm" onClick={() => act(() => post(`/api/construction/ra-bills/${enc(b.id)}/certify`, { expectedVersion: b.version }), 'Certified and sent to Bills')}>Certify</button>
                    <button className="btn ghost sm" onClick={() => act(() => post(`/api/construction/ra-bills/${enc(b.id)}/cancel`), 'Cancelled')}>Cancel</button></span>
                    : <Chip tone={b.status === 'certified' ? 'good' : 'mute'}>{b.status === 'certified' ? `Certified${b.certifiedByName ? ` by ${b.certifiedByName}` : ''}` : 'Cancelled'}</Chip> },
                ]} />
              </Panel>}
              {d.bills && d.bills.length > 0 && <Panel title="Supplier bills" actions={<button className="btn ghost sm" onClick={() => go('/bills')}>Open in Bills</button>}>
                {d.bills.map((b) => <div key={b.id} className="small"><b>{b.billNo ?? 'Bill'}</b> · {fmtDay(b.date)} · {inr(b.amountPaise)} · {b.status.replace('_', ' ')}{b.fromRaBill ? ' · from an RA bill' : ''}</div>)}
              </Panel>}
              {form === 'receive' && <Receive ctx={d} onClose={() => setForm(null)} onDone={done} />}
              {form === 'measure' && <Measure ctx={d} onClose={() => setForm(null)} onDone={done} />}
              {form === 'bill' && <SupplierBill ctx={d} onClose={() => setForm(null)} onDone={done} />}
              {form === 'ra' && <RaBill ctx={d} onClose={() => setForm(null)} onDone={done} />}
              {(form === 'cancel' || form === 'close') && <Reason title={form === 'cancel' ? 'Cancel the order' : 'Close the order'} onClose={() => setForm(null)} onSave={async (reason) => { await post(`/api/construction/orders/${enc(o.id)}/${form}`, { reason }); done(); }} />}
            </div>);
        }}
      </Load>
    </Modal>
  );
}

function Receive({ ctx, onClose, onDone }: { ctx: OrderCtx; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, { got: string; rejected: string; reason: string }>>({});
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const set = (id: string, k: 'got' | 'rejected' | 'reason', v: string) => setQty({ ...qty, [id]: { ...(qty[id] ?? { got: '', rejected: '', reason: '' }), [k]: v } });
  async function save() {
    const lines = Object.entries(qty).filter(([, v]) => v.got.trim()).map(([lineId, v]) => ({ lineId, receivedQty: v.got.trim(), rejectedQty: v.rejected.trim() || undefined, rejectionReason: v.reason.trim() || undefined }));
    if (!lines.length) return setMsg('Type what arrived on at least one line.');
    try { await post(`/api/construction/orders/${enc(ctx.order.id)}/receipts`, { date, note: note.trim() || undefined, lines }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title="Goods received" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Record</button></>}>
      <div className="stack">
        <Field label="Day"><DateInput value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} /></Field>
        {ctx.lines.map((l) => (
          <div key={l.id} className="card card-pad stack">
            <b>{l.description}</b><span className="small muted">{l.toComeQty} {l.unit} still to come</span>
            <div className="grid g4">
              <Field label="Arrived"><input className="inp" inputMode="decimal" value={qty[l.id]?.got ?? ''} onChange={(e) => set(l.id, 'got', e.target.value)} /></Field>
              <Field label="Rejected"><input className="inp" inputMode="decimal" value={qty[l.id]?.rejected ?? ''} onChange={(e) => set(l.id, 'rejected', e.target.value)} /></Field>
            </div>
            {(qty[l.id]?.rejected ?? '').trim() && <Field label="Why rejected"><input className="inp" maxLength={300} value={qty[l.id]?.reason ?? ''} onChange={(e) => set(l.id, 'reason', e.target.value)} /></Field>}
          </div>))}
        <Field label="Note (challan number, vehicle)"><input className="inp" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function Measure({ ctx, onClose, onDone }: { ctx: OrderCtx; onClose: () => void; onDone: () => void }) {
  const [lineId, setLineId] = useState(ctx.lines[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(todayISO());
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    if (!quantity.trim()) return setMsg('Type the measured quantity.');
    try { await post(`/api/construction/orders/${enc(ctx.order.id)}/measurements`, { lineId, quantity: quantity.trim(), location: location.trim() || undefined, date }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title="Record a measurement" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Record</button></>}>
      <div className="stack">
        <Field label="Line"><select className="inp" value={lineId} onChange={(e) => setLineId(e.target.value)}>{ctx.lines.map((l) => <option key={l.id} value={l.id}>{l.description} ({l.measuredQty} of {l.quantity} {l.unit})</option>)}</select></Field>
        <Field label="Quantity" required><input className="inp" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        <Field label="Where"><input className="inp" maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ground floor, kitchen" /></Field>
        <Field label="Day"><DateInput value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function SupplierBill({ ctx, onClose, onDone }: { ctx: OrderCtx; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ billNo: '', billDate: todayISO(), dueDate: '', amount: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  async function save() {
    const amountPaise = toPaise(v.amount);
    if (!v.billNo.trim() || !amountPaise) return setMsg('Type the bill number and amount.');
    try { await post(`/api/construction/orders/${enc(ctx.order.id)}/bills`, { billNo: v.billNo.trim(), billDate: v.billDate, dueDate: v.dueDate || undefined, amountPaise }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title="Supplier's bill" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Send to Bills</button></>}>
      <div className="stack">
        <p className="hint">The bill goes into Revenue & Accounting › Bills against {ctx.order.vendorName}, linked to {ctx.order.poNo}, and follows your bill approval rules.</p>
        <Field label="Bill number" required><input className="inp" maxLength={60} value={v.billNo} onChange={set('billNo')} /></Field>
        <Field label="Bill date"><DateInput value={v.billDate} onChange={set('billDate')} /></Field>
        <Field label="Due"><DateInput value={v.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Amount with tax (₹)" required><input className="inp" inputMode="decimal" value={v.amount} onChange={set('amount')} /></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function RaBill({ ctx, onClose, onDone }: { ctx: OrderCtx; onClose: () => void; onDone: () => void }) {
  const draft = ctx.measurements.filter((m) => m.status === 'draft');
  const [pick, setPick] = useState<string[]>(draft.map((m) => m.id));
  const [retention, setRetention] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const gross = draft.filter((m) => pick.includes(m.id)).reduce((s, m) => s + (m.amountPaise ?? 0), 0);
  const cap = Math.round((gross * ctx.order.retentionPct) / 100);
  async function save() {
    const r = retention.trim() ? toPaise(retention) : cap;
    try { await post(`/api/construction/orders/${enc(ctx.order.id)}/ra-bills`, { measurementIds: pick, adjustments: r ? [{ type: 'retention', amountPaise: r, description: `${ctx.order.retentionPct}% retention` }] : [] }); onDone(); } catch (e) { setMsg(errText(e)); }
  }
  return (
    <Modal title="Make an RA bill" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Make the bill</button></>}>
      <div className="stack">
        {draft.map((m) => <label key={m.id} className="row" style={{ gap: 8 }}><input type="checkbox" checked={pick.includes(m.id)} onChange={(e) => setPick(e.target.checked ? [...pick, m.id] : pick.filter((x) => x !== m.id))} />{fmtDay(m.date)} · {m.description} · {m.quantity} {m.unit} · {money(m.amountPaise)}</label>)}
        <p className="small">Gross {inr(gross)} before tax. Retention up to {ctx.order.retentionPct}%: {inr(cap)}.</p>
        <Field label="Retention (₹)" hint="Leave empty to keep the full allowed retention."><input className="inp" inputMode="decimal" value={retention} onChange={(e) => setRetention(e.target.value)} /></Field>
        <p className="hint">Certifying the bill makes it final and sends its net amount to Revenue & Accounting › Bills.</p>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function Reason({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => { if (reason.trim().length < 3) return setMsg('Say why.'); try { await onSave(reason.trim()); } catch (e) { setMsg(errText(e)); } };
  return (
    <Modal title={title} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Back</button><button className="btn primary" onClick={save}>{title}</button></>}>
      <div className="stack"><Field label="Reason" required><input className="inp" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{msg && <p className="err-text" role="alert">{msg}</p>}</div>
    </Modal>
  );
}

interface SiteReport { date: string; notes: { id: string; authorName: string | null; workers: number | null; body: string; issues: string | null; corrections: number }[]; done: { id: string; title: string; byName: string | null; proofPhotos: number; signedOff: boolean }[]; started: { id: string; title: string }[]; raised: { id: string; title: string; byName: string | null }[]; overdue: { id: string; title: string; dueDate: string }[]; proofPhotos: number; references: number }
interface SiteData { report: SiteReport; jobs: { id: string; title: string; status: string; assignedName: string | null; dueDate: string | null; overdue: boolean }[]; defects: { id: string; title: string; location: string | null; severity: 'minor' | 'major' | 'critical'; vendorName: string | null; status: 'open' | 'fixed' | 'closed'; raisedByName: string | null }[]; receipts: { id: string; grnNo: string; date: string; poNo: string }[]; subcontractors: { id: string; name: string; orders: number }[] }
function SiteDay({ r }: { r: SiteReport }) {
  const line = (label: string, items: string[]) => (items.length ? <div className="small"><b>{label}:</b> {items.join('; ')}</div> : null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {r.notes.length ? r.notes.map((n) => (
        <div key={n.id} className="small"><b>{n.authorName ?? 'Team'}</b>{n.workers !== null ? ` · ${n.workers} working` : ''}: {n.body}{n.issues ? <span style={{ color: 'var(--i-red)' }}> Problems: {n.issues}</span> : null}{n.corrections ? <span className="muted"> (corrected)</span> : null}</div>
      )) : <p className="hint">No notes for {fmtDay(r.date)} yet.</p>}
      {line('Finished', r.done.map((j) => `${j.title}${j.byName ? ` (${j.byName})` : ''}, ${j.proofPhotos} proof photo${j.proofPhotos === 1 ? '' : 's'}${j.signedOff ? ', signed off' : ''}`))}
      {line('Started', r.started.map((j) => j.title))}
      {line('Requests raised', r.raised.map((j) => `${j.title}${j.byName ? ` (${j.byName})` : ''}`))}
      {line('Overdue', r.overdue.map((j) => j.title))}
      <div className="muted small">{r.proofPhotos} proof photo{r.proofPhotos === 1 ? '' : 's'} taken that day{r.references ? `; ${r.references} reference file${r.references === 1 ? '' : 's'} added (references are not proof)` : ''}.</div>
    </div>
  );
}

function SiteTab({ p, onChanged }: { p: Project; onChanged: () => void }) {
  const toast = useToast();
  const [day, setDay] = useState(todayISO());
  const [data, err, reload, status] = useApi<SiteData>(`/api/construction/projects/${enc(p.id)}/site?date=${day}`);
  const [raising, setRaising] = useState(false);
  const [writing, setWriting] = useState(false);
  const setDefect = async (id: string, s: string) => { try { await patch(`/api/construction/defects/${enc(id)}`, { status: s }); reload(); onChanged(); } catch (e) { toast(errText(e)); } };
  return (
    <Load data={data} error={err} status={status} retry={reload}>
      {(d) => (<div className="stack">
        <Panel title="Daily site report" note="The same report as Work › Tasks: the team's notes for the day and the jobs behind them. Notes written here are filed under this project and the day shown." actions={<span className="row" style={{ gap: 6 }}><DateInput className="inp" style={{ width: 170 }} aria-label="Report day" value={day} max={todayISO()} onChange={(e) => setDay(e.target.value || todayISO())} /><button className="btn ghost sm" onClick={() => setWriting(true)}>Write a note</button></span>}>
          <SiteDay r={d.report} />
        </Panel>
        <Panel title="Jobs" note="The project's jobs on Work › Tasks, closed there with camera proof." actions={<button className="btn ghost sm" onClick={() => go('/tasks')}>Open Tasks</button>}>
          <Table rows={d.jobs} rowKey={(j) => j.id} empty="No jobs on this project yet." cols={[
            { head: 'Job', cell: (j) => <b>{j.title}</b> },
            { head: 'Who', cell: (j) => j.assignedName ?? 'Anyone' },
            { head: 'Due', cell: (j) => (j.dueDate ? fmtDay(j.dueDate) : '—') },
            { head: 'State', cell: (j) => (j.status === 'done' ? <Chip tone="good">Done</Chip> : j.overdue ? <Chip tone="bad">Overdue</Chip> : <Chip>Open</Chip>) },
          ]} />
        </Panel>
        <Panel title="Defects" actions={p.canManage ? <button className="btn primary sm" onClick={() => setRaising(true)}>Raise a defect</button> : undefined}>
          <Table rows={d.defects} rowKey={(x) => x.id} empty="No defects." cols={[
            { head: 'Defect', cell: (x) => <span><b>{x.title}</b>{x.location ? <span className="muted small"> · {x.location}</span> : null}</span> },
            { head: 'Severity', cell: (x) => <Chip tone={x.severity === 'critical' ? 'bad' : x.severity === 'major' ? 'warn' : 'mute'}>{x.severity}</Chip> },
            { head: 'Who fixes', cell: (x) => x.vendorName ?? '—' },
            { head: 'State', cell: (x) => <Chip tone={x.status === 'closed' ? 'good' : x.status === 'fixed' ? 'info' : 'warn'}>{x.status}</Chip> },
            { head: '', cell: (x) => (p.canManage && x.status !== 'closed' ? <span className="row" style={{ gap: 4 }}>{x.status === 'open' && <button className="btn ghost sm" onClick={() => setDefect(x.id, 'fixed')}>Mark fixed</button>}<button className="btn ghost sm" onClick={() => setDefect(x.id, 'closed')}>Close</button></span> : null) },
          ]} />
        </Panel>
        <div className="grid g2">
          <Panel title="Goods received lately">{d.receipts.length ? d.receipts.map((g) => <div key={g.id} className="small"><b>{g.grnNo}</b> · {fmtDay(g.date)} · {g.poNo}</div>) : <p className="hint">Nothing received yet.</p>}</Panel>
          <Panel title="Subcontractors">{d.subcontractors.length ? d.subcontractors.map((s) => <div key={s.id} className="small"><b>{s.name}</b> · {s.orders} work order{s.orders === 1 ? '' : 's'}</div>) : <p className="hint">No work orders yet.</p>}</Panel>
        </div>
        {writing && <SiteReportDialog projects={[]} fixed={{ projectId: p.id, projectName: p.name, date: day }} onClose={() => { setWriting(false); reload(); }} />}
        {raising && <RaiseDefect projectId={p.id} onClose={() => setRaising(false)} onDone={() => { setRaising(false); reload(); onChanged(); }} />}
      </div>)}
    </Load>
  );
}

function RaiseDefect({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ title: '', location: '', severity: 'minor' });
  const [msg, setMsg] = useState<string | null>(null);
  async function save() { try { await post(`/api/construction/projects/${enc(projectId)}/defects`, { title: v.title, location: v.location || undefined, severity: v.severity }); onDone(); } catch (e) { setMsg(errText(e)); } }
  return (
    <Modal title="Raise a defect" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Raise</button></>}>
      <div className="stack">
        <Field label="What is wrong" required><input className="inp" maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Where"><input className="inp" maxLength={120} value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} /></Field>
        <Field label="Severity"><select className="inp" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select></Field>
        {msg && <p className="err-text" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

interface CDoc { docId: string; kind: 'drawing' | 'document'; title: string; drawingNo: string | null; revision: string | null; current: boolean; fileName: string; linkedByName: string | null; linkedAt: number }
function DocsTab({ p }: { p: Project }) {
  const toast = useToast();
  const [data, err, reload, status] = useApi<{ items: CDoc[] }>(`/api/construction/projects/${enc(p.id)}/documents`);
  const [kind, setKind] = useState<'drawing' | 'document'>('drawing');
  const [drawingNo, setDrawingNo] = useState('');
  const [revision, setRevision] = useState('');
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (kind === 'drawing' && !drawingNo.trim()) return toast('Type the drawing number first.');
    const q = new URLSearchParams({ filename: f.name, kind, ...(kind === 'drawing' ? { drawingNo: drawingNo.trim(), revision: revision.trim() } : {}) });
    try { await sendFile(`/api/construction/projects/${enc(p.id)}/documents?${q}`, f, { 'content-type': f.type || 'application/octet-stream' }); toast('Added to the project'); setDrawingNo(''); setRevision(''); reload(); } catch (e) { toast(errText(e)); }
  };
  return (
    <>
      {p.canManage && (
        <Panel title="Add a drawing or document" note="Files go through the virus check into Documents and are put on this project. A new revision of a drawing number becomes the current one; the earlier one stays.">
          <div className="stack">
            <Tabs label="Kind" value={kind} onChange={setKind} items={[['drawing', 'Drawing'], ['document', 'Document']]} />
            {kind === 'drawing' && <div className="grid g2"><Field label="Drawing number"><input className="inp" maxLength={40} value={drawingNo} onChange={(e) => setDrawingNo(e.target.value)} placeholder="A-101" /></Field><Field label="Revision"><input className="inp" maxLength={10} value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="B" /></Field></div>}
            <label className="btn primary sm" style={{ alignSelf: 'flex-start' }}>Choose the file<input type="file" hidden onChange={(e) => void upload(e.target.files?.[0])} /></label>
          </div>
        </Panel>)}
      <Panel title="Plans & Documents">
        <Load data={data} error={err} status={status} retry={reload}>
          {(d) => <Table rows={d.items} rowKey={(x) => x.docId} empty="Nothing on this project yet." cols={[
            { head: 'Drawing or document', cell: (x) => <span><b>{x.drawingNo ? `${x.drawingNo}${x.revision ? ` rev ${x.revision}` : ''} · ` : ''}{x.title}</b>{!x.current && <span className="muted small"> · replaced</span>}</span> },
            { head: 'Kind', cell: (x) => (x.kind === 'drawing' ? 'Drawing' : 'Document') },
            { head: 'Added', cell: (x) => x.linkedByName ?? '—' },
            { head: '', cell: (x) => <button className="btn ghost sm" onClick={() => download(`/api/construction/documents/${enc(x.docId)}/file`, x.fileName).catch((e) => toast(errText(e)))}>Download</button> },
          ]} />}
        </Load>
      </Panel>
    </>
  );
}

function FinanceTab({ p }: { p: Project }) {
  const [data, err, reload, status] = useApi<{ figures: Figures; orders: Order[]; bills: { id: string; billNo: string | null; date: string; amountPaise: number; status: string; vendorName: string; poNo: string | null; raBillNo: string | null }[]; explain: Record<string, string> }>(`/api/construction/projects/${enc(p.id)}/finance`);
  return (
    <Load data={data} error={err} status={status} retry={reload}>
      {(d) => (<div className="stack">
        <div className="grid g4">
          {(['budgetPaise', 'committedPaise', 'receivedPaise', 'measuredPaise', 'billedPaise', 'paidPaise', 'outstandingPaise', 'retentionHeldPaise'] as const).map((k) => (
            <Stat key={k} label={{ budgetPaise: 'Budget (BOQ)', committedPaise: 'Committed', receivedPaise: 'Goods accepted', measuredPaise: 'Work measured', billedPaise: 'Billed', paidPaise: 'Paid', outstandingPaise: 'Approved, unpaid', retentionHeldPaise: 'Retention held' }[k]} value={inr(d.figures[k])} foot={d.explain[k]} />))}
        </div>
        <Panel title="Orders against budget">
          <Table rows={d.orders} rowKey={(o) => o.id} empty="No orders yet." cols={[
            { head: 'Order', cell: (o) => <b>{o.poNo}</b> },
            { head: 'Supplier', cell: (o) => o.vendorName },
            { head: 'Ordered, before tax', num: true, cell: (o) => money(o.subtotalPaise) },
            { head: 'Done', num: true, cell: (o) => money(o.kind === 'work' ? o.progress.measuredPaise : o.progress.receivedPaise) },
            { head: 'Billed, with tax', num: true, cell: (o) => money(o.progress.billedPaise) },
            { head: 'Paid', num: true, cell: (o) => money(o.progress.paidPaise) },
          ]} />
        </Panel>
        <Panel title="Supplier bills" note="Kept in Revenue & Accounting › Bills; approve and pay them there." actions={<button className="btn ghost sm" onClick={() => go('/bills')}>Open Bills</button>}>
          <Table rows={d.bills} rowKey={(b) => b.id} empty="No bills yet." cols={[
            { head: 'Bill', cell: (b) => <span><b>{b.billNo ?? 'Bill'}</b> <span className="muted small">{b.vendorName}{b.poNo ? ` · ${b.poNo}` : ''}{b.raBillNo ? ` · ${b.raBillNo}` : ''}</span></span> },
            { head: 'Day', cell: (b) => fmtDay(b.date) },
            { head: 'Amount', num: true, cell: (b) => inr(b.amountPaise) },
            { head: 'State', cell: (b) => b.status.replace('_', ' ') },
          ]} />
        </Panel>
      </div>)}
    </Load>
  );
}

