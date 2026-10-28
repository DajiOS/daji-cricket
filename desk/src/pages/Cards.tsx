import { useEffect, useRef, useState } from 'react';
import { Chip, Field, Filters, Modal, PageHead, Table, useForm, NameField, useToast } from '../ui';
import { ApiError, del, download, getToken, getViewOwner, patch, post, qs, sendFile, useApi, formatPhone } from '../lib';
import { Async, errMsg, useDebounced } from '../parts/club/common';

interface Card { id: string; name: string; title: string; company: string; phones: string[]; emails: string[]; website: string; address: string; notes: string; hasImage: boolean }
interface Scan { fields: Omit<Card, 'id' | 'hasImage'>; readable: boolean; duplicates: { id: string; name: string; company: string }[] }
const LIMIT = 50;
const API_BASE = ((window as any).DAJI_API || '').replace(/\/$/, '');

/** Shrinks a phone photo (often 4–10 MB) to a sharp 1800px JPEG so it uploads fast and stays under the 5 MB limit. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
    const b = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', 0.88));
    return b ?? file;
  } catch { return file; }
}

/** Card photos need the sign-in header, so they are fetched and shown from a local blob. */
function CardPhoto({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url = ''; let dead = false;
    fetch(`${API_BASE}/api/staff/cards/${id}/image${qs({ ownerId: getViewOwner() })}`, { headers: { authorization: 'Bearer ' + (getToken() ?? '') } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && !dead) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return src ? <img src={src} alt="Business card" style={{ maxWidth: '100%', borderRadius: 6 }} /> : null;
}

const toForm = (c?: Partial<Card>) => ({ name: c?.name ?? '', title: c?.title ?? '', company: c?.company ?? '', phones: (c?.phones ?? []).join('\n'), emails: (c?.emails ?? []).join('\n'), website: c?.website ?? '', address: c?.address ?? '', notes: c?.notes ?? '' });
const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

function Editor({ card, draft, photo, dup, onClose, onSaved }: { card?: Card; draft?: Scan['fields']; photo?: Blob; dup?: Scan['duplicates']; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const { v, bind, setV } = useForm(toForm(card ?? draft));
  const [preview] = useState(() => (photo ? URL.createObjectURL(photo) : null));
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const save = async () => {
    if (!v.name.trim()) { toast('Enter the person’s name before saving.'); return; }
    setBusy(true);
    try {
      const body = { name: v.name, title: v.title, company: v.company, phones: lines(v.phones), emails: lines(v.emails), website: v.website, address: v.address, notes: v.notes };
      if (card) await patch(`/api/staff/cards/${card.id}`, body);
      else {
        const saved = await post<Card>('/api/staff/cards', body);
        if (photo) { try { await sendFile(`/api/staff/cards/${saved.id}/image`, photo, { 'content-type': photo.type || 'image/jpeg' }); } catch (e) { toast('Saved, but the photo could not be kept: ' + errMsg(e)); } }
      }
      toast('Contact saved'); onSaved();
    } catch (e) { toast(e instanceof ApiError ? e.message : errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={card ? 'Edit contact' : 'New contact'} onClose={onClose} wide foot={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={save}>{busy ? 'Saving…' : 'Save contact'}</button></>}>
      {dup && dup.length > 0 && <div className="note warn" style={{ marginBottom: 12 }}>Already saved with the same phone or email: {dup.map((d) => d.name + (d.company ? ` (${d.company})` : '')).join(', ')}. Saving adds another entry.</div>}
      {photo && <div className="note" style={{ marginBottom: 12 }}>Check the details below against the card before saving. Card readers can mistake digits.</div>}
      <div className="form-grid">
        {(preview || card?.hasImage) && <div className="full">{preview ? <img src={preview} alt="Card" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 6 }} /> : <CardPhoto id={card!.id} />}</div>}
        <NameField value={v.name} onChange={(n) => setV((x: any) => ({ ...x, name: n }))} />
        <Field label="Job title"><input className="inp" {...bind('title')} /></Field>
        <Field label="Company"><input className="inp" {...bind('company')} /></Field>
        <Field label="Website"><input className="inp" {...bind('website')} /></Field>
        <Field label="Phone numbers" hint="One per line"><textarea className="inp" rows={3} {...bind('phones')} /></Field>
        <Field label="Emails" hint="One per line"><textarea className="inp" rows={3} {...bind('emails')} /></Field>
        <Field label="Address" full><textarea className="inp" rows={2} {...bind('address')} /></Field>
        <Field label="Notes" full><textarea className="inp" rows={2} {...bind('notes')} /></Field>
      </div>
    </Modal>
  );
}

export default function Cards({ sub }: { sub: string }) {
  void sub; const toast = useToast();
  const [has, setHas] = useState('');
  const [q, setQ] = useState(''); const [offset, setOffset] = useState(0); const dq = useDebounced(q);
  const [data, error, reload] = useApi<{ items: Card[]; total: number }>('/api/staff/cards' + qs({ q: dq.trim(), limit: LIMIT, offset }));
  const [status] = useApi<{ ocr: boolean }>('/api/staff/cards/status');
  const [edit, setEdit] = useState<{ card?: Card; draft?: Scan['fields']; photo?: Blob; dup?: Scan['duplicates'] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setScanning(true);
    try {
      const photo = await shrink(f);
      const r = await sendFile<Scan>('/api/staff/cards/scan', photo, { 'content-type': photo.type || 'image/jpeg' });
      if (!r.readable) toast('Could not find contact details on that photo. You can fill them in by hand.');
      setEdit({ draft: r.fields, photo, dup: r.duplicates });
    } catch (e) { toast(errMsg(e)); } finally { setScanning(false); if (file.current) file.current.value = ''; }
  };
  const remove = async (c: Card) => { if (!confirm(`Delete ${c.name}?`)) return; try { await del(`/api/staff/cards/${c.id}`); reload(); } catch (e) { toast(errMsg(e)); } };

  return (
    <div className="stack">
      <PageHead eyebrow="Ground" title="Business cards" lede="Photograph a card, check what was read, and save it. Download a contact to put it in your phone's address book.">
        <button className="btn" onClick={() => download('/api/staff/cards/export.vcf', 'daji-contacts.vcf').catch((e) => toast(errMsg(e)))}>Download all (.vcf)</button>
        <button className="btn" onClick={() => setEdit({})}>Type in a contact</button>
        <button className="btn primary" disabled={scanning} aria-busy={scanning || undefined} onClick={() => (status?.ocr === false ? toast('Reading cards from a photo is not switched on for this server. Use Type in a contact instead.') : file.current?.click())}>{scanning ? 'Reading card…' : 'Scan a card'}</button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </PageHead>
      {status?.ocr === false && <div className="note warn">Reading cards from photos is not switched on yet (the server needs ANTHROPIC_API_KEY). You can still type contacts in.</div>}
      <div className="card">
        <div className="card-head"><h3>Saved contacts {data ? <Chip>{data.total}</Chip> : null}</h3></div>
        <div className="card-pad row"><input className="inp" style={{ flex: '1 1 220px', width: 'auto' }} type="search" placeholder="Search name, company, phone or email" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
          <Filters active={has ? 1 : 0}><select className="inp" style={{ width: 170 }} aria-label="Details on file" value={has} onChange={(e) => setHas(e.target.value)}><option value="">Any details</option><option value="phone">Has a phone</option><option value="email">Has an email</option><option value="address">Has an address</option><option value="photo">Has a card photo</option></select></Filters></div>
        <Async data={data} error={error}>{(d) => (
          <>
            <Table rows={d.items.filter((c) => !has || (has === 'phone' ? c.phones.length : has === 'email' ? c.emails.length : has === 'address' ? c.address : c.hasImage))} empty="No contacts yet. Scan a card to add the first." onRow={(c) => setEdit({ card: c })} cols={[
              { head: 'Person', cell: (c) => <><span className="strong">{c.name}</span><div className="muted small">{[c.title, c.company].filter(Boolean).join(' · ')}</div></> },
              { head: 'Reach', cell: (c) => <div className="small">{[...c.phones.map(formatPhone), ...c.emails].slice(0, 3).join(' · ')}</div> },
              { head: '', cell: (c) => <span className="row" onClick={(e) => e.stopPropagation()}>
                <button className="btn sm" onClick={() => download(`/api/staff/cards/${c.id}/vcard`, `${c.name.replace(/[^\w-]+/g, '_') || 'contact'}.vcf`).catch((e) => toast(errMsg(e)))}>Save to phone</button>
                <button className="btn ghost sm" onClick={() => remove(c)}>Delete</button></span> },
            ]} />
            {d.total > LIMIT && <div className="card-pad row"><button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button><button className="btn sm" disabled={offset + LIMIT >= d.total} onClick={() => setOffset(offset + LIMIT)}>Next</button></div>}
          </>
        )}</Async>
      </div>
      {edit && <Editor {...edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
