// Documents: drop in any file and every page is read, indexed and filed in the folder its pages point to, with the other likely folders one tap
// away. Search finds a document by the words on its pages and shows the page. Photos and scans are read by Platform AI once the Claude
// connection is set up in Settings; until then they wait and everything else works.
import { useRef, useState } from 'react';
import { PageHead, Chip, Empty, ErrorBox, Loading, Modal, Confirm, useToast, Icon } from '../ui';
import { api, can, del, download, fmtDateTime, go, patch, post, sendFile, useApi } from '../lib';
import { useSession } from '../App';
import { PagePicture, Snippet } from '../parts/docs/PagePicture';

export interface Suggestion { folderId: string; name: string; reason: string }
export interface Doc {
  id: string; name: string; mime: string; bytes: number; pages: number; reading: 'text' | 'ai' | 'waiting' | 'none';
  folder: { id: string; name: string } | null; filedBy: 'auto' | 'person'; suggestions: Suggestion[]; links: { kind: string; id: string; label: string }[]; createdAt: number;
}
export interface Hit { docId: string; name: string; folder: string | null; mime: string; page: number; pages: number; snippet: string }
interface Folder { id: string; key: string | null; name: string; count: number }
interface Folders { items: Folder[]; waiting: number; aiReady: boolean }

const READING: Record<Doc['reading'], [Parameters<typeof Chip>[0]['tone'], string]> = {
  text: ['good', 'Every page searchable'], ai: ['good', 'Read by Platform AI'], waiting: ['warn', 'Waiting for Platform AI'], none: ['mute', 'Nothing to read'],
};
const LINK_TO: Record<string, (id: string) => string> = { booking: (id) => '/bookings/' + id, customer: (id) => '/contacts/' + id, vendor: () => '/bills/vendors', bank_account: () => '/transactions', bank_import: () => '/transactions/import' };
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function Documents({ sub }: { sub: string }) {
  const { ownerId } = useSession();
  const [folders, fErr, reloadFolders] = useApi<Folders>('/api/docs/folders', [ownerId]);
  const [folder, setFolder] = useState<string | null>(null);
  const [docs, dErr, reloadDocs] = useApi<{ items: Doc[] }>(`/api/docs${folder ? `?folderId=${folder}` : ''}`, [ownerId]);
  const [q, setQ] = useState(''); const [asked, setAsked] = useState(''); const [qErr, setQErr] = useState<string | null>(null);
  const [hits, hErr] = useApi<{ items: Hit[] }>(asked ? `/api/docs/search?q=${encodeURIComponent(asked)}` : null, [ownerId]);
  const [fresh, setFresh] = useState<Doc[]>([]);
  const [open, view] = sub.split('/');
  const reload = () => { reloadFolders(); reloadDocs(); };
  const replace = (d: Doc) => { setFresh((x) => x.map((y) => (y.id === d.id ? d : y))); reload(); };

  return (
    <div className="stack">
      <PageHead eyebrow="Work" title="Documents" lede="Drop in any file. Every page is read and searchable, and each document is filed where its pages say it belongs, with the other folders it could go in one tap away." />
      <Uploader onDone={(d) => { setFresh((x) => [d, ...x]); reload(); }} />
      {folders && folders.waiting > 0 && <AiNote waiting={folders.waiting} ready={folders.aiReady} />}
      {fresh.length > 0 && folders && (
        <section className="stack" aria-label="Just filed">
          <h3 style={{ margin: 0 }}>Just filed</h3>
          {fresh.map((d) => <Filed key={d.id} d={d} folders={folders.items} aiReady={folders.aiReady} onChange={replace} onGone={() => { setFresh((x) => x.filter((y) => y.id !== d.id)); reload(); }} />)}
        </section>)}

      <form className="card card-pad row" onSubmit={(e) => { e.preventDefault(); if (!q.trim()) { setQErr('Type a word or two that is written on the page you want.'); return; } setQErr(null); setAsked(q.trim()); }}>
        <Icon name="search" size={18} />
        <input className="inp" style={{ flex: 1, minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a document by what is written on its pages, e.g. fire NOC, Arvindbhai lease, insurance premium" aria-label="Search the pages of your documents" />
        <button className="btn primary" type="submit">Search</button>
        {asked && <button className="btn ghost" type="button" onClick={() => { setQ(''); setAsked(''); }}>Clear</button>}
      </form>
      {qErr && <div className="small muted" role="alert">{qErr}</div>}
      {asked && (hErr ? <ErrorBox msg={hErr} /> : !hits ? <Loading h={160} /> : <Hits hits={hits.items} words={asked} />)}

      <ErrorBox msg={fErr || dErr} />
      {!folders ? (!fErr && <Loading h={60} />) : (
        <div className="doc-folders" role="tablist" aria-label="Folders">
          <button type="button" role="tab" aria-selected={!folder} className={`dchip${!folder ? ' on' : ''}`} onClick={() => setFolder(null)}>All</button>
          {folders.items.map((f) => <button key={f.id} type="button" role="tab" aria-selected={folder === f.id} className={`dchip${folder === f.id ? ' on' : ''}`} onClick={() => setFolder(f.id)}>{f.name} <span className="muted">{f.count}</span></button>)}
          <NewFolder onMade={reload} />
          {folder && <FolderTools f={folders.items.find((x) => x.id === folder)} onGone={() => { setFolder(null); reload(); }} onRenamed={reload} />}
        </div>)}
      {!docs ? (!dErr && <Loading h={200} />) : !docs.items.length ? <div className="card"><Empty>{folder ? 'Nothing in this folder yet.' : 'No documents yet. Drop a file above: bank statements, bills, agreements, licences, photos of receipts.'}</Empty></div> : (
        <div className="tbl-wrap card"><table className="tbl">
          <thead><tr><th>Document</th><th>Folder</th><th className="num">Pages</th><th>Read</th><th>Linked to</th><th>Added</th></tr></thead>
          <tbody>{docs.items.map((d) => (
            <tr key={d.id} className="click" onClick={() => go('/documents/' + d.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('/documents/' + d.id)}>
              <td className="strong">{d.name}</td><td>{d.folder?.name ?? '—'}{d.filedBy === 'auto' && <span className="small muted"> · suggested</span>}</td><td className="num">{d.pages}</td>
              <td><Chip tone={READING[d.reading][0]}>{READING[d.reading][1]}</Chip></td><td className="small">{d.links.map((l) => l.label).join(', ') || '—'}</td><td className="small muted">{fmtDateTime(d.createdAt)}</td>
            </tr>))}</tbody>
        </table></div>)}
      {open && folders && <Viewer id={open} page={Number(view) || 1} folders={folders.items} aiReady={folders.aiReady} onClose={() => go('/documents')} onChange={reload} />}
    </div>
  );
}

function Uploader({ onDone }: { onDone: (d: Doc) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null); const sending = busy !== null;
  const [over, setOver] = useState(false);
  async function take(list: FileList | null) {
    for (const f of Array.from(list ?? [])) {
      setBusy(f.name);
      try { onDone(await sendFile<Doc>(`/api/docs?filename=${encodeURIComponent(f.name)}`, f)); }
      catch (e: any) { toast(`${f.name}: ${e.message}`); }
    }
    setBusy(null); if (input.current) input.current.value = '';
  }
  return (
    <div className={`card card-pad doc-drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files); }}>
      <Icon name="upload" size={22} />
      <div style={{ flex: 1 }}>
        <b>{busy ? `Reading ${busy}…` : 'Drop files here, or choose them'}</b>
        <div className="small muted">PDF, photos (JPEG, PNG, WebP), Excel, CSV or text, up to 25 MB each. Every file is virus-checked first.</div>
      </div>
      <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.csv,.txt" onChange={(e) => void take(e.target.files)} />
      <button className="btn primary" type="button" disabled={sending} onClick={() => input.current?.click()}>Choose files</button>
    </div>
  );
}

function AiNote({ waiting, ready }: { waiting: number; ready: boolean }) {
  return (
    <div className="card card-pad small" role="note">
      {waiting} photo{waiting === 1 ? ' or scan is' : 's or scans are'} kept but not read yet, so {waiting === 1 ? 'its words are' : 'their words are'} not searchable.{' '}
      {ready ? 'Open one and press Read with Platform AI.' : <>Platform AI reads them once the Claude connection is set up in <a href="#/settings/connections">Settings › Connections</a>.</>}
    </div>
  );
}

/** A document just uploaded: where it was filed and why, the other folders it could go in, and what it was tied to. */
function Filed({ d, folders, aiReady, onChange, onGone }: { d: Doc; folders: Folder[]; aiReady: boolean; onChange: (d: Doc) => void; onGone: () => void }) {
  const why = d.suggestions.find((s) => s.folderId === d.folder?.id);
  return (
    <div className="card card-pad doc-filed">
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        {(d.mime === 'application/pdf' || d.mime.startsWith('image/')) && <PagePicture docId={d.id} mime={d.mime} width={96} label={`First page of ${d.name}`} />}
        <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <div className="row"><b>{d.name}</b><span className="small muted">{d.pages} page{d.pages === 1 ? '' : 's'} · {kb(d.bytes)}</span><Chip tone={READING[d.reading][0]}>{READING[d.reading][1]}</Chip></div>
          <div>{d.filedBy === 'person' ? 'Moved to' : 'Filed in'} <b>{d.folder?.name ?? 'no folder'}</b>{d.filedBy === 'auto' && why && <span className="muted"> because it {why.reason}</span>}.</div>
          <MoveTo d={d} folders={folders} onChange={onChange} />
          {d.links.length > 0 && <div className="small">Also shows with: {d.links.map((l, i) => <span key={l.kind + l.id}>{i ? ', ' : ''}<a href={'#' + (LINK_TO[l.kind]?.(l.id) ?? '/documents')}>{l.label}</a></span>)}</div>}
          <Actions d={d} aiReady={aiReady} onChange={onChange} />
        </div>
        <button className="btn sm ghost" type="button" onClick={() => go('/documents/' + d.id)}>Open</button>
        <Confirm className="btn sm ghost" label="Remove" ask="Remove it?" onYes={async () => { await del(`/api/docs/${d.id}`); onGone(); }} />
      </div>
    </div>
  );
}

/** The folders it could go in, best first, then any folder or a new one. */
function MoveTo({ d, folders, onChange }: { d: Doc; folders: Folder[]; onChange: (d: Doc) => void }) {
  const toast = useToast();
  const move = async (folderId: string) => { try { onChange(await patch<Doc>(`/api/docs/${d.id}`, { folderId })); } catch (e: any) { toast(e.message); } };
  const others = d.suggestions.filter((s) => s.folderId !== d.folder?.id);
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {others.length > 0 && <span className="small muted">Could also go in:</span>}
      {others.map((s) => <button key={s.folderId} type="button" className="dchip" title={`It ${s.reason}`} onClick={() => move(s.folderId)}>{s.name}</button>)}
      <select className="inp sm" aria-label="Move to another folder" value="" onChange={async (e) => {
        const v = e.target.value; if (!v) return;
        if (v === '+') { const name = prompt('Name of the new folder'); if (!name?.trim()) return; try { const f = await post<Folder>('/api/docs/folders', { name }); await move(f.id); } catch (er: any) { toast(er.message); } return; }
        await move(v);
      }}>
        <option value="">Another folder…</option>
        {folders.filter((f) => f.id !== d.folder?.id).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        <option value="+">New folder…</option>
      </select>
    </div>
  );
}

/** What the document can do where it is filed: a bank statement goes into the books; a photo or scan is read by Platform AI. */
function Actions({ d, aiReady, onChange }: { d: Doc; aiReady: boolean; onChange: (d: Doc) => void }) {
  const { me } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [accts] = useApi<{ items: { id: string; name: string; kind: string }[] }>(d.folder?.name === 'Bank statements' && can(me, 'manage_accounting') ? '/api/accounting/accounts' : null);
  const linked = d.links.find((l) => l.kind === 'bank_account')?.id;
  const [acct, setAcct] = useState('');
  const imported = d.links.some((l) => l.kind === 'bank_import');
  async function run<T>(f: () => Promise<T>, ok: (x: T) => string) { setBusy(true); try { const x = await f(); toast(ok(x)); onChange(await api<Doc>(`/api/docs/${d.id}`)); } catch (e: any) { toast(e.message); } setBusy(false); }
  return (
    <>
      {d.reading === 'waiting' && (aiReady
        ? <div><button className="btn sm" type="button" disabled={busy} onClick={() => run(() => post(`/api/docs/${d.id}/read`), () => 'Read. Its pages are searchable now.')}>{busy ? 'Reading…' : 'Read with Platform AI'}</button></div>
        : <div className="small muted">Its pages are read once Platform AI (the Claude connection) is set up in <a href="#/settings/connections">Settings › Connections</a>. The file is kept meanwhile.</div>)}
      {accts && !imported && (
        <div className="row" style={{ gap: 6 }}>
          <span className="small">Bring its transactions into the books:</span>
          <select className="inp sm" aria-label="Bank account" value={acct || linked || ''} onChange={(e) => setAcct(e.target.value)}>
            <option value="">Pick the account…</option>
            {accts.items.filter((a) => a.kind === 'bank').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn sm primary" type="button" disabled={busy} onClick={() => !(acct || linked) ? toast('Pick the bank account this statement belongs to.') : run(() => post<{ rowsNew: number; autoMatched: number }>(`/api/docs/${d.id}/import-statement`, { accountId: acct || linked }), (x) => `Imported ${x.rowsNew} transactions${x.autoMatched ? `, ${x.autoMatched} matched to bookings` : ''}.`)}>Import</button>
        </div>)}
    </>
  );
}

function Hits({ hits, words }: { hits: Hit[]; words: string }) {
  if (!hits.length) return <div className="card"><Empty>No page mentions “{words}”. Photos and scans are searched once Platform AI has read them.</Empty></div>;
  return (
    <div className="doc-hits">
      {hits.map((h) => (
        <button key={h.docId} type="button" className="card doc-hit" onClick={() => go(`/documents/${h.docId}/${h.page}`)}>
          {(h.mime === 'application/pdf' || h.mime.startsWith('image/')) && <PagePicture docId={h.docId} mime={h.mime} page={h.page} width={200} label={`${h.name}, page ${h.page}`} />}
          <span className="strong">{h.name}</span>
          <span className="small muted">Page {h.page} of {h.pages}{h.folder ? ` · ${h.folder}` : ''}</span>
          <Snippet text={h.snippet} />
        </button>))}
    </div>
  );
}

function NewFolder({ onMade }: { onMade: () => void }) {
  const toast = useToast();
  return <button type="button" className="dchip" onClick={async () => { const name = prompt('Name of the new folder'); if (!name?.trim()) return; try { await post('/api/docs/folders', { name }); onMade(); } catch (e: any) { toast(e.message); } }}>+ New folder</button>;
}

function FolderTools({ f, onGone, onRenamed }: { f?: Folder; onGone: () => void; onRenamed: () => void }) {
  const toast = useToast();
  if (!f) return null;
  return (
    <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
      <button type="button" className="btn sm ghost" onClick={async () => { const name = prompt('New name for the folder', f.name); if (!name?.trim() || name === f.name) return; try { await patch(`/api/docs/folders/${f.id}`, { name }); onRenamed(); } catch (e: any) { toast(e.message); } }}>Rename</button>
      {f.key !== 'other' && <Confirm className="btn sm ghost" label="Delete folder" ask={f.count ? 'Move its documents out first.' : 'Delete this empty folder?'} onYes={async () => { try { await del(`/api/docs/folders/${f.id}`); onGone(); } catch (e: any) { toast(e.message); } }} />}
    </span>
  );
}

/** One document: its pages as pictures, the text read from each, where it is filed, and what it is tied to. */
function Viewer({ id, page, folders, aiReady, onClose, onChange }: { id: string; page: number; folders: Folder[]; aiReady: boolean; onClose: () => void; onChange: () => void }) {
  const [d, err, reload] = useApi<Doc & { pageTexts: { page: number; text: string; source: string }[] }>(`/api/docs/${id}`);
  const toast = useToast();
  const n = d ? Math.min(Math.max(1, page), Math.max(1, d.pages)) : page;
  const to = (p: number) => go(`/documents/${id}/${p}`);
  const text = d?.pageTexts.find((p) => p.page === n)?.text ?? '';
  return (
    <Modal wide title={d?.name ?? 'Document'} onClose={onClose} foot={d && <>
      <button className="btn ghost" type="button" onClick={() => download(`/api/docs/${id}/file`, d.name).catch((e) => toast(e.message))}>Download</button>
      <Confirm className="btn ghost" label="Remove" ask="Remove it from every list and from search?" onYes={async () => { await del(`/api/docs/${id}`); onChange(); onClose(); }} />
      <button className="btn primary" type="button" onClick={onClose}>Done</button>
    </>}>
      {err ? <ErrorBox msg={err} /> : !d ? <Loading h={300} /> : (
        <div className="doc-view">
          <div className="stack" style={{ alignItems: 'center' }}>
            {(d.mime === 'application/pdf' || d.mime.startsWith('image/')) ? <PagePicture docId={d.id} mime={d.mime} page={n} width={420} label={`${d.name}, page ${n}`} /> : <pre className="doc-text">{text}</pre>}
            {d.pages > 1 && <div className="row"><button className="btn sm" type="button" disabled={n <= 1} onClick={() => to(n - 1)}>Previous</button><span className="small">Page {n} of {d.pages}</span><button className="btn sm" type="button" disabled={n >= d.pages} onClick={() => to(n + 1)}>Next</button></div>}
          </div>
          <div className="stack" style={{ gap: 10, minWidth: 0 }}>
            <div>In <b>{d.folder?.name ?? 'no folder'}</b>{d.filedBy === 'auto' && <span className="small muted"> (suggested)</span>}</div>
            <MoveTo d={d} folders={folders} onChange={() => { reload(); onChange(); }} />
            {d.links.length > 0 && <div className="small">Shows with: {d.links.map((l, i) => <span key={l.kind + l.id}>{i ? ', ' : ''}<a href={'#' + (LINK_TO[l.kind]?.(l.id) ?? '/documents')}>{l.label}</a></span>)}</div>}
            <Chip tone={READING[d.reading][0]}>{READING[d.reading][1]}</Chip>
            <Actions d={d} aiReady={aiReady} onChange={() => { reload(); onChange(); }} />
            {d.mime !== 'text/plain' && <details><summary className="small">Text read from page {n}</summary><pre className="doc-text">{text || 'No text on this page yet.'}</pre></details>}
          </div>
        </div>)}
    </Modal>
  );
}
