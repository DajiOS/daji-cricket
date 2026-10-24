import { useState } from 'react';
import { put } from '../../lib';
import { Chip, Field, useToast } from '../../ui';
import type { Template } from './shared';

const SAMPLE = { name: 'Rahul', date: 'Fri 16 Oct', time: '7:00 pm', amount: '₹1,500' };
const fill = (b: string) => b.replace(/\{(name|date|time|amount)\}/g, (_m, k: keyof typeof SAMPLE) => SAMPLE[k]);

function One({ t, saved }: { t: Template; saved: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState(t.body);
  const [busy, setBusy] = useState(false);
  const run = async (payload: object, ok: string) => {
    setBusy(true);
    try { const r = await put(`/api/desk/reminders/templates/${t.kind}`, payload); if (r.body) setBody(r.body); toast(ok); saved(); }
    catch (e: any) { toast(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>{t.label}</h3>{t.custom ? <Chip tone="gold">Edited</Chip> : <Chip>Default</Chip>}</div>
      <Field label="Message" hint="Use {name} {date} {time} {amount}"><textarea className="inp" rows={4} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="rem-preview small"><span className="muted">Preview</span><div>{fill(body)}</div></div>
      <div className="row">
        <button className="btn primary sm" disabled={busy || body === t.body} onClick={() => (body.trim() ? run({ body }, 'Template saved') : toast('The message is empty. Write the message, or press Reset to default.'))}>Save</button>
        {t.custom && <button className="btn ghost sm" disabled={busy} onClick={async () => { await run({ reset: true }, 'Back to the default'); setBody(t.defaultBody); }}>Reset to default</button>}
      </div>
    </div>
  );
}

export default function TemplatesTab({ templates, reload }: { templates: Template[]; reload: () => void }) {
  return <div className="grid g2">{templates.map((t) => <One key={t.kind + t.body} t={t} saved={reload} />)}</div>;
}
