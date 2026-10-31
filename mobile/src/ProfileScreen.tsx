import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api, setToken, upload } from './api';
import { pickProfilePhoto } from './camera';
import type { User } from './types';
import { Avatar, BackBar, Btn, Field, Icon, ListCard, ListRow, PhoneField, RoundBtn, s, NameFields, splitName, splitPhone, ScreenHead } from './ui';
import { useAppearance } from './photo';
import { C, formatPhone } from './theme';
import { biometricName, lockOn, setLockOn, unlock } from './lock';
import { VoiceShortcuts } from './VoiceShortcuts';
import { UI_LANGUAGES, UI_LANGUAGE_NAMES, translator, useLang, type T, type UiLang } from './lang';

const roles = (t: T): Record<string, string> => ({ customer: t('role.customer'), staff: t('role.staff'), owner: t('role.owner'), super_admin: t('role.super_admin') });
type Page = null | 'edit' | 'language' | 'voice' | 'password' | 'delete';
const pages = (t: T): Record<Exclude<Page, null>, string> => ({ edit: t('profile.edit'), language: t('profile.language'), voice: t('profile.voice'), password: t('profile.password'), delete: t('profile.delete') });

/** A person's own details as a settings list: their card, then Edit profile, Appearance, Voice Shortcuts, unlock, Password and Sign out, each opening its own page. */
export function ProfileScreen({ user, onUser, onSignOut }: { user: User; onUser: (u: User) => void; onSignOut: () => void }) {
  const [name, setName] = useState(user.name); const [email, setEmail] = useState(user.email ?? ''); const [phone, setPhone] = useState(splitPhone(user.phone).number); const [cc, setCc] = useState(splitPhone(user.phone).code);
  const [biz, setBiz] = useState(user.businessName ?? ''); const [upi, setUpi] = useState(user.upiId ?? '');
  const [cur, setCur] = useState(''); const [nw, setNw] = useState('');
  const [delPw, setDelPw] = useState(''); const [delWord, setDelWord] = useState('');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<Page>(null); const look = useAppearance();
  const { t, lang } = useLang(); const ROLE = roles(t); const PAGES = pages(t);
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
    try { const r = await api<{ user: User }>('/api/me', { method: 'PATCH', body: { aiName: aiName.trim() || null } }); onUser(r.user); setNote(t('profile.aiSaved', { ai: r.user.aiName ?? aiName.trim() })); }
    catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };
  useEffect(() => { void biometricName().then(setBio); void lockOn().then(setBioOn); }, []);
  // saved to the profile, so the same language follows this person to every phone and the website; the app switches when the server says so
  const pickLang = async (l: UiLang) => {
    setErr(''); setNote('');
    try { const r = await api<{ user: User }>('/api/me', { method: 'PATCH', body: { language: l } }); onUser(r.user); setNote(translator(l)('profile.languageSaved')); }
    catch { setErr(t('profile.languageNotSaved')); }
  };

  const save = async () => {
    setErr(''); setNote(''); setBusy(true);
    try {
      const r = await api<{ user: User }>('/api/me', { method: 'PATCH', body: { firstName: splitName(name).first, lastName: splitName(name).last, email: email.trim() || undefined, ...(phone.trim() ? { countryCode: cc.trim(), phone: phone.trim() } : {}), ...(owner ? { businessName: biz.trim(), upiId: upi.trim() } : {}) } });
      onUser(r.user); setNote(t('profile.saved'));
    } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); } finally { setBusy(false); }
  };
  const pic = async () => {
    setErr(''); setNote('');
    try { const p = await pickProfilePhoto(); if (!p) return; const r = await upload<{ user: User }>('/api/me/avatar', p.uri); onUser(r.user); setNote(t('profile.picUpdated')); } catch (e: any) { setErr(e.message); }
  };
  const dropPic = async () => { try { await api('/api/me/avatar', { method: 'DELETE' }); onUser({ ...user, avatarUrl: null }); } catch (e: any) { setErr(e.message); } };
  const pw = async () => {
    setErr(''); setNote('');
    const first = user.hasPassword === false; // made with a phone code or at the desk: no current password to give
    try { const r = await api<{ token: string; user: User }>('/api/me/password', { method: 'POST', body: { ...(first ? {} : { currentPassword: cur }), newPassword: nw } }); setCur(''); setNw(''); await setToken(r.token); onUser(r.user); setNote(first ? t('profile.pwSet') : t('profile.pwChanged')); } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
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
  const lockName = bio === 'Face ID' || bio === 'Touch ID' ? bio : t('profile.fingerOrFace');
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]} keyboardShouldPersistTaps="handled">
      {page ? <BackBar title={PAGES[page]} onBack={() => go(null)} /> : <ScreenHead title={t('profile.title')} right={<RoundBtn icon="create-outline" label={t('profile.edit')} onPress={() => go('edit')} size={42} />} />}
      {!page && (<>
        <View style={[s.card, { alignItems: 'center', paddingTop: 26, paddingBottom: 22 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('profile.choosePic')} onPress={pic} style={{ marginBottom: 12 }}>
            <Avatar name={user.name} url={user.avatarUrl} size={92} />
            <View style={{ position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: C.strong, borderWidth: 3, borderColor: C.panel, alignItems: 'center', justifyContent: 'center' }}><Icon name="camera" size={14} color={C.onStrong} /></View>
          </Pressable>
          <Text style={{ color: C.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' }}>{user.name}</Text>
          {!!(user.email || user.phone) && <Text style={[s.muted, { marginTop: 2, textAlign: 'center' }]}>{user.email || formatPhone(user.phone)}</Text>}
          <View style={{ marginTop: 10, backgroundColor: C.soft, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 }}>
            <Text style={{ color: C.text, fontSize: 12.5, fontWeight: '600' }}>{owner && user.businessName ? `${ROLE[user.role]} · ${user.businessName}` : ROLE[user.role] ?? user.role}</Text>
          </View>
        </View>
        {msgs}
        <ListCard>
          <ListRow icon="person-outline" title={t('profile.edit')} sub={t('profile.editSub')} onPress={() => go('edit')} />
          <ListRow icon="language-outline" title={t('profile.language')} sub={UI_LANGUAGE_NAMES[lang]} onPress={() => go('language')} />
          <ListRow icon="contrast-outline" title={t('profile.appearance')} sub={look.mode === 'dark' ? t('profile.dark') : t('profile.light')} onPress={look.flip} right={<Text style={{ color: C.gold, fontWeight: '700' }}>{look.mode === 'dark' ? t('profile.useLight') : t('profile.useDark')}</Text>} />
          <ListRow icon="mic-outline" title={t('profile.voice')} sub={t('profile.voiceSub', { ai: user.aiName || 'Ask AI' })} onPress={() => go('voice')} />
          {!!bio && <ListRow icon="finger-print-outline" title={t('profile.unlock', { lock: lockName })} sub={bioOn ? t('common.on') : t('common.off')} onPress={flipBio} right={<Text style={{ color: C.gold, fontWeight: '700' }}>{bioOn ? t('common.turnOff') : t('common.turnOn')}</Text>} />}
          <ListRow icon="lock-closed-outline" title={t('profile.password')} sub={user.hasPassword === false ? t('profile.setPassword') : t('profile.changePassword')} onPress={() => go('password')} last={user.role !== 'customer'} />
          {user.role === 'customer' && <ListRow icon="trash-outline" title={t('profile.delete')} onPress={() => go('delete')} last />}
        </ListCard>
        <ListCard><ListRow icon="log-out-outline" title={t('profile.signOut')} tone="danger" onPress={onSignOut} right={<View />} last /></ListCard>
      </>)}
      {page === 'edit' && (<>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
          <Avatar name={user.name} url={user.avatarUrl} size={72} />
          <View style={{ marginLeft: 16, flex: 1 }}>
            <Btn kind="outline" label={t('profile.choosePic')} onPress={pic} style={{ marginBottom: 6 }} />
            {!!user.avatarUrl && <Btn kind="ghost" label={t('profile.removePic')} onPress={dropPic} style={{ marginBottom: 0 }} />}
          </View>
        </View>
        {msgs}
        <NameFields value={name} onChange={setName} />
        <Field label={t('profile.email')} value={email} onChangeText={setEmail} keyboardType="email-address" />
        <PhoneField code={cc} number={phone} onCode={setCc} onNumber={setPhone} />
        {owner && <><Field label="Business name" value={biz} onChangeText={setBiz} autoCapitalize="words" /><Field label="UPI ID for payments" value={upi} onChangeText={setUpi} /></>}
        <Btn label={t('profile.save')} onPress={save} busy={busy} />
      </>)}
      {page === 'language' && (<>
        {msgs}
        <ListCard>
          {UI_LANGUAGES.map((l, i) => <ListRow key={l} icon={lang === l ? 'checkmark-circle' : 'ellipse-outline'} title={UI_LANGUAGE_NAMES[l]} onPress={() => void pickLang(l)} right={<View />} last={i === UI_LANGUAGES.length - 1} />)}
        </ListCard>
        <Text style={[s.muted, { marginBottom: 10 }]}>{t('profile.languageNote')}</Text>
      </>)}
      {page === 'voice' && (<>
        {msgs}
        <Field label={t('profile.aiField')} value={aiName} onChangeText={setAiName} placeholder="Ask AI" autoCapitalize="words" />
        {!!aiWarn && <Text style={s.err}>{aiWarn}</Text>}
        {!!user.aiNameNotice && <Text style={[s.muted, { color: C.gold, marginBottom: 6 }]}>{user.aiNameNotice}</Text>}
        <Text style={[s.muted, { marginBottom: 10 }]}>{t('profile.aiNote')}</Text>
        <Btn kind="outline" label={t('profile.aiSave')} onPress={saveAi} disabled={aiName.trim() === (user.aiNameOwn ?? '')} />
        <VoiceShortcuts user={user} />
      </>)}
      {page === 'password' && (<>
        {msgs}
        {user.hasPassword === false ? <Text style={[s.muted, { marginBottom: 10 }]}>{t('profile.setPwNote')}</Text>
          : <Field label={t('profile.currentPw')} value={cur} onChangeText={setCur} secureTextEntry />}
        <Field label={t('profile.newPw')} value={nw} onChangeText={setNw} secureTextEntry />
        <Btn label={user.hasPassword === false ? t('profile.setPwBtn') : t('profile.changePwBtn')} onPress={pw} disabled={(user.hasPassword !== false && !cur) || !nw} />
      </>)}
      {page === 'delete' && user.role === 'customer' && (<>
        {msgs}
        <Text style={[s.muted, { marginBottom: 12 }]}>{t('profile.deleteNote')}</Text>
        <Field label={t('profile.deletePw')} value={delPw} onChangeText={setDelPw} secureTextEntry />
        <Field label={t('profile.deleteType')} value={delWord} onChangeText={setDelWord} autoCapitalize="characters" />
        <Btn kind="outline" label={t('profile.deleteBtn')} onPress={del} disabled={delWord.trim() !== 'DELETE'} />
      </>)}
    </ScrollView>
  );
}
