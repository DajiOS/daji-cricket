// Settings, Your business: the business's own name, its app's name, its ground logo and its app logo (white-label). Customers and the
// team see these, never another business's. The owner changes them; the team sees them. Logos are virus-checked before they are kept.
import { useState } from 'react';
import { useApi, put, sendFile, del } from '../../lib';
import { Loading, ErrorBox, Field, useToast } from '../../ui';
import { Panel, errText } from './common';
import { useSession } from '../../App';

export interface Brand { businessId: string; name: string; appName: string; logoUrl: string | null; appLogoUrl: string | null; siteDomain: string | null; mainSite: boolean; slug: string; mainSettings: boolean }

const API = ((window as any).DAJI_API || '').replace(/\/$/, '');
export const brandSrc = (u: string | null) => (u ? API + u : null);

function Logo({ label, hint, url, kind, canEdit, onDone }: { label: string; hint: string; url: string | null; kind: 'logo' | 'app'; canEdit: boolean; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function upload() {
    if (!file) return toast('Choose a picture first');
    setBusy(true);
    try { await sendFile(`/api/desk/brand/logo?kind=${kind}`, file, { 'content-type': file.type || 'application/octet-stream' }); toast(`${label} saved.`); setFile(null); onDone(); }
    catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  async function remove() {
    setBusy(true);
    try { await del(`/api/desk/brand/logo?kind=${kind}`); toast(`${label} removed.`); onDone(); } catch (e) { toast(errText(e)); }
    setBusy(false);
  }
  return (
    <Field label={label} hint={hint} full>
      <div className="row" style={{ alignItems: 'center' }}>
        {url ? <img src={brandSrc(url)!} alt={label} style={{ maxHeight: 64, maxWidth: 200, objectFit: 'contain', background: 'var(--surface, transparent)', borderRadius: 8 }} /> : <span className="small muted">None yet</span>}
        {canEdit && <>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={`Choose a ${label.toLowerCase()}`} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" className="btn sm" disabled={busy} onClick={upload}>Upload</button>
          {url && <button type="button" className="btn sm ghost" disabled={busy} onClick={remove}>Remove</button>}
        </>}
      </div>
    </Field>
  );
}

export default function BrandSettings() {
  const { me, ownerId } = useSession();
  const toast = useToast();
  const [b, error, reload] = useApi<Brand>('/api/desk/brand', [ownerId]);
  const [f, setF] = useState<{ name: string; appName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!b) return <Loading />;
  const canEdit = me.role !== 'staff' && !me.readOnly;
  const v = f ?? { name: b.name, appName: b.appName };
  async function save() {
    setBusy(true); setMsg(null);
    try { await put('/api/desk/brand', { name: v.name.trim(), appName: v.appName.trim() }); toast('Saved.'); setF(null); reload(); } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  return (
    <Panel title="Your business" note="The name and logos your customers and team see, on your booking page, your app, receipts, reminders and reports. Another business never sees them, and you never see theirs.">
      <div className="form-grid">
        <Field label="Business name" hint="Shown everywhere your customers see you."><input className="inp" disabled={!canEdit} value={v.name} onChange={(e) => setF({ ...v, name: e.target.value })} /></Field>
        <Field label="App name" hint="The name under your app's icon, up to 30 letters."><input className="inp" disabled={!canEdit} maxLength={30} value={v.appName} onChange={(e) => setF({ ...v, appName: e.target.value })} /></Field>
        <Logo label="Ground logo" hint="PNG, JPEG, WebP or GIF, up to 2 MB. Shown on your booking page and in the desk." url={b.logoUrl} kind="logo" canEdit={canEdit} onDone={reload} />
        <Logo label="App logo" hint="A square picture, at least 1024 by 1024, for your own app's icon." url={b.appLogoUrl} kind="app" canEdit={canEdit} onDone={reload} />
      </div>
      {canEdit && <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy || !f} onClick={save}>Save</button>{msg && <span className="err-text" role="alert">{msg}</span>}</div>}
      {!b.mainSite && <p className="small muted" style={{ marginTop: 10 }}>Your booking page: <a href={`${API || location.origin}/b/${b.slug}`} target="_blank" rel="noopener">{`${API || location.origin}/b/${b.slug}`}</a>{b.siteDomain ? <> and <a href={`https://${b.siteDomain}`} target="_blank" rel="noopener">{b.siteDomain}</a></> : null}</p>}
    </Panel>
  );
}
