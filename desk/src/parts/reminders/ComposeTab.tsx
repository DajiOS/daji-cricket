import { useEffect, useState } from 'react';
import { post } from '../../lib';
import { Field, useForm, useToast } from '../../ui';
import type { Kind, Template } from './shared';

/** One-off messages: tournament fixtures and anything else that is not in the queue. */
export default function ComposeTab({ templates, onLogged }: { templates: Template[]; onLogged: () => void }) {
  const toast = useToast();
  const { v, bind } = useForm({ kind: 'fixture' as Kind, name: '', phone: '', date: '', time: '', amount: '' });
  const [pre, setPre] = useState<{ message: string; link: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { post('/api/desk/reminders/preview', v).then((r) => live && setPre(r)).catch(() => live && setPre(null)); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [v.kind, v.name, v.phone, v.date, v.time, v.amount, templates]);
  const log = async () => {
    if (!v.name.trim() || !pre?.link) { toast('Add a name and a 10-digit WhatsApp number first.'); return; }
    if (!pre) return;
    try { await post('/api/desk/reminders/sent', { kind: v.kind, name: v.name, phone: v.phone, message: pre.message }); toast('Logged as sent'); onLogged(); }
    catch (e: any) { toast(e.message); }
  };
  return (
    <div className="grid g2">
      <div className="card card-pad stack" style={{ gap: 14 }}>
        <h3>Send one message</h3>
        <div className="form-grid">
          <Field label="Template" full><select className="inp" {...bind('kind')}>{templates.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}</select></Field>
          <Field label="Name" required><input className="inp" {...bind('name')} placeholder="Team captain" /></Field>
          <Field label="WhatsApp number" required><input className="inp" inputMode="tel" {...bind('phone')} placeholder="98765 43210" /></Field>
          <Field label="Date"><input className="inp" {...bind('date')} placeholder="Sat 17 Oct" /></Field>
          <Field label="Time"><input className="inp" {...bind('time')} placeholder="9:00 am" /></Field>
          <Field label="Amount" full><input className="inp" {...bind('amount')} placeholder="₹1,500" /></Field>
        </div>
      </div>
      <div className="card card-pad stack" style={{ gap: 14 }}>
        <h3>Message</h3>
        <div className="rem-preview">{pre?.message || <span className="muted">Fill in the details to see the message.</span>}</div>
        <div className="row">
          {pre?.link ? <a className="btn primary sm" href={pre.link} target="_blank" rel="noopener noreferrer">Open WhatsApp</a> : <button className="btn primary sm" disabled>Open WhatsApp</button>}
          <button className="btn sm" onClick={log}>Mark sent</button>
        </div>
        {!pre?.link && <div className="hint">Add a name and a 10-digit number to get the link.</div>}
      </div>
    </div>
  );
}
