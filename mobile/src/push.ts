import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from './api';

// Show alerts while the app is open too, so a waiting approval is never missed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let registered: string | null = null;

/** Ask permission, get this phone's Expo push token and tell the server. Safe to call on every sign-in. */
export async function registerForPush(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('bookings', {
        name: 'Bookings', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250],
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!data || data === registered) return;
    await api('/api/me/push-token', { method: 'POST', body: { token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
    registered = data;
  } catch { /* notifications are a convenience; never block sign-in */ }
}

/** Call before signing out so this phone stops receiving the account's alerts. */
export async function unregisterPush(): Promise<void> {
  const t = registered;
  registered = null;
  if (!t) return;
  try { await api('/api/me/push-token/remove', { method: 'POST', body: { token: t } }); } catch { /* ignore */ }
}

/** Run `onOpen` when the person taps a notification (opens the bookings view). */
export function onNotificationTap(onOpen: () => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(() => onOpen());
  return () => sub.remove();
}
