// Settings › Connections, Shared spreadsheet: one business's workbook shared with people outside the desk. Daji sends its own tabs
// (bookings, open slots, customers, payments) and reads the "Booking requests" tab back into a review list. Accepting a row makes an
// ordinary enquiry; nothing read from a sheet becomes a booking or money by itself.
import { useRef, useState } from 'react';
import { aiName, download, fmtDate, fmtDateTime, formatPhone, post, put, sendFile, useApi } from '../../lib';
import { Chip, Confirm, ErrorBox, Loading, Table, Tabs, useToast } from '../../ui';
import { useSession } from '../../App';
import { Panel, errText } from './common';

interface Run { id: string; direction: 'push' | 'pull'; via: string; ok: boolean; counts: Record<string, number>; message: string; at: number }
interface Sheet {
  provider: 'file' | 'excel' | 'google'; providers: { id: 'file' | 'excel' | 'google'; name: string; ready: boolean; note: string }[];
  connected: boolean; account: string | null; file: { name: string | null; url: string | null } | null; problem: string | null;
  pushTabs: string[]; pullRequests: boolean; includeContacts: boolean; autoSync: boolean; grounds: { id: string; name: string }[]; groundIds: string[]; tabNames: Record<string, string>; requestsTab: string; requestHeaders: string[];
  inbox: { waiting: number; invalid: number; accepted: number; rejected: number }; lastPush: Run | null; lastPull: Run | null; runs: Run[]; canChange: boolean; vault: boolean;
}
interface Item { id: string; line: number; status: string; problems: string[]; reason: string | null; enquiryId: string | null; createdAt: number; date: string | null; start: string | null; hours: number | null; ground: string | null; name: string; phone: string | null; players: number | null; note: string; free: boolean | null }

const TAB_LABEL: [string, string][] = [['bookings', 'Bookings'], ['slots', 'Open slots'], ['customers', 'Customers'], ['payments', 'Payments']];
const SIGN_IN_WORD: Record<string, [boolean, string]> = {
  connected: [true, 'Signed in. Now paste the link of the workbook below.'],
  refused: [false, 'The sign-in was cancelled or refused, so nothing was linked.'],
  expired: [false, 'That sign-in took too long or was already used. Press Sign in again.'],
  failed: [false, 'The sign-in did not work. The reason is shown on the card.'],
};

export default function SharedSheet() {
  const { me } = useSession();
  const [data, error, reload] = useApi<Sheet>('/api/desk/sheets');
  const back = /\/sheet-(\w+)/.exec(location.hash)?.[1];
  if (error) return <Panel title="Shared spreadsheet"><ErrorBox msg={`Could not load the shared spreadsheet: ${error}`} /><button className="btn sm" style={{ marginTop: 10 }} onClick={reload}>Try again</button></Panel>;
  if (!data) return <Panel title="Shared spreadsheet"><Loading h={160} /></Panel>;
  const linked = data.provider !== 'file' && data.connected && !!data.file;
  return (
    <div className="stack">
      <Panel title="Shared spreadsheet" note={<>Keep a spreadsheet with people outside the desk. Daji writes the bookings, slots, customers and payments of the grounds you choose into it, and reads booking requests back for the team to check. Nothing of the other grounds goes in. {aiName()} can answer questions about it.</>}>
        <div className="stack">
          {back && SIGN_IN_WORD[back] && <div className={SIGN_IN_WORD[back]![0] ? 'ok-text' : 'err-text'} role="status">{SIGN_IN_WORD[back]![1]}</div>}
          {data.problem && <ErrorBox msg={`Problem: ${data.problem}`} />}
          <Status s={data} />
          {data.canChange && <Settings s={data} onSaved={reload} />}
          {data.canChange && data.provider !== 'file' && <Link s={data} onDone={reload} />}
          <Actions s={data} linked={linked} canSend={data.canChange} onDone={reload} />
          <History runs={data.runs} />
        </div>
      </Panel>
      {(data.pullRequests || data.inbox.waiting + data.inbox.invalid > 0) && <Review counts={data.inbox} onChange={reload} canReview={me.role !== 'staff' || !me.readOnly} />}
    </div>
  );
}

function Status({ s }: { s: Sheet }) {
  const kind = s.providers.find((p) => p.id === s.provider)?.name ?? s.provider;
  const run = (r: Run | null, what: string) => r ? <div className="small">{what} {fmtDateTime(r.at)}: <span className={r.ok ? '' : 'err-text'}>{r.ok ? '' : 'failed. '}{r.message}</span></div> : <div className="small muted">Not {what.toLowerCase()} yet.</div>;
  return (
    <div className="dl-line" style={{ alignItems: 'flex-start' }}>
      <div className="stack" style={{ gap: 4 }}>
        <div><b>{kind}</b>{s.account && <span className="small muted"> · signed in as {s.account}</span>}</div>
        {s.file && <div className="small">Workbook: {s.file.url ? <a href={s.file.url} target="_blank" rel="noopener noreferrer">{s.file.name || 'open it'}</a> : s.file.name}</div>}
        {run(s.lastPush, 'Sent')}
        {s.pullRequests && run(s.lastPull, 'Read')}
      </div>
      <div className="acts">
        {s.provider === 'file' ? <Chip tone="info">Download and upload</Chip> : s.connected && s.file ? <Chip tone={s.problem ? 'bad' : 'good'}>{s.problem ? 'Needs attention' : s.autoSync ? 'Linked, every 15 minutes' : 'Linked'}</Chip> : <Chip tone="warn">{s.connected ? 'Paste the workbook link' : 'Sign in to link'}</Chip>}
      </div>
    </div>
  );
}

function Settings({ s, onSaved }: { s: Sheet; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ provider: s.provider, pushTabs: s.pushTabs, includeContacts: s.includeContacts, pullRequests: s.pullRequests, autoSync: s.autoSync, groundIds: s.groundIds });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const switching = f.provider !== s.provider;
  async function save() {
    setBusy(true); setErr(null);
    try { await put('/api/desk/sheets', { ...f, autoSync: switching ? false : f.autoSync }); toast('Saved'); onSaved(); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  const tick = (k: string) => setF((x) => ({ ...x, pushTabs: x.pushTabs.includes(k) ? x.pushTabs.filter((t) => t !== k) : [...x.pushTabs, k] }));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: '14px 0 0' }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Which spreadsheet</legend>
        {s.providers.map((p) => (
          <label key={p.id} className="row" style={{ gap: 8, alignItems: 'flex-start', opacity: p.ready ? 1 : 0.6 }}>
            <input type="radio" name="sheet-provider" checked={f.provider === p.id} disabled={!p.ready} onChange={() => setF((x) => ({ ...x, provider: p.id }))} />
            <span><span className="small" style={{ fontWeight: 600 }}>{p.name}</span><span className="hint" style={{ display: 'block', marginTop: 0 }}>{p.note}</span></span>
          </label>
        ))}
        {switching && s.connected && <div className="hint">Changing this forgets the current sign-in and workbook link.</div>}
      </fieldset>
      {s.grounds.length > 1 && <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: '14px 0 0' }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Which grounds</legend>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          {s.grounds.map((g) => <label key={g.id} className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.groundIds.includes(g.id)} onChange={() => setF((x) => ({ ...x, groundIds: x.groundIds.includes(g.id) ? x.groundIds.filter((i) => i !== g.id) : [...x.groundIds, g.id] }))} />{g.name}</label>)}
        </div>
        <div className="hint" style={{ marginTop: 0 }}>{f.groundIds.length ? 'Only the ticked grounds: their bookings, open slots, customers and payments, and requests for them. Nothing of the other grounds goes into the sheet.' : 'None ticked means every ground.'}</div>
      </fieldset>}
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: '14px 0 0' }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>What Daji sends</legend>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          {TAB_LABEL.map(([k, l]) => <label key={k} className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.pushTabs.includes(k)} onChange={() => tick(k)} />{l}</label>)}
        </div>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.includeContacts} onChange={(e) => setF((x) => ({ ...x, includeContacts: e.target.checked }))} />Include customers' phone numbers and emails</label>
        {f.includeContacts && <div className="hint" style={{ marginTop: 0 }}>Everyone who can open the spreadsheet will see them. Share it only with people who should.</div>}
        <div className="hint" style={{ marginTop: 0 }}>Bookings from {30} days back to {90} days ahead, open slots for the next 14 days, and payments of the last 90 days. Amounts are in rupees.</div>
      </fieldset>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: '14px 0 0' }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>What Daji reads</legend>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.pullRequests} onChange={(e) => setF((x) => ({ ...x, pullRequests: e.target.checked }))} />Read the "{s.requestsTab}" tab into the review list below</label>
        <div className="hint" style={{ marginTop: 0 }}>Columns: {s.requestHeaders.join(', ')}. Rows are checked, then wait for the team. Nothing read from the sheet becomes a booking or a payment by itself.</div>
        {f.provider !== 'file' && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.autoSync && !switching} disabled={switching || !s.file} onChange={(e) => setF((x) => ({ ...x, autoSync: e.target.checked }))} />Send and read by itself every 15 minutes{!s.file && ' (link the workbook first)'}</label>}
      </fieldset>
      {err && <ErrorBox msg={err} />}
      <div><button className="btn sm primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
    </div>
  );
}

function Link({ s, onDone }: { s: Sheet; onDone: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const word = s.provider === 'excel' ? 'Microsoft' : 'Google';
  async function signIn() {
    setBusy(true); setErr(null);
    try { const r = await post<{ url: string }>('/api/desk/sheets/signin', {}); location.href = r.url; } catch (e) { setErr(errText(e)); setBusy(false); }
  }
  async function link() {
    if (!url.trim()) { setErr('Paste the link of the workbook first.'); return; }
    setBusy(true); setErr(null);
    try { await post('/api/desk/sheets/file', { url: url.trim() }); toast('Workbook linked'); setUrl(''); onDone(); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }
  async function disconnect() {
    try { await post('/api/desk/sheets/disconnect', {}); toast('Disconnected'); onDone(); } catch (e) { setErr(errText(e)); }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!s.connected ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm primary" disabled={busy} onClick={signIn}>Sign in with {word}</button>
          <span className="hint" style={{ marginTop: 0 }}>Use the account that can edit the workbook. Daji keeps the sign-in locked in the server and never shows it.</span>
        </div>
      ) : (
        <>
          <label className="small" style={{ fontWeight: 600 }} htmlFor="sheet-url">{s.file ? 'Link another workbook' : 'Workbook link'}</label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input id="sheet-url" className="inp" style={{ flex: '1 1 260px' }} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder={s.provider === 'excel' ? 'In Excel press Share, then Copy link, and paste it here' : 'https://docs.google.com/spreadsheets/d/…'} />
            <button className="btn sm" disabled={busy} onClick={link}>{busy ? 'Checking…' : 'Check and link'}</button>
          </div>
          <div className="row" style={{ gap: 8 }}><Confirm label="Disconnect" className="btn sm ghost" ask="Forget the sign-in and the workbook link?" onYes={disconnect} /></div>
        </>
      )}
      {err && <ErrorBox msg={err} />}
    </div>
  );
}

function Actions({ s, linked, canSend, onDone }: { s: Sheet; linked: boolean; canSend: boolean; onDone: () => void }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function act(what: string, fn: () => Promise<Run | void>) {
    setBusy(what); setMsg(null);
    try { const r = await fn(); if (r) setMsg({ ok: r.ok, text: r.message }); else toast('Downloaded'); onDone(); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(null);
  }
  const working = busy !== null;
  const upload = (f: File) => act('upload', () => sendFile<Run>(`/api/desk/sheets/upload?filename=${encodeURIComponent(f.name)}`, f));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={working} onClick={() => act('download', () => download('/api/desk/sheets/download', `daji-sheet-${new Date().toISOString().slice(0, 10)}.xlsx`))}>{busy === 'download' ? 'Preparing…' : 'Download workbook'}</button>
        {s.pullRequests && <>
          <button className="btn sm" disabled={working} onClick={() => file.current?.click()}>{busy === 'upload' ? 'Reading…' : 'Upload filled workbook'}</button>
          <input ref={file} type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        </>}
        {linked && canSend && <button className="btn sm primary" disabled={working} onClick={() => act('push', () => post<Run>('/api/desk/sheets/push', {}))}>{busy === 'push' ? 'Sending…' : 'Send now'}</button>}
        {linked && s.pullRequests && <button className="btn sm" disabled={working} onClick={() => act('pull', () => post<Run>('/api/desk/sheets/pull', {}))}>{busy === 'pull' ? 'Reading…' : 'Read requests now'}</button>}
      </div>
      {msg && <div className={msg.ok ? 'ok-text' : 'err-text'} role="status">{msg.ok ? '' : 'Failed: '}{msg.text}</div>}
    </div>
  );
}

function History({ runs }: { runs: Run[] }) {
  const [open, setOpen] = useState(false);
  if (!runs.length) return null;
  const VIA: Record<string, string> = { download: 'Download', upload: 'Upload', excel: 'Excel', google: 'Google Sheets' };
  return (
    <div>
      <button className="btn sm ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide history' : `History (${runs.length})`}</button>
      {open && <div className="tbl-wrap" style={{ marginTop: 6 }}><Table rows={runs} rowKey={(r) => r.id} cols={[
        { head: 'When', cell: (r) => fmtDateTime(r.at) },
        { head: 'What', cell: (r) => `${r.direction === 'push' ? 'Sent' : 'Read'} · ${VIA[r.via] ?? r.via}` },
        { head: 'Result', cell: (r) => <span className={r.ok ? '' : 'err-text'}>{r.ok ? '' : 'Failed: '}{r.message}</span> },
      ]} /></div>}
    </div>
  );
}

function Review({ counts, onChange, canReview }: { counts: Sheet['inbox']; onChange: () => void; canReview: boolean }) {
  const toast = useToast();
  const [tab, setTab] = useState<'waiting' | 'invalid' | 'accepted' | 'rejected'>(counts.waiting || !counts.invalid ? 'waiting' : 'invalid');
  const [data, error, reload] = useApi<{ items: Item[] }>(`/api/desk/sheets/inbox?status=${tab}`, [tab]);
  const [err, setErr] = useState<string | null>(null);
  async function decide(it: Item, accept: boolean) {
    setErr(null);
    try {
      const r = await post<Item>(`/api/desk/sheets/inbox/${encodeURIComponent(it.id)}/${accept ? 'accept' : 'reject'}`, {});
      toast(accept ? `Added to Enquiries for ${r.name}` : 'Marked as not taken'); reload(); onChange();
    } catch (e) { setErr(errText(e)); }
  }
  const when = (it: Item) => it.date ? `${fmtDate(it.date)}${it.start ? `, ${it.start}` : ''}${it.hours ? ` for ${it.hours} h` : ''}` : '';
  return (
    <Panel title="Booking requests from the sheet" note="Each row is checked against this business's grounds. Accept makes an enquiry; book it from Enquiries, where Daji confirms the time and the price.">
      <Tabs label="Requests" value={tab} onChange={setTab} items={[['waiting', `To review (${counts.waiting})`], ['invalid', `Needs fixing (${counts.invalid})`], ['accepted', `Accepted (${counts.accepted})`], ['rejected', `Not taken (${counts.rejected})`]]} />
      <div style={{ marginTop: 10 }}>
        {err && <ErrorBox msg={err} />}
        {error ? <ErrorBox msg={`Could not load the requests: ${error}`} /> : !data ? <Loading h={120} /> : (
          <div className="tbl-wrap"><Table rows={data.items} rowKey={(r) => r.id}
            empty={tab === 'waiting' ? 'No requests waiting. Upload the filled workbook or read the linked sheet to bring new ones in.' : 'Nothing here.'}
            cols={[
              { head: 'Line', cell: (r) => r.line, num: true, width: 50 },
              { head: 'When', cell: (r) => when(r) || <span className="muted">{r.problems.find((p) => /^(Date|Start)/.test(p)) ?? '-'}</span> },
              { head: 'Ground', cell: (r) => r.ground ?? '-' },
              { head: 'Who', cell: (r) => <>{r.name || '-'}{r.phone && <div className="small muted">{formatPhone(r.phone)}</div>}</> },
              { head: 'Note', cell: (r) => <>{r.note}{r.players ? <div className="small muted">{r.players} players</div> : null}</> },
              { head: tab === 'invalid' ? 'What to fix' : 'Status', cell: (r) => tab === 'invalid' ? <span className="small err-text">{r.problems.join('; ')}</span>
                : tab === 'waiting' ? (r.free === true ? <Chip tone="good">Free now</Chip> : r.free === false ? <Chip tone="warn">Not free now</Chip> : <Chip>Check</Chip>)
                : tab === 'accepted' ? <a href="#/enquiries">In Enquiries</a> : <span className="small muted">{r.reason || 'Not taken'}</span> },
              ...(canReview && (tab === 'waiting' || tab === 'invalid') ? [{ head: '', cell: (r: Item) => (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  {tab === 'waiting' && <button className="btn sm primary" onClick={() => decide(r, true)}>Accept</button>}
                  <Confirm label="Not taking it" className="btn sm ghost" ask="Mark as not taken?" onYes={() => decide(r, false)} />
                </div>) }] : []),
            ]} /></div>
        )}
      </div>
    </Panel>
  );
}
