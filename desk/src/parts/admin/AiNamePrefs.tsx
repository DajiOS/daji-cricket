import { useEffect, useState } from 'react';
import { api, setAiName, useApi, type Me } from '../../lib';
import { ErrorBox, Field, Modal, useToast } from '../../ui';

interface AiNameInfo { core: string; systemDefault: string; site: string; own: string | null; name: string; reserved: string[] }

/** Profile › Preferences: the name this person sees the assistant called. Any name, shown exactly as typed; a reserved one
 *  (Siri, Alexa, Hey Google, ...) is refused with the reason as you type. Empty goes back to the business default. */
export function AiNamePrefs({ onClose, onSaved }: { onClose: () => void; onSaved: (me: Me) => void }) {
  const [info] = useApi<AiNameInfo>('/api/ai-name');
  const [name, setName] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const value = name ?? info?.own ?? '';

  // checks while typing, so "Hey Siri" is refused before Save is pressed
  useEffect(() => {
    const t = value.trim();
    if (!t) { setWarn(null); return; }
    let live = true;
    const timer = setTimeout(() => { api<{ ok: boolean; message?: string }>('/api/ai-name/check', { method: 'POST', body: { name: t } }).then((r) => { if (live) setWarn(r.ok ? null : r.message ?? null); }).catch(() => { if (live) setWarn(null); }); }, 250); // the server checks again on save
    return () => { live = false; clearTimeout(timer); };
  }, [value]);

  async function save() {
    if (warn) { setErr(warn); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api<{ user: Me }>('/api/me', { method: 'PATCH', body: { aiName: value.trim() || null } });
      setAiName(r.user.aiName); onSaved(r.user);
      toast(`The assistant is now called ${r.user.aiName ?? value.trim()} for you.`);
      onClose();
    } catch (e: any) { setErr(e.details?.fields?.[0]?.message ?? e.message); }
    setBusy(false);
  }

  return (
    <Modal title="Preferences" onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={save}>Save</button>
    </>}>
      <div className="stack">
        <Field label="AI assistant name" error={warn} hint={`Shown exactly as you type it, on your screens only. Leave it empty to use the business default${info ? ` (${info.site})` : ''}.`}>
          <input className="inp" value={value} onChange={(e) => setName(e.target.value)} placeholder={info?.site ?? 'Ask AI'} aria-describedby="ai-name-note" />
        </Field>
        <p id="ai-name-note" className="small muted" style={{ margin: 0 }}>This changes only the name you see. {info?.core ?? 'Platform AI'} underneath stays the same: what it can see and do, your access, the history and the money limits do not change.</p>
        <ErrorBox msg={err} />
      </div>
    </Modal>
  );
}
