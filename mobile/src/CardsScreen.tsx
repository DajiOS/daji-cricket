import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api, authImage, upload } from './api';
import { takeCardPhoto } from './camera';
import { Btn, Empty, Field, Loading, NameFields, s, ScreenHead } from './ui';
import { C, formatPhone } from './theme';

interface Card { id: string; name: string; title: string; company: string; phones: string[]; emails: string[]; website: string; address: string; notes: string; hasImage: boolean }
interface Scan { fields: Omit<Card, 'id' | 'hasImage'>; readable: boolean; duplicates: { id: string; name: string; company: string }[] }
type Edit = { card?: Card; draft?: Scan['fields']; photo?: string; dup?: Scan['duplicates'] };
const lines = (v: string) => v.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
const digits = (p: string) => p.replace(/[^\d+]/g, '');

/** Business cards: photograph a card, check what was read, save it, and call, email or WhatsApp the person. */
export function CardsScreen() {
  const [items, setItems] = useState<Card[] | null>(null); const [total, setTotal] = useState(0); const [q, setQ] = useState('');
  const [ocr, setOcr] = useState<boolean | null>(null); const [edit, setEdit] = useState<Edit | null>(null); const [open, setOpen] = useState('');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [scanning, setScanning] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await api<{ items: Card[]; total: number }>(`/api/staff/cards?limit=100&q=${encodeURIComponent(q.trim())}`); setItems(r.items); setTotal(r.total); setErr(''); } catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(() => void load(), 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => { api<{ ocr: boolean }>('/api/staff/cards/status').then((r) => setOcr(r.ocr)).catch(() => setOcr(false)); }, []);

  const scan = async () => {
    setErr(''); setNote('');
    try {
      const shot = await takeCardPhoto(); if (!shot) return;
      setScanning(true);
      const r = await upload<Scan>('/api/staff/cards/scan', shot.uri);
      if (!r.readable) setNote('Could not find contact details on that photo. Fill them in by hand.');
      setEdit({ draft: r.fields, photo: shot.uri, dup: r.duplicates });
    } catch (e: any) { setErr(e.message); } finally { setScanning(false); }
  };
  const remove = async (c: Card) => {
    setErr(''); setNote('');
    try { await api(`/api/staff/cards/${c.id}`, { method: 'DELETE' }); setNote(`${c.name} deleted.`); setOpen(''); void load(); } catch (e: any) { setErr(e.message); }
  };
  const go = (url: string) => { Linking.openURL(url).catch(() => setErr('This phone cannot open that.')); };

  if (edit) return <Editor {...edit} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); setNote(m); void load(); }} />;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="People" title="Business cards" about="Photograph a card, check what was read, and save it. Card readers can mistake digits, so check before saving." />
      <Btn label={scanning ? 'Reading card…' : 'Scan a card'} busy={scanning} disabled={ocr === false} onPress={scan} />
      <Btn kind="ghost" icon="create-outline" label="Type in a contact" onPress={() => setEdit({})} />
      {ocr === false && <Text style={[s.muted, { marginBottom: 8 }]}>Reading cards from photos is not switched on yet (the server needs an AI key). You can still type contacts in.</Text>}
      <Field label={`Saved contacts${total ? ` (${total})` : ''}`} value={q} onChangeText={setQ} placeholder="Search name, company, phone or email" />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}
      {items === null ? <Loading /> : !items.length ? <Empty icon="id-card-outline" text={q.trim() ? 'No contact matches.' : 'No contacts yet. Scan a card to add the first.'} /> : items.map((c) => (
        <Pressable key={c.id} onPress={() => setOpen(open === c.id ? '' : c.id)} style={s.card}>
          <Text style={[s.text, { fontWeight: '700' }]}>{c.name}</Text>
          {!!(c.title || c.company) && <Text style={s.muted}>{[c.title, c.company].filter(Boolean).join('  ·  ')}</Text>}
          {open !== c.id ? <Text style={[s.muted, { marginTop: 4 }]} numberOfLines={1}>{[...c.phones.map(formatPhone), ...c.emails].slice(0, 2).join('  ·  ')}</Text> : (
            <View style={{ marginTop: 10 }}>
              {c.hasImage && <Image source={authImage(`/api/staff/cards/${c.id}/image`)} style={{ width: '100%', height: 180, borderRadius: 12, backgroundColor: C.line, marginBottom: 10 }} resizeMode="contain" />}
              {c.phones.map((p) => (
                <View key={p} style={[s.row, { flexWrap: 'wrap' }]}>
                  <Text style={s.text}>{formatPhone(p)}</Text>
                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    <Pressable onPress={() => go(`tel:${digits(p)}`)}><Text style={{ color: C.gold, fontWeight: '600' }}>Call</Text></Pressable>
                    <Pressable onPress={() => go(`https://wa.me/${digits(p).replace(/^\+/, '').replace(/^(\d{10})$/, '91$1')}`)}><Text style={{ color: C.gold, fontWeight: '600' }}>WhatsApp</Text></Pressable>
                  </View>
                </View>
              ))}
              {c.emails.map((m) => <Pressable key={m} onPress={() => go(`mailto:${m}`)} style={s.row}><Text style={s.text}>{m}</Text><Text style={{ color: C.gold, fontWeight: '600' }}>Email</Text></Pressable>)}
              {!!c.website && <Pressable onPress={() => go(/^https?:/.test(c.website) ? c.website : `https://${c.website}`)} style={s.row}><Text style={s.text}>{c.website}</Text><Text style={{ color: C.gold, fontWeight: '600' }}>Open</Text></Pressable>}
              {!!c.address && <Text style={[s.muted, { marginTop: 6 }]}>{c.address}</Text>}
              {!!c.notes && <Text style={[s.muted, { marginTop: 6 }]}>{c.notes}</Text>}
              <Btn kind="outline" label="Edit" onPress={() => setEdit({ card: c })} style={{ marginTop: 10 }} />
              <Btn kind="ghost" label="Delete" onPress={() => remove(c)} style={{ marginBottom: 0 }} />
            </View>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Editor({ card, draft, photo, dup, onClose, onSaved }: Edit & { onClose: () => void; onSaved: (msg: string) => void }) {
  const src = card ?? draft;
  const [f, setF] = useState({ name: src?.name ?? '', title: src?.title ?? '', company: src?.company ?? '', phones: (src?.phones ?? []).join('\n'), emails: (src?.emails ?? []).join('\n'), website: src?.website ?? '', address: src?.address ?? '', notes: src?.notes ?? '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...f, phones: lines(f.phones), emails: lines(f.emails) };
      if (card) await api(`/api/staff/cards/${card.id}`, { method: 'PATCH', body });
      else {
        const saved = await api<Card>('/api/staff/cards', { method: 'POST', body });
        if (photo) { try { await upload(`/api/staff/cards/${saved.id}/image`, photo); } catch (e: any) { onSaved(`Saved, but the photo could not be kept: ${e.message}`); return; } }
      }
      onSaved(`${f.name.trim()} saved.`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]}>
      <ScreenHead eyebrow="Business cards" title={card ? 'Edit contact' : 'New contact'} />
      {!!dup?.length && <Text style={[s.muted, { color: C.danger, marginBottom: 8 }]}>Already saved with the same phone or email: {dup.map((d) => d.name + (d.company ? ` (${d.company})` : '')).join(', ')}. Saving adds another entry.</Text>}
      {!!photo && <><Image source={{ uri: photo }} style={{ width: '100%', height: 200, borderRadius: 12, backgroundColor: C.line, marginBottom: 8 }} resizeMode="contain" /><Text style={[s.muted, { marginBottom: 10 }]}>Check the details below against the card before saving.</Text></>}
      <NameFields value={f.name} onChange={set('name')} />
      <Field label="Job title" value={f.title} onChangeText={set('title')} autoCapitalize="words" />
      <Field label="Company" value={f.company} onChangeText={set('company')} autoCapitalize="words" />
      <Field label="Phone numbers (one per line)" value={f.phones} onChangeText={set('phones')} multiline keyboardType="phone-pad" style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]} />
      <Field label="Emails (one per line)" value={f.emails} onChangeText={set('emails')} multiline keyboardType="email-address" style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]} />
      <Field label="Website" value={f.website} onChangeText={set('website')} keyboardType="url" />
      <Field label="Address" value={f.address} onChangeText={set('address')} multiline autoCapitalize="sentences" style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]} />
      <Field label="Notes" value={f.notes} onChangeText={set('notes')} multiline autoCapitalize="sentences" style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn label="Save contact" busy={busy} disabled={!f.name.trim()} onPress={save} />
      <Btn kind="ghost" label="Cancel" onPress={onClose} />
    </ScrollView>
  );
}
