import { Linking, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { ADMIN_APP } from './variant';
import ACTIONS from '../voice-actions.json';

// Voice shortcuts: the common voice-action layer of the app. Every action here is one the signed-in person can already do by
// tapping: it opens the app at that place, and anything it asks goes through the normal API with the person's own sign-in, so a
// voice command never sees or does more than the app does. Siri only opens the app; answers show on the screen and are never read
// aloud, nothing is put into the phone's search or suggestions, and the app never listens on its own (Siri does the listening,
// only when the person asks it to). Voice can prepare work (a draft task) but never approves or releases money.
//
// Two ways in, on iPhone (the native side is plugins/withDajiVoice.js and modules/daji-voice):
//  1. App Shortcuts, registered when the app is installed. Apple only lets these use the app's own name ("Ask Daji Admin ...").
//  2. Add to Siri: a personal phrase the person records, suggested with the assistant name they picked ("Tell Guppi ...").
// On Android the same actions are app shortcuts (long-press the icon) that the phone's assistant can open.
// Each action arrives as <scheme>://voice/<action>?q=...; App.tsx hands it to openVoiceLink.

export interface VoiceAction {
  id: string;
  /** What the action does, as shown in the list. */
  title: string;
  /** The built-in phrase (App Shortcuts), with APP for the app's name. Apple requires the app's name in it. */
  phrase: string;
  /** Suggested personal phrase for Add to Siri, with NAME for the assistant name the person picked. */
  personal: string;
  /** The question the assistant is asked; or the screen it opens. */
  question?: string;
  screen?: 'tasks' | 'book' | 'live' | 'ask' | 'auctions' | 'fantasy' | 'cash' | 'construction';
}

const STAFF: VoiceAction[] = ACTIONS.staff as VoiceAction[];
const CUSTOMER: VoiceAction[] = ACTIONS.customer as VoiceAction[];
/** The actions this app offers (voice-actions.json; the native App Shortcuts and Android shortcuts are built from the same file). */
export const VOICE_ACTIONS: VoiceAction[] = ADMIN_APP ? STAFF : CUSTOMER;

export const APP_NAME: string = Constants.expoConfig?.name ?? (ADMIN_APP ? 'Daji Admin' : 'Daji Cricket Ground');
const SCHEME: string = (Constants.expoConfig?.scheme as string | undefined) ?? (ADMIN_APP ? 'dajiadmin' : 'dajicricket');
export const builtinPhrase = (a: VoiceAction): string => a.phrase.replace('APP', APP_NAME);
export const personalPhrase = (a: VoiceAction, aiName: string): string => a.personal.replace('NAME', aiName);
export const voiceUrl = (a: VoiceAction): string => `${SCHEME}://voice/${a.id}`;

// ---- this phone's switch: off until the person turns it on (shared front-desk phones stay off unless someone chooses otherwise)
const KEY = 'daji.voice';
export async function voiceOn(): Promise<boolean> { try { return (await SecureStore.getItemAsync(KEY)) === '1'; } catch { return false; } }
export async function setVoiceOn(on: boolean): Promise<void> { try { if (on) await SecureStore.setItemAsync(KEY, '1'); else await SecureStore.deleteItemAsync(KEY); } catch { /* stays as it was */ } }

// ---- the native part. Missing in a build made before it existed (an over-the-air update can reach one), so every use checks first.
interface NativeVoice {
  isAvailable(): boolean;
  addToSiri(o: { action: string; title: string; phrase: string; url: string }): Promise<'added' | 'updated' | 'deleted' | 'cancelled'>;
  listPhrases(): Promise<{ action: string; phrase: string }[]>;
}
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeVoice>('DajiVoice') : null;
/** True when this phone can show Apple's Add to Siri screen. */
export const canAddToSiri = (): boolean => { try { return !!native?.isAvailable(); } catch { return false; } };
/** Apple's own Add to Siri screen for one action, with the person's phrase suggested. If they already recorded one, it opens to edit or delete it. */
export async function addToSiri(a: VoiceAction, aiName: string): Promise<string> {
  if (!native) throw new Error('Add to Siri needs the newest version of the app from the App Store.');
  return native.addToSiri({ action: a.id, title: a.title, phrase: personalPhrase(a, aiName), url: voiceUrl(a) });
}
/** The phrases this person has recorded with Siri for this app, by action. */
export async function recordedPhrases(): Promise<Record<string, string>> {
  try { const l = native ? await native.listPhrases() : []; return Object.fromEntries(l.map((x) => [x.action, x.phrase])); } catch { return {}; }
}
/** Opens the Shortcuts app (iPhone), where App Shortcuts and personal shortcuts live. */
export const openShortcuts = (): Promise<void> => Linking.openURL(Platform.OS === 'ios' ? 'shortcuts://' : 'app-settings:').catch(() => {});

// ---- a voice link arriving
export interface VoiceRequest { action: VoiceAction; question?: string; title?: string }
/** Reads <scheme>://voice/<action>?q=...&title=... Anything else is not a voice link (null). */
export function parseVoiceLink(url: string | null | undefined): VoiceRequest | null {
  if (!url) return null;
  const m = url.match(/^[a-z][\w+.-]*:\/\/voice\/([a-z]+)(?:\?(.*))?$/i);
  if (!m) return null;
  const action = VOICE_ACTIONS.find((a) => a.id === m[1]!.toLowerCase());
  if (!action) return null;
  const params = new Map((m[2] ?? '').split('&').filter(Boolean).map((kv) => { const [k, v = ''] = kv.split('='); try { return [k!, decodeURIComponent(v.replace(/\+/g, ' '))] as const; } catch { return [k!, ''] as const; } }));
  const clip = (v: string | undefined, n: number) => (v ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : undefined) || undefined; // eslint-disable-line no-control-regex
  return { action, question: clip(params.get('q'), 500), title: clip(params.get('title'), 120) };
}
