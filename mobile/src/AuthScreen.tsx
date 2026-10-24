import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { API_URL, LIVE_URL, api, setSite, setToken } from './api';
import { signInWithMicrosoft } from './microsoft';
import type { User } from './types';
import { Btn, Chip, Field, PhoneField, s, NameFields, splitName } from './ui';
import { C } from './theme';

export function AuthScreen({ onUser, admin, onBack, note }: { onUser: (u: User) => void; admin?: boolean; onBack?: () => void; note?: string }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [f, setF] = useState({ name: '', countryCode: '+91', phone: '', email: '', password: '', code: '' });
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  // Sign in with Microsoft, shown when the server has it set up. A 2-step code, if the account has one, is asked for after.
  const [site, setSiteUrl] = useState(API_URL);
  const [msOn, setMsOn] = useState(false);
  const [msFinish, setMsFinish] = useState<null | ((code: string) => Promise<{ token: string; user: User }>)>(null);
  useEffect(() => { setMsOn(false); api<{ microsoftSignIn?: boolean }>('/api/config').then((c) => setMsOn(!!c.microsoftSignIn)).catch(() => {}); }, [site]);
  const microsoft = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await signInWithMicrosoft();
      if (!r) return;
      if ('needCode' in r) { setMsFinish(() => r.finish); setNeedCode(true); setErr('Enter the 6-digit code from your authenticator app.'); return; }
      onUser(r.user);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  // The site switch: the live server, or a test server (a computer running the server with DEMO_MODE=1, see README).
  // Always on the Daji Admin sign-in; in the customer app it opens with a long press on the logo, so customers never trip on it.
  const [siteOpen, setSiteOpen] = useState(admin === true && API_URL !== LIVE_URL);
  const [testUrl, setTestUrl] = useState(API_URL === LIVE_URL ? '' : API_URL);
  const pickSite = async (url: string | null) => {
    setErr('');
    if (url !== null && !/^https?:\/\/[^\s/]+/.test(url.trim())) { setErr('Type the test server address, like http://192.168.1.20:4000'); return; }
    await setSite(url?.trim() ?? null); setSiteUrl(url?.trim().replace(/\/+$/, '') ?? LIVE_URL); setNeedCode(false); setMsFinish(null);
  };

  const go = async () => {
    setErr(''); setBusy(true);
    try {
      if (msFinish) { const r = await msFinish(f.code); onUser(r.user); return; }
      const body = mode === 'in' ? { identifier: f.email.trim(), password: f.password, ...(f.code ? { code: f.code.trim() } : {}) } : { firstName: splitName(f.name).first, lastName: splitName(f.name).last, countryCode: f.countryCode.trim(), phone: f.phone.trim(), email: f.email.trim(), password: f.password };
      const r = await api<{ token: string; user: User }>(mode === 'in' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body });
      await setToken(r.token); onUser(r.user);
    } catch (e: any) {
      if (String(e.code).startsWith('TICKET_')) { setMsFinish(null); setNeedCode(false); setErr(e.message); }
      else if (e.code === 'MFA_REQUIRED' || e.code === 'MFA_CODE_REQUIRED') { setNeedCode(true); setErr('Enter the 6-digit code from your authenticator app.'); } else setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { paddingTop: 70 }]} keyboardShouldPersistTaps="handled">
        <Pressable onLongPress={() => setSiteOpen(true)} delayLongPress={1200} accessibilityRole="image">
          <Image source={require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 240, height: 82, marginBottom: 18, marginLeft: -6 }} />
        </Pressable>
        {(admin || siteOpen) && (
          <Pressable onPress={() => setSiteOpen(!siteOpen)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Text style={[s.muted, { textTransform: 'uppercase', letterSpacing: 1.4, fontSize: 11 }]}>Site  </Text>
            <Text style={{ color: site === LIVE_URL ? C.text : C.gold, fontSize: 13 }}>{site === LIVE_URL ? 'Live: Daji Cricket Ground' : `Test server: ${site.replace(/^https?:\/\//, '')}`}</Text>
            <Text style={[s.muted, { marginLeft: 8 }]}>{siteOpen ? 'Close' : 'Change'}</Text>
          </Pressable>
        )}
        {siteOpen && (
          <View style={{ borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
              <Chip label="Live" on={site === LIVE_URL} onPress={() => void pickSite(null)} />
              <Chip label="Test server" on={site !== LIVE_URL} onPress={() => { if (testUrl) void pickSite(testUrl); }} />
            </View>
            <Field label="Test server address" value={testUrl} onChangeText={setTestUrl} placeholder="http://192.168.1.20:4000" keyboardType="url" autoCapitalize="none" autoCorrect={false} />
            <Btn kind="outline" label="Use this test server" onPress={() => void pickSite(testUrl)} disabled={!testUrl.trim()} />
            <Text style={s.muted}>A test server is for trying the app with demo accounts; bookings and payments there are not real. Store builds only reach https addresses.</Text>
          </View>
        )}
        <Text style={s.h1}>{mode === 'in' ? 'Sign in' : 'Create your account'}</Text>
        <Text style={[s.muted, { marginBottom: 22 }]}>{note ?? (admin ? 'For the ground team and owners.' : 'Book the ground, see what you have played and spent, and follow your child at the academy.')}</Text>
        {mode === 'up' && (<><NameFields value={f.name} onChange={set('name')} /><PhoneField code={f.countryCode} number={f.phone} onCode={set('countryCode')} onNumber={set('phone')} /></>)}
        <Field label={mode === 'in' ? 'Email or mobile number' : 'Email'} value={f.email} onChangeText={set('email')} keyboardType={mode === 'in' ? 'default' : 'email-address'} autoCapitalize="none" autoComplete={mode === 'in' ? 'username' : 'email'} />
        {mode === 'in' && <Text style={[s.muted, { marginTop: -6, marginBottom: 12 }]}>Number from outside India? Start it with + and the country code.</Text>}
        <Field label="Password" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="password" />
        {mode === 'up' && <Text style={[s.muted, { marginBottom: 12 }]}>8 or more characters with a capital letter, a small letter and a number.</Text>}
        {needCode && <Field label="Code" value={f.code} onChangeText={set('code')} keyboardType="number-pad" maxLength={6} />}
        {!!err && <Text style={s.err}>{err}</Text>}
        <Btn label={msFinish ? 'Finish signing in' : mode === 'in' ? 'Sign in' : 'Create account'} onPress={go} busy={busy} />
        {mode === 'in' && msOn && !msFinish && <Btn kind="outline" label="Sign in with Microsoft" onPress={microsoft} disabled={busy} />}
        {!admin && <Btn kind="ghost" label={mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'} onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); }} />}
        {onBack && <Btn kind="ghost" label="Back to booking" onPress={onBack} />}
        <View style={{ height: 1, backgroundColor: C.line, marginVertical: 14 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
