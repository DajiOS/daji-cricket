import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, useApi } from './lib';
import { Icon } from './ui';

// Guppi, the staff assistant: a panel on the right that the top-bar button, the Home question box and the search all open. Each answer comes from the
// desk's own reports through read-only tools on the server, limited to what this login may see. The key lives on the server only.
interface Answer { question: string; answer: string; understood: string; details: { label: string; text: string }[]; notes: string[]; suggestions: string[]; source: 'builtin' | 'claude'; verified: boolean }
interface Turn { q: string; a?: Answer; err?: string }

export function AskPanel() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [ex] = useApi<{ items: string[]; claudeEnabled: boolean }>(open ? '/api/staff/ask/examples' : null, [open]);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  async function send(text: string) {
    const t = text.trim();
    if (t.length < 2 || busy) return;
    setQ(''); setBusy(true);
    setTurns((x) => [...x, { q: t }]);
    try {
      const a = await api<Answer>('/api/staff/ask', { method: 'POST', body: { question: t } });
      setTurns((x) => x.map((r, i) => (i === x.length - 1 ? { ...r, a } : r)));
    } catch (e: any) {
      setTurns((x) => x.map((r, i) => (i === x.length - 1 ? { ...r, err: e.message } : r)));
    }
    setBusy(false);
  }
  useEffect(() => {
    const f = (e: Event) => { setOpen(true); const t = (e as CustomEvent<string>).detail; if (t) void send(t); else setTimeout(() => field.current?.focus(), 50); };
    addEventListener('daji:ask', f); return () => removeEventListener('daji:ask', f);
  });
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns, busy]);
  useEffect(() => { if (!open) return; const f = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [open]);
  if (!open) return null;

  return createPortal(
    <div className="ai-wrap" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <aside className="ai-panel" role="dialog" aria-modal="true" aria-label="Guppi">
        <header className="ai-head">
          <div><span className="eyebrow">Guppi</span><h2>What would you like to know?</h2></div>
          <button type="button" className="dround" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" size={16} /></button>
        </header>
        <div className="ai-body">
          {ex && !ex.claudeEnabled && <p className="ai-note">Guppi is answering from the built-in reports, which cover bookings, money and customers. To let it answer anything, the owner adds the AI key on the server (see deploy/.env).</p>}
          {!turns.length && <>
            <p className="muted" style={{ margin: 0 }}>Ask about bookings, money, jobs or the team. It only reads your own data and only what your login may see.</p>
            <div className="ai-ex">{(ex?.items ?? []).slice(0, 6).map((x) => <button key={x} type="button" onClick={() => send(x)}>{x}</button>)}</div>
          </>}
          {turns.map((t, i) => (
            <div key={i} className="ai-turn">
              <div className="ai-q">{t.q}</div>
              {t.err ? <div className="err">{t.err}</div> : !t.a ? <div className="ai-a muted">Working it out…</div> : (
                <div className="ai-a">
                  <p>{t.a.answer}</p>
                  {t.a.details.length > 0 && <dl>{t.a.details.slice(0, 6).map((d) => <div key={d.label}><dt>{d.label}</dt><dd>{d.text}</dd></div>)}</dl>}
                  <span className="small muted">{t.a.understood}</span>
                  {t.a.notes.map((n) => <span key={n} className="small muted">{n}</span>)}
                  <span className="ai-src">{t.a.source === 'claude' ? 'Written by AI from your reports' : 'Built-in answer from your reports'}</span>
                  {i === turns.length - 1 && t.a.suggestions.length > 0 && <div className="ai-ex">{t.a.suggestions.slice(0, 3).map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>}
                </div>)}
            </div>))}
          <div ref={end} />
        </div>
        <form className="ai-form" onSubmit={(e) => { e.preventDefault(); void send(q); }}>
          <input ref={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the ground, the bookings or the books…" aria-label="Your question" maxLength={500} autoFocus />
          <button type="submit" disabled={busy || q.trim().length < 2} aria-label="Ask"><Icon name="chevron" size={16} /></button>
        </form>
      </aside>
    </div>, document.body);
}
