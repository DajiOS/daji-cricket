import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

// Face ID / fingerprint unlock. The sign-in itself stays the server's (the token in secure storage); this only asks the
// phone's owner to prove it is them before the app shows anything, on opening and when coming back after a while.
// Off until the person turns it on under Profile, and switched off again on sign out so the next person starts clean.
const KEY = 'daji.biolock';
const AWAY_MS = 2 * 60 * 1000; // the camera or a UPI app are shorter trips than this

/** What the phone calls it ("Face ID", "fingerprint"...), or null when the phone has none set up. */
export async function biometricName(): Promise<string | null> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const kinds = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = kinds.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    if (Platform.OS === 'ios') return face ? 'Face ID' : 'Touch ID';
    if (kinds.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    return face ? 'face unlock' : 'biometric unlock';
  } catch { return null; }
}

export async function lockOn(): Promise<boolean> { try { return (await SecureStore.getItemAsync(KEY)) === '1'; } catch { return false; } }
export async function setLockOn(on: boolean): Promise<void> {
  try { if (on) await SecureStore.setItemAsync(KEY, '1'); else await SecureStore.deleteItemAsync(KEY); } catch { /* stays as it was */ }
}

/** Shows the phone's own Face ID / fingerprint prompt (with the phone passcode as the fallback). True when it was them. */
export async function unlock(prompt = 'Unlock Daji'): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: 'Cancel', disableDeviceFallback: false });
    return r.success;
  } catch { return false; }
}

/** True while the app should be covered: on opening (once signed in, if unlock is on) and back after AWAY_MS.
 *  The third item covers it at once, for the first sign-in check, so nothing shows before the lock is read. */
export function useLock(signedIn: boolean): [boolean, () => void, () => void] {
  const [locked, setLocked] = useState(false);
  const left = useRef<number | null>(null);
  useEffect(() => {
    if (!signedIn) { setLocked(false); return; }
    let live = true;
    void lockOn().then((v) => { if (live && v) setLocked(true); });
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { if (left.current === null) left.current = Date.now(); return; }
      const away = left.current === null ? 0 : Date.now() - left.current;
      left.current = null;
      if (away >= AWAY_MS) void lockOn().then((v) => { if (v) setLocked(true); });
    });
    return () => { live = false; sub.remove(); };
  }, [signedIn]);
  return [locked, () => setLocked(false), () => setLocked(true)];
}
