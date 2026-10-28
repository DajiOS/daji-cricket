// Settings › Platform AI: the name everyone at this business sees the assistant called (each person can pick their own under
// Preferences), and for the software owner the reserved names no one may use. A name is a label only; Platform AI underneath never changes.
import { useState } from 'react';
import { del, post, put, setAiName, useApi } from '../../lib';
import { ErrorBox, Loading, Table } from '../../ui';
import { useSession } from '../../App';
import { Panel, errText } from './common';

interface Reserved { id: string | null; phrase: string; note: string | null; builtin: boolean; createdAt: number | null }

export default function AiName() {
  const { me } = useSession();
  const [s, error] = useApi<{ aiAssistantName: string; voiceShortcutsEnabled: boolean }>('/api/admin/settings');
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading h={160} />;
  return (
    <div className="stack">
      <DefaultName initial={s.aiAssistantName} own={!!me.aiNameOwn} />
      <VoiceSwitch initial={s.voiceShortcutsEnabled} />
      {me.role === 'super_admin' && <ReservedList />}
    </div>
  );
}

function DefaultName({ initial, own }: { initial: string; own: boolean }) {
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      const name = v.trim() || 'Ask AI';
      await put('/api/admin/settings', { aiAssistantName: name });
      if (!own) setAiName(name);
      setV(name); setMsg({ ok: true, text: `Saved. Everyone who has not picked their own name now sees ${name}.` });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  }
  return (
    <Panel title="Assistant name" note="What everyone here sees the assistant called: customers on the website and app, and the team on the desk. Each person can still pick their own name under Preferences.">
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input className="inp" style={{ flex: '1 1 260px' }} value={v} onChange={(e) => setV(e.target.value)} aria-label="Assistant name" placeholder="Ask AI" />
          <button className="btn primary" onClick={save}>Save</button>
        </div>
        {msg && <div className={msg.ok ? 'ok-text' : 'err-text'} role="status">{msg.text}</div>}
        <p className="small muted" style={{ margin: 0 }}>Any name works, shown exactly as typed, except names and wake phrases of other companies' assistants (Siri, Alexa, Hey Google, Gemini, Copilot, Cortana and others). The name changes only the label: Platform AI underneath, everyone's access, the money limits and the AI provider stay the same.</p>
      </div>
    </Panel>
  );
}

/** Siri and the phone assistant for the whole business. Each person also turns voice on for themselves in the app; this turns it off for everyone. */
function VoiceSwitch({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function flip() {
    setMsg(null);
    try { await put('/api/admin/settings', { voiceShortcutsEnabled: !on }); setOn(!on); setMsg({ ok: true, text: !on ? 'Voice shortcuts are allowed. Each person turns them on in the app under Profile.' : 'Voice shortcuts are off for everyone.' }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  }
  return (
    <Panel title="Voice shortcuts" note="Siri on iPhone and the assistant on Android phones can open the app at a question or a screen. Speech is turned into text by Apple or Google on their own servers, so switch this off if that should not happen here.">
      <div className="stack">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${on ? 'b-good' : 'b-mute'}`}>{on ? 'Allowed' : 'Off'}</span>
          <button className="btn" onClick={flip}>{on ? 'Turn off for everyone' : 'Allow voice shortcuts'}</button>
        </div>
        {msg && <div className={msg.ok ? 'ok-text' : 'err-text'} role="status">{msg.text}</div>}
        <p className="small muted" style={{ margin: 0 }}>A voice shortcut only opens the app: it works with the person's own sign-in and access, answers stay on the screen and are never read out, nothing goes into the phone's search, and voice never approves or pays anything.</p>
      </div>
    </Panel>
  );
}

/** Software owner only: the built-in reserved names, plus any added here. Added ones take effect at once, with no release. */
function ReservedList() {
  const [d, error, reload] = useApi<{ items: Reserved[] }>('/api/admin/ai-reserved-names');
  const [phrase, setPhrase] = useState(''); const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setErr(null);
    try { await post('/api/admin/ai-reserved-names', { phrase, note }); setPhrase(''); setNote(''); reload(); } catch (e) { setErr(errText(e)); }
  }
  async function remove(id: string) { setErr(null); try { await del(`/api/admin/ai-reserved-names/${encodeURIComponent(id)}`); reload(); } catch (e) { setErr(errText(e)); } }
  return (
    <Panel title="Reserved names" note="No business or person can use these as the assistant's name or wake phrase. Add a new one here and it applies straight away.">
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input className="inp" style={{ flex: '1 1 200px' }} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Name or wake phrase" aria-label="Name or wake phrase" />
          <input className="inp" style={{ flex: '2 1 240px' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" aria-label="Why" />
          <button className="btn" onClick={add} disabled={phrase.trim().length < 2}>Add</button>
        </div>
        <ErrorBox msg={err ?? error} />
        {!d ? <Loading h={120} /> : (
          <div className="tbl-wrap"><Table rows={d.items} rowKey={(r) => r.id ?? `b:${r.phrase}`} cols={[
            { head: 'Name or phrase', cell: (r) => r.phrase },
            { head: 'Source', cell: (r) => (r.builtin ? 'Built in' : 'Added') },
            { head: 'Why', cell: (r) => r.note ?? '' },
            { head: '', cell: (r) => (r.id ? <button className="btn sm ghost" onClick={() => remove(r.id!)}>Remove</button> : null) },
          ]} /></div>)}
      </div>
    </Panel>
  );
}
