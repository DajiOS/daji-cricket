// Connections, the notebook of services, accounts and owner requests.
import { useState } from 'react';
import { useApi, post, put, patch, del, fmtDateTime, formatPhone } from '../../lib';
import { Loading, ErrorBox, Chip, Table, Modal, Field, Empty, useToast, type Tone } from '../../ui';
import { Panel, errText } from './common';
import { useSession } from '../../App';

const CONN: Record<string, [Tone, string]> = { ready: ['good', 'Ready'], partial: ['warn', 'Partly set up'], missing: ['mute', 'Not connected'], not_built: ['mute', 'Not built yet'] };
const SERVICE_STATUS: Record<string, [Tone, string]> = { not_started: ['mute', 'Not started'], account_created: ['info', 'Account created'], connected: ['info', 'Connected'], live: ['good', 'Live'], problem: ['bad', 'Needs attention'] };

export function Connections() {
  const { me } = useSession();
  const [data, error, reload] = useApi<{ items: any[] }>('/api/admin/integrations');
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  // never a blank card: while loading, a line saying so; on a failure, the server's own message and code
  if (error) return <Panel title="Connections"><ErrorBox msg={`Could not load the services: ${error} (signed in as ${me.role})`} /><button className="btn sm" style={{ marginTop: 10 }} onClick={reload}>Try again</button></Panel>;
  if (!data) return <Panel title="Connections"><Loading /></Panel>;
  async function test(id: string) {
    setTesting(id);
    try { const t = await post<{ ok: boolean; message: string }>(`/api/admin/integrations/${encodeURIComponent(id)}/test`, {}); setResults((r) => ({ ...r, [id]: t })); reload(); }
    catch (e) { setResults((r) => ({ ...r, [id]: { ok: false, message: errText(e) } })); }
    setTesting(null);
  }
  return (
    <Panel title="Connections" note="What the server needs for each service. Only the names of missing settings are shown, never their values. New services appear here as they are added.">
      {!data.items?.length && <div className="err" role="alert">The server answered but listed no services ({Array.isArray(data.items) ? 'an empty list' : 'no list'}; signed in as {me.role}). It said: <code style={{ wordBreak: 'break-all' }}>{JSON.stringify(data).slice(0, 300)}</code></div>}
      {(data.items || []).map((c) => {
        const res = results[c.id];
        return (
          <div className="dl-line" key={c.id} style={{ alignItems: 'flex-start' }}>
            <div>
              <b>{c.name}</b> <span className="small muted">· {c.what}</span>
              {c.status !== 'ready' && <div className="hint">{c.note || (c.missing.length ? `Missing: ${c.missing.join(', ')}. ` : '') + c.setup}</div>}
              {res ? <div className={res.ok ? 'ok-text' : 'err-text'} style={{ marginTop: 4 }}>{res.ok ? 'Passed: ' : 'Failed: '}{res.message}</div>
                : c.lastTest && <div className="hint">Last test {fmtDateTime(c.lastTest.at)}: {c.lastTest.message}</div>}
              <AccountNotes id={c.id} notes={c.notes || ''} onSaved={reload} />
            </div>
            <div className="acts"><Chip tone={(CONN[c.status] || ['mute', c.status])[0]}>{(CONN[c.status] || ['mute', c.status])[1]}</Chip>{c.canTest && <button className="btn sm" disabled={testing === c.id} onClick={() => test(c.id)}>{testing === c.id ? 'Testing…' : 'Test'}</button>}</div>
          </div>
        );
      })}
    </Panel>
  );
}

/** The owner's own record of a service's account: who signed up and with what, account names, what is still pending. Never keys. */
function AccountNotes({ id, notes, onSaved }: { id: string; notes: string; onSaved: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try { await put(`/api/admin/integrations/${encodeURIComponent(id)}/notes`, { notes: edit }); toast('Notes saved'); setEdit(null); onSaved(); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  if (edit === null) return (
    <div style={{ marginTop: 8 }}>
      <div className="small" style={{ fontWeight: 600 }}>Account and notes</div>
      {notes ? <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{notes}</div> : <div className="hint" style={{ marginTop: 0 }}>Nothing written yet.</div>}
      <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => { setEdit(notes); setErr(null); }}>{notes ? 'Edit notes' : 'Add notes'}</button>
    </div>
  );
  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
      <label className="small" style={{ fontWeight: 600 }} htmlFor={`notes-${id}`}>Account and notes</label>
      <textarea id={`notes-${id}`} className="inp" rows={4} maxLength={2000} value={edit} onChange={(e) => setEdit(e.target.value)} placeholder="Who signed up and with which login, account names, numbers, what is still pending" />
      <div className="hint" style={{ marginTop: 0 }}>Never put keys or passwords here. They stay in the server settings only, and anything that looks like one is refused.</div>
      {err && <ErrorBox msg={err} />}
      <div className="row" style={{ gap: 8 }}><button className="btn sm primary" disabled={busy} onClick={save}>Save</button><button className="btn sm ghost" disabled={busy} onClick={() => setEdit(null)}>Cancel</button></div>
    </div>
  );
}

function ServiceForm({ s, onClose, onDone }: { s: any | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: s?.name || '', purpose: s?.purpose || '', accountEmail: s?.accountEmail || '', phone: s?.phone || '', loginUrl: s?.loginUrl || '', status: s?.status || 'not_started', notes: s?.notes || '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setErr(null); setBusy(true);
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).trim()]));
    try { s ? await patch(`/api/admin/services/${encodeURIComponent(s.id)}`, body) : await post('/api/admin/services', body); toast('Saved'); onDone(); } catch (e) { setErr(errText(e)); setBusy(false); }
  }
  async function remove() { try { await del(`/api/admin/services/${encodeURIComponent(s.id)}`); onDone(); } catch (e) { setErr(errText(e)); } }
  return (
    <Modal title={s ? s.name : 'Add a service'} onClose={onClose} foot={<>{s && <button className="btn ghost" onClick={remove}>Remove from the list</button>}<button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name"><input className="inp" maxLength={80} value={f.name} onChange={set('name')} /></Field>
        <Field label="What it is for"><input className="inp" maxLength={200} placeholder="What we use it for" value={f.purpose} onChange={set('purpose')} /></Field>
        <Field label="Account email"><input className="inp" type="email" placeholder="Email the account was opened with" value={f.accountEmail} onChange={set('accountEmail')} /></Field>
        <Field label="Phone number"><input className="inp" maxLength={30} placeholder="Phone number on the account" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Login link"><input className="inp" type="url" placeholder="https://…" value={f.loginUrl} onChange={set('loginUrl')} /></Field>
        <Field label="Where it stands"><select className="inp" value={f.status} onChange={set('status')}>{Object.entries(SERVICE_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Notes" full><textarea className="inp" rows={4} maxLength={2000} style={{ height: 'auto', padding: 10 }} placeholder="What is done, what is left, who to call" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div style={{ marginTop: 10 }}><ErrorBox msg={err} /></div>
    </Modal>
  );
}

export function Services() {
  const [data, error, reload] = useApi<{ items: any[] }>('/api/admin/services');
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Loading />;
  return (
    <Panel title="Services and accounts" note="Which email and phone each service was opened with, so it is never forgotten. Do not write passwords or keys here; those go in the server settings file." actions={<button className="btn sm primary" onClick={() => setEdit(null)}>Add a service</button>}>
      {!data.items.length ? <Empty>No services written down yet.</Empty> : data.items.map((s) => (
        <div className="dl-line" key={s.id} style={{ alignItems: 'flex-start' }}>
          <div>
            <b>{s.name}</b>{s.purpose && <span className="small muted"> · {s.purpose}</span>}
            <div className="hint">{[s.accountEmail && 'Email: ' + s.accountEmail, s.phone && 'Phone: ' + formatPhone(s.phone)].filter(Boolean).join('   ·   ') || 'No account details yet'}</div>
            {s.loginUrl && <div className="hint"><a href={s.loginUrl} target="_blank" rel="noopener noreferrer">Open {s.name}</a></div>}
            {s.notes && <div className="hint" style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</div>}
          </div>
          <div className="acts"><Chip tone={(SERVICE_STATUS[s.status] || ['mute', s.status])[0]}>{(SERVICE_STATUS[s.status] || ['mute', s.status])[1]}</Chip><button className="btn sm ghost" onClick={() => setEdit(s)}>Edit</button></div>
        </div>
      ))}
      {edit !== undefined && <ServiceForm s={edit} onClose={() => setEdit(undefined)} onDone={() => { setEdit(undefined); reload(); }} />}
    </Panel>
  );
}

const LEAD_STATUS: [string, string][] = [['new', 'New'], ['contacted', 'Contacted'], ['demo', 'Demo booked'], ['won', 'Won'], ['lost', 'Lost']];
export function Leads() {
  const toast = useToast();
  const [data, error] = useApi<{ items: any[] }>('/api/admin/leads');
  const [msg, setMsg] = useState<any | null>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Loading />;
  async function setStatus(l: any, status: string) { try { await patch(`/api/admin/leads/${l.id}`, { status }); toast('Saved'); } catch (e) { toast(errText(e)); } }
  return (
    <Panel title="Requests from ground owners">
      <Table rows={data.items} empty="No requests yet." cols={[
        { head: 'Who', cell: (l) => <><b>{l.business}</b><div className="small muted">{l.name}{l.city ? ', ' + l.city : ''}</div></> },
        { head: 'Contact', cell: (l) => <span className="small">{l.phone}<br />{l.email}</span> },
        { head: 'Grounds', cell: (l) => l.grounds || '', num: true },
        { head: 'Status', cell: (l) => <select className="inp sm" defaultValue={l.status} aria-label="Status" onChange={(e) => setStatus(l, e.target.value)}>{LEAD_STATUS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select> },
        { head: '', cell: (l) => l.message ? <button className="btn sm ghost" onClick={() => setMsg(l)}>Message</button> : null },
      ]} />
      {msg && <Modal title={msg.business} onClose={() => setMsg(null)}><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{msg.message}</p></Modal>}
    </Panel>
  );
}
