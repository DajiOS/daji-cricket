import { useRef, useState } from 'react';
import { PageHead, Stat, Loading, ErrorBox, useToast } from '../ui';
import { useApi, del, patch, getToken } from '../lib';
import { errText } from '../parts/admin/common';

interface Item { thumb?: string | null; id: string; name: string; kind: 'image' | 'video'; bytes: number; tag: string; url: string; createdAt: number }
interface Lib { items: Item[]; freeBytes: number | null; libraryBytes: number }
const API = ((window as any).DAJI_API || '').replace(/\/$/, '');
const TAGS: [string, string][] = [['hero', 'Top banner'], ['gallery', 'Gallery'], ['academy', 'Academy'], ['other', 'Other']];
const size = (b: number) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

interface Job { key: string; name: string; pct: number; state: 'up' | 'done' | 'fail'; msg?: string }

export default function Media() {
  const [lib, err, reload] = useApi<Lib>('/api/library');
  const toast = useToast();
  const [tag, setTag] = useState('gallery');
  const [jobs, setJobs] = useState<Job[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const patchJob = (key: string, p: Partial<Job>) => setJobs((j) => j.map((x) => (x.key === key ? { ...x, ...p } : x)));
  function send(file: File): Promise<void> {
    const key = Math.random().toString(36).slice(2);
    setJobs((j) => [...j, { key, name: file.name, pct: 0, state: 'up' }]);
    return new Promise((resolve) => {
      const x = new XMLHttpRequest();
      x.open('POST', `${API}/api/library?name=${encodeURIComponent(file.name)}&tag=${encodeURIComponent(tag)}`);
      const t = getToken(); if (t) x.setRequestHeader('authorization', 'Bearer ' + t);
      x.setRequestHeader('content-type', 'application/octet-stream');
      x.upload.onprogress = (e) => { if (e.lengthComputable) patchJob(key, { pct: Math.round((e.loaded / e.total) * 100) }); };
      x.onload = () => {
        if (x.status === 201) patchJob(key, { pct: 100, state: 'done' });
        else { let m = `Upload failed (${x.status || 'no answer'})`; try { m = JSON.parse(x.responseText).error.message; } catch { /* keep default */ } patchJob(key, { state: 'fail', msg: m }); }
        resolve();
      };
      x.onerror = () => { patchJob(key, { state: 'fail', msg: 'Connection lost. Try this file again.' }); resolve(); };
      x.send(file);
    });
  }
  async function pick(files: FileList | File[]) {
    // one at a time, so a slow connection finishes each file instead of stalling them all
    for (const f of Array.from(files)) await send(f);
    reload(); toast('Upload finished');
  }
  async function retag(it: Item, to: string) { try { await patch('/api/library/' + it.id, { tag: to }); reload(); } catch (e) { toast(errText(e)); } }
  async function remove(it: Item) {
    if (!window.confirm(`Remove ${it.name}? It will disappear from the website.`)) return;
    try { await del('/api/library/' + it.id); reload(); } catch (e) { toast(errText(e)); }
  }
  async function copy(it: Item) {
    const u = location.origin.replace(/\/$/, '') + it.url;
    try { await navigator.clipboard.writeText(u); toast('Link copied'); } catch { window.prompt('Copy this link', u); }
  }

  return (
    <div className="stack">
      <PageHead eyebrow="Website" title="Photos and videos" lede="Upload as many photos and videos as you like, of any size. Choose where each one is used: the top banner of the website or the gallery. Files stay on your own server." />
      <ErrorBox msg={err} />
      <div className="grid g3">
        <Stat label="Files" value={lib ? lib.items.length : '—'} foot="Photos and videos" />
        <Stat label="Space used" value={lib ? size(lib.libraryBytes) : '—'} foot="By this library" />
        <Stat label="Space free" value={lib && lib.freeBytes != null ? size(lib.freeBytes) : '—'} foot="On the server" />
      </div>
      <div className="card" style={{ padding: 16 }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void pick(e.dataTransfer.files); }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', border: `2px dashed ${drag ? 'var(--gold, #c9a96b)' : 'rgba(127,127,127,.4)'}`, borderRadius: 14, padding: 18 }}>
          <div style={{ flex: '1 1 220px' }}>
            <strong>Drop files here, or choose them</strong>
            <div className="hint">JPG, PNG, WebP, MP4, MOV, WebM. Keep this page open until the bars finish. For the top banner, a short clip under 30 seconds plays best on phones.</div>
          </div>
          <label className="hint">Use as&nbsp;
            <select className="inp" value={tag} onChange={(e) => setTag(e.target.value)}>{TAGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <button className="btn primary" onClick={() => input.current?.click()}>Choose files</button>
          <input ref={input} type="file" multiple hidden accept="image/*,video/*,.mp4,.mov,.webm" onChange={(e) => { if (e.target.files?.length) void pick(e.target.files); e.target.value = ''; }} />
        </div>
        {jobs.length > 0 && <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {jobs.map((j) => (
            <div key={j.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</span><span>{j.state === 'fail' ? j.msg : j.state === 'done' ? 'Done' : j.pct + '%'}</span></div>
              <div style={{ height: 6, borderRadius: 4, background: 'rgba(127,127,127,.25)', overflow: 'hidden' }}><div style={{ width: j.pct + '%', height: '100%', background: j.state === 'fail' ? '#c0392b' : '#14573e' }} /></div>
            </div>
          ))}
        </div>}
      </div>
      {!lib ? <Loading /> : lib.items.length === 0 ? <p className="hint">Nothing uploaded yet.</p> : (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
          {lib.items.map((it) => (
            <div key={it.id} className="card" style={{ padding: 10, display: 'grid', gap: 8, minWidth: 0 }}>
              <a href={API + it.url} target="_blank" rel="noreferrer" style={{ display: 'block', position: 'relative' }} title="Open the original">
                {it.thumb ? <img src={API + it.thumb} alt={it.name} loading="lazy" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                  : it.kind === 'image' ? <img src={API + it.url} alt={it.name} loading="lazy" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                  : <div style={{ width: '100%', aspectRatio: '16/10', borderRadius: 10, background: '#0f3d2e', display: 'grid', placeItems: 'center', color: '#f3ead2' }}>Video</div>}
                {it.kind === 'video' && <span style={{ position: 'absolute', left: '50%', top: '50%', width: 44, height: 44, margin: '-22px 0 0 -22px', borderRadius: '50%', background: 'rgba(15,61,46,.75)', color: '#f6f2e9', display: 'grid', placeItems: 'center', fontSize: 18 }}>▶</span>}
              </a>
              <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.name}>{it.name}</div>
              <div className="hint">{it.kind === 'video' ? 'Video' : 'Photo'} · {size(it.bytes)}</div>
              <select className="inp" value={it.tag} onChange={(e) => void retag(it, e.target.value)}>{TAGS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <div style={{ display: 'flex', gap: 8 }}><button className="btn ghost" onClick={() => void copy(it)}>Copy link</button><button className="btn ghost" onClick={() => void remove(it)}>Remove</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
