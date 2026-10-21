// Instagram link and the gallery photos shown on the website.
import { useState } from 'react';
import { useApi, put, sendFile, api } from '../../lib';
import { Loading, ErrorBox, Field, useToast } from '../../ui';
import { Panel, errText } from './common';

function Upload({ busy, onGo }: { busy: boolean; onGo: (f: FileList | null) => void }) {
  const [files, setFiles] = useState<FileList | null>(null);
  return <div className="row" style={{ marginTop: 6 }}><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(e) => setFiles(e.target.files)} /><button className="btn sm" disabled={busy} onClick={() => onGo(files)}>Upload</button></div>;
}

const DESIGN_NAMES: Record<string, string> = {
  noir: 'Floodlight Noir', pavilion: 'Emerald Pavilion', whites: 'Test Whites', pinkball: 'Pink Ball Night', monsoon: 'Monsoon Glass',
  maroon: 'Royal Maroon', carbon: 'Carbon T20', champagne: 'Champagne Minimal', stadium: 'Stadium Royal Blue', willow: 'Willow & Leather',
  ivory: 'Plain light', obsidian: 'Plain dark',
};
const SCHEDULE: [string, string, string[]][] = [
  ['Morning', '6 am to 11 am', ['whites', 'champagne', 'pavilion']], ['Afternoon', '11 am to 5 pm', ['willow', 'monsoon', 'maroon']],
  ['Evening', '5 pm to 8 pm', ['stadium', 'carbon']], ['Night', '8 pm to 6 am', ['noir', 'pinkball']],
];

/** Which design the public website wears: one that changes through the day, or one the owner fixes. */
function Design() {
  const toast = useToast();
  const [s, error, reload] = useApi<any>('/api/admin/settings');
  const [now, setNow] = useState<{ design: string; band: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!now) void api<any>('/api/festival').then((r) => setNow(r.site)).catch(() => setNow({ design: '', band: null }));
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading h={120} />;
  async function pick(v: string) {
    setBusy(true);
    try { await put('/api/admin/settings', { siteDesign: v }); toast(v === 'rotate' ? 'The design now changes through the day.' : `The website now always shows ${DESIGN_NAMES[v]}.`); reload(); setNow(null); } catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  const rotate = (s.siteDesign || 'rotate') === 'rotate';
  return (
    <Panel title="Website design" note="What visitors see when they have not picked a design themselves. Festival days still come first.">
      <div className="form-grid">
        <label className="check full"><input type="radio" name="sd" checked={rotate} disabled={busy} onChange={() => pick('rotate')} /><span><b>Change by itself through the day</b> (recommended): a design to suit the light at the ground, and a different one each day</span></label>
        {rotate && <div className="full" style={{ display: 'grid', gap: 4, paddingLeft: 26 }}>
          {SCHEDULE.map(([n, t, ds]) => <div key={n} className="small"><b>{n}</b> <span className="muted">({t}):</span> {ds.map((d) => DESIGN_NAMES[d]).join(', ')}</div>)}
          {now && now.design && <div className="hint" style={{ marginTop: 4 }}>Showing now: {DESIGN_NAMES[now.design] || now.design}{now.band ? ` (${now.band.toLowerCase()})` : ''}</div>}
        </div>}
        <label className="check full"><input type="radio" name="sd" checked={!rotate} disabled={busy} onChange={() => pick(s.siteDesign && s.siteDesign !== 'rotate' ? s.siteDesign : 'noir')} /><span><b>Always show one design</b></span></label>
        {!rotate && <Field label="Design" full><select className="inp" disabled={busy} value={s.siteDesign} onChange={(e) => pick(e.target.value)}>{Object.entries(DESIGN_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        <div className="full"><a className="btn sm ghost" href="/" target="_blank" rel="noopener">Open the website</a></div>
      </div>
    </Panel>
  );
}

export default function Website() {
  return <><Design /><div style={{ height: 12 }} /><Gallery /></>;
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
