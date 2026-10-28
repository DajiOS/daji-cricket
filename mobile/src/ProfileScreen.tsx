import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, setToken, upload } from './api';
import { pickProfilePhoto } from './camera';
import type { User } from './types';
import { Avatar, BackBar, Btn, Field, ListCard, ListRow, PhoneField, s, NameFields, splitName, splitPhone } from './ui';
import { useAppearance } from './photo';
import { C } from './theme';
import { biometricName, lockOn, setLockOn, unlock } from './lock';
import { VoiceShortcuts } from './VoiceShortcuts';

const ROLE: Record<string, string> = { customer: 'Customer', staff: 'Team member', owner: 'Owner', super_admin: 'Super admin' };
type Page = null | 'edit' | 'voice' | 'password' | 'delete';
const PAGES: Record<Exclude<Page, null>, string> = { edit: 'Edit profile', voice: 'Voice Shortcuts', password: 'Password', delete: 'Delete my account' };

/** A person's own details as a settings list: their card, then Edit profile, Appearance, Voice Shortcuts, unlock, Password and Sign out, each opening its own page. */
export function ProfileScreen({ user, onUser, onSignOut }: { user: User; onUser: (u: User) => void; onSignOut: () => void }) {
  const [name, setName] = useState(user.name); const [email, setEmail] = useState(user.email ?? ''); const [phone, setPhone] = useState(splitPhone(user.phone).number); const [cc, setCc] = useState(splitPhone(user.phone).code);
  const [biz, setBiz] = useState(user.businessName ?? ''); const [upi, setUpi] = useState(user.upiId ?? '');
  const [cur, setCur] = useState(''); const [nw, setNw] = useState('');
  const [delPw, setDelPw] = useState(''); const [delWord, setDelWord] = useState('');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<Page>(null); const look = useAppearance();
  const owner = user.role === 'owner';
  const [bio, setBio] = useState<string | null>(null); const [bioOn, setBioOn] = useState(false);
  const [aiName, setAiName] = useState(user.aiNameOwn ?? ''); const [aiWarn, setAiWarn] = useState('');
  // checked as it is typed, so a reserved name ("Hey Siri") is refused before Save
  useEffect(() => {
    const t = aiName.trim(); if (!t) { setAiWarn(''); return; }
    let live = true;
    const timer = setTimeout(() => { api<{ ok: boolean; message?: string }>('/api/ai-name/check', { method: 'POST', body: { name: t } }).then((r) => { if (live) setAiWarn(r.ok ? '' : r.message ?? ''); }).catch(() => { if (live) setAiWarn(''); }); }, 300); // the server checks again on save
    return () => { live = false; clearTimeout(timer); };
  }, [aiName]);
  const saveAi = async () => {
    setErr(''); setNote('');
    if (aiWarn) { setErr(aiWarn); return; }
    try { const r = await api<{ user: User }>('/api/me', { method: 'PATCH', body: { aiName: aiName.trim() || null } }); onUser(r.user); setNote(`The assistant is now called ${r.user.aiName ?? aiName.trim()} for you.`); }
    catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  useEffect(() => { void biometricName().then(setBio); void lockOn().then(setBioOn); }, []);

  const save = async () => {
    setErr(''); setNote(''); setBusy(true);
    try {
      const r = await api<{ user: User }>('/api/me', { method: 'PATCH', body: { firstName: splitName(name).first, lastName: splitName(name).last, email: email.trim() || undefined, ...(phone.trim() ? { countryCode: cc.trim(), phone: phone.trim() } : {}), ...(owner ? { businessName: biz.trim(), upiId: upi.trim() } : {}) } });
      onUser(r.user); setNote('Profile saved.');
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); } finally { setBusy(false); }
  };
  const pic = async () => {
    setErr(''); setNote('');
    try { const p = await pickProfilePhoto(); if (!p) return; const r = await upload<{ user: User }>('/api/me/avatar', p.uri); onUser(r.user); setNote('Picture updated.'); } catch (e: any) { setErr(e.message); }
  };
  const dropPic = async () => { try { await api('/api/me/avatar', { method: 'DELETE' }); onUser({ ...user, avatarUrl: null }); } catch (e: any) { setErr(e.message); } };
  const pw = async () => {
    setErr(''); setNote('');
    const first = user.hasPassword === false; // made with a phone code or at the desk: no current password to give
    try { const r = await api<{ token: string; user: User }>('/api/me/password', { method: 'POST', body: { ...(first ? {} : { currentPassword: cur }), newPassword: nw } }); setCur(''); setNw(''); await setToken(r.token); onUser(r.user); setNote(first ? 'Password set. You can now sign in with your email or mobile number.' : 'Password changed.'); } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };

  // turning it on asks for the face or finger once, so nobody switches it on for a phone that cannot unlock it
  const flipBio = async () => {
    setErr(''); setNote('');
    if (bioOn) { await setLockOn(false); setBioOn(false); setNote(`${bio ?? 'Biometric'} unlock is off.`); return; }
    if (!(await unlock(`Turn on ${bio} unlock`))) return;
    await setLockOn(true); setBioOn(true); setNote(`The app now asks for ${bio} when it opens.`);
  };

  const del = async () => {
    setErr(''); setNote('');
    try { await api('/api/me/delete', { method: 'POST', body: { confirm: delWord.trim(), ...(delPw ? { password: delPw } : {}) } }); onSignOut(); } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };

  const go = (p: Page) => { setErr(''); setNote(''); setPage(p); };
  const msgs = <>{!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok, marginBottom: 8 }]}>{note}</Text>}</>;
  const lockName = bio === 'Face ID' || bio === 'Touch ID' ? bio : 'Fingerprint or face';
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} keyboardShouldPersistTaps="handled">
      {page ? <BackBar title={PAGES[page]} onBack={() => go(null)} /> : <><Text style={s.eyebrow}>{ROLE[user.role] ?? user.role}</Text><Text style={s.h1}>Profile & settings</Text></>}
      {!page && (<>
        <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
          <Avatar name={user.name} url={user.avatarUrl} size={60} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{user.name}</Text>
            {!!(user.email || user.phone) && <Text style={s.muted}>{user.email || user.phone}</Text>}
            <Text style={[s.muted, { color: C.gold, fontWeight: '600' }]}>{owner && user.businessName ? `${ROLE[user.role]} · ${user.businessName}` : ROLE[user.role] ?? user.role}</Text>
          </View>
        </View>
        {msgs}
        <ListCard>
          <ListRow icon="person-outline" title="Edit profile" sub="Picture, name, email and mobile" onPress={() => go('edit')} />
          <ListRow icon="contrast-outline" title="Appearance" sub={look.mode === 'dark' ? 'Dark' : 'Light'} onPress={look.flip} right={<Text style={{ color: C.gold, fontWeight: '700' }}>{look.mode === 'dark' ? 'Use light' : 'Use dark'}</Text>} />
          <ListRow icon="mic-outline" title="Voice Shortcuts" sub={`Siri and Android, and the assistant's name (${user.aiName || 'Ask AI'})`} onPress={() => go('voice')} />
          {!!bio && <ListRow icon="finger-print-outline" title={`${lockName} unlock`} sub={bioOn ? 'On' : 'Off'} onPress={flipBio} right={<Text style={{ color: C.gold, fontWeight: '700' }}>{bioOn ? 'Turn off' : 'Turn on'}</Text>} />}
          <ListRow icon="lock-closed-outline" title="Password" sub={user.hasPassword === false ? 'Set a password' : 'Change your password'} onPress={() => go('password')} last={user.role !== 'customer'} />
          {user.role === 'customer' && <ListRow icon="trash-outline" title="Delete my account" onPress={() => go('delete')} last />}
        </ListCard>
        <ListCard><ListRow icon="log-out-outline" title="Sign out" tone="danger" onPress={onSignOut} right={<View />} last /></ListCard>
      </>)}
      {page === 'edit' && (<>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
          <Avatar name={user.name} url={user.avatarUrl} size={72} />
          <View style={{ marginLeft: 16, flex: 1 }}>
            <Btn kind="outline" label="Choose a picture" onPress={pic} style={{ marginBottom: 6 }} />
            {!!user.avatarUrl && <Btn kind="ghost" label="Remove picture" onPress={dropPic} style={{ marginBottom: 0 }} />}
          </View>
        </View>
        {msgs}
        <NameFields value={name} onChange={setName} />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <PhoneField code={cc} number={phone} onCode={setCc} onNumber={setPhone} />
        {owner && <><Field label="Business name" value={biz} onChangeText={setBiz} autoCapitalize="words" /><Field label="UPI ID for payments" value={upi} onChangeText={setUpi} /></>}
        <Btn label="Save profile" onPress={save} busy={busy} />
      </>)}
      {page === 'voice' && (<>
        {msgs}
        <Field label="AI assistant name" value={aiName} onChangeText={setAiName} placeholder="Ask AI" autoCapitalize="words" />
        {!!aiWarn && <Text style={s.err}>{aiWarn}</Text>}
        {!!user.aiNameNotice && <Text style={[s.muted, { color: C.gold, marginBottom: 6 }]}>{user.aiNameNotice}</Text>}
        <Text style={[s.muted, { marginBottom: 10 }]}>Any name you like, shown exactly as you type it, on your screens only. Leave it empty for the business default. It changes only the name, not what the assistant can see or do.</Text>
        <Btn kind="outline" label="Save assistant name" onPress={saveAi} disabled={aiName.trim() === (user.aiNameOwn ?? '')} />
        <VoiceShortcuts user={user} />
      </>)}
      {page === 'password' && (<>
        {msgs}
        {user.hasPassword === false ? <Text style={[s.muted, { marginBottom: 10 }]}>Set a password to sign in with your email or mobile number.</Text>
          : <Field label="Current password" value={cur} onChangeText={setCur} secureTextEntry />}
        <Field label="New password" value={nw} onChangeText={setNw} secureTextEntry />
        <Btn label={user.hasPassword === false ? 'Set password' : 'Change password'} onPress={pw} disabled={(user.hasPassword !== false && !cur) || !nw} />
      </>)}
      {page === 'delete' && user.role === 'customer' && (<>
        {msgs}
        <Text style={[s.muted, { marginBottom: 12 }]}>This removes your name, email, mobile number, picture and sign-in. Past bookings stay in the ground's records without your details. It cannot be undone. Cancel upcoming bookings first.</Text>
        <Field label="Password (if you have one)" value={delPw} onChangeText={setDelPw} secureTextEntry />
        <Field label="Type DELETE to confirm" value={delWord} onChangeText={setDelWord} autoCapitalize="characters" />
        <Btn kind="outline" label="Delete my account for good" onPress={del} disabled={delWord.trim() !== 'DELETE'} />
      </>)}
    </ScrollView>
  );
}
