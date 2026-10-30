import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, authImage } from './api';
import { BackBar, Badge, Btn, Chip, Field, Loading, Segmented, Stat, Stats, s } from './ui';
import { C, inr } from './theme';
import type { User } from './types';

// WhatsApp (server/src/wainbox.ts): what the team sends to the business number waits here until a person files it on a job,
// a project or a cash spend, makes it a request, or sets it aside. A suggestion is never filed by itself. The same inbox as
// Work › WhatsApp on the desk, with the same access: owners, and staff who may manage jobs. Switching it on stays on the desk.

type State = 'review' | 'filed' | 'dismissed' | 'failed' | 'all';
type LinkKind = 'task' | 'project' | 'cash';
interface Link { id: string; kind: LinkKind; recordId: string; title: string | null; why: string | null; byName: string | null; at: number; file: 'on_job' | 'coming' | 'not_on_job' | null }
interface Msg {
  id: string; direction: 'in' | 'out'; from: string; personId: string | null; personName: string | null; profileName: string | null; onTeam: boolean;
  kind: string; text: string | null; hasMedia: boolean; mediaState: 'none' | 'waiting' | 'stored' | 'failed' | 'rejected'; mediaMime: string | null; mediaName: string | null; mediaError: string | null;
  sentAt: number; receivedAt: number; state: 'review' | 'filed' | 'dismissed' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  suggestion: { kind: LinkKind | 'none'; recordId: string | null; why: string; title: string | null } | null;
  links: Link[]; reviewedByName: string | null; reviewNote: string | null; canReply: boolean; replyClosesAt: number | null;
}
interface Status { enabled: boolean; connected: boolean | null; inboxHere: boolean; counts: { review: number; filed: number; dismissed: number; mediaFailed: number; mediaWaiting: number; sendsFailed: number; filesNotOnJob: number }; droppedWhileOff: { messages: number; lastAt: number } | null }

const LINK: Record<LinkKind, string> = { task: 'Job', project: 'Project', cash: 'Cash spend' };
const KIND: Record<string, string> = { text: 'Message', image: 'Photo', video: 'Video', audio: 'Voice note', document: 'Document', sticker: 'Sticker', location: 'Location', contacts: 'Contact', unsupported: 'Something WhatsApp could not pass on' };
const STATE: Record<Msg['state'], [string, 'muted' | 'gold' | 'ok' | 'danger' | 'warn']> = {
  review: ['To review', 'warn'], filed: ['Filed', 'ok'], dismissed: ['Set aside', 'muted'], sending: ['Sending', 'muted'], sent: ['Sent', 'muted'], delivered: ['Delivered', 'ok'], read: ['Read', 'ok'], failed: ['Not sent', 'danger'],
};
const when = (ms: number) => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const who = (m: Msg) => m.personName ?? m.profileName ?? m.from;
const key = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const GROUPS = 'WhatsApp passes on one-to-one chats with the business number only. Messages in a WhatsApp group never arrive here, so ask the team to send updates to the business number.';

export function WhatsAppScreen({ user }: { user: User }) {
  const boss = user.role !== 'staff';
  const [tab, setTab] = useState<State>('review');
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<Msg[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [st, list] = await Promise.all([api<Status>('/api/whatsapp/status'), api<{ items: Msg[] }>(`/api/whatsapp/messages?state=${tab}`)]);
      setStatus(st); setItems(list.items); setErr('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

  if (open) return <Detail id={open} boss={boss} onBack={() => { setOpen(null); void load(); }} />;
  const c = status?.counts;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <Text style={s.eyebrow}>Work</Text><Text style={s.h1}>WhatsApp</Text>
      <Text style={[s.muted, { marginBottom: 12 }]}>Messages, photos and files the team sends to the business number. You decide where each one goes; nothing is filed on a guess.</Text>
      {status && !status.enabled && <View style={[s.card, { borderColor: C.gold }]}><Text style={[s.text, { fontWeight: '700', marginBottom: 4 }]}>Switched off</Text><Text style={s.muted}>Messages coming in are not kept while this is off. {boss ? 'The owner switches it on under Work › WhatsApp on the desk, after the steps in Settings › Connections.' : 'The owner switches it on.'} Anything kept before stays here.{status.droppedWhileOff ? ` ${status.droppedWhileOff.messages} message${status.droppedWhileOff.messages === 1 ? '' : 's'} arrived while it was off (last ${when(status.droppedWhileOff.lastAt)}) and ${status.droppedWhileOff.messages === 1 ? 'was' : 'were'} not kept; WhatsApp does not send them again.` : ''}</Text></View>}
      {status?.enabled && status.connected === false && <View style={[s.card, { borderColor: C.gold }]}><Text style={s.muted}>Switched on, but the WhatsApp settings are not complete on the server, so nothing new arrives yet. See Settings › Connections.</Text></View>}
      {status?.enabled && !status.inboxHere && <Text style={[s.muted, { marginBottom: 8 }]}>Messages from numbers not on any team go to the main business. Your team's messages still come here.</Text>}
      {c && <Stats>
        <Stat label="To review" value={String(c.review)} />
        <Stat label="Filed" value={String(c.filed)} />
        <Stat label="Files to fix" value={String(c.mediaFailed)} tone={c.mediaFailed ? 'danger' : undefined} foot={[c.mediaWaiting ? `${c.mediaWaiting} still coming` : '', c.filesNotOnJob ? `${c.filesNotOnJob} not on their job yet` : ''].filter(Boolean).join(' · ') || undefined} />
        <Stat label="Replies not sent" value={String(c.sendsFailed)} tone={c.sendsFailed ? 'danger' : undefined} />
      </Stats>}
      <View style={{ marginVertical: 10 }}><Segmented<State> items={[['review', 'To review'], ['filed', 'Filed'], ['dismissed', 'Set aside'], ['failed', 'Problems'], ['all', 'All']]} value={tab} onChange={(t) => { setTab(t); setItems(null); }} /></View>
      {!!err && <Text style={s.err}>{err}</Text>}
      {items === null ? (err ? null : <Loading />) : !items.length ? <Text style={s.muted}>{tab === 'review' ? 'Nothing waiting for review.' : 'Nothing here.'}</Text> : items.map((m) => (
        <Pressable key={m.id} accessibilityRole="button" onPress={() => setOpen(m.id)} style={s.card}>
          <View style={[s.row, { marginBottom: 4 }]}>
            <Text style={[s.text, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{m.direction === 'out' ? `To ${who(m)}` : who(m)}</Text>
            <Text style={s.muted}>{when(m.receivedAt)}</Text>
          </View>
          <Text style={s.text} numberOfLines={2}>{m.text || KIND[m.kind] || m.kind}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <Badge tone={STATE[m.state][1]} label={STATE[m.state][0]} />
            {!m.onTeam && m.direction === 'in' && <Badge label="Not on the team" />}
            {m.hasMedia && <Badge tone={m.mediaState === 'failed' || m.mediaState === 'rejected' ? 'danger' : 'muted'} label={m.mediaState === 'stored' ? KIND[m.kind] ?? 'File' : m.mediaState === 'waiting' ? 'File coming' : 'File not kept'} />}
            {m.state === 'review' && m.suggestion && m.suggestion.kind !== 'none' && <Badge tone="gold" label={`Suggested: ${LINK[m.suggestion.kind]}${m.suggestion.title ? ` · ${m.suggestion.title}` : ''}`} />}
            {m.links.map((l) => <Badge key={l.id} tone="ok" label={`${LINK[l.kind]} · ${l.title ?? ''}`} />)}
          </View>
        </Pressable>))}
      <Text style={[s.muted, { marginTop: 12 }]}>{GROUPS}</Text>
    </ScrollView>
  );
}

function Detail({ id, boss, onBack }: { id: string; boss: boolean; onBack: () => void }) {
  const [data, setData] = useState<{ message: Msg; conversation: Msg[] } | null>(null);
  const [mode, setMode] = useState<null | 'file' | 'request' | 'reply' | 'dismiss' | { unlink: Link }>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api(`/api/whatsapp/messages/${encodeURIComponent(id)}`)); setErr(''); } catch (e: any) { setErr(e.message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const path = `/api/whatsapp/messages/${encodeURIComponent(id)}`;
  const act = async (what: string, body: unknown, done: (r: any) => string) => {
    if (busy) return;
    setBusy(true); setErr('');
    try { const r = await api(`${path}/${what}`, { method: 'POST', body }); setNote(done(r)); setMode(null); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (!data) return <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]}><BackBar title="WhatsApp" onBack={onBack} />{err ? <Text style={s.err}>{err}</Text> : <Loading />}</ScrollView>;
  const m = data.message;
  const inbound = m.direction === 'in';
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
      <BackBar title={who(m)} onBack={onBack} />
      <Text style={[s.muted, { marginBottom: 8 }]}>{m.from}{m.profileName && m.personName ? ` · WhatsApp name ${m.profileName}` : ''}{!m.onTeam ? ' · not on the team' : ''}</Text>
      {!!note && <Text style={[s.text, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      {!!err && <Text style={s.err}>{err}</Text>}

      <View style={s.card}>
        <View style={[s.row, { marginBottom: 6 }]}><Text style={s.muted}>{KIND[m.kind] ?? m.kind} · {when(m.sentAt)}</Text><Badge tone={STATE[m.state][1]} label={STATE[m.state][0]} /></View>
        {!!m.text && <Text style={s.text} selectable>{m.text}</Text>}
        <Media m={m} />
        {m.hasMedia && (m.mediaState === 'failed' || m.mediaState === 'rejected') && <>
          <Text style={[s.muted, { color: C.danger, marginTop: 6 }]}>{m.mediaState === 'rejected' ? 'The file failed the safety check and was not kept.' : `The file could not be fetched from WhatsApp${m.mediaError ? `: ${m.mediaError}` : ''}.`}</Text>
          {m.mediaState === 'failed' && <Btn kind="outline" label="Try again" busy={busy} onPress={() => void act('media/retry', {}, () => 'It will be fetched again in the next few minutes.')} style={{ marginTop: 8 }} />}
        </>}
        {m.state === 'review' && m.suggestion && <Text style={[s.muted, { marginTop: 8, color: m.suggestion.kind === 'none' ? C.muted : C.gold }]}>{m.suggestion.kind === 'none' ? m.suggestion.why : `Suggested: ${LINK[m.suggestion.kind]}${m.suggestion.title ? ` "${m.suggestion.title}"` : ''}. ${m.suggestion.why}`}</Text>}
        {m.state === 'dismissed' && <Text style={[s.muted, { marginTop: 8 }]}>Set aside{m.reviewedByName ? ` by ${m.reviewedByName}` : ''}{m.reviewNote ? `: ${m.reviewNote}` : ''}</Text>}
      </View>

      {m.links.length > 0 && <>
        <Text style={[s.eyebrow, { marginTop: 10 }]}>Filed on</Text>
        {m.links.map((l) => (
          <View key={l.id} style={s.card}>
            <Text style={[s.text, { fontWeight: '700' }]}>{LINK[l.kind]} · {l.title ?? 'Not visible to you'}</Text>
            <Text style={s.muted}>{l.why ?? (l.byName ? `By ${l.byName}` : '')} · {when(l.at)}</Text>
            {l.file === 'coming' && <Text style={[s.muted, { marginTop: 4 }]}>The file is still coming from WhatsApp. It goes on the job by itself when it arrives.</Text>}
            {l.file === 'not_on_job' && <Text style={[s.muted, { marginTop: 4, color: C.danger }]}>The file is not on the job.{m.mediaState === 'stored' ? '' : ' Press Try again above to fetch it.'}</Text>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {l.file === 'not_on_job' && m.mediaState === 'stored' && <Chip label="Add the file to the job" onPress={() => void act('link', { kind: l.kind, recordId: l.recordId }, (r) => r?.note ?? 'The file is on the job now.')} />}
              <Chip label="Take off" onPress={() => setMode({ unlink: l })} />
            </View>
          </View>))}
      </>}

      {mode === null && inbound && <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
        {m.state !== 'dismissed' && <Chip label={m.links.length ? 'File somewhere else too' : 'File it'} onPress={() => setMode('file')} />}
        {m.state === 'review' && <Chip label="Make a request" onPress={() => setMode('request')} />}
        <Chip label="Reply" onPress={() => setMode('reply')} />
        {m.state === 'review' && <Chip label="Set aside" onPress={() => setMode('dismiss')} />}
        {m.state === 'dismissed' && <Chip label="Put back for review" onPress={() => void act('restore', {}, () => 'Back for review.')} />}
      </View>}
      {mode === 'file' && <FileOn m={m} boss={boss} busy={busy} onCancel={() => setMode(null)} onDone={(kind, recordId) => void act('link', { kind, recordId }, (r) => `Filed on the ${LINK[kind].toLowerCase()}.${r?.note ? ` ${r.note}` : ''}`)} />}
      {mode === 'request' && <MakeRequest m={m} busy={busy} onCancel={() => setMode(null)} onDone={(title) => void act('request', { title }, (r) => `Request "${r?.task?.title ?? title}" is in the jobs inbox.${r?.note ? ` ${r.note}` : ''}`)} />}
      {mode === 'reply' && <Reply m={m} busy={busy} onCancel={() => setMode(null)} onDone={(text, clientKey) => void act('reply', { text, clientKey }, (r) => (r?.state === 'failed' ? 'The reply was not sent. It is listed under Problems.' : 'Reply sent.'))} />}
      {mode === 'dismiss' && <Reason title="Why set it aside?" button="Set aside" busy={busy} onCancel={() => setMode(null)} onDone={(reason) => void act('dismiss', { reason }, () => 'Set aside. It is kept and can be put back.')} />}
      {mode !== null && typeof mode === 'object' && <Reason title={`Why take it off ${LINK[mode.unlink.kind].toLowerCase()} "${mode.unlink.title ?? ''}"?`} button="Take off" busy={busy} onCancel={() => setMode(null)}
        onDone={(reason) => void act('unlink', { linkId: mode.unlink.id, reason }, () => 'Taken off. The link stays on file.')} />}

      {data.conversation.length > 1 && <>
        <Text style={[s.eyebrow, { marginTop: 16 }]}>Conversation</Text>
        {data.conversation.map((x) => (
          <View key={x.id} style={{ alignSelf: x.direction === 'out' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: x.id === m.id ? C.soft : C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 6 }}>
            <Text style={s.text}>{x.text || KIND[x.kind] || x.kind}</Text>
            <Text style={[s.muted, { fontSize: 11, marginTop: 2 }]}>{when(x.sentAt)}{x.direction === 'out' ? ` · ${STATE[x.state][0]}` : ''}</Text>
          </View>))}
      </>}
    </ScrollView>
  );
}

/** A kept photo is shown; other files say what they are and open on the desk, where they download. */
function Media({ m }: { m: Msg }) {
  if (!m.hasMedia) return null;
  if (m.mediaState === 'waiting') return <Text style={[s.muted, { marginTop: 6 }]}>The file is still being fetched from WhatsApp.</Text>;
  if (m.mediaState !== 'stored') return null;
  if (m.mediaMime && /^image\/(png|jpeg|webp|gif)$/.test(m.mediaMime)) return <Image source={authImage(`/api/whatsapp/messages/${encodeURIComponent(m.id)}/media`)} style={{ width: '100%', height: 260, borderRadius: 10, backgroundColor: C.line, marginTop: 8 }} resizeMode="contain" accessibilityLabel="Photo sent on WhatsApp" />;
  return <Text style={[s.muted, { marginTop: 6 }]}>{KIND[m.kind] ?? 'File'} kept{m.mediaName ? `: ${m.mediaName}` : ''}. Open it on the desk to play or download it.</Text>;
}

function FileOn({ m, boss, busy, onCancel, onDone }: { m: Msg; boss: boolean; busy: boolean; onCancel: () => void; onDone: (kind: LinkKind, recordId: string) => void }) {
  const sug = m.suggestion && m.suggestion.kind !== 'none' ? m.suggestion.kind : 'task';
  const [kind, setKind] = useState<LinkKind>(sug);
  const [pick, setPick] = useState(m.suggestion?.recordId ?? '');
  const [options, setOptions] = useState<[string, string][] | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    setOptions(null);
    const go = kind === 'task' ? api<{ items: { id: string; title: string; status: string }[] }>('/api/tasks').then((r) => r.items.filter((t) => t.status === 'open').map((t): [string, string] => [t.id, t.title]))
      : kind === 'project' ? api<{ items: { id: string; name: string }[] }>('/api/projects').then((r) => r.items.map((p): [string, string] => [p.id, p.name]))
      : m.personId && (boss || m.personId) ? api<{ items: { id: string; kind: string; description: string; payee: string | null; amountPaise: number; date: string; hidden: boolean }[] }>(`/api/cash/wallets/${encodeURIComponent(m.personId)}/entries`)
        .then((r) => r.items.filter((e) => e.kind === 'expense' && !e.hidden).map((e): [string, string] => [e.id, `${e.date} · ${e.payee ? `${e.payee} · ` : ''}${e.description} · ${inr(e.amountPaise)}`]))
      : Promise.resolve([] as [string, string][]);
    go.then(setOptions).catch((e: any) => { setOptions([]); setProblem(e.message); });
  }, [kind, m.personId, boss]);
  return (
    <View style={[s.card, { marginTop: 10 }]}>
      <Text style={[s.text, { fontWeight: '700', marginBottom: 8 }]}>File it on</Text>
      <Segmented<LinkKind> items={[['task', 'A job'], ['project', 'A project'], ['cash', 'A cash spend']]} value={kind} onChange={(k) => { setKind(k); setPick(''); setProblem(''); }} />
      <Text style={[s.muted, { marginVertical: 8 }]}>{kind === 'cash' ? (m.personId ? `Spends entered by ${m.personName}. Enter the spend under Cash first if it is not there.` : 'Only a team member who holds cash has spends to pick.') : kind === 'task' ? 'A photo or PDF goes on the job as a reference, never as proof.' : 'Pick the project.'}</Text>
      {options === null ? <Loading /> : !options.length ? <Text style={s.muted}>Nothing to pick.</Text> : <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{options.map(([v, l]) => <Chip key={v} label={l} on={pick === v} onPress={() => { setPick(v); setProblem(''); }} />)}</View>}
      {!!problem && <Text style={s.err}>{problem}</Text>}
      <Btn label="File it" busy={busy} onPress={() => (pick ? onDone(kind, pick) : setProblem(`Pick a ${LINK[kind].toLowerCase()} first.`))} style={{ marginTop: 8 }} />
      <Btn kind="ghost" label="Cancel" onPress={onCancel} />
    </View>
  );
}

function MakeRequest({ m, busy, onCancel, onDone }: { m: Msg; busy: boolean; onCancel: () => void; onDone: (title: string) => void }) {
  const [title, setTitle] = useState((m.text ?? '').split('\n')[0]!.slice(0, 120));
  const [problem, setProblem] = useState('');
  return (
    <View style={[s.card, { marginTop: 10 }]}>
      <Field label="Title for the request" value={title} maxLength={120} onChangeText={(t) => { setTitle(t); setProblem(''); }} />
      <Text style={s.muted}>It goes to the jobs inbox, where a manager takes it in or turns it down. The message's words go with it.</Text>
      {!!problem && <Text style={s.err}>{problem}</Text>}
      <Btn label="Make the request" busy={busy} onPress={() => (title.trim().length < 3 ? setProblem('At least 3 characters.') : onDone(title.trim()))} style={{ marginTop: 8 }} />
      <Btn kind="ghost" label="Cancel" onPress={onCancel} />
    </View>
  );
}

function Reply({ m, busy, onCancel, onDone }: { m: Msg; busy: boolean; onCancel: () => void; onDone: (text: string, clientKey: string) => void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const k = useRef(key()); // the same key on a second press, so a reply goes out once
  if (!m.canReply) return (
    <View style={[s.card, { marginTop: 10 }]}>
      <Text style={s.muted}>WhatsApp allows a typed reply only within 24 hours of their last message{m.replyClosesAt ? ` (that closed ${when(m.replyClosesAt)})` : ''}. Ask them to send a message first, or call them.</Text>
      <Btn kind="ghost" label="Close" onPress={onCancel} />
    </View>
  );
  return (
    <View style={[s.card, { marginTop: 10 }]}>
      <Field label="Reply" value={text} maxLength={1000} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} onChangeText={(t) => { setText(t); setProblem(''); }} />
      {!!m.replyClosesAt && <Text style={s.muted}>You can reply until {when(m.replyClosesAt)}. When they press Reply on it, their answer is filed in the same place.</Text>}
      {!!problem && <Text style={s.err}>{problem}</Text>}
      <Btn label="Send" busy={busy} onPress={() => (text.trim() ? onDone(text.trim(), k.current) : setProblem('Write the reply first.'))} style={{ marginTop: 8 }} />
      <Btn kind="ghost" label="Cancel" onPress={onCancel} />
    </View>
  );
}

function Reason({ title, button, busy, onCancel, onDone }: { title: string; button: string; busy: boolean; onCancel: () => void; onDone: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  return (
    <View style={[s.card, { marginTop: 10 }]}>
      <Field label={title} value={reason} maxLength={300} onChangeText={(t) => { setReason(t); setProblem(''); }} />
      {!!problem && <Text style={s.err}>{problem}</Text>}
      <Btn label={button} busy={busy} onPress={() => (reason.trim().length < 3 ? setProblem('Give a reason of at least 3 characters.') : onDone(reason.trim()))} style={{ marginTop: 8 }} />
      <Btn kind="ghost" label="Cancel" onPress={onCancel} />
    </View>
  );
}
