import * as ImagePicker from 'expo-image-picker';

/**
 * Opens the camera (never the gallery) for proof photos. The picture is read straight from the camera, and the moment it was taken is noted here
 * so the server can fall back on it if the phone leaves the time out of the saved file. The server still rejects anything older than 5 minutes.
 */
export async function takeProofPhoto(): Promise<{ uri: string; shotAt: number } | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Allow camera access in your phone settings to take photos.');
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: true, allowsEditing: false });
  if (r.canceled || !r.assets[0]) return null;
  return { uri: r.assets[0].uri, shotAt: Date.now() };
}

/** A profile picture may come from the gallery. It is cropped square and kept small. */
export async function pickProfilePhoto(): Promise<{ uri: string } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Allow photo access in your phone settings to choose a picture.');
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
  if (r.canceled || !r.assets[0]) return null;
  return { uri: r.assets[0].uri };
}

/** A business card for the card reader: the camera, at a quality that keeps the photo well under the server's 5 MB limit. */
export async function takeCardPhoto(): Promise<{ uri: string } | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Allow camera access in your phone settings to scan cards.');
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, allowsEditing: false });
  if (r.canceled || !r.assets[0]) return null;
  return { uri: r.assets[0].uri };
}
