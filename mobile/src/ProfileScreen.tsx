import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, upload } from './api';
import { pickProfilePhoto } from './camera';
import type { User } from './types';
import { Avatar, Btn, Field, Section, s } from './ui';
import { C } from './theme';

const ROLE: Record<string, string> = { customer: 'Customer', staff: 'Team member', owner: 'Owner', super_admin: 'Super admin' };

/** A person's own details: picture (or their initial), name, email, mobile, password, and Sign out at the top. */
export function ProfileScreen({ user, onUser, onSignOut }: { user: User; onUser: (u: User) => void; onSignOut: () => void }) {
  const [name, setName] = useState(user.name); const [email, setEmail] = useState(user.email ?? ''); const [phone, setPhone] = useState(user.phone ?? '');
  const [biz, setBiz] = useState(user.businessName ?? ''); const [upi, setUpi] = useState(user.upiId ?? '');
  const [cur, setCur] = useState(''); const [nw, setNw] = useState('');
  const [delOpen, setDelOpen] = useState(false); const [delPw, setDelPw] = useState(''); const [delWord, setDelWord] = useState('');
  const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const owner = user.role === 'owner';

  const save = async () => {
    setErr(''); setNote(''); setBusy(true);
    try {
      const r = await api<{ user: User }>('/api/me', { method: 'PATCH', body: { name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined, ...(owner ? { businessName: biz.trim(), upiId: upi.trim() } : {}) } });
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
    try { await api('/api/me/password', { method: 'POST', body: { currentPassword: cur, newPassword: nw } }); setCur(''); setNw(''); setNote('Password changed.'); } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };

  const del = async () => {
    setErr(''); setNote('');
    try { await api('/api/me/delete', { method: 'POST', body: { confirm: delWord.trim(), ...(delPw ? { password: delPw } : {}) } }); onSignOut(); } catch (e: any) { setErr((e.details?.fields?.[0]?.message as string) ?? e.message); }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} keyboardShouldPersistTaps="handled">
      <Text style={s.eyebrow}>{ROLE[user.role] ?? user.role}</Text><Text style={s.h1}>Your profile</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
        <Avatar name={user.name} url={user.avatarUrl} size={72} />
        <View style={{ marginLeft: 16, flex: 1 }}>
          <Btn kind="outline" label="Choose a picture" onPress={pic} style={{ marginBottom: 6 }} />
          {!!user.avatarUrl && <Btn kind="ghost" label="Remove picture" onPress={dropPic} style={{ marginBottom: 0 }} />}
        </View>
      </View>
      <Btn kind="outline" label="Sign out" onPress={onSignOut} />
      {!!err && <Text style={s.err}>{err}</Text>}{!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      {owner && <><Field label="Business name" value={biz} onChangeText={setBiz} autoCapitalize="words" /><Field label="UPI ID for payments" value={upi} onChangeText={setUpi} /></>}
      <Btn label="Save profile" onPress={save} busy={busy} />
      <Section>Password</Section>
      <Field label="Current password" value={cur} onChangeText={setCur} secureTextEntry />
      <Field label="New password" value={nw} onChangeText={setNw} secureTextEntry />
      <Btn kind="outline" label="Change password" onPress={pw} disabled={!cur || !nw} />
      {user.role === 'customer' && <>
        <Section>Delete my account</Section>
        {!delOpen ? <Btn kind="ghost" label="Delete my account…" onPress={() => setDelOpen(true)} /> : <>
          <Text style={s.muted}>This removes your name, email, mobile number, picture and sign-in. Past bookings stay in the ground's records without your details. It cannot be undone. Cancel upcoming bookings first.</Text>
          <Field label="Password (if you have one)" value={delPw} onChangeText={setDelPw} secureTextEntry />
          <Field label="Type DELETE to confirm" value={delWord} onChangeText={setDelWord} autoCapitalize="characters" />
          <Btn kind="outline" label="Delete my account for good" onPress={del} disabled={delWord.trim() !== 'DELETE'} />
        </>}
      </>}
    </ScrollView>
  );
}
