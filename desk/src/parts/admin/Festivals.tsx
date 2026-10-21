// The festival calendar: on these days the public website changes its look by itself, one look for each day of a festival.
import { useState } from 'react';
import { useApi, put, post, del, fmtDay } from '../../lib';
import { Loading, ErrorBox, Field, Chip, Confirm, DateInput, Modal, useToast } from '../../ui';
import { Panel, errText } from './common';

interface DayLook { title: string; greeting: string; local: string; headline: string; headline2: string; lede: string; colour: string; countdown: boolean; countdownFrom: string }
interface Festival { id: string; name: string; look: string; repeat: string; starts: string[]; days: DayLook[]; offer: string; enabled: boolean; sort: number; next: { from: string; to: string } | null; warning: string | null }
type Draft = Omit<Festival, 'id' | 'next' | 'warning'> & { id?: string };

const LOOK_NAMES: Record<string, string> = { uttarayan: 'Kites (Uttarayan)', tiranga: 'Tricolour (national days)', holi: 'Colours (Holi)', ganesh: 'Marigold and modak (Ganesh)', navratri: 'Garba and dandiya (Navratri)', diwali: 'Diyas and rangoli (Diwali)', christmas: 'Stars and snow (Christmas, New Year)' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const blankDay = (title = ''): DayLook => ({ title, greeting: '', local: '', headline: '', headline2: '', lede: '', colour: '', countdown: false, countdownFrom: '' });
const span = (f: { from: string; to: string }) => (f.from === f.to ? fmtDay(f.from) : `${fmtDay(f.from)} to ${fmtDay(f.to)}`);

function DayEditor({ d, n, onChange, onRemove }: { d: DayLook; n: number; onChange: (d: DayLook) => void; onRemove?: () => void }) {
  const set = (k: keyof DayLook) => (e: { target: { value: string } }) => onChange({ ...d, [k]: e.target.value });
  return (
    <details className="card" style={{ marginTop: 8 }} open={n === 1 && !d.title}>
      <summary className="card-pad" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="swatch" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, background: d.colour || 'transparent', border: '1px solid var(--line)', flex: 'none' }} />
        <b>Day {n}</b><span className="muted">{d.title || 'No name yet'}</span>{d.countdown && <Chip tone="gold">Countdown</Chip>}
      </summary>
      <div className="card-pad" style={{ paddingTop: 0 }}>
        <div className="form-grid">
          <Field label="Name of the day" hint="Shown on the banner, e.g. Dhanteras"><input className="inp" maxLength={60} value={d.title} onChange={set('title')} /></Field>
          <Field label="Colour of the day" hint="Navratri's colour, or none for the festival's own">
            <div className="row" style={{ gap: 8 }}>
              <input type="color" aria-label="Colour" value={d.colour || '#e0a526'} onChange={set('colour')} style={{ width: 44, height: 34, padding: 0, border: 0, background: 'none' }} />
              <input className="inp" style={{ width: 110 }} maxLength={7} placeholder="none" value={d.colour} onChange={set('colour')} />
              {d.colour && <button type="button" className="btn sm ghost" onClick={() => onChange({ ...d, colour: '' })}>None</button>}
            </div>
          </Field>
          <Field label="Greeting" hint="e.g. Happy Diwali"><input className="inp" maxLength={120} value={d.greeting} onChange={set('greeting')} /></Field>
          <Field label="Greeting in Gujarati or Hindi" hint="Optional"><input className="inp" maxLength={120} value={d.local} onChange={set('local')} /></Field>
          <Field label="Headline, first line"><input className="inp" maxLength={60} value={d.headline} onChange={set('headline')} /></Field>
          <Field label="Headline, second line" hint="Drawn in the festival colour"><input className="inp" maxLength={60} value={d.headline2} onChange={set('headline2')} /></Field>
          <Field label="Line under the headline" full><textarea className="inp" style={{ height: 64, padding: 10 }} maxLength={240} value={d.lede} onChange={set('lede')} /></Field>
          <div className="full row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label className="check"><input type="checkbox" checked={d.countdown} onChange={(e) => onChange({ ...d, countdown: e.target.checked, countdownFrom: d.countdownFrom || '06:00' })} /><span>Count down to midnight on this day (New Year’s Eve)</span></label>
            {d.countdown && <label className="row" style={{ gap: 6 }}><span className="small muted">Start the countdown at</span><input className="inp" type="time" style={{ width: 120 }} value={d.countdownFrom} onChange={set('countdownFrom')} /></label>}
            {onRemove && <span style={{ marginLeft: 'auto' }}><Confirm label="Remove this day" ask="Remove it?" onYes={onRemove} /></span>}
          </div>
        </div>
      </div>
    </details>
  );
}

function Editor({ start, looks, onClose, onSaved }: { start: Draft; looks: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Draft>(start);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<'fixed' | 'moving'>(f.repeat ? 'fixed' : 'moving');
  const [mm, dd] = (f.repeat || '01-01').split('-') as [string, string];
  const setDay = (i: number, d: DayLook) => setF({ ...f, days: f.days.map((x, j) => (j === i ? d : x)) });
  async function save() {
    setBusy(true); setMsg(null);
    const body = { name: f.name, look: f.look, repeat: mode === 'fixed' ? `${mm}-${dd}` : '', starts: mode === 'moving' ? f.starts.filter(Boolean) : [], days: f.days, offer: f.offer, enabled: f.enabled, sort: f.sort };
    try { if (f.id) await put(`/api/admin/festivals/${f.id}`, body); else await post('/api/admin/festivals', body); toast('Festival saved.'); onSaved(); } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  async function remove() {
    setBusy(true);
    try { await del(`/api/admin/festivals/${f.id}`); toast('Festival removed.'); onSaved(); } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  return (
    <Modal wide title={f.id ? f.name : 'Add a festival'} onClose={onClose}
      foot={<div className="row" style={{ width: '100%' }}>{msg && <span className="err-text">{msg}</span>}<span style={{ marginLeft: 'auto' }} />{f.id && <Confirm label="Remove festival" ask="Remove it from the calendar?" onYes={remove} />}<button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save festival</button></div>}>
      <div className="form-grid">
        <Field label="Festival name"><input className="inp" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Look" hint="The colours, decoration and moving effect"><select className="inp" value={f.look} onChange={(e) => setF({ ...f, look: e.target.value })}>{looks.map((l) => <option key={l} value={l}>{LOOK_NAMES[l] || l}</option>)}</select></Field>
        <Field label="When" full>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label className="check"><input type="radio" name="when" checked={mode === 'fixed'} onChange={() => setMode('fixed')} /><span>The same day every year</span></label>
            <label className="check"><input type="radio" name="when" checked={mode === 'moving'} onChange={() => setMode('moving')} /><span>The date changes each year (panchang)</span></label>
          </div>
        </Field>
        {mode === 'fixed' ? (
          <Field label="First day" hint="It comes back on this day each year" full>
            <div className="row" style={{ gap: 8 }}>
              <select className="inp" style={{ width: 90 }} aria-label="Day" value={dd} onChange={(e) => setF({ ...f, repeat: `${mm}-${e.target.value}` })}>{Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((x) => <option key={x} value={x}>{+x}</option>)}</select>
              <select className="inp" style={{ width: 160 }} aria-label="Month" value={mm} onChange={(e) => setF({ ...f, repeat: `${e.target.value}-${dd}` })}>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</select>
            </div>
          </Field>
        ) : (
          <Field label="First day in each year" hint="Add next year's date when the panchang is out" full>
            <div style={{ display: 'grid', gap: 6 }}>
              {f.starts.map((s, i) => (
                <div className="row" key={i} style={{ gap: 8 }}>
                  <DateInput className="inp" style={{ width: 180 }} aria-label={`First day ${i + 1}`} value={s} onChange={(e) => setF({ ...f, starts: f.starts.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <button type="button" className="btn sm ghost" onClick={() => setF({ ...f, starts: f.starts.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
              <div><button type="button" className="btn sm" onClick={() => setF({ ...f, starts: [...f.starts, ''] })}>Add a year’s date</button></div>
            </div>
          </Field>
        )}
        <Field label="Festival offer or event (optional)" hint="Shown on the banner and the booking card, e.g. 10% off evening slots" full><input className="inp" maxLength={160} value={f.offer} onChange={(e) => setF({ ...f, offer: e.target.value })} /></Field>
        <label className="check full"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /><span>Show this festival on the website</span></label>
      </div>
      <h4 style={{ margin: '18px 0 4px' }}>{f.days.length === 1 ? 'One day' : `${f.days.length} days`}, each with its own look</h4>
      {f.days.map((d, i) => <DayEditor key={i} d={d} n={i + 1} onChange={(x) => setDay(i, x)} onRemove={f.days.length > 1 ? () => setF({ ...f, days: f.days.filter((_, j) => j !== i) }) : undefined} />)}
      {f.days.length < 15 && <div style={{ marginTop: 8 }}><button type="button" className="btn sm" onClick={() => setF({ ...f, days: [...f.days, blankDay()] })}>Add a day</button></div>}
    </Modal>
  );
}

export default function Festivals() {
  const toast = useToast();
  const [cal, error, reload] = useApi<{ items: Festival[]; looks: string[] }>('/api/admin/festivals');
  const [s, sErr, reloadS] = useApi<any>('/api/admin/settings');
  const [edit, setEdit] = useState<Draft | null>(null);
  if (error || sErr) return <ErrorBox msg={error || sErr} />;
  if (!cal || !s) return <Loading />;
  async function toggle(f: Festival) {
    try { await put(`/api/admin/festivals/${f.id}`, { enabled: !f.enabled }); toast(f.enabled ? `${f.name} switched off.` : `${f.name} switched on.`); reload(); } catch (e) { toast(errText(e)); }
  }
  async function everyone(v: boolean) {
    try { await put('/api/admin/settings', { festivalForEveryone: v }); toast('Saved.'); reloadS(); } catch (e) { toast(errText(e)); }
  }
  const warnings = cal.items.filter((f) => f.enabled && f.warning).length;
  return (
    <>
      <Panel title="Festival looks" note="On these days the website changes its look by itself: decoration, greeting, headline and an offer, with a new look for each day. When the festival is over it goes back to normal."
        actions={<button className="btn primary sm" onClick={() => setEdit({ name: '', look: 'diwali', repeat: '', starts: [''], days: [blankDay('Day 1')], offer: '', enabled: true, sort: 100 })}>Add a festival</button>}>
        <label className="check"><input type="checkbox" checked={!!s.festivalForEveryone} onChange={(e) => everyone(e.target.checked)} /><span>Show the festival look to every visitor, even one who picked their own theme</span></label>
        <p className="hint" style={{ marginTop: 8 }}>Dates of Holi, Ganesh Chaturthi, Navratri and Diwali move with the panchang. Check them, and Navratri’s colours, each year.{warnings ? ` ${warnings === 1 ? 'One festival needs' : `${warnings} festivals need`} dates.` : ''}</p>
      </Panel>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {cal.items.map((f) => (
          <div className="card" key={f.id}>
            <div className="card-pad row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><b>{f.name}</b>{f.enabled ? <Chip tone="good">On</Chip> : <Chip>Off</Chip>}<span className="small muted">{f.days.length === 1 ? '1 day' : `${f.days.length} days`}</span></div>
                <div className="small muted" style={{ marginTop: 3 }}>{f.next ? `Next: ${span(f.next)}` : 'No upcoming dates'}{f.repeat ? ' · every year' : ''}{f.offer ? ` · Offer: ${f.offer}` : ''}</div>
                {f.warning && <div style={{ marginTop: 6 }}><Chip tone="warn">{f.warning}</Chip></div>}
                <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>{f.days.map((d, i) => <span key={i} title={`Day ${i + 1}: ${d.title}`} style={{ width: 12, height: 12, borderRadius: 3, background: d.colour || 'var(--line)' }} />)}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <a className="btn sm ghost" href={`/?festival=${encodeURIComponent(f.id)}&day=1`} target="_blank" rel="noopener">Preview</a>
                <button className="btn sm" onClick={() => toggle(f)}>{f.enabled ? 'Switch off' : 'Switch on'}</button>
                <button className="btn sm primary" onClick={() => setEdit({ ...f, starts: f.starts.length || f.repeat ? f.starts : [''] })}>Edit</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {edit && <Editor start={edit} looks={cal.looks} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
