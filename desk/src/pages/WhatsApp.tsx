// Work › WhatsApp (wainbox.ts, redesign addendum step 7): what the team sends to the business number, kept exactly as it came.
// A person puts each message against a job, a project or a cash spend, turns it into a request for the jobs inbox, replies, or
// sets it aside with a reason. Nothing is filed by a guess: a suggestion is only a suggestion. WhatsApp lets a business read
// one-to-one chats with its number only, not group chats, and allows a typed reply only within 24 hours of the person's last message.
import { useEffect, useState } from 'react';
import { fetchBlob, fmtDateTime, put, post, useApi } from '../lib';
import { useSession } from '../App';
import { isMainBusiness } from '../registry';
import { Chip, ErrorBox, Field, Load, Modal, PageHead, Stat, Table, Tabs, useToast, type Tone } from '../ui';
import { Panel, errText } from '../parts/admin/common';

type LinkKind = 'task' | 'project' | 'cash';
interface Link { id: string; kind: LinkKind; recordId: string; title: string | null; why: string | null; byName: string | null; at: number }
interface Msg {
  id: string; direction: 'in' | 'out'; from: string; personId: string | null; personName: string | null; profileName: string | null; onTeam: boolean;
  kind: string; text: string | null; hasMedia: boolean; mediaState: 'none' | 'waiting' | 'stored' | 'failed' | 'rejected'; mediaMime: string | null; mediaName: string | null; mediaError: string | null;
  sentAt: number; receivedAt: number; state: 'review' | 'filed' | 'dismissed' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  suggestion: { kind: LinkKind | 'none'; recordId: string | null; why: string; title: string | null } | null;
  links: Link[]; reviewedByName: string | null; reviewNote: string | null; canReply: boolean; replyClosesAt: number | null;
}
interface Status { enabled: boolean; connected: boolean | null; inboxHere: boolean; counts: { review: number; filed: number; dismissed: number; mediaFailed: number; mediaWaiting: number; sendsFailed: number }; lastDelivery: { at: number; outcome: string } | null }
type Tab = 'review' | 'filed' | 'dismissed' | 'failed' | 'all';

const STATE: Record<Msg['state'], [Tone, string]> = {
  review: ['warn', 'To review'], filed: ['good', 'Filed'], dismissed: ['mute', 'Set aside'],
  sending: ['info', 'Sending'], sent: ['info', 'Sent'], delivered: ['good', 'Delivered'], read: ['good', 'Read'], failed: ['bad', 'Not sent'],
};
const KIND: Record<string, string> = { text: 'Message', image: 'Photo', video: 'Video', audio: 'Voice note', document: 'Document', sticker: 'Sticker', location: 'Location', contacts: 'Contact', interactive: 'Answer', button: 'Answer', reaction: 'Reaction', unsupported: 'Not supported by WhatsApp' };
const LINK: Record<LinkKind, string> = { task: 'Job', project: 'Project', cash: 'Cash spend' };
const who = (m: Msg) => (m.direction === 'out' ? 'Reply from the business' : m.personName ?? m.profileName ?? m.from);
const key = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export default function WhatsApp() {
  const { me, ownerId } = useSession();
  const boss = me.role !== 'staff';
  const [tab, setTab] = useState<Tab>('review');
  const [status, sErr, reloadStatus] = useApi<Status>('/api/whatsapp/status', [ownerId]);
  const [list, lErr, reloadList] = useApi<{ items: Msg[] }>(`/api/whatsapp/messages?state=${tab}`, [ownerId, tab]);
  const [open, setOpen] = useState<string | null>(null);
  const reload = () => { reloadStatus(); reloadList(); };
  return (
    <div className="stack">
      <PageHead eyebrow="Work" title="WhatsApp" lede="Photos, receipts, voice notes and messages the team sends to the business number. Put each one against a job, a project or a cash spend; nothing is filed by a guess.">
        {boss && status && isMainBusiness() && <Switch on={status.enabled} onDone={reload} />}
      </PageHead>
      {sErr && <ErrorBox msg={sErr} />}
      {status && <Banner s={status} />}
      {status && (
        <div className="grid g4">
          <Stat label="To review" value={status.counts.review} foot="Waiting for someone to file them" />
          <Stat label="Filed" value={status.counts.filed} foot="On a job, project or cash spend" />
          <Stat label="Files to fix" value={status.counts.mediaFailed} foot={status.counts.mediaWaiting ? `${status.counts.mediaWaiting} still being fetched` : 'Not fetched, or failed the virus check'} />
          <Stat label="Replies not sent" value={status.counts.sendsFailed} foot="WhatsApp refused them" />
        </div>
      )}
      <div className="tabs-scroll"><Tabs value={tab} onChange={setTab} label="Show" items={[['review', 'To review'], ['filed', 'Filed'], ['dismissed', 'Set aside'], ['failed', 'Problems'], ['all', 'All']]} /></div>
      <Panel title={tab === 'review' ? 'Waiting for review' : tab === 'filed' ? 'Filed' : tab === 'dismissed' ? 'Set aside' : tab === 'failed' ? 'Files and replies with a problem' : 'Every message'}
        note="A message on a job or project is seen only by people who may see that job or project.">
        <Load data={list} error={lErr} retry={reloadList} isEmpty={(d) => !d.items.length} empty={tab === 'review' ? 'Nothing waiting. New messages to the business number show here.' : 'Nothing here.'}>
          {(d) => <Table rows={d.items} rowKey={(m) => m.id} onRow={(m) => setOpen(m.id)} cols={[
            { head: 'From', cell: (m) => <span><b>{who(m)}</b>{m.direction === 'in' && !m.onTeam && <span className="muted small"> · not on the team</span>}</span> },
            { head: 'What', cell: (m) => <span>{m.kind !== 'text' && <Chip tone="info">{KIND[m.kind] ?? m.kind}</Chip>} {m.text ? (m.text.length > 90 ? `${m.text.slice(0, 90)}…` : m.text) : m.kind === 'text' ? '' : <span className="muted small">No words</span>}{m.mediaState === 'failed' || m.mediaState === 'rejected' ? <span className="small"> <Chip tone="bad">{m.mediaState === 'rejected' ? 'Failed virus check' : 'File not fetched'}</Chip></span> : null}</span> },
            { head: 'Where', cell: (m) => m.links.length ? m.links.map((l) => `${LINK[l.kind]}: ${l.title ?? ''}`).join('; ') : m.suggestion && m.suggestion.kind !== 'none' ? <span className="muted small">Suggested: {m.suggestion.title ?? LINK[m.suggestion.kind]}</span> : <span className="muted small">Not filed</span> },
            { head: 'When', cell: (m) => fmtDateTime(m.sentAt) },
            { head: 'Status', cell: (m) => <Chip tone={STATE[m.state][0]}>{STATE[m.state][1]}</Chip> },
          ]} />}
        </Load>
      </Panel>
      {tab === 'failed' && boss && <Deliveries />}
      <p className="hint">WhatsApp lets a business read one-to-one chats with its number only. Messages in a WhatsApp group do not arrive here: ask the team to send them to the business number.</p>
      {open && <Detail id={open} boss={boss} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function Banner({ s }: { s: Status }) {
  if (!s.enabled) return <div className="state state-partial" role="status"><b>Messages coming in are switched off.</b><span className="small">Nothing sent to the business number is kept until the owner switches this on. Check the WhatsApp account's messaging limits first (Settings › Connections).</span></div>;
  if (s.connected === false) return <div className="state state-partial" role="status"><b>WhatsApp is not fully set up.</b><span className="small">Messages may not arrive. See Settings › Connections, "WhatsApp messages coming in".</span></div>;
  return null;
}

function Switch({ on, onDone }: { on: boolean; onDone: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const flip = async () => {
    try { await put('/api/admin/settings', { whatsappInboundEnabled: !on }); toast(on ? 'Messages coming in are switched off.' : 'Messages coming in are switched on.'); setAsking(false); onDone(); } catch (e) { toast(errText(e)); }
  };
  if (on) return <button className="btn" onClick={() => void flip()}>Switch off</button>;
  if (!asking) return <button className="btn primary" onClick={() => setAsking(true)}>Switch on</button>;
  return <span className="row" style={{ gap: 6 }}><span className="small muted">Limits checked in WhatsApp Manager?</span><button className="btn sm primary" onClick={() => void flip()}>Yes, switch on</button><button className="btn sm ghost" onClick={() => setAsking(false)}>Not yet</button></span>;
}

function Deliveries() {
  const [d, err, reload] = useApi<{ items: { at: number; to: string | null; error: string | null; reply: boolean }[] }>('/api/whatsapp/deliveries');
  return (
    <Panel title="Messages WhatsApp could not deliver" note="Anything the business number sent: sign-in codes, alerts, waitlist offers and replies. Numbers show their last four digits.">
      <Load data={d} error={err} retry={reload} isEmpty={(x) => !x.items.length} empty="WhatsApp has not reported any failed delivery.">
        {(x) => <Table rows={x.items} cols={[{ head: 'When', cell: (r) => fmtDateTime(r.at) }, { head: 'To', cell: (r) => r.to ?? '' }, { head: 'What', cell: (r) => (r.reply ? 'A reply' : 'Code, alert or offer') }, { head: 'Why', cell: (r) => r.error ?? 'No reason given' }]} />}
      </Load>
    </Panel>
  );
}

function Media({ m }: { m: Msg }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const image = !!m.mediaMime && /^image\//.test(m.mediaMime);
  useEffect(() => {
    if (m.mediaState !== 'stored' || !image) return;
    let u: string | null = null;
    fetchBlob(`/api/whatsapp/messages/${encodeURIComponent(m.id)}/media`).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch((e) => setErr(errText(e)));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [m.id, m.mediaState, image]);
  const openFile = async () => { try { window.open(URL.createObjectURL(await fetchBlob(`/api/whatsapp/messages/${encodeURIComponent(m.id)}/media`)), '_blank', 'noopener'); } catch (e) { setErr(errText(e)); } };
  if (!m.hasMedia) return null;
  if (m.mediaState === 'waiting') return <p className="hint">The file is being fetched from WhatsApp and checked for viruses.</p>;
  if (m.mediaState === 'rejected') return <p className="err">The file did not pass the virus check, so it was not kept.</p>;
  if (m.mediaState === 'failed') return <p className="err">The file could not be fetched: {m.mediaError}</p>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {image && url && <img src={url} alt={m.text ?? 'Photo sent by WhatsApp'} style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8, objectFit: 'contain' }} />}
      {!image && <button className="btn sm" onClick={() => void openFile()}>Open {m.mediaName ?? KIND[m.kind]?.toLowerCase() ?? 'file'}</button>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function Detail({ id, boss, onClose, onChanged }: { id: string; boss: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [d, err, reload] = useApi<{ message: Msg; conversation: Msg[] }>(`/api/whatsapp/messages/${encodeURIComponent(id)}`, [id]);
  const [mode, setMode] = useState<null | 'file' | 'request' | 'reply' | 'dismiss'>(null);
  const done = (msg: string) => { toast(msg); setMode(null); reload(); onChanged(); };
  const act = async (path: string, body: unknown, msg: string) => { try { const r = await post<{ note?: string | null }>(`/api/whatsapp/messages/${encodeURIComponent(id)}/${path}`, body); done(r?.note ? `${msg} ${r.note}` : msg); } catch (e) { toast(errText(e)); } };
  const m = d?.message;
  return (
    <Modal wide title={m ? `${KIND[m.kind] ?? 'Message'} from ${who(m)}` : 'Message'} onClose={onClose}
      foot={m && m.direction === 'in' ? <>
        {m.state !== 'dismissed' && <button className="btn primary" onClick={() => setMode('file')}>Put on a record</button>}
        {m.state !== 'dismissed' && <button className="btn" onClick={() => setMode('request')}>Make a request</button>}
        <button className="btn" onClick={() => setMode('reply')}>Reply</button>
        {m.state === 'review' && <button className="btn ghost" onClick={() => setMode('dismiss')}>Set aside</button>}
        {m.state === 'dismissed' && <button className="btn" onClick={() => void act('restore', {}, 'Back in the review list.')}>Put back for review</button>}
        {m.mediaState === 'failed' && <button className="btn ghost" onClick={() => void act('media/retry', {}, 'The file will be fetched again.')}>Try the file again</button>}
      </> : undefined}>
      <Load data={d} error={err} retry={reload}>
        {(x) => (
          <div className="stack">
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <Chip tone={STATE[x.message.state][0]}>{STATE[x.message.state][1]}</Chip>
              <span className="muted small">{x.message.direction === 'in' ? (x.message.onTeam ? x.message.from : `${x.message.from}, not on the team`) : ''} · sent {fmtDateTime(x.message.sentAt)}</span>
            </div>
            {x.message.text && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{x.message.text}</p>}
            <Media m={x.message} />
            {x.message.suggestion && x.message.links.length === 0 && <p className="hint">Suggestion: {x.message.suggestion.why}{x.message.suggestion.title ? ` (${x.message.suggestion.title})` : ''}</p>}
            {x.message.links.length > 0 && <Links m={x.message} onChanged={() => { reload(); onChanged(); }} />}
            {x.message.reviewNote && <p className="muted small">Set aside: {x.message.reviewNote}{x.message.reviewedByName ? ` (${x.message.reviewedByName})` : ''}</p>}
            {mode === 'file' && <FileOn m={x.message} boss={boss} onCancel={() => setMode(null)} onDone={(kind, recordId) => void act('link', { kind, recordId }, 'Filed.')} />}
            {mode === 'request' && <MakeRequest m={x.message} onCancel={() => setMode(null)} onDone={(title) => void act('request', { title }, 'Request sent to the jobs inbox.')} />}
            {mode === 'reply' && <Reply m={x.message} onCancel={() => setMode(null)} onDone={(text) => void act('reply', { text, clientKey: key() }, 'Reply sent.')} />}
            {mode === 'dismiss' && <Reason label="Why set it aside?" button="Set aside" onCancel={() => setMode(null)} onDone={(reason) => void act('dismiss', { reason }, 'Set aside. It is kept on file.')} />}
            {x.conversation.length > 1 && (
              <div className="stack" style={{ gap: 4 }}>
                <h3 style={{ margin: '8px 0 0' }}>Conversation</h3>
                {x.conversation.map((c) => (
                  <div key={c.id} className="card card-pad" style={{ padding: '8px 12px', marginLeft: c.direction === 'out' ? 32 : 0, marginRight: c.direction === 'in' ? 32 : 0, outline: c.id === x.message.id ? '1px solid var(--gold, #b8962e)' : undefined }}>
                    <div className="small muted">{who(c)} · {fmtDateTime(c.sentAt)} · {STATE[c.state][1]}</div>
                    <div>{c.kind !== 'text' && <Chip tone="info">{KIND[c.kind] ?? c.kind}</Chip>} {c.text}</div>
                  </div>))}
              </div>)}
          </div>)}
      </Load>
    </Modal>
  );
}

function Links({ m, onChanged }: { m: Msg; onChanged: () => void }) {
  const toast = useToast();
  const [taking, setTaking] = useState<Link | null>(null);
  return (
    <div className="stack" style={{ gap: 4 }}>
      {m.links.map((l) => <div key={l.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span><b>{LINK[l.kind]}:</b> {l.title ?? 'not available'}<span className="muted small">{l.why ? ` · ${l.why}` : ''}{l.byName ? ` · by ${l.byName}` : ''}</span></span>
        {m.direction === 'in' && <button className="btn ghost sm" onClick={() => setTaking(l)}>Take off</button>}
      </div>)}
      {taking && <Reason label={`Why take it off ${LINK[taking.kind].toLowerCase()} "${taking.title ?? ''}"?`} button="Take off" onCancel={() => setTaking(null)}
        onDone={async (reason) => { try { await post(`/api/whatsapp/messages/${encodeURIComponent(m.id)}/unlink`, { linkId: taking.id, reason }); toast('Taken off. The link stays on file.'); setTaking(null); onChanged(); } catch (e) { toast(errText(e)); } }} />}
    </div>
  );
}

function FileOn({ m, boss, onCancel, onDone }: { m: Msg; boss: boolean; onCancel: () => void; onDone: (kind: LinkKind, recordId: string) => void }) {
  const sug = m.suggestion && m.suggestion.kind !== 'none' ? m.suggestion.kind : 'task';
  const [kind, setKind] = useState<LinkKind>(sug);
  const [pick, setPick] = useState(m.suggestion?.recordId ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [tasks] = useApi<{ items: { id: string; title: string; status: string }[] }>(kind === 'task' ? '/api/tasks' : null, [kind]);
  const [projects] = useApi<{ items: { id: string; name: string }[] }>(kind === 'project' ? '/api/projects' : null, [kind]);
  const [spends] = useApi<{ items: { id: string; kind: string; description: string; payee: string | null; amountPaise: number; date: string; hidden: boolean }[] }>(kind === 'cash' && m.personId && (boss || m.personId) ? `/api/cash/wallets/${encodeURIComponent(m.personId)}/entries` : null, [kind, m.personId]);
  const options: [string, string][] = kind === 'task' ? (tasks?.items ?? []).filter((t) => t.status === 'open').map((t) => [t.id, t.title])
    : kind === 'project' ? (projects?.items ?? []).map((p) => [p.id, p.name])
    : (spends?.items ?? []).filter((e) => e.kind === 'expense' && !e.hidden).map((e) => [e.id, `${e.date} · ${e.payee ? `${e.payee} · ` : ''}${e.description} · ₹${(e.amountPaise / 100).toLocaleString('en-IN')}`]);
  const submit = () => { if (!pick) { setProblem(`Pick a ${LINK[kind].toLowerCase()} first.`); return; } onDone(kind, pick); };
  return (
    <div className="card card-pad stack">
      <Tabs value={kind} onChange={(k) => { setKind(k); setPick(''); setProblem(null); }} label="Put on" items={[['task', 'A job'], ['project', 'A project'], ['cash', 'A cash spend']]} />
      <Field label={LINK[kind]} hint={kind === 'cash' ? (m.personId ? `Spends entered by ${m.personName}. Enter the spend on the Cash page first if it is not there.` : 'Only a team member who holds cash has spends to pick.') : kind === 'task' ? 'A photo or PDF goes on the job as a reference, never as proof.' : undefined} error={problem}>
        <select className="inp" value={pick} onChange={(e) => { setPick(e.target.value); setProblem(null); }}>
          <option value="">Choose…</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <div className="row"><button className="btn primary" onClick={submit}>File it</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function MakeRequest({ m, onCancel, onDone }: { m: Msg; onCancel: () => void; onDone: (title: string) => void }) {
  const [title, setTitle] = useState((m.text ?? '').split('\n')[0]!.slice(0, 120));
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="card card-pad stack">
      <Field label="Title for the request" hint="It goes to the jobs inbox, where a manager takes it in or turns it down. The message's words go with it." error={problem}>
        <input className="inp" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); setProblem(null); }} />
      </Field>
      <div className="row"><button className="btn primary" onClick={() => (title.trim().length < 3 ? setProblem('At least 3 characters.') : onDone(title.trim()))}>Make the request</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function Reply({ m, onCancel, onDone }: { m: Msg; onCancel: () => void; onDone: (text: string) => void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (!m.canReply) return <div className="card card-pad"><p className="hint" style={{ margin: 0 }}>WhatsApp allows a typed reply only within 24 hours of their last message{m.replyClosesAt ? ` (that closed ${fmtDateTime(m.replyClosesAt)})` : ''}. Ask them to send a message first, or call them.</p><button className="btn ghost sm" onClick={onCancel}>Close</button></div>;
  return (
    <div className="card card-pad stack">
      <Field label="Reply" hint={m.replyClosesAt ? `You can reply until ${fmtDateTime(m.replyClosesAt)}. When they press Reply on it, their answer is filed in the same place.` : undefined} error={problem}>
        <textarea className="inp" rows={3} maxLength={1000} value={text} onChange={(e) => { setText(e.target.value); setProblem(null); }} />
      </Field>
      <div className="row"><button className="btn primary" onClick={() => (text.trim() ? onDone(text.trim()) : setProblem('Write the reply first.'))}>Send</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function Reason({ label, button, onCancel, onDone }: { label: string; button: string; onCancel: () => void; onDone: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="card card-pad stack">
      <Field label={label} error={problem}><input className="inp" value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setProblem(null); }} /></Field>
      <div className="row"><button className="btn primary" onClick={() => (reason.trim().length < 3 ? setProblem('Give a reason of at least 3 characters.') : onDone(reason.trim()))}>{button}</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
