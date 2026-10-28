import { many, one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { newId } from './ids.ts';
import { audit, type Actor } from './audit.ts';

// The name people see for the assistant. Platform AI is the core feature and its name inside the software; it never changes.
// Each business sets a default display name (Settings, `aiAssistantName`, "Ask AI" unless changed), and each person can pick their
// own in Profile › Preferences. The name is shown exactly as typed ("Guppi", "Hey Guppi", "Ask AI"): nothing is added in front.
// A name is only a label. It never changes permissions, security rules, what the assistant can do, which business's data it reads,
// the question history, money limits, customer data separation or the AI provider and model.
//
// Reserved names: a name or wake phrase tied to another company's assistant (Siri, Alexa, Hey Google, ...) is refused on save.
// The built-in list below is the floor; the software owner adds more at run time (Platform › Reserved AI names) without a release.

export const CORE_AI_NAME = 'Platform AI';
export const DEFAULT_AI_NAME = 'Ask AI';
export const AI_NAME_MAX = 200;

registerSchema('ai-names-1', `
CREATE TABLE ai_user_names (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE TABLE ai_reserved_names (
  id TEXT PRIMARY KEY,
  phrase TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_ai_reserved_live ON ai_reserved_names(deleted_at);
INSERT INTO ai_user_names(user_id, name, created_at, updated_at, updated_by)
  SELECT id, 'Guppi', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, NULL FROM users WHERE role IN ('owner', 'staff', 'super_admin');
`);
// The INSERT keeps the desk looking as it did before names could be chosen: everyone already on the team saw "Guppi", so it becomes
// their own pick, which they can change or clear. Accounts made later start on the business default.

/** Names and wake phrases of other companies' assistants. Always reserved; the software owner can add to them but not remove them. */
export const BUILTIN_RESERVED: readonly string[] = [
  'Siri', 'Hey Siri',
  'Alexa', 'Hey Alexa', 'Amazon Alexa',
  'Google', 'Google Assistant', 'Hey Google', 'OK Google',
  'Gemini', 'Hey Gemini', 'Bard',
  'Copilot', 'Microsoft Copilot', 'Hey Copilot',
  'Cortana', 'Hey Cortana',
  'Bixby', 'Hi Bixby',
  'ChatGPT', 'GPT', 'OpenAI',
  'Claude', 'Meta AI', 'Hey Meta', 'Grok', 'Perplexity',
];

const WAKE_WORDS = ['hey', 'hi', 'hello', 'ok', 'okay', 'ask', 'my', 'the'];
const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

/** Lower case, accents and look-alike characters folded, everything else a space: "Hey S1ri!" -> ["hey", "siri"]. */
export function nameWords(s: string): string[] {
  const t = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/(?<=\p{L})[0-9@$]|[0-9@$](?=\p{L})/gu, (ch) => LOOKALIKE[ch] ?? ch);
  return t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
}
/** The words run together, with leading wake words taken off: "Hey Siri" and "heysiri" both give "siri". */
function core(words: string[]): string {
  let j = words.join('');
  for (let again = true; again;) { again = false; for (const w of WAKE_WORDS) if (j.length > w.length && j.startsWith(w)) { j = j.slice(w.length); again = true; } }
  return j;
}

export interface ReservedName { id: string | null; phrase: string; note: string | null; builtin: boolean; createdAt: number | null }
export function reservedNames(): ReservedName[] {
  const added = many<{ id: string; phrase: string; note: string | null; created_at: number }>('SELECT id, phrase, note, created_at FROM ai_reserved_names WHERE deleted_at IS NULL ORDER BY phrase');
  return [...BUILTIN_RESERVED.map((phrase) => ({ id: null, phrase, note: null, builtin: true, createdAt: null })), ...added.map((r) => ({ id: r.id, phrase: r.phrase, note: r.note, builtin: false, createdAt: r.created_at }))];
}

/** The reserved phrase this name collides with, or null. A reserved phrase anywhere in the name as whole words counts ("Ask Siri", "My Alexa"), and so does the same name run together or dressed up ("HeySiri", "S1ri"). */
export function reservedMatch(name: string, list: readonly string[] = reservedNames().map((r) => r.phrase)): string | null {
  const words = nameWords(name);
  if (!words.length) return null;
  const nameCore = core(words);
  for (const phrase of list) {
    const p = nameWords(phrase);
    if (!p.length) continue;
    for (let i = 0; i + p.length <= words.length; i++) if (p.every((w, k) => words[i + k] === w)) return phrase;
    const pc = core(p);
    if (pc && pc === nameCore) return phrase;
  }
  return null;
}

export const reservedMessage = (typed: string): string => `"${typed}" cannot be used. This name or wake phrase is reserved or associated with another product. Please choose a different name.`;

/** A display name that is fine to save, tidied, or an error that says what to change. Any words and any length are fine (the owner's
 *  decision, 28 Oct 2026); the one rule is the reserved list. AI_NAME_MAX only stops a pasted page of text from becoming a label. */
export function checkAiName(raw: unknown, field = 'aiName'): string {
  const fail = (message: string): never => { throw new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field, message }] }); };
  if (typeof raw !== 'string') return fail('Type a name for the assistant');
  // eslint-disable-next-line no-control-regex
  const name = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(name)) return fail('Type a name with at least one letter or number');
  if (name.length > AI_NAME_MAX) return fail(`That is too long to show as a label. Keep it under ${AI_NAME_MAX} characters`);
  if (reservedMatch(name)) return fail(reservedMessage(name));
  return name;
}

/** A name that was fine when saved but was reserved later keeps working for this long, with a notice asking for a new one. */
export const RESERVED_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;
/** When a saved name collides with a phrase added to the reserved list after it was saved: until when it still shows. Null = no collision. */
function graceFor(name: string): { phrase: string; until: number } | null {
  const hit = reservedMatch(name);
  if (!hit) return null;
  const added = one<{ created_at: number }>('SELECT created_at FROM ai_reserved_names WHERE deleted_at IS NULL AND phrase = ? ORDER BY created_at LIMIT 1', hit);
  return { phrase: hit, until: (added?.created_at ?? 0) + RESERVED_GRACE_DAYS * DAY_MS };
}

/** The business's default display name as saved in Settings (read straight from the settings table so this file does not need settings.ts). */
function savedSiteName(): string {
  const r = one<{ value: string }>("SELECT value FROM settings WHERE key = 'aiAssistantName'");
  if (!r) return DEFAULT_AI_NAME;
  try { const v = JSON.parse(r.value); return typeof v === 'string' && v.trim() ? v : DEFAULT_AI_NAME; } catch { return DEFAULT_AI_NAME; }
}
/** The business default in use: the saved one, unless it was reserved later and its grace period is over. */
export function siteAiName(): string {
  const n = savedSiteName(), g = graceFor(n);
  return g && now() >= g.until ? DEFAULT_AI_NAME : n;
}
/** This person's own pick, or null when they use the business default (or their pick was reserved later and its grace period is over). */
export function ownAiName(userId: string): string | null {
  const n = one<{ name: string }>('SELECT name FROM ai_user_names WHERE user_id = ?', userId)?.name ?? null;
  if (n === null) return null;
  const g = graceFor(n);
  return g && now() >= g.until ? null : n;
}
/** The name this person sees: their own pick, else the business default, else "Ask AI". */
export const aiNameFor = (userId: string | null | undefined): string => (userId ? ownAiName(userId) : null) ?? siteAiName();

/** A notice for someone whose name (their own, or the business default) was reserved after it was saved: change it before the date. */
export function aiNameNotice(userId: string): string | null {
  const own = one<{ name: string }>('SELECT name FROM ai_user_names WHERE user_id = ?', userId)?.name ?? null;
  const name = own ?? savedSiteName();
  const g = graceFor(name);
  if (!g) return null;
  const day = new Date(g.until + 5.5 * 3_600_000).toISOString().slice(0, 10);
  if (now() >= g.until) return `"${name}" is now reserved for another product, so the assistant is shown as ${aiNameFor(userId)} instead. ${own ? 'Pick a new name under Profile › Preferences.' : 'The owner can pick a new default in Settings › Platform AI.'}`;
  return `"${name}" is now reserved for another product. It keeps working until ${day}; ${own ? 'please pick a new name under Profile › Preferences before then' : 'the owner should pick a new default in Settings › Platform AI before then'}.`;
}

/** Saves (or with null / '' clears) a person's own display name. Returns the name they now see. */
export function setOwnAiName(actor: Actor & { id: string }, raw: unknown, ownerId: string | null): string {
  const before = ownAiName(actor.id);
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (before !== null) { run('DELETE FROM ai_user_names WHERE user_id = ?', actor.id); audit(actor, 'ai_name.update', 'user', actor.id, { from: before, to: null }, ownerId); }
    return siteAiName();
  }
  const name = checkAiName(raw);
  if (name !== before) {
    const t = now();
    run(`INSERT INTO ai_user_names(user_id, name, created_at, updated_at, updated_by) VALUES(?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, actor.id, name, t, t, actor.id);
    audit(actor, 'ai_name.update', 'user', actor.id, { from: before, to: name }, ownerId);
  }
  return name;
}

/** The software owner adds a reserved name or wake phrase. No one can save it from now on; a name already using it keeps working for
 *  RESERVED_GRACE_DAYS with a notice (aiNameNotice), then falls back to the business default or "Ask AI". */
export function addReservedName(actor: Actor & { id: string }, body: unknown): ReservedName {
  const b = (body && typeof body === 'object' ? body : {}) as { phrase?: unknown; note?: unknown };
  const fail = (field: string, message: string): never => { throw new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field, message }] }); };
  const phrase = typeof b.phrase === 'string' ? b.phrase.replace(/\s+/g, ' ').trim() : '';
  if (phrase.length < 2 || phrase.length > 60 || !nameWords(phrase).length) fail('phrase', 'Between 2 and 60 characters, with at least one letter or number');
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) || null : null;
  const same = reservedNames().find((r) => nameWords(r.phrase).join(' ') === nameWords(phrase).join(' '));
  if (same) throw new HttpError(409, 'ALREADY_RESERVED', `"${same.phrase}" is already on the reserved list`);
  const id = newId('arn'); const t = now();
  run('INSERT INTO ai_reserved_names(id, phrase, note, created_at, created_by) VALUES(?,?,?,?,?)', id, phrase, note, t, actor.id);
  audit(actor, 'ai_reserved.add', 'ai_reserved_name', id, { phrase, note });
  return { id, phrase, note, builtin: false, createdAt: t };
}

/** Takes an added phrase off the list (kept, marked removed). Built-in phrases cannot be removed. */
export function removeReservedName(actor: Actor & { id: string }, id: string): void {
  const r = one<{ phrase: string }>('SELECT phrase FROM ai_reserved_names WHERE id = ? AND deleted_at IS NULL', id);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'That reserved name is not on the list (the built-in ones cannot be removed)');
  run('UPDATE ai_reserved_names SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'ai_reserved.remove', 'ai_reserved_name', id, { phrase: r.phrase });
}

/** What Ask AI says when someone asks what it is called. */
export function aiNameAnswer(userId: string): string {
  const mine = ownAiName(userId), site = siteAiName();
  return `You call me ${mine ?? site}${mine ? ` (the business default is ${site})` : ', the name this business set'}. Underneath I am ${CORE_AI_NAME}, the assistant built into the software. You can change the name you see under Profile › Preferences › AI assistant name; it changes only the label, not what I can see or do.`;
}
// The same question in Gujarati and Hindi, in their own scripts or typed in English letters ("tamaru naam shu che", "aapka naam kya hai").
// Only "your name" and "who are you": "the customer's name" is a different question.
const NAME_Q_IN = /(તમારું|તમારુ|તારું|તારુ)\s*નામ|તમે\s*કોણ|(तुम्हारा|आपका|तेरा)\s*नाम|(तुम|आप|तू)\s*कौन|\b(tamaru|tamaaru|taru|tumhara|tumhaara|aapka|apka|tera)\s+(naam|nam)\b|\b(tame|tum|aap|ap|tu)\s+(kon|kaun)\s+(cho|chho|che|ho|hai|hain|hoo?)\b/i;
export const isNameQuestion = (q: string): boolean => /\b(what('?s| is) your name|who are you|what (are|should) (i|we) call you|what do (i|we) call you|your name\??$|rename (you|the assistant)|change (your|the assistant'?s?) name)\b/i.test(q) || NAME_Q_IN.test(q);
