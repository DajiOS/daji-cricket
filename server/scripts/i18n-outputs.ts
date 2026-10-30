// What i18n-build.ts writes: the shared word list (shared/src/i18n.ts) as a file the phone app imports and one the website loads.
// Kept apart from the writer so test/ui-language.test.ts can check the files in the repo are the same as these.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_LANGUAGES, UI_LANGUAGE_NAMES, uiStrings } from '../../shared/src/i18n.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HEAD = '// Made by server/scripts/i18n-build.ts from shared/src/i18n.ts. Do not edit: change shared/src/i18n.ts and run the script again.\n';
const all = Object.fromEntries(UI_LANGUAGES.map((l) => [l, uiStrings(l)]));
const json = (v: unknown): string => JSON.stringify(v, null, 1);

export function i18nOutputs(): { path: string; text: string }[] {
  const mobile = `${HEAD}export const UI_LANGUAGES = ${JSON.stringify(UI_LANGUAGES)} as const;
export type UiLang = (typeof UI_LANGUAGES)[number];
export const UI_LANGUAGE_NAMES: Record<UiLang, string> = ${JSON.stringify(UI_LANGUAGE_NAMES)};
export const STRINGS = ${json(all)} as const;
export type UiKey = keyof (typeof STRINGS)['en'];
`;
  const web = `${HEAD}// The website's screen language: window.DajiI18n.t(key, {vars}), .set(lang), .apply(root) and .onChange(fn). An element with
// data-i18n="key" shows that line; data-i18n-aria="key" sets its aria-label. The choice is kept in this browser (a convenience only);
// for someone signed in, app.js saves it to their profile so it follows them to the phone app.
(() => {
'use strict';
const LANGS = ${JSON.stringify(UI_LANGUAGES)};
const NAMES = ${JSON.stringify(UI_LANGUAGE_NAMES)};
const STRINGS = ${json(all)};
const KEY = 'daji.lang';
let cur = 'en';
try { const v = localStorage.getItem(KEY); if (LANGS.includes(v)) cur = v; } catch { /* storage can be blocked */ }
const fns = [];
const t = (k, vars) => { const line = STRINGS[cur][k] ?? STRINGS.en[k] ?? k; return vars ? line.replace(/\\{(\\w+)\\}/g, (m, v) => (v in vars ? String(vars[v]) : m)) : line; };
function fonts() {
  if (cur === 'en' || document.getElementById('tf-ui-lang')) return;
  const l = document.createElement('link'); l.id = 'tf-ui-lang'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Hind+Vadodara:wght@400;500;600&family=Hind:wght@400;500;600&display=swap';
  document.head.appendChild(l);
}
function apply(root) {
  const r = root || document;
  for (const el of r.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
  for (const el of r.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  document.documentElement.lang = cur;
  document.documentElement.setAttribute('data-lang', cur);
  fonts();
}
function set(l, keep) {
  if (!LANGS.includes(l) || l === cur) return;
  cur = l;
  if (keep !== false) { try { localStorage.setItem(KEY, l); } catch { /* storage can be blocked */ } }
  apply();
  for (const f of fns) { try { f(l); } catch { /* one listener failing does not stop the others */ } }
}
window.DajiI18n = { t, apply, set, langs: LANGS, names: NAMES, get lang() { return cur; }, onChange(f) { fns.push(f); } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply()); else apply();
})();
`;
  return [{ path: join(ROOT, 'mobile', 'src', 'strings.gen.ts'), text: mobile }, { path: join(ROOT, 'web', 'public', 'i18n.js'), text: web }];
}
