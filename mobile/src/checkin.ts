import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { api, upload } from './api';
import { unlock } from './lock';

// Checking in at the ground (server: players.ts). The phone proves that whoever holds it can unlock it (Face ID, fingerprint or passcode)
// and where it is. When the business has switched on the face check (Amazon Rekognition), a selfie from the front camera goes once to the
// server, is compared with the face the player enrolled, and is not kept. The server decides the rest: inside the ground's check-in
// distance, one phone per player, one player per phone, the face matching.

const DEVICE_KEY = 'daji.device';
let deviceId: string | null = null;

/** This phone's own id for check-in, made once and kept in the phone's secure storage. It is not a tracking id: only check-in sends it. */
export async function checkInDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  try { deviceId = await SecureStore.getItemAsync(DEVICE_KEY); } catch { deviceId = null; }
  if (!deviceId) {
    const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
    deviceId = `d-${Date.now().toString(16)}-${hex()}${hex()}${hex()}${hex()}`;
    try { await SecureStore.setItemAsync(DEVICE_KEY, deviceId); } catch { /* kept for this session */ }
  }
  return deviceId;
}

/** Where the phone is. expo-location is loaded only here, so an older app build without it still opens and is told to update. */
async function whereAmI(): Promise<{ lat: number; lng: number; accuracy: number; mocked: boolean }> {
  let Location: typeof import('expo-location');
  try { Location = require('expo-location'); } catch { throw new Error('Update the Daji app to check in at the ground.'); }
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Allow location for Daji in your phone settings to check in. It is used only at the moment you check in.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 9999, mocked: !!p.mocked };
}

async function selfie(): Promise<{ uri: string; shotAt: number } | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Allow camera access in your phone settings to take your check-in selfie.');
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], cameraType: ImagePicker.CameraType.front, quality: 0.5, exif: true, allowsEditing: false });
  if (r.canceled || !r.assets[0]) return null;
  return { uri: r.assets[0].uri, shotAt: Date.now() };
}

export class NeedsMoveCode extends Error { constructor(message: string) { super(message); } }
/** The face check is on and this player has not enrolled yet: the app asks for consent and enrols first. */
export class NeedsFace extends Error { constructor(message: string) { super(message); } }

/** The whole check-in. Throws NeedsMoveCode when this profile checks in on another phone (a code to the profile's number moves it),
 *  and NeedsFace when the face check is on and the player has not enrolled. */
export async function checkInAtGround(bookingId: string, faceCheck: boolean, moveCode?: string): Promise<'done' | 'already' | 'cancelled'> {
  if (!(await unlock('Unlock to check in'))) throw new Error('Unlock with your Face ID, fingerprint or phone passcode to check in.');
  let faceCheckId: string | undefined;
  try {
    if (faceCheck) {
      const shot = await selfie();
      if (!shot) return 'cancelled';
      faceCheckId = (await upload<{ faceCheckId: string }>(`/api/bookings/${bookingId}/check-in/face`, shot.uri, { 'x-app-shot-at': String(shot.shotAt) })).faceCheckId;
    }
    const at = await whereAmI();
    const r = await api<{ already: boolean }>(`/api/bookings/${bookingId}/check-in`, { method: 'POST', body: { ...at, unlocked: true, deviceId: await checkInDeviceId(), ...(faceCheckId ? { faceCheckId } : {}), ...(moveCode ? { moveCode } : {}) } });
    return r.already ? 'already' : 'done';
  } catch (e: any) {
    if (e?.code === 'PROFILE_ON_ANOTHER_PHONE') throw new NeedsMoveCode(e.message);
    if (e?.code === 'FACE_NOT_ENROLLED') throw new NeedsFace(e.message);
    throw e;
  }
}

/** Enrols this player's face once, after they agreed. The face service keeps a template; Daji keeps no photo. */
export async function enrolMyFace(): Promise<'done' | 'cancelled'> {
  const shot = await selfie();
  if (!shot) return 'cancelled';
  await upload(`/api/me/face`, shot.uri, { 'x-app-shot-at': String(shot.shotAt), 'x-face-consent': 'yes' });
  return 'done';
}
export const myFace = () => api<{ faceCheck: boolean; enrolled: boolean }>('/api/me/face');
export const removeMyFace = () => api<{ removed: boolean }>('/api/me/face/remove', { method: 'POST', body: {} });

export const sendMoveCode = () => api<{ to: string; devCode?: string }>('/api/me/check-in-phone/code', { method: 'POST', body: {} });
