// Instagram link and the gallery photos shown on the website.
import { useState } from 'react';
import { useApi, put, sendFile } from '../../lib';
import { Loading, ErrorBox, Field, useToast } from '../../ui';
import { Panel, errText } from './common';

function Upload({ busy, onGo }: { busy: boolean; onGo: (f: FileList | null) => void }) {
  const [files, setFiles] = useState<FileList | null>(null);
  return <div className="row" style={{ marginTop: 6 }}><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(e) => setFiles(e.target.files)} /><button className="btn sm" disabled={busy} onClick={() => onGo(files)}>Upload</button></div>;
}

export default function Website() {
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
