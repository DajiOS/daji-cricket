import { createContext, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import { STRINGS, UI_LANGUAGES, UI_LANGUAGE_NAMES, type UiKey, type UiLang } from './strings.gen';

// The language of the screens: English, Gujarati or Hindi, from the shared word list (strings.gen.ts, made from shared/src/i18n.ts).
// A signed-in person's choice comes from the server (Profile › Screen language) and follows them to the website; before sign-in it is
// remembered on this phone. Words only: it never changes a price, a booking, a payment or what anyone may do.
export type { UiKey, UiLang };
export { UI_LANGUAGES, UI_LANGUAGE_NAMES };
export type T = (key: UiKey, vars?: Record<string, string | number>) => string;
export const isLang = (v: unknown): v is UiLang => typeof v === 'string' && (UI_LANGUAGES as readonly string[]).includes(v);

export function translator(lang: UiLang): T {
  const lines: Record<string, string> = STRINGS[lang];
  return (key, vars) => {
    const line = lines[key] ?? (STRINGS.en as Record<string, string>)[key] ?? key;
    return vars ? line.replace(/\{(\w+)\}/g, (m, v: string) => (v in vars ? String(vars[v]) : m)) : line;
  };
}

const KEY = 'daji.lang';
export async function savedLang(): Promise<UiLang> { try { const v = await SecureStore.getItemAsync(KEY); return isLang(v) ? v : 'en'; } catch { return 'en'; } }
export function rememberLang(l: UiLang): void { SecureStore.setItemAsync(KEY, l).catch(() => {}); }

export const Lang = createContext<{ lang: UiLang; t: T; setLang: (l: UiLang) => void }>({ lang: 'en', t: translator('en'), setLang: () => {} });
/** The words for the screen in the language this person picked. */
export const useT = (): T => useContext(Lang).t;
export const useLang = () => useContext(Lang);
