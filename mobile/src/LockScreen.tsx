import React, { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { biometricName, unlock } from './lock';
import { Btn, s } from './ui';
import { C, mode } from './theme';

/** Covers the app until the phone's owner shows their face or finger. It asks once by itself; the button asks again. */
export function LockScreen({ name, onUnlock, onSignOut }: { name: string; onUnlock: () => void; onSignOut: () => void }) {
  const [bio, setBio] = useState('Face ID');
  const [tried, setTried] = useState(false);
  const ask = async () => { if (await unlock(`Unlock Daji as ${name}`)) onUnlock(); else setTried(true); };
  useEffect(() => { void biometricName().then((b) => { if (b) setBio(b); }); void ask(); }, []);
  return (
    <View style={[s.screen, s.pad, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingTop: 90, backgroundColor: C.bg }]}>
      <Image source={mode === 'light' ? require('../assets/logo-green.png') : require('../assets/logo.png')} accessibilityLabel="Daji Cricket Ground" resizeMode="contain" style={{ width: 240, height: 82, marginBottom: 18, marginLeft: -6 }} />
      <Text style={s.eyebrow}>Locked</Text>
      <Text style={s.h1}>Welcome back, {name.split(' ')[0]}</Text>
      <Text style={[s.muted, { marginBottom: 22 }]}>{tried ? `That didn't unlock. Try ${bio} again, or sign in with your password.` : `Use ${bio} to open the app.`}</Text>
      <Btn label={`Unlock with ${bio}`} onPress={ask} />
      <Btn kind="ghost" label="Sign in with password instead" onPress={onSignOut} />
    </View>
  );
}
