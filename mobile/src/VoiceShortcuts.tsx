import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { api } from './api';
import type { User } from './types';
import { Btn, Section, s } from './ui';
import { C } from './theme';
import { addToSiri, builtinPhrase, canAddToSiri, openShortcuts, personalPhrase, recordedPhrases, setVoiceOn, voiceOn, VOICE_ACTIONS, APP_NAME } from './voice';

/** Profile › Preferences › Voice Shortcuts: this phone's voice switch, the actions, the phrases that work with no setup, and Add to Siri
 *  for a personal phrase with the assistant name this person picked. */
export function VoiceShortcuts({ user }: { user: User }) {
  const name = user.aiName || 'Ask AI';
  const [on, setOn] = useState<boolean | null>(null);
  const [biz, setBiz] = useState(true);
  const [mine, setMine] = useState<Record<string, string>>({});
  const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const siri = Platform.OS === 'ios' && canAddToSiri();
  useEffect(() => {
    void voiceOn().then(setOn);
    api<{ voiceEnabled?: boolean }>('/api/config').then((c) => setBiz(c.voiceEnabled !== false)).catch(() => {});
    void recordedPhrases().then(setMine);
  }, []);
  const flip = async () => { const next = !on; await setVoiceOn(next); setOn(next); setNote(next ? 'Voice shortcuts are on for this phone.' : 'Voice shortcuts are off for this phone.'); };
  const add = async (id: string) => {
    setErr(''); setNote('');
    const a = VOICE_ACTIONS.find((x) => x.id === id)!;
    try {
      const r = await addToSiri(a, name);
      if (r !== 'cancelled') { setMine(await recordedPhrases()); setNote(r === 'deleted' ? 'Removed from Siri.' : 'Saved with Siri.'); }
    } catch (e: any) { setErr(e.message); }
  };
  const boss = user.role === 'owner' || user.role === 'super_admin';

  return (
    <View>
      <Section>Voice Shortcuts</Section>
      {!biz && <Text style={[s.muted, { marginBottom: 10 }]}>{boss ? 'Voice shortcuts are switched off for the business. Switch them on in Settings on the desk.' : 'The owner has switched voice shortcuts off for this business.'}</Text>}
      {biz && <>
        <Text style={[s.muted, { marginBottom: 10 }]}>{on ? 'On for this phone.' : 'Off for this phone. Turn it on to use Siri or the phone assistant with the app.'} Voice only opens the app: answers show on the screen and are never read out, and voice never approves or pays anything. It works with the same sign-in and access as tapping, inside {user.businessName || 'this business'}.</Text>
        <Btn kind="outline" label={on ? 'Turn voice shortcuts off' : 'Turn voice shortcuts on'} onPress={flip} />
        {on && <>
          <Text style={[s.text, { marginTop: 8, marginBottom: 4, fontWeight: '700' }]}>Works with no setup</Text>
          <Text style={[s.muted, { marginBottom: 6 }]}>{Platform.OS === 'ios' ? `Apple lets these phrases use the app's own name, ${APP_NAME}. Say "Hey Siri", then:` : `Long-press the ${APP_NAME} icon for these, or ask the phone's assistant to open them:`}</Text>
          {VOICE_ACTIONS.map((a) => <Text key={a.id} style={[s.muted, { marginBottom: 2 }]}>• "{Platform.OS === 'ios' ? builtinPhrase(a) : a.title}"</Text>)}
          {siri && <>
            <Text style={[s.text, { marginTop: 14, marginBottom: 4, fontWeight: '700' }]}>Your own phrases, with {name}</Text>
            <Text style={[s.muted, { marginBottom: 8 }]}>Tap one to record it with Siri. You can say it your own way, and change or delete it here or in the Shortcuts app.</Text>
            {VOICE_ACTIONS.map((a) => (
              <Btn key={a.id} kind="outline" label={mine[a.id] ? `"${mine[a.id]}" (change)` : `Add to Siri: "${personalPhrase(a, name)}"`} onPress={() => add(a.id)} />))}
          </>}
          {Platform.OS === 'ios' && <Btn kind="ghost" label="Open Shortcuts" onPress={openShortcuts} />}
        </>}
      </>}
      {!!err && <Text style={s.err}>{err}</Text>}
      {!!note && <Text style={[s.muted, { color: C.ok }]}>{note}</Text>}
    </View>
  );
}
