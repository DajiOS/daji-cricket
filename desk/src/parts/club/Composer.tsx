// Contacts: write, preview and send a message to the people the filters picked.
import { useState } from 'react';
import { Field, Modal, useToast } from '../../ui';
import { api, post } from '../../lib';
import { Select, errMsg } from './common';

interface Template { id: string; title: string; subject?: string | null; body: string }
interface Plan { willSend: number; skipped: { noConsent: number; noAddress: number; disabled: number }; preview: { body: string } }

export default function Composer({ filter, templates, onClose, onSent }: { filter: Record<string, string | number>; templates: Template[]; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [channel, setChannel] = useState('whatsapp'); const [tpl, setTpl] = useState(''); const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const payload = (extra: object = {}) => ({ channel, subject: channel === 'email' ? subject : undefined, body, filter, ...extra });
  const touch = () => { setPlan(null); setErr(null); };
  const pick = (id: string) => { setTpl(id); const t = templates.find((x) => x.id === id); if (t) { setSubject(t.subject || ''); setBody(t.body); touch(); } };
  const preview = async () => { touch(); setBusy(true); try { setPlan(await post<Plan>('/api/staff/broadcasts/preview', payload())); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const send = async () => {
    if (!plan) return; setBusy(true);
    try { const r = await post('/api/staff/broadcasts', payload({ confirmCount: plan.willSend, requestId: 'ui-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) })); toast(`Queued for ${r.broadcast.queued} people. Delivery needs your email, text or WhatsApp provider to be connected.`); onSent(); onClose(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Message these people" onClose={onClose} wide>
      <p className="hint">Only people who said yes to this channel are messaged. Use {'{name}'} for their first name. Check the preview before sending.</p>
      <div className="form-grid">
        <Field label="Template"><Select value={tpl} onChange={pick} options={[['', 'Start from a template'], ...templates.map((x) => [x.id, x.title] as [string, string])]} /></Field>
        <Field label="Channel"><Select value={channel} onChange={(v) => { setChannel(v); touch(); }} options={[['whatsapp', 'WhatsApp'], ['email', 'Email'], ['sms', 'Text message']]} /></Field>
        {channel === 'email' && <Field label="Subject" full><input className="inp" maxLength={120} placeholder="Subject (email only)" value={subject} onChange={(e) => { setSubject(e.target.value); touch(); }} /></Field>}
        <Field label="Message" full><textarea className="inp" rows={6} maxLength={5000} placeholder="Hi {name}, …" value={body} onChange={(e) => { setBody(e.target.value); touch(); }} /></Field>
      </div>
      {err && <div className="err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      <div style={{ marginTop: 14 }}><button className="btn" disabled={busy || !body.trim()} onClick={preview}>Preview</button></div>
      {plan && (
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="stmt-stats">
            <div><div className="label">Will reach</div><div className="v">{plan.willSend}</div></div>
            <div><div className="label">Left out</div><div className="v small-v">{plan.skipped.noConsent} no consent, {plan.skipped.noAddress} no address, {plan.skipped.disabled} disabled</div></div>
          </div>
          <div className="hint">First message as it will read:</div>
          <pre className="msg-preview">{plan.preview.body}</pre>
          {plan.willSend ? <button className="btn primary" disabled={busy} onClick={send}>Send to {plan.willSend} people</button> : <p className="hint">Nobody can be reached on this channel for this group.</p>}
        </div>
      )}
    </Modal>
  );
}
export async function loadTemplates(): Promise<Template[]> { return (await api<{ items: Template[] }>('/api/staff/broadcast-templates')).items; }
