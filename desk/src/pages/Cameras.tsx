import { useEffect, useState } from 'react';
import { PageHead, ErrorBox, Loading, Modal, useToast } from '../ui';
import { api, post, patch, del, useApi } from '../lib';
import { useSession } from '../App';
import { errText } from '../parts/admin/common';

interface Cam { id: string; name: string; active: boolean; online: boolean; watchers: number; lastFrameAt: number | null }
const API = ((window as any).DAJI_API || '').replace(/\/$/, '');
const HOST = location.origin;

/** Live pictures from the ground's cameras. The pictures arrive from a small program on a PC at the ground (see camera-bridge/README.md). */
export default function Cameras({ sub }: { sub: string }) {
  void sub;
  const { me } = useSession();
  const toast = useToast();
  const manager = me?.role === 'owner' || me?.role === 'super_admin';
  const [data, error, reload] = useApi<{ items: Cam[] }>('/api/cameras');
  const [link, setLink] = useState<{ token: string; nonce: number } | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ id: string; name: string; token: string } | null>(null);
  const [visible, setVisible] = useState(!document.hidden);

  // the list refreshes every 10 seconds so Online/Offline stays true
  useEffect(() => { const t = setInterval(reload, 10000); return () => clearInterval(t); }, [reload]);
  // pictures stop while the tab is hidden (saves data, and the bridge slows down when nobody is watching)
  useEffect(() => { const f = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, []);
  // a fresh link token now, and again every 25 minutes (a stream is cut after 30 minutes; this reconnects it)
  useEffect(() => {
    let live = true;
    const get = () => api<{ token: string }>('/api/cameras/view-token', { method: 'POST', body: {} }).then((r) => live && setLink((l) => ({ token: r.token, nonce: (l?.nonce ?? 0) + 1 }))).catch(() => undefined);
    void get();
    const t = setInterval(get, 25 * 60 * 1000);
    return () => { live = false; clearInterval(t); };
  }, []);

  async function add(name: string) {
    try { const c = await post<Cam & { ingestToken: string }>('/api/cameras', { name }); setAdding(false); setSecret({ id: c.id, name: c.name, token: c.ingestToken }); reload(); }
    catch (e) { toast(errText(e)); }
  }
  async function rotate(c: Cam) {
    if (!window.confirm(`Make a new secret for ${c.name}? The bridge must be updated with it, or this camera goes offline.`)) return;
    try { const r = await post<{ ingestToken: string }>(`/api/cameras/${c.id}/token`, {}); setSecret({ id: c.id, name: c.name, token: r.ingestToken }); } catch (e) { toast(errText(e)); }
  }
  async function rename(c: Cam) {
    const n = window.prompt('Camera name', c.name); if (!n || n === c.name) return;
    try { await patch(`/api/cameras/${c.id}`, { name: n }); reload(); } catch (e) { toast(errText(e)); }
  }
  async function toggle(c: Cam) { try { await patch(`/api/cameras/${c.id}`, { active: !c.active }); reload(); } catch (e) { toast(errText(e)); } }
  async function remove(c: Cam) {
    if (!window.confirm(`Remove ${c.name}? Its recordings on the recorder are not touched.`)) return;
    try { await del(`/api/cameras/${c.id}`); reload(); } catch (e) { toast(errText(e)); }
  }

  const cams = data?.items ?? [];
  const live = cams.filter((c) => c.active);
  const src = (c: Cam) => (link && visible ? `${API}/api/cameras/${c.id}/stream?t=${encodeURIComponent(link.token)}&n=${link.nonce}` : '');

  return (
    <div className="stack">
      <PageHead eyebrow="Ground" title="Live cameras" lede="Watch the ground live. Pictures come from your camera recorder through a small program running at the ground. Nothing is recorded here; the recorder keeps the recordings.">
        {manager && <button className="btn primary" onClick={() => setAdding(true)}>Add camera</button>}
      </PageHead>
      <ErrorBox msg={error} />
      {!data ? <Loading /> : live.length === 0 ? (
        <div className="card card-pad"><p>{manager ? 'No cameras yet. Add one, then start the camera bridge at the ground. The steps are in camera-bridge/README.md.' : 'No cameras are set up yet. Ask the owner.'}</p></div>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: big ? '1fr' : 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {live.filter((c) => !big || c.id === big).map((c) => (
            <div key={c.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ position: 'relative', background: '#111', aspectRatio: '16 / 9', cursor: 'pointer' }} onClick={() => setBig(big ? null : c.id)} title={big ? 'Back to all cameras' : 'Make bigger'}>
                {c.online && src(c) && <img src={src(c)} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />}
                {!c.online && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#bbb', textAlign: 'center', padding: 12 }}>No picture. The camera bridge at the ground may be off.</div>}
              </div>
              <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{c.name}</strong>
                <span style={{ color: c.online ? 'var(--ok, #1a7f37)' : 'var(--muted, #888)' }}>{c.online ? 'Live' : 'Offline'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {manager && cams.length > 0 && (
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Manage cameras</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {cams.map((c) => (
              <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span><strong>{c.name}</strong> {c.active ? '' : '(switched off)'} <small style={{ color: 'var(--muted, #888)' }}>{c.id}</small></span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn ghost" onClick={() => rename(c)}>Rename</button>
                  <button className="btn ghost" onClick={() => toggle(c)}>{c.active ? 'Switch off' : 'Switch on'}</button>
                  <button className="btn ghost" onClick={() => rotate(c)}>New secret</button>
                  <button className="btn ghost" onClick={() => remove(c)}>Remove</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {adding && <AddCamera onClose={() => setAdding(false)} onAdd={add} />}
      {secret && (
        <Modal title={`Connect ${secret.name}`} onClose={() => setSecret(null)} wide foot={<button className="btn primary" onClick={() => setSecret(null)}>Done</button>}>
          <p>Copy this into the bridge settings now. For safety it is shown only once. If you lose it, choose New secret.</p>
          <p style={{ marginBottom: 4 }}>Add this block to <code>bridge.json</code> under <code>cameras</code>, and fill in the recorder channel number:</p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'all' }}>{JSON.stringify({ id: secret.id, token: secret.token, channel: 1 }, null, 2)}</pre>
          <p>Server address for the bridge: <code>{HOST}</code></p>
        </Modal>
      )}
    </div>
  );
}

function AddCamera({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Add camera" onClose={onClose} foot={<><ErrorBox msg={err} /><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => (name.trim() ? onAdd(name.trim()) : setErr('Give the camera a name, for example Pitch 1, north end.'))}>Add camera</button></>}>
      <label className="field"><span>Camera name <b className="req">*</b></span><input autoFocus value={name} maxLength={60} placeholder="Pitch 1, north end" onChange={(e) => setName(e.target.value)} /></label>
    </Modal>
  );
}
