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

/**
 * A profile picture may come from the gallery. It is cropped square and kept small. The system photo picker needs no photo permission
 * (Android 13+ and iOS 14+), which keeps the app clear of Google Play's photo permission declaration.
 */
export async function pickProfilePhoto(): Promise<{ uri: string } | null> {
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

/**
 * A reference picture for a job: from the gallery (a WhatsApp picture, a drawing, a screenshot of a quote). It is never proof, so
 * the gallery is fine here. The system photo picker needs no photo permission. On an iPhone a HEIC picture is handed over as a
 * JPEG (the compatible representation). Anything the server would refuse (not a JPEG, PNG or WebP, or over 10 MB) is turned
 * away here with a plain message, before it is sent.
 */
export async function pickReferencePhoto(): Promise<{ uri: string; name: string } | null> {
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsEditing: false, quality: 0.7,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  if (a.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(a.mimeType)) throw new Error('Pick a JPEG, PNG or WebP picture.');
  if (a.fileSize && a.fileSize > 10 * 1024 * 1024) throw new Error('That picture is over 10 MB. Pick a smaller one.');
  return { uri: a.uri, name: a.fileName ?? 'reference.jpg' };
}
