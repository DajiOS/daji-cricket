import * as Font from 'expo-font';

// The app's own typeface (Plus Jakarta Sans, SIL Open Font Licence) and icons (Phosphor, MIT), shipped inside the app as font files so
// nothing is fetched from the internet and they arrive with an over-the-air update. Each weight is its own family, because Android
// does not pick a weight of a custom font from fontWeight.
const FILES = {
  'Jakarta-400': require('../assets/fonts/PlusJakartaSans_400Regular.ttf'),
  'Jakarta-500': require('../assets/fonts/PlusJakartaSans_500Medium.ttf'),
  'Jakarta-600': require('../assets/fonts/PlusJakartaSans_600SemiBold.ttf'),
  'Jakarta-700': require('../assets/fonts/PlusJakartaSans_700Bold.ttf'),
  'Jakarta-800': require('../assets/fonts/PlusJakartaSans_800ExtraBold.ttf'),
  Phosphor: require('../assets/fonts/Phosphor.ttf'),
  'Phosphor-Fill': require('../assets/fonts/Phosphor-Fill.ttf'),
};

/** True once the fonts are loaded. Until then (or if loading fails) words use the phone's own font and icons the built-in set. */
export let fontsReady = false;
export async function loadFonts(): Promise<void> {
  try { await Font.loadAsync(FILES); fontsReady = true; } catch { fontsReady = false; }
}

/** The family for a weight: 400 regular, 500 medium, 600 semi-bold, 700 and up bold. The app's look is light, so nothing is drawn heavier than bold. */
export function fontFor(weight?: string | number | null): string {
  const n = weight === 'bold' ? 700 : weight == null || weight === 'normal' ? 400 : Number(weight) || 400;
  return n >= 700 ? 'Jakarta-700' : n >= 600 ? 'Jakarta-600' : n >= 500 ? 'Jakarta-500' : 'Jakarta-400';
}
