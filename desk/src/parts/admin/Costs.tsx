// Software costs: what the platform costs to build and run, from every service's invoices. Fetched automatically where the service has an API.
import { useRef, useState } from 'react';
import { useApi, post, put, patch, del, sendFile, download, inr, fmtDate, todayISO } from '../../lib';
import { Loading, ErrorBox, Table, Chip, Field, Modal, useForm, useToast, DateInput } from '../../ui';
import { Panel, errText } from './common';

const CATS: Record<string, string> = { hosting: 'Hosting', domain: 'Domain', website: 'Website', payments: 'Payments', messaging: 'Messages', banking: 'Bank feeds', ai: 'AI', app: 'App stores', tools: 'Tools', other: 'Other' };
const CYCLES: Record<string, string> = { monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly', usage: 'By usage', one_time: 'One time' };
const STATUS: Record<string, ['good' | 'warn' | 'mute', string]> = { paid: ['good', 'Paid'], due: ['warn', 'To pay'], expected: ['mute', 'Expected'] };
const money = (minor: number, cur: string) => (cur === 'USD' ? `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : inr(minor, 2));
const toMinor = (s: string): number | null => { const t = s.trim().replace(/,/g, ''); if (!/^\d+(\.\d{1,2})?$/.test(t)) return null; return Math.round(Number(t) * 100); };
const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

export function SoftwareCosts() {
  const [d, error, reload] = useApi<any>('/api/admin/billing');
  const [inv, , reloadInv] = useApi<{ items: any[] }>('/api/admin/billing/invoices');
  const [svcDlg, setSvcDlg] = useState<any | null>(null);
  const [invDlg, setInvDlg] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetched, setFetched] = useState<any[] | null>(null);
  const toast = useToast();
  if (error) return <ErrorBox msg={error} />;
  if (!d || !inv) return <Loading />;
  const s = d.summary, services: any[] = d.services;
  const all = () => { reload(); reloadInv(); };
  const run = async (fn: () => Promise<any>, ok?: (r: any) => string) => { setBusy(true); try { const r = await fn(); if (ok) toast(ok(r)); all(); return r; } catch (e) { toast(errText(e)); } finally { setBusy(false); } };
  const maxMonth = Math.max(1, ...s.months.map((m: any) => m.totalPaise));
  return (
    <div className="stack">
      <div className="grid g4">
        <div className="card stat"><div className="label">This month</div><div className="value">{inr(s.thisMonthPaise, 0)}</div><div className="foot">invoices dated this month</div></div>
        <div className="card stat"><div className="label">Last 12 months</div><div className="value">{inr(s.last12MonthsPaise, 0)}</div><div className="foot">including {inr(s.gstPaise, 0)} GST ever paid</div></div>
        <div className="card stat"><div className="label">Yearly run rate</div><div className="value">{inr(s.yearlyRunRatePaise, 0)}</div><div className="foot">fixed plans plus usage over the last year</div></div>
        <div className="card stat"><div className="label">Cost per booking</div><div className="value">{s.perBookingPaise === null ? '–' : inr(s.perBookingPaise, 0)}</div><div className="foot">{s.bookingsLast12} bookings in 12 months · one-time {inr(s.oneTimePaise, 0)}</div></div>
      </div>

      <Panel title="Month by month" note="Rupees. USD invoices use the rate saved with each invoice. Expected (unconfirmed) invoices are not counted.">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Month</th><th></th><th className="num right">Total</th></tr></thead>
          <tbody>{[...s.months].reverse().map((m: any) => (
            <tr key={m.month}><td>{monthLabel(m.month)}</td>
              <td style={{ width: '60%' }}><div style={{ height: 10, borderRadius: 5, background: 'var(--gold, #c9a24b)', width: `${(m.totalPaise / maxMonth) * 100}%`, minWidth: m.totalPaise ? 4 : 0 }} title={Object.entries(m.byCategory).map(([k, v]) => `${CATS[k] ?? k} ${inr(v as number, 0)}`).join(' · ')} /></td>
              <td className="num right">{inr(m.totalPaise, 0)}</td></tr>))}</tbody>
        </table></div>
        {s.byCategory.length > 0 && <p className="hint" style={{ marginBottom: 0 }}>Last 12 months by kind: {s.byCategory.map((c: any) => `${CATS[c.category] ?? c.category} ${inr(c.last12Paise, 0)}`).join(' · ')}</p>}
      </Panel>

      <Panel title="Services" note="Everything the platform pays for. Where a service has an API its invoices arrive by themselves; for the rest, enter the invoice when it comes (a fixed fee makes an Expected invoice on its due date)."
        actions={<>{services.length < d.catalogSize && <button className="btn sm" disabled={busy} onClick={() => run(() => post('/api/admin/billing/services/catalog'), (r) => r.added ? `Added ${r.added} services. Fill in the prices.` : 'All the usual services are already here.')}>Add the usual services</button>}
          <button className="btn sm primary" onClick={() => setSvcDlg({})}>Add a service</button></>}>
        <Table rows={services} empty="No services yet. Press Add the usual services." onRow={(r) => setSvcDlg(r)} cols={[
          { head: 'Service', cell: (r) => <><div className="strong">{r.name}</div><div className="muted small">{r.vendor ?? ''}{r.vendor ? ' · ' : ''}{CATS[r.category]}</div></> },
          { head: 'Billing', cell: (r) => <>{CYCLES[r.cycle]}{r.expectedMinor ? <div className="muted small">{money(r.expectedMinor, r.currency)}{r.gstPercent ? ` + ${r.gstPercent}% GST` : ''}</div> : null}</> },
          { head: 'Source', cell: (r) => r.source === 'manual' ? <span className="muted">Entered by hand</span> : <Chip tone="good">Automatic · {r.source}</Chip> },
          { head: 'Next due', cell: (r) => r.nextDue ? fmtDate(r.nextDue) : '–' },
          { head: 'Paid so far', cell: (r) => inr(r.totalInrPaise, 0), num: true },
          { head: '', cell: (r) => r.active ? null : <Chip tone="mute">Off</Chip> },
        ]} />
      </Panel>

      <Panel title="Invoices" actions={<button className="btn sm primary" disabled={!services.length} onClick={() => setInvDlg({})}>Add an invoice</button>}>
        <Table rows={inv.items} empty="No invoices yet." onRow={(r) => setInvDlg(r)} cols={[
          { head: 'Date', cell: (r) => fmtDate(r.invoiceDate) },
          { head: 'Service', cell: (r) => <><div className="strong">{r.serviceName}</div><div className="muted small">{r.invoiceNo ? `No. ${r.invoiceNo} · ` : ''}{r.source === 'auto' ? 'fetched automatically' : r.source === 'recurring' ? 'fixed fee' : 'entered by hand'}</div></> },
          { head: 'Amount', cell: (r) => <>{money(r.amountMinor + r.gstMinor, r.currency)}{r.currency === 'USD' && <div className="muted small">at ₹{r.fxRate}</div>}</>, num: true },
          { head: 'In rupees', cell: (r) => inr(r.inrPaise, 2), num: true },
          { head: 'Status', cell: (r) => <Chip tone={STATUS[r.status]![0]}>{STATUS[r.status]![1]}</Chip> },
          { head: '', cell: (r) => r.hasFile ? <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); download(`/api/admin/billing/invoices/${r.id}/file`, r.fileName).catch((er) => toast(er.message)); }}>PDF</button> : null },
        ]} />
      </Panel>

      <SourcesPanel settings={d.settings} reload={all} fetched={fetched} setFetched={setFetched} />
      {svcDlg && <ServiceDialog svc={svcDlg} onClose={() => setSvcDlg(null)} done={() => { setSvcDlg(null); all(); }} />}
      {invDlg && <InvoiceDialog invoice={invDlg} services={services} rate={d.settings.usdInr} onClose={() => setInvDlg(null)} done={() => { setInvDlg(null); all(); }} />}
    </div>
  );
}

function SourcesPanel({ settings, reload, fetched, setFetched }: { settings: any; reload: () => void; fetched: any[] | null; setFetched: (r: any[] | null) => void }) {
  const [f, setF] = useState({ usdInr: String(settings.usdInr), anthropicAdminKey: '', awsAccessKeyId: '', awsSecretAccessKey: '' });
  const [busy, setBusy] = useState(false); const toast = useToast();
  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try { await put('/api/admin/billing/settings', { usdInr: Number(f.usdInr) || undefined, ...Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== 'usdInr' && v.trim())), ...extra }); setF({ ...f, anthropicAdminKey: '', awsAccessKeyId: '', awsSecretAccessKey: '' }); toast('Saved'); reload(); } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const fetchNow = async () => { setBusy(true); try { const r = await post<{ results: any[] }>('/api/admin/billing/fetch'); setFetched(r.results); reload(); } catch (e) { toast(errText(e)); } finally { setBusy(false); } };
  return (
    <Panel title="Automatic invoices" note="Keys are stored encrypted and never shown again. Fetched once a day, and when you press the button. The last three months are checked, the running month is an estimate, a paid invoice is never changed."
      actions={<button className="btn sm primary" disabled={busy} onClick={fetchNow}>Fetch now</button>}>
      <div className="form-grid">
        <Field label="Dollar rate (₹ per US$)" hint="Used for US$ invoices that arrive by themselves. You can set the exact rate on any invoice."><input className="inp" inputMode="decimal" value={f.usdInr} onChange={(e) => setF({ ...f, usdInr: e.target.value })} /></Field>
        <Field label={`Anthropic Admin key ${settings.keysSet.anthropicAdminKey ? '(saved)' : '(not set)'}`} hint="console.anthropic.com, Settings, Admin keys. Starts with sk-ant-admin."><input className="inp" type="password" autoComplete="new-password" value={f.anthropicAdminKey} onChange={(e) => setF({ ...f, anthropicAdminKey: e.target.value })} /></Field>
        <Field label={`AWS access key ID ${settings.keysSet.awsAccessKeyId ? '(saved)' : '(not set)'}`} hint="An IAM user allowed only ce:GetCostAndUsage."><input className="inp" autoComplete="off" value={f.awsAccessKeyId} onChange={(e) => setF({ ...f, awsAccessKeyId: e.target.value })} /></Field>
        <Field label={`AWS secret key ${settings.keysSet.awsSecretAccessKey ? '(saved)' : '(not set)'}`}><input className="inp" type="password" autoComplete="new-password" value={f.awsSecretAccessKey} onChange={(e) => setF({ ...f, awsSecretAccessKey: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={busy} onClick={() => save()}>Save</button>
        {(settings.keysSet.anthropicAdminKey || settings.keysSet.awsSecretAccessKey) && <button className="btn ghost" disabled={busy} onClick={() => save({ clear: ['anthropicAdminKey', 'awsAccessKeyId', 'awsSecretAccessKey'] })}>Remove saved keys</button>}
        <span className="muted small">Razorpay fees use the Razorpay keys already on the server{settings.razorpay ? '' : ' (not set up here)'}.</span>
      </div>
      {fetched && <div style={{ marginTop: 12 }}>{fetched.length === 0 ? <p className="hint">No automatic services yet. Add the usual services first.</p> : fetched.map((r) => <p key={r.service} className={r.error ? 'err' : 'hint'} style={{ margin: '4px 0' }}><strong>{r.service}:</strong> {r.error ?? r.months.map((m: any) => `${m.month} ${m.result}`).join(', ')}</p>)}</div>}
    </Panel>
  );
}

function ServiceDialog({ svc, onClose, done }: { svc: any; onClose: () => void; done: () => void }) {
  const f = useForm({ name: svc.name ?? '', vendor: svc.vendor ?? '', category: svc.category ?? 'tools', cycle: svc.cycle ?? 'monthly', currency: svc.currency ?? 'INR', expected: svc.expectedMinor ? String(svc.expectedMinor / 100) : '', gst: String(svc.gstPercent ?? 0), source: svc.source ?? 'manual', sourceRef: svc.sourceRef ?? '', nextDue: svc.nextDue ?? '', active: svc.active ?? true, notes: svc.notes ?? '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    const exp = f.v.expected.trim() ? toMinor(f.v.expected) : 0; if (exp === null) { setErr('Enter the usual amount in numbers.'); return; }
    const body = { name: f.v.name.trim(), vendor: f.v.vendor.trim() || (svc.id ? '' : undefined), category: f.v.category, cycle: f.v.cycle, currency: f.v.currency, expectedMinor: exp, gstPercent: Number(f.v.gst) || 0, source: f.v.source, sourceRef: f.v.sourceRef.trim() || (svc.id ? '' : undefined), nextDue: f.v.nextDue || (svc.id ? '' : undefined), active: f.v.active, notes: f.v.notes.trim() || (svc.id ? '' : undefined) };
    setBusy(true); setErr('');
    try { if (svc.id) await patch('/api/admin/billing/services/' + svc.id, body); else await post('/api/admin/billing/services', body); done(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const remove = async () => { setBusy(true); try { await del('/api/admin/billing/services/' + svc.id); done(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return (
    <Modal title={svc.id ? 'Change service' : 'Add a service'} onClose={onClose} wide foot={<>{svc.id && <button className="btn ghost" disabled={busy} onClick={remove}>{svc.invoices ? 'Switch off' : 'Delete'}</button>}<button className="btn primary" disabled={busy || !f.v.name.trim()} onClick={save}>Save</button></>}>
      {err && <ErrorBox msg={err} />}
      <div className="form-grid">
        <Field label="Name"><input className="inp" {...f.bind('name')} /></Field>
        <Field label="Company"><input className="inp" placeholder="Amazon Web Services" {...f.bind('vendor')} /></Field>
        <Field label="Kind"><select className="inp" {...f.bind('category')}>{Object.entries(CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Billed"><select className="inp" {...f.bind('cycle')}>{Object.entries(CYCLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Currency"><select className="inp" {...f.bind('currency')}><option value="INR">Rupees</option><option value="USD">US dollars</option></select></Field>
        <Field label="Usual amount" hint="Before GST. Leave empty for usage bills."><input className="inp" inputMode="decimal" {...f.bind('expected')} /></Field>
        <Field label="GST %" hint="18 for Indian companies, 0 for foreign ones."><input className="inp" inputMode="decimal" {...f.bind('gst')} /></Field>
        <Field label="Next due date" hint="A fixed fee makes an Expected invoice on this date."><DateInput className="inp" {...f.bind('nextDue')} /></Field>
        <Field label="Invoices come from"><select className="inp" {...f.bind('source')}><option value="manual">I enter them</option><option value="aws">AWS Cost Explorer</option><option value="anthropic">Anthropic cost report</option><option value="razorpay">Razorpay payments</option></select></Field>
        {f.v.source === 'aws' && <Field label="AWS service name" hint="For example Amazon Lightsail. Empty means the whole AWS bill."><input className="inp" {...f.bind('sourceRef')} /></Field>}
        <Field label="Notes" full><input className="inp" {...f.bind('notes')} /></Field>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.v.active} onChange={(e) => f.setV({ ...f.v, active: e.target.checked })} />Still in use</label>
      </div>
    </Modal>
  );
}

function InvoiceDialog({ invoice, services, rate, onClose, done }: { invoice: any; services: any[]; rate: number; onClose: () => void; done: () => void }) {
  const editing = !!invoice.id;
  const first = services.find((x) => x.active) ?? services[0];
  const f = useForm({ serviceId: invoice.serviceId ?? first?.id ?? '', invoiceNo: invoice.invoiceNo ?? '', invoiceDate: invoice.invoiceDate ?? todayISO(), amount: invoice.amountMinor !== undefined ? String(invoice.amountMinor / 100) : '', gst: invoice.gstMinor !== undefined ? String(invoice.gstMinor / 100) : '', fx: String(invoice.fxRate && invoice.fxRate !== 1 ? invoice.fxRate : rate), status: invoice.status ?? 'due', paidOn: invoice.paidOn ?? '', notes: invoice.notes ?? '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const pick = useRef<HTMLInputElement>(null); const toast = useToast();
  const svc = services.find((x) => x.id === f.v.serviceId);
  const save = async () => {
    const amt = toMinor(f.v.amount); if (amt === null) { setErr('Enter the amount in numbers, before GST.'); return; }
    const gst = f.v.gst.trim() ? toMinor(f.v.gst) : undefined; if (gst === null) { setErr('Enter the GST in numbers.'); return; }
    setBusy(true); setErr('');
    const body = { ...(editing ? {} : { serviceId: f.v.serviceId }), invoiceNo: f.v.invoiceNo.trim() || undefined, invoiceDate: f.v.invoiceDate, amountMinor: amt, ...(gst !== undefined ? { gstMinor: gst } : {}), ...(svc?.currency === 'USD' ? { fxRate: Number(f.v.fx) || undefined } : {}), status: f.v.status, ...(f.v.status === 'paid' ? { paidOn: f.v.paidOn || f.v.invoiceDate } : {}), notes: f.v.notes.trim() || undefined };
    try { if (editing) await patch('/api/admin/billing/invoices/' + invoice.id, body); else await post('/api/admin/billing/invoices', body); done(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const attach = async (file: File) => { try { await sendFile(`/api/admin/billing/invoices/${invoice.id}/file?filename=${encodeURIComponent(file.name)}`, file); toast('File attached'); done(); } catch (e) { setErr(errText(e)); } };
  const remove = async () => { setBusy(true); try { await del('/api/admin/billing/invoices/' + invoice.id); done(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return (
    <Modal title={editing ? 'Change invoice' : 'Add an invoice'} onClose={onClose} wide foot={<>{editing && <button className="btn ghost" disabled={busy} onClick={remove}>Delete</button>}<button className="btn primary" disabled={busy || !f.v.serviceId} onClick={save}>Save</button></>}>
      {err && <ErrorBox msg={err} />}
      {invoice.source === 'auto' && <p className="hint" style={{ marginTop: 0 }}>This invoice was fetched automatically and may be refreshed until you mark it paid.</p>}
      <div className="form-grid">
        <Field label="Service"><select className="inp" disabled={editing} {...f.bind('serviceId')}>{services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Invoice number"><input className="inp" {...f.bind('invoiceNo')} /></Field>
        <Field label="Invoice date"><DateInput className="inp" {...f.bind('invoiceDate')} /></Field>
        <Field label={`Amount before GST (${svc?.currency === 'USD' ? 'US$' : '₹'})`}><input className="inp" inputMode="decimal" {...f.bind('amount')} /></Field>
        <Field label="GST" hint={svc?.gstPercent ? `Left empty it is ${svc.gstPercent}% of the amount.` : 'Leave empty for none.'}><input className="inp" inputMode="decimal" {...f.bind('gst')} /></Field>
        {svc?.currency === 'USD' && <Field label="Dollar rate (₹ per US$)" hint="The rate on the day, from your card or bank statement."><input className="inp" inputMode="decimal" {...f.bind('fx')} /></Field>}
        <Field label="Status"><select className="inp" {...f.bind('status')}><option value="due">To pay</option><option value="paid">Paid</option><option value="expected">Expected (not counted yet)</option></select></Field>
        {f.v.status === 'paid' && <Field label="Paid on"><DateInput className="inp" {...f.bind('paidOn')} /></Field>}
        <Field label="Notes" full><input className="inp" {...f.bind('notes')} /></Field>
      </div>
      {editing && <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <input ref={pick} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) attach(x); }} />
        <button className="btn sm" onClick={() => pick.current?.click()}>{invoice.hasFile ? 'Replace the PDF' : 'Attach the invoice PDF'}</button>
        {invoice.hasFile && <button className="btn sm ghost" onClick={() => download(`/api/admin/billing/invoices/${invoice.id}/file`, invoice.fileName).catch((e) => toast(e.message))}>Download {invoice.fileName}</button>}
      </div>}
    </Modal>
  );
}
