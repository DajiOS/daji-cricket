import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, setToken } from './api';
import type { User } from './types';
import { Btn, Field, PhoneField, s, NameFields, splitName } from './ui';
import { C } from './theme';
import { useAppearance, useGroundPhoto } from './photo';
import { useT } from './lang';

export function AuthScreen({ onUser, admin, onBack, note }: { onUser: (u: User) => void; admin?: boolean; onBack?: () => void; note?: string }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [f, setF] = useState({ name: '', countryCode: '+91', phone: '', email: '', password: '', code: '' });
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const pic = useGroundPhoto(); const look = useAppearance(); const t = useT();
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const go = async () => {
    setErr(''); setBusy(true);
    try {
      const body = mode === 'in' ? { identifier: f.email.trim(), password: f.password, ...(f.code ? { code: f.code.trim() } : {}) } : { firstName: splitName(f.name).first, lastName: splitName(f.name).last, countryCode: f.countryCode.trim(), phone: f.phone.trim(), email: f.email.trim(), password: f.password };
      const r = await api<{ token: string; user: User }>(mode === 'in' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body });
      await setToken(r.token); onUser(r.user);
    } catch (e: any) {
      if (e.code === 'MFA_REQUIRED' || e.code === 'MFA_CODE_REQUIRED') { setNeedCode(true); setErr(t('auth.codeNote')); } else setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ height: 250, backgroundColor: '#0F3A22', justifyContent: 'flex-end', padding: 18, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden', marginBottom: 18 }}>
          {!!pic && <Image source={{ uri: pic }} resizeMode="cover" style={StyleSheet.absoluteFill} />}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: pic ? 'rgba(6,22,13,.55)' : 'transparent' }]} />
          <Image source={require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 220, height: 76, marginLeft: -6 }} />
          <Text style={{ color: 'rgba(255,255,255,.9)', fontSize: 13, fontWeight: '700', letterSpacing: 2, marginTop: 6 }}>{admin ? 'DAJI ADMIN' : 'PLAY · PRACTICE · GROW'}</Text>
        </View>
        <View style={s.pad}>
        <Text style={s.h1}>{mode === 'in' ? t('auth.signIn') : t('auth.create')}</Text>
        <Text style={[s.note, { marginBottom: 22 }]}>{note ?? (admin ? 'For the ground team and owners.' : t('auth.intro'))}</Text>
        {mode === 'up' && (<><NameFields value={f.name} onChange={set('name')} /><PhoneField code={f.countryCode} number={f.phone} onCode={set('countryCode')} onNumber={set('phone')} /></>)}
        <Field label={mode === 'in' ? t('auth.idLabel') : t('profile.email')} value={f.email} onChangeText={set('email')} keyboardType={mode === 'in' ? 'default' : 'email-address'} autoCapitalize="none" autoComplete={mode === 'in' ? 'username' : 'email'} />
        {mode === 'in' && <Text style={[s.note, { marginTop: -6, marginBottom: 12 }]}>{t('auth.abroad')}</Text>}
        <Field label={t('profile.password')} value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="password" />
        {mode === 'up' && <Text style={[s.note, { marginBottom: 12 }]}>{t('auth.pwRule')}</Text>}
        {needCode && <Field label={t('auth.code')} value={f.code} onChangeText={set('code')} keyboardType="number-pad" maxLength={6} />}
        {!!err && <Text style={s.err}>{err}</Text>}
        <Btn label={mode === 'in' ? t('auth.signIn') : t('auth.createBtn')} onPress={go} busy={busy} />
        {!admin && <Btn kind="link" label={mode === 'in' ? t('auth.toCreate') : t('auth.toSignIn')} onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); }} />}
        {onBack && <Btn kind="link" label={t('auth.back')} onPress={onBack} />}
        <View style={{ height: 1, backgroundColor: C.line, marginVertical: 14 }} />
        <Btn kind="link" label={look.mode === 'dark' ? t('auth.useLight') : t('auth.useDark')} onPress={look.flip} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
