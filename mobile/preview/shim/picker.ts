// Preview only: "the camera" is a file chooser, so the checks on the photo can be tried with real files.
const choose = (): Promise<File | null> => new Promise((resolve) => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.style.display = 'none';
  i.onchange = () => resolve(i.files && i.files[0] ? i.files[0] : null);
  i.oncancel = () => resolve(null);
  document.body.append(i); i.click();
});
export const requestCameraPermissionsAsync = async () => ({ granted: true });
export const requestMediaLibraryPermissionsAsync = async () => ({ granted: true });
const run = async () => { const f = await choose(); return f ? { canceled: false, assets: [{ uri: URL.createObjectURL(f) }] } : { canceled: true, assets: [] }; };
export const launchCameraAsync = run;
export const launchImageLibraryAsync = run;
