import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

// Screens load their data when they open, so an app left in the background kept showing what it loaded hours ago.
// Coming back after a while: take a newer published version of the app if there is one (it restarts the app), otherwise
// count one more "wake" so the open screen loads again. Short trips away (the camera, a UPI app) change nothing.
const AWAY_MS = 2 * 60 * 1000;

export function useWake(paused: boolean): number {
  const [wake, setWake] = useState(0);
  const left = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { if (left.current === null) left.current = Date.now(); return; }
      const away = left.current === null ? 0 : Date.now() - left.current;
      left.current = null;
      if (away < AWAY_MS || pausedRef.current) return;
      void (async () => {
        if (await takeUpdate()) return;
        setWake((w) => w + 1);
      })();
    });
    return () => sub.remove();
  }, []);
  return wake;
}

/** Downloads and starts a newer published version of the app. False when there is none, or updates are off (development). */
async function takeUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;
  try {
    if (!(await Updates.checkForUpdateAsync()).isAvailable) return false;
    if (!(await Updates.fetchUpdateAsync()).isNew) return false;
    await Updates.reloadAsync();
    return true;
  } catch { return false; } // offline or the update server is down: keep the version we have
}
