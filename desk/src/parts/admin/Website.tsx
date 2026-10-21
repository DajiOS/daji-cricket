// The website's design (the quarterly design packs and how the design changes through the day), the Instagram link and
// the gallery photos shown on the website.
import { useState } from 'react';
import { useApi, put, sendFile, api, fmtDay } from '../../lib';
import { Loading, ErrorBox, Field, Chip, DateInput, useToast } from '../../ui';
import { Panel, errText } from './common';

function Upload({ busy, onGo }: { busy: boolean; onGo: (f: FileList | null) => void }) {
  const [files, setFiles] = useState<FileList | null>(null);
  return <div className="row" style={{ marginTop: 6 }}><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(e) => setFiles(e.target.files)} /><button className="btn sm" disabled={busy} onClick={() => onGo(files)}>Upload</button></div>;
}

export const DESIGN_NAMES: Record<string, string> = {
  noir: 'Floodlight Noir', pavilion: 'Emerald Pavilion', whites: 'Test Whites', pinkball: 'Pink Ball Night', monsoon: 'Monsoon Glass',
  maroon: 'Royal Maroon', carbon: 'Carbon T20', champagne: 'Champagne Minimal', stadium: 'Stadium Royal Blue', willow: 'Willow & Leather',
  mist: 'Winter Mist', scorebook: 'Scorebook', sunrise: 'Sunrise Nets', azure: 'Azure Day', terracotta: 'Stepwell Terracotta',
  mango: 'Mango Grove', dusk: 'Golden Hour', scoreboard: 'Scoreboard', aurora: 'Winter Night', ember: 'Ember Night',
  kulfi: 'Kulfi Cream', camp: 'Summer Camp', neem: 'Neem Shade', heatwave: 'Heatwave', gola: 'Ice Gola',
  khus: 'Khus Cool', powerplay: 'Powerplay', thunder: 'Pre-monsoon Sky', firefly: 'Firefly Night', jamun: 'Jamun Night',
  ivory: 'Plain light', obsidian: 'Plain dark',
};
/** Page colour and accent of each design, for the little swatches. */
const SWATCH: Record<string, [string, string]> = {
  noir: ['#07090a', '#d6b36a'], pavilion: ['#0b2a20', '#dcc289'], whites: ['#fbfbf8', '#b3261e'], pinkball: ['#0b0c22', '#ff7ab6'], monsoon: ['#0d1a1e', '#7fd6c3'],
  maroon: ['#260a10', '#e4bb6a'], carbon: ['#0c0e11', '#9fd8ff'], champagne: ['#ffffff', '#9a7a3e'], stadium: ['#06184a', '#ffcb3d'], willow: ['#1c120b', '#dca66b'],
  mist: ['#eef2f4', '#2f6f8f'], scorebook: ['#f6f1e4', '#2446a8'], sunrise: ['#fff4ec', '#d44d33'], azure: ['#f3f8fd', '#0a6fd6'], terracotta: ['#f5e9dc', '#b14e2b'],
  mango: ['#0f2117', '#ffbf3c'], dusk: ['#1a1022', '#ffa84a'], scoreboard: ['#0a0a0a', '#ffb000'], aurora: ['#070b1a', '#6ef0c8'], ember: ['#0e0806', '#ff6a2b'],
  kulfi: ['#fbf6ea', '#2f8f6b'], camp: ['#f2f9ff', '#d45816'], neem: ['#eef3e6', '#3c6b2f'], heatwave: ['#fbefd9', '#d2381c'], gola: ['#f4fbfd', '#e0245e'],
  khus: ['#0c1a15', '#9fe3b8'], powerplay: ['#0d0a1f', '#c6ff3d'], thunder: ['#0e1820', '#ffd23f'], firefly: ['#06110c', '#e4ff6e'], jamun: ['#150a1f', '#c9a7ff'],
};
const nameOf = (d: string) => DESIGN_NAMES[d] || d.charAt(0).toUpperCase() + d.slice(1);
const hourText = (h: number) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h} am` : `${h - 12} pm`);

interface Band { name: string; from: number; designs: string[] }
interface Pack { id: string; name: string; note: string; quarter: string; from: string; to: string; startsOn: string; delayed: boolean; state: 'live' | 'upcoming' | 'archived'; switchedOn: boolean; approved: { at: number } | null; bands: Band[]; designs: string[] }
interface PackCalendar { live: Pack; next: Pack | null; packs: Pack[]; reminder: string | null }

function Swatches({ designs }: { designs: string[] }) {
  return <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{designs.map((d) => { const [bg, ac] = SWATCH[d] || ['#888', '#ccc']; return (
    <a key={d} className="small" href={`/?theme=${d}`} target="_blank" rel="noopener" title={`Open the website in ${nameOf(d)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'inherit', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 10px 3px 4px' }}>
      <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 999, background: `linear-gradient(135deg, ${bg} 50%, ${ac} 50%)`, boxShadow: '0 0 0 1px rgba(0,0,0,.15)' }} />{nameOf(d)}</a>); })}</div>;
}

/** The quarterly design packs: the live one, the next one (it goes live by itself; delay or switch if wanted), and the archive. */
function Packs({ cal, reload }: { cal: PackCalendar; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [delay, setDelay] = useState<string | null>(null);
  async function act(id: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    try { await put(`/api/admin/design-packs/${id}`, body); toast(done); setDelay(null); reload(); } catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  const { live, next } = cal, older = cal.packs.filter((p) => p.state === 'archived');
  return (
    <Panel title="Design packs" note="A new set of designer themes every quarter. Each pack goes live by itself on the first day of its quarter, and the one before it is archived.">
      {cal.reminder && <div style={{ marginBottom: 12 }}><Chip tone="warn">{cal.reminder}</Chip></div>}
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Chip tone="good">Live</Chip><b>{live.name}</b><span className="muted">{live.quarter}</span>{live.switchedOn && <Chip tone="info">Switched on by you</Chip>}</div>
          <div className="hint" style={{ marginTop: 4 }}>{live.note}</div>
          <Swatches designs={live.designs} />
          {live.switchedOn && <div className="row" style={{ marginTop: 8 }}><button className="btn sm ghost" disabled={busy} onClick={() => act(live.id, { switchOn: false }, 'Back to the quarterly schedule.')}>Back to the schedule</button></div>}
        </div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          {next ? <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Chip tone="info">Next</Chip><b>{next.name}</b><span className="muted">{next.quarter}</span></div>
            <div className="hint" style={{ marginTop: 4 }}>{next.note} Goes live by itself on {fmtDay(next.startsOn)}{next.delayed ? ' (delayed by you)' : ''}. Nothing to approve; delay it or switch it on early only if you want to.</div>
            <Swatches designs={next.designs} />
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <a className="btn sm ghost" href={`/?pack=${next.id}`} target="_blank" rel="noopener">Try the pack on the website</a>
              <button className="btn sm ghost" disabled={busy} onClick={() => setDelay(delay === null ? next.startsOn : null)}>Delay or hold</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => act(next.id, { switchOn: true }, `${next.name} is live now.`)}>Switch on now</button>
            </div>
            {delay !== null && <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
              <span className="small">Start it on</span>
              <DateInput className="inp" style={{ width: 180 }} aria-label="New start day" min={next.from} max={next.to} value={delay} onChange={(e) => setDelay(e.target.value)} />
              <button className="btn sm primary" disabled={busy || !delay} onClick={() => act(next.id, { startsOn: delay }, `${next.name} now starts on ${fmtDay(delay)}.`)}>Save</button>
              {next.delayed && <button className="btn sm ghost" disabled={busy} onClick={() => act(next.id, { startsOn: null }, `${next.name} starts on ${fmtDay(next.from)} again.`)}>Start on {fmtDay(next.from)}</button>}
            </div>}
          </> : <div className="hint">No pack for next quarter yet. New packs are built and put here about a month before their quarter starts, and go live by themselves.</div>}
        </div>
        {older.length > 0 && <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Earlier packs</div>
          {older.map((p) => <div key={p.id} className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 6 }}><b>{p.name}</b><span className="muted">{p.quarter}</span><button className="btn sm ghost" disabled={busy} onClick={() => act(p.id, { switchOn: true }, `${p.name} is back on until the next pack’s day.`)}>Switch back on</button></div>)}
          <div className="hint">Visitors who picked a design from an earlier pack keep it.</div>
        </div>}
      </div>
    </Panel>
  );
}

/** Which design the public website wears: one that changes through the day, or one the owner fixes. */
function Design({ cal }: { cal: PackCalendar }) {
  const toast = useToast();
  const [s, error, reload] = useApi<any>('/api/admin/settings');
  const [now, setNow] = useState<{ design: string; band: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!now) void api<any>('/api/festival').then((r) => setNow(r.site)).catch(() => setNow({ design: '', band: null }));
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading h={120} />;
  async function pick(v: string) {
    setBusy(true);
    try { await put('/api/admin/settings', { siteDesign: v }); toast(v === 'rotate' ? 'The design now changes through the day.' : `The website now always shows ${nameOf(v)}.`); reload(); setNow(null); } catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  const rotate = (s.siteDesign || 'rotate') === 'rotate', bands = cal.live.bands, pace: string = s.designPace || 'daypart';
  async function setPace(v: string) {
    setBusy(true);
    try { await put('/api/admin/settings', { designPace: v }); toast(v === 'daily' ? 'The design now changes once a day.' : v === 'weekly' ? 'The design now changes once a week.' : 'The design now changes four times a day.'); reload(); setNow(null); } catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  const all = [...new Set(cal.packs.flatMap((p) => p.designs)), 'ivory', 'obsidian'];
  return (
    <Panel title="Website design" note="Visitors cannot choose a design; the website shows the one set here. Every design has a day version (6 am to 6 pm) and a night version, and visitors can flip between the two with the sun and moon switch. Festival days still come first.">
      <div className="form-grid">
        <label className="check full"><input type="radio" name="sd" checked={rotate} disabled={busy} onChange={() => pick('rotate')} /><span><b>Change by itself through the day</b> (recommended): a design from the live pack to suit the light at the ground, and a different one each day</span></label>
        {rotate && <div className="full" style={{ display: 'grid', gap: 4, paddingLeft: 26 }}>
          <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>How often it changes
            <select className="inp" style={{ width: 'auto' }} disabled={busy} value={pace} onChange={(e) => setPace(e.target.value)}>
              <option value="daypart">Four times a day (morning, afternoon, evening, night)</option><option value="daily">Once a day, at 6 am</option><option value="weekly">Once a week, on Monday at 6 am</option>
            </select></label>
          {pace === 'daypart' ? bands.map((b, i) => <div key={b.name} className="small"><b>{b.name}</b> <span className="muted">({hourText(b.from)} to {hourText(bands[(i + 1) % bands.length]!.from)}):</span> {b.designs.map(nameOf).join(', ')}</div>)
            : <div className="small">In turn: {bands.flatMap((b) => b.designs).map(nameOf).join(', ')}</div>}
          {now && now.design && <div className="hint" style={{ marginTop: 4 }}>Showing now: {nameOf(now.design)}{now.band ? ` (${now.band.toLowerCase()})` : ''}</div>}
        </div>}
        <label className="check full"><input type="radio" name="sd" checked={!rotate} disabled={busy} onChange={() => pick(s.siteDesign && s.siteDesign !== 'rotate' ? s.siteDesign : cal.live.designs[0]!)} /><span><b>Always show one design</b></span></label>
        {!rotate && <Field label="Design" hint="Any design from any pack, live or earlier" full><select className="inp" disabled={busy} value={s.siteDesign} onChange={(e) => pick(e.target.value)}>{all.map((k) => <option key={k} value={k}>{nameOf(k)}</option>)}</select></Field>}
        <div className="full"><a className="btn sm ghost" href="/" target="_blank" rel="noopener">Open the website</a></div>
      </div>
    </Panel>
  );
}

export default function Website() {
  const [cal, error, reload] = useApi<PackCalendar>('/api/admin/design-packs');
  if (error) return <ErrorBox msg={error} />;
  if (!cal) return <Loading h={160} />;
  return <><Packs cal={cal} reload={reload} /><div style={{ height: 12 }} /><Design cal={cal} /><div style={{ height: 12 }} /><Gallery /></>;
}

function Gallery() {
  const toast = useToast();
  const [s, error] = useApi<any>('/api/admin/settings');
  const [f, setF] = useState<{ ig: string; gal: string; acad: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading />;
  const v = f ?? { ig: s.instagramUrl || '', gal: (s.galleryImages || []).join('\n'), acad: (s.academyImages || []).join('\n') };
  const lines = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  async function save() {
    setBusy(true); setMsg(null);
    try { await put('/api/admin/settings', { instagramUrl: v.ig.trim(), galleryImages: lines(v.gal), academyImages: lines(v.acad) }); toast('Website updated.'); } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  async function upload(kind: 'gallery' | 'academy', files: FileList | null) {
    if (!files?.length) return toast('Choose one or more photos first');
    setBusy(true);
    try {
      let add = '';
      for (const file of Array.from(files)) { const r = await sendFile<{ url: string }>(`/api/media?kind=${kind}&filename=${encodeURIComponent(file.name)}`, file, { 'content-type': file.type || 'application/octet-stream' }); add += '\n' + r.url; }
      setF({ ...v, [kind === 'gallery' ? 'gal' : 'acad']: (kind === 'gallery' ? v.gal : v.acad).trim() + add });
      toast('Uploaded. Press Save to publish them.');
    } catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  return (
    <Panel title="Website: gallery and Instagram" note="What visitors see on the public website.">
      <div className="form-grid">
        <Field label="Instagram page" full><input className="inp" type="url" placeholder="https://www.instagram.com/your_page/" value={v.ig} onChange={(e) => setF({ ...v, ig: e.target.value })} /></Field>
        <Field label="Gallery photos (links or uploads)" hint="One photo link per line, each starting with https://" full>
          <textarea className="inp" style={{ height: 130, padding: 10 }} value={v.gal} onChange={(e) => setF({ ...v, gal: e.target.value })} />
        </Field>
        <div className="full"><Upload busy={busy} onGo={(fl) => upload('gallery', fl)} /></div>
        <Field label="Academy photos" hint="One per line" full><textarea className="inp" style={{ height: 90, padding: 10 }} value={v.acad} onChange={(e) => setF({ ...v, acad: e.target.value })} /></Field>
        <div className="full"><Upload busy={busy} onGo={(fl) => upload('academy', fl)} /></div>
      </div>
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" disabled={busy} onClick={save}>Save website details</button>{msg && <span className="err-text">{msg}</span>}</div>
    </Panel>
  );
}
