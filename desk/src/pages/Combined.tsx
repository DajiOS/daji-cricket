// Reports › All my businesses (combined.ts, redesign step 6): the businesses the owner marked "Mine", side by side, with their
// branches and projects. It only reads: each business keeps its own books, and a line opens in its own business to be acted on.
// A business that could not be read says "Not available", never ₹0. Cash handed to a wallet is shown once, as a movement.
import { useState } from 'react';
import { go, inr, fmtDay, todayISO, useApi } from '../lib';
import { useSession } from '../App';
import { Chip, DateInput, ErrorBox, Field, Loading, PageHead, Stat, Table, Tabs } from '../ui';
import { Panel } from '../parts/admin/common';

type Avail<T> = ({ status: 'ok' } & T) | { status: 'not_split' | 'unavailable'; why: string };
interface Books { revenuePaise: number; expensesPaise: number; netProfitPaise: number }
interface Wallet { holderId: string; holderName: string | null; givenPaise: number; expectedPaise: number; confirmedPaise: number; waiting: number; spentWaitingPaise: number }
interface Biz {
  id: string; name: string; own: boolean; currency: string; status: 'ok' | 'unavailable';
  books: Avail<Books>;
  cash: Avail<{ handedOutPaise: number; returnedPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number; spends: number; wallets: Wallet[] | null }>;
  tasks: Avail<{ open: number; overdue: number; doneInRange: number }>;
  approvalsWaiting: Avail<{ count: number }>;
}
interface Row { businessId: string; businessName: string; areaId: string | null; areaName: string | null; restricted: boolean; projectId: string | null; projectName: string | null; spentConfirmedPaise: number; spentWaitingPaise: number; openTasks: number; overdueTasks: number; doneTasks: number }
interface Line { kind: 'spend' | 'task'; id: string; businessId: string; businessName: string; areaName: string | null; projectName: string | null; personName: string | null; date: string | null; title: string; amountPaise: number | null; status: string; open: { businessId: string; page: 'cash' | 'tasks'; id: string } }
interface Part<T> { value: T | null; included: string[]; leftOut: string[]; partial: boolean; notSplit: boolean }
interface Total { currency: string; books: Part<Books>; cash: Part<{ handedOutPaise: number; returnedPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number }>; tasks: Part<{ open: number; overdue: number; done: number }>; leftOut: string[]; booksNote: string | null }
/** A part of the total: its figure, "Not split" or "Not available" (never ₹0), and "partial" when some business is left out. */
const partValue = <T,>(p: Part<T>, f: (x: T) => string) => (p.notSplit ? 'Not split' : p.value === null ? NA : f(p.value) + (p.partial ? ' (partial)' : ''));
const partFoot = <T,>(p: Part<T>, ok: string) => (p.partial ? `Leaves out ${p.leftOut.join(', ')}, not available just now` : p.value === null && !p.notSplit ? `Could not be read for ${p.leftOut.join(', ')}` : ok);
interface View {
  label: string; asOf: string;
  filters: { businessId: string | null; areaId: string | null; projectId: string | null; personId: string | null; from: string; to: string };
  options: { businesses: { id: string; name: string; own: boolean }[]; supported: number; areas: { id: string; name: string; businessId: string; restricted: boolean; archived: boolean }[]; projects: { id: string; name: string; businessId: string; areaId: string | null }[]; people: { id: string; name: string; businessIds: string[] }[] };
  businesses: Biz[]; byArea: Row[]; byProject: Row[]; lines: Line[]; linesCut: boolean; totals: Total[]; notes: string[];
}

const NA = 'Not available';
/** Cash handed to wallets and cash given back, each as itself: a return may be for an advance from before these dates. */
const moves = (c: { handedOutPaise: number; returnedPaise: number }) =>
  [c.handedOutPaise ? `${inr(c.handedOutPaise)} handed to wallets` : '', c.returnedPaise ? `${inr(c.returnedPaise)} given back` : ''].filter(Boolean).join(', ') + ' in these dates';
const money = <T,>(a: Avail<T>, f: (x: T) => string) => (a.status === 'ok' ? f(a as T) : a.status === 'not_split' ? 'Not split' : NA);
const monthStart = () => todayISO().slice(0, 8) + '01';

export default function Combined() {
  const { setOwner } = useSession();
  const [f, setF] = useState({ business: '', area: '', project: '', person: '', from: monthStart(), to: todayISO() });
  const [tab, setTab] = useState<'branches' | 'projects' | 'lines'>('branches');
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const [v, err, reload, status] = useApi<View>(`/api/me/combined?${q}`, [q]);
  const set = (k: keyof typeof f, val: string) => setF((x) => {
    const n = { ...x, [k]: val };
    // a branch or project belongs to one business; changing the business clears them
    if (k === 'business') { n.area = ''; n.project = ''; }
    if (k === 'area') n.project = '';
    return n;
  });
  /** Opens the original record in its own business: the desk switches to that business first. */
  const open = (l: { businessId: string; page: 'cash' | 'tasks' }) => { setOwner(l.businessId); go(`/${l.page}`); };

  // a team member who follows a link here: the view is the business owner's, there is nothing to retry
  if (status === 403) return <><Head /><div className="state" role="status"><b>This view is for the business owner.</b> <span className="small">It shows all of the owner's businesses together. Your own work is under Work.</span></div></>;
  // a failed load has no choices to show: offer the default view as well as a retry, so the owner is never stuck on one selection
  const plain = !f.business && !f.area && !f.project && !f.person && f.from === monthStart() && f.to === todayISO();
  if (err) return <><Head /><ErrorBox msg={err} /><div className="row"><button className="btn" onClick={reload}>Try again</button>{!plain && <button className="btn" onClick={() => setF({ business: '', area: '', project: '', person: '', from: monthStart(), to: todayISO() })}>Back to all my businesses</button>}</div></>;
  // while a new filter loads, the figures on screen are for the old one: show loading rather than the wrong selection's numbers
  const forNow = !!v && (v.filters.areaId ?? '') === f.area && (v.filters.projectId ?? '') === f.project && (v.filters.personId ?? '') === f.person
    && v.filters.from === f.from && v.filters.to === f.to && (!f.business || v.filters.businessId === f.business) && (!!f.business || !!f.area || !!f.project || !v.filters.businessId);
  if (!v || !forNow) return <><Head /><Loading /></>;
  const t = v.totals[0];
  const areas = v.options.areas.filter((a) => !f.business || a.businessId === f.business);
  const projects = v.options.projects.filter((p) => (!f.business || p.businessId === f.business) && (!f.area || p.areaId === f.area));
  const narrowed = !!(f.area || f.project || f.person);
  const rowCols = (withProject: boolean) => [
    { head: 'Business', cell: (r: Row) => r.businessName },
    { head: 'Branch', cell: (r: Row) => <span>{r.areaName ?? <span className="muted">Not in a branch</span>}{r.restricted && <> <Chip tone="info">Restricted</Chip></>}</span> },
    ...(withProject ? [{ head: 'Project', cell: (r: Row) => <b>{r.projectName}</b> }] : []),
    { head: 'Cash spent, signed', num: true, cell: (r: Row) => inr(r.spentConfirmedPaise) },
    { head: 'Waiting', num: true, cell: (r: Row) => (r.spentWaitingPaise ? inr(r.spentWaitingPaise) : '–') },
    { head: 'Open jobs', num: true, cell: (r: Row) => <span>{r.openTasks}{r.overdueTasks > 0 && <> <Chip tone="bad">{r.overdueTasks} late</Chip></>}</span> },
    { head: 'Done', num: true, cell: (r: Row) => r.doneTasks },
  ];

  return (
    <>
      <Head />
      <div className="stack">
        <div className="card card-pad combined-banner" role="note">
          <b>Viewing: {v.label}.</b> <span className="small">Each business keeps its own books. Nothing here can be changed: open a line to work on it in its own business.</span>
        </div>

        <Panel title="Filters">
          <div className="form-grid combined-filters">
            <Field label="Business"><select className="inp" value={f.business} onChange={(e) => set('business', e.target.value)}><option value="">All my businesses</option>{v.options.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field label="Branch"><select className="inp" value={f.area} onChange={(e) => set('area', e.target.value)}><option value="">All branches</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}{f.business ? '' : ` (${v.options.businesses.find((b) => b.id === a.businessId)?.name ?? ''})`}{a.archived ? ', archived' : ''}</option>)}</select></Field>
            <Field label="Project"><select className="inp" value={f.project} onChange={(e) => set('project', e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Person"><select className="inp" value={f.person} onChange={(e) => set('person', e.target.value)}><option value="">Everyone</option>{v.options.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="From"><DateInput className="inp" value={f.from} onChange={(e) => set('from', e.target.value)} max={f.to} aria-label="From" /></Field>
            <Field label="To"><DateInput className="inp" value={f.to} onChange={(e) => set('to', e.target.value)} min={f.from} aria-label="To" /></Field>
          </div>
          {v.options.supported > 0 && <p className="hint">{v.options.supported === 1 ? 'One business you support is' : `${v.options.supported} businesses you support are`} not included. Mark a business "Mine" in Settings › Branches and access to include it.</p>}
        </Panel>

        {t && (
          <Panel title={`Together (${t.currency})`} note={`${v.businesses.length === 1 ? "1 business" : `${v.businesses.length} businesses`}, ${fmtDay(v.filters.from)} to ${fmtDay(v.filters.to)}.${t.leftOut.length ? ` Not available just now, so left out: ${t.leftOut.join('; ')}.` : ''}`}>
            <div className="grid g4">
              <Stat label="Revenue in the books" value={partValue(t.books, (x) => inr(x.revenuePaise))} foot={t.booksNote ?? 'Each business\'s own books, added up'} />
              <Stat label="Expenses in the books" value={partValue(t.books, (x) => inr(x.expensesPaise))} foot={t.books.value ? `${t.books.value.netProfitPaise >= 0 ? 'Profit' : 'Loss'} ${inr(Math.abs(t.books.value.netProfitPaise))}` : '–'} />
              <Stat label="Cash spent" value={partValue(t.cash, (x) => inr(x.spentConfirmedPaise))} foot={partFoot(t.cash, `${t.cash.value?.spentWaitingPaise ? `${inr(t.cash.value.spentWaitingPaise)} waiting for sign-off. ` : ''}Not in the books yet, so not added to them`)} />
              <Stat label="Open jobs" value={partValue(t.tasks, (x) => String(x.open))} foot={partFoot(t.tasks, t.tasks.value ? `${t.tasks.value.overdue} late · ${t.tasks.value.done} done in these dates` : '–')} />
            </div>
            {!narrowed && !!t.cash.value && (!!t.cash.value.handedOutPaise || !!t.cash.value.returnedPaise) && <p className="hint">{moves(t.cash.value)}{t.cash.partial ? ' (partial)' : ''}. That is your own money moving, shown once, not spending.</p>}
          </Panel>
        )}

        <div className="grid g2">
          {v.businesses.map((b) => (
            <Panel key={b.id} title={b.name} note={b.status === 'ok' ? (b.own ? 'Your own business' : 'Marked "Mine" in your portfolio') : 'Some of this business could not be read just now. Its figures are left out, not counted as ₹0.'}
              actions={<button className="btn sm" onClick={() => { setOwner(b.id); go('/'); }}>Open this business</button>}>
              <dl className="combined-dl">
                <dt>Revenue</dt><dd>{money(b.books, (x) => inr(x.revenuePaise))}</dd>
                <dt>Expenses</dt><dd>{money(b.books, (x) => inr(x.expensesPaise))}</dd>
                <dt>{b.books.status === 'ok' && b.books.netProfitPaise < 0 ? 'Loss' : 'Profit'}</dt><dd>{money(b.books, (x) => inr(Math.abs(x.netProfitPaise)))}</dd>
                <dt>Cash spent</dt><dd>{money(b.cash, (x) => `${inr(x.spentConfirmedPaise)}${x.spentWaitingPaise ? ` + ${inr(x.spentWaitingPaise)} waiting` : ''}`)}</dd>
                <dt>Open jobs</dt><dd>{money(b.tasks, (x) => `${x.open}${x.overdue ? ` (${x.overdue} late)` : ''}`)}</dd>
                <dt>Approvals waiting</dt><dd>{money(b.approvalsWaiting, (x) => String(x.count))}</dd>
              </dl>
              {b.cash.status === 'ok' && b.cash.wallets && b.cash.wallets.length > 0 && (
                <p className="small muted">{b.cash.wallets.map((w) => `${w.holderName ?? 'Someone'} should have ${inr(w.expectedPaise)}`).join(' · ')}</p>
              )}
              {[b.books, b.cash, b.tasks].some((x) => x.status === 'unavailable') && <p className="err-text" role="status">Not available just now. Open the business itself, or try again.</p>}
            </Panel>
          ))}
        </div>

        <Panel title="Where it went" actions={<Tabs value={tab} onChange={setTab} items={[['branches', 'By branch'], ['projects', 'By project'], ['lines', 'Lines']]} label="Breakdown" />}>
          {tab === 'branches' && <Table rows={v.byArea} rowKey={(r) => `${r.businessId}:${r.areaId ?? '-'}`} cols={rowCols(false)} empty="No branches in these businesses yet." />}
          {tab === 'projects' && <Table rows={v.byProject} rowKey={(r) => r.projectId ?? ''} cols={rowCols(true)} empty="No projects here." />}
          {tab === 'lines' && v.linesCut && <p className="hint" role="status">This list is cut short: it shows the latest {v.lines.length} lines. Narrow the dates or filters to see the rest.</p>}
          {tab === 'lines' && <Table rows={v.lines} rowKey={(l) => `${l.kind}:${l.id}`} onRow={(l) => open(l.open)} empty="Nothing in these dates." cols={[
            { head: 'Date', cell: (l) => (l.date ? fmtDay(l.date) : '–') },
            { head: 'What', cell: (l) => <span><Chip tone={l.kind === 'spend' ? 'info' : 'mute'}>{l.kind === 'spend' ? 'Cash spend' : 'Open job'}</Chip> <b>{l.title}</b></span> },
            { head: 'Business', cell: (l) => l.businessName },
            { head: 'Branch · project', cell: (l) => [l.areaName, l.projectName].filter(Boolean).join(' · ') || '–' },
            { head: 'Person', cell: (l) => l.personName ?? '–' },
            { head: 'Amount', num: true, cell: (l) => (l.amountPaise === null ? '' : <span>{inr(l.amountPaise)}{l.status === 'waiting' && <> <Chip tone="warn">Waiting</Chip></>}</span>) },
          ]} />}
        </Panel>

        <ul className="small muted combined-notes">{v.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </div>
    </>
  );
}

const Head = () => <PageHead eyebrow="Reports" title="All my businesses" lede="The businesses you marked as yours, side by side, with their branches and projects. Read-only." />;
