import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { api, setToken } from './api';
import type { User } from './types';
import { Btn, Field, s } from './ui';
import { C } from './theme';

export function AuthScreen({ onUser }: { onUser: (u: User) => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '', code: '' });
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const go = async () => {
    setErr(''); setBusy(true);
    try {
      const body = mode === 'in' ? { identifier: f.email.trim(), password: f.password, ...(f.code ? { code: f.code.trim() } : {}) } : { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), password: f.password };
      const r = await api<{ token: string; user: User }>(mode === 'in' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body });
      await setToken(r.token); onUser(r.user);
    } catch (e: any) {
      if (e.code === 'MFA_REQUIRED' || e.code === 'MFA_CODE_REQUIRED') { setNeedCode(true); setErr('Enter the 6-digit code from your authenticator app.'); } else setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { paddingTop: 70 }]} keyboardShouldPersistTaps="handled">
        <Image source={require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 240, height: 82, marginBottom: 18, marginLeft: -6 }} />
        <Text style={s.h1}>{mode === 'in' ? 'Sign in' : 'Create your account'}</Text>
        <Text style={[s.muted, { marginBottom: 22 }]}>Book the ground, see what you have played and spent, and follow your child at the academy.</Text>
        {mode === 'up' && (<><Field label="Name" value={f.name} onChangeText={set('name')} autoCapitalize="words" /><Field label="Mobile number" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" /></>)}
        <Field label={mode === 'in' ? 'Email or mobile number' : 'Email'} value={f.email} onChangeText={set('email')} keyboardType={mode === 'in' ? 'default' : 'email-address'} autoCapitalize="none" autoComplete={mode === 'in' ? 'username' : 'email'} />
        <Field label="Password" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="password" />
        {mode === 'up' && <Text style={[s.muted, { marginBottom: 12 }]}>8 or more characters with a capital letter, a small letter and a number.</Text>}
        {needCode && <Field label="Code" value={f.code} onChangeText={set('code')} keyboardType="number-pad" maxLength={6} />}
        {!!err && <Text style={s.err}>{err}</Text>}
        <Btn label={mode === 'in' ? 'Sign in' : 'Create account'} onPress={go} busy={busy} />
        <Btn kind="ghost" label={mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'} onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); }} />
        <View style={{ height: 1, backgroundColor: C.line, marginVertical: 14 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
