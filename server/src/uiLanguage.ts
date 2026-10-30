import { one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { isUiLang, UI_LANGUAGE_NAMES, type UiLang } from '@daji/shared';

// The language of a person's screens: English, Gujarati or Hindi (the word list is shared/src/i18n.ts). Each person picks it in
// Profile › Screen language, on the phone or the website, and it follows them to every device they sign in on.
// It is a label only. It never changes a price, a booking, a payment, a permission or which business's data anyone sees, and it
// does not decide the assistant's language: the assistant answers in the language the question was written in (guppiLang.ts).
// A person who never picked one sees English. Clearing the choice goes back to English.

registerSchema('ui-language-1', `
CREATE TABLE ui_languages (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  lang TEXT NOT NULL CHECK (lang IN ('en','gu','hi')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
`);

/** The language this person picked, or null when they never picked one (they see English). */
export function ownUiLanguage(userId: string): UiLang | null {
  const l = one<{ lang: string }>('SELECT lang FROM ui_languages WHERE user_id = ?', userId)?.lang;
  return isUiLang(l) ? l : null;
}
export const uiLanguageFor = (userId: string): UiLang => ownUiLanguage(userId) ?? 'en';

/** Profile › Screen language. null goes back to English. Only ever the person's own row: the caller passes the signed-in actor. */
export function setUiLanguage(actor: Actor & { id: string }, lang: UiLang | null, ownerId: string | null): UiLang {
  const before = ownUiLanguage(actor.id);
  if (lang === null) {
    if (before !== null) { run('DELETE FROM ui_languages WHERE user_id = ?', actor.id); audit(actor, 'ui_language.update', 'user', actor.id, { from: before, to: null }, ownerId); }
    return 'en';
  }
  if (lang !== before) {
    const t = now();
    run(`INSERT INTO ui_languages(user_id, lang, created_at, updated_at, updated_by) VALUES(?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET lang = excluded.lang, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, actor.id, lang, t, t, actor.id);
    audit(actor, 'ui_language.update', 'user', actor.id, { from: before, to: lang }, ownerId);
  }
  return lang;
}

/** The message for a value that is not one of the three. */
export const UI_LANGUAGE_REFUSED = 'Pick English (en), Gujarati (gu) or Hindi (hi).';

// "What language is my app in?", "change the app to Gujarati", in English, Gujarati or Hindi, in their own scripts or in English letters.
// About the screens only: "do you speak Gujarati" is about the assistant and is answered by its own language handling.
const SCREEN = String.raw`(app|screen|screens|website|site|menu|display)`;
const LANG_Q_EN = new RegExp(String.raw`\b(what|which)\s+language\b.*\b${SCREEN}\b|\b${SCREEN}\b.*\b(in|to)\s+(gujarati|hindi|english)\b|\b(change|switch|set)\s+(the\s+|my\s+)?(${SCREEN}\s+)?language\b|\bscreen\s+language\b`, 'i');
const LANG_Q_IN = /(એપ|સ્ક્રીન|વેબસાઇટ).*(ભાષા)|(ભાષા).*(બદલ)|(ऐप|स्क्रीन|वेबसाइट).*(भाषा)|(भाषा).*(बदल)|\b(app|screen)\s+(ni|ki|ka)?\s*(bhasha|bhaasha)\b|\b(bhasha|bhaasha)\s+(badal|badlo|badli|badalvi)/i;
export const isUiLanguageQuestion = (q: string): boolean => LANG_Q_EN.test(q) || LANG_Q_IN.test(q);

/** The answer, from this person's saved choice. It says where to change it and that it changes only the words on the screens. */
export function uiLanguageAnswer(userId: string): string {
  const own = ownUiLanguage(userId);
  const name = UI_LANGUAGE_NAMES[own ?? 'en'];
  return `Your screens are in ${name}${own ? '' : ', the starting language'}. You can pick English, ગુજરાતી (Gujarati) or हिन्दी (Hindi) under Profile › Screen language; the choice follows you to the app and the website. It changes only the words on your screens, not bookings, prices or payments. I answer in whatever language you write to me in.`;
}
