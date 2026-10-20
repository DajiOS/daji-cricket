import type { Config } from '../config.ts';
import { now } from '../clock.ts';
import { audit, type Actor } from '../audit.ts';
import { HttpError } from '../errors.ts';
import type { UserRow } from '../auth.ts';
import { answerBuiltin, classify, EXAMPLES, type Built, type Detail, type Intent, type OpenReport, type Period } from './builtin.ts';
import { askClaude, AiError } from './claude.ts';
import { niceRange } from './dates.ts';
import * as T from './tools.ts';

export const MAX_QUESTION = 500;

export interface AskAnswer {
  question: string;
  answer: string;
  details: Detail[];
  /** What the question was taken to mean: the topic, the dates and the basis. Shown under the answer so a wrong reading is easy to spot. */
  understood: string;
  period: Period | null;
  intent: Intent | 'claude';
  source: 'builtin' | 'claude';
  /** Built-in answers come straight from the reports. For Claude answers: false when a ₹ amount in the reply is not one the reports returned. */
  verified: boolean;
  open: OpenReport | null;
  notes: string[];
  suggestions: string[];
  /** Claude mode: the reports it looked at. */
  sources?: { tool: string; input: Record<string, unknown>; error?: string }[];
}

// ---- a question costs money in Claude mode, so every person gets a fixed number an hour
const asked = new Map<string, number[]>();
export function resetAskLimits(): void { asked.clear(); }
function takeSlot(cfg: Config, userId: string): void {
  const t = now();
  const recent = (asked.get(userId) ?? []).filter((x) => x > t - 3_600_000);
  if (recent.length >= cfg.ai.limitPerHour) {
    const minutes = Math.max(1, Math.ceil((recent[0]! + 3_600_000 - t) / 60_000));
    throw new HttpError(429, 'ASK_LIMIT', `You have asked ${recent.length} questions in the last hour. You can ask again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, { retryAfterMinutes: minutes });
  }
  recent.push(t);
  asked.set(userId, recent);
}

export function cleanQuestion(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'VALIDATION_FAILED', 'Send your question as text', { fields: [{ field: 'question', message: 'Required' }] });
  // eslint-disable-next-line no-control-regex
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 2) throw new HttpError(400, 'VALIDATION_FAILED', 'Type a question', { fields: [{ field: 'question', message: 'Required' }] });
  if (q.length > MAX_QUESTION) throw new HttpError(400, 'VALIDATION_FAILED', `Keep the question under ${MAX_QUESTION} characters`, { fields: [{ field: 'question', message: `At most ${MAX_QUESTION} characters` }] });
  return q;
}

export function examplesFor(ctx: T.Ctx): string[] {
  return [...(T.can(ctx, 'reports') ? EXAMPLES.reports : []), ...(T.can(ctx, 'bookings') ? EXAMPLES.bookings : []), ...(T.can(ctx, 'customers') ? EXAMPLES.customers : [])];
}

/**
 * Answers one question. `fetchImpl` is for tests. Built-in answers never leave the server; Claude is used only when a key is
 * set and either the mode is "claude" or the built-in answerer could not read the question (mode "auto").
 */
export async function ask(cfg: Config, user: UserRow, ownerId: string, rawQuestion: unknown, fetchImpl: typeof fetch = fetch): Promise<AskAnswer> {
  const question = cleanQuestion(rawQuestion);
  const ctx: T.Ctx = { ownerId, user };
  takeSlot(cfg, user.id);
  const actor: Actor = { id: user.id, role: user.role };
  const { intent } = classify(question);
  const useClaude = !!cfg.ai.apiKey && cfg.ai.mode !== 'builtin' && (cfg.ai.mode === 'claude' || intent === 'unknown');

  let claudeNote: string | null = null;
  if (useClaude) {
    try {
      const r = await askClaude(cfg, ctx, question, fetchImpl);
      const used = r.sources.filter((s) => !s.error);
      audit(actor, 'ask.question', 'ask', null, { question: question.slice(0, 200), source: 'claude', tools: r.sources.map((s) => s.tool), verified: r.verified }, ownerId);
      return {
        question, answer: r.answer, details: [], source: 'claude', intent: 'claude', verified: r.verified, period: null, open: null,
        understood: used.length ? `Answered by Claude from: ${[...new Set(used.map((s) => describeTool(s.tool, s.input)))].join('; ')}` : 'Answered by Claude without looking anything up',
        notes: r.verified ? ['This answer was written by Claude from your own reports. Check the dates it mentions.'] : [`Check these amounts against the reports before relying on them: ${r.unverified.join(', ')}.`],
        suggestions: [], sources: r.sources,
      };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (!(e instanceof AiError)) throw e;
      claudeNote = cfg.ai.mode === 'claude' ? `Claude could not be reached (${e.message.toLowerCase()}), so this uses the built-in answers.` : null;
    }
  }

  const b: Built = answerBuiltin({ question, ctx });
  audit(actor, 'ask.question', 'ask', null, { question: question.slice(0, 200), source: 'builtin', intent: b.intent }, ownerId);
  return { question, ...b, notes: claudeNote ? [claudeNote, ...b.notes] : b.notes, intent: b.intent, source: 'builtin', verified: true };
}

function describeTool(tool: string, i: Record<string, unknown>): string {
  const names: Record<string, string> = {
    get_profit_and_loss: 'Profit and loss', get_money_received: 'Money received', get_account_balances: 'Account balances', get_balance_sheet: 'Balance sheet', get_bookings_summary: 'Bookings',
    get_upcoming_sessions: 'Upcoming sessions', get_money_owed: 'Money owed', get_utilisation: 'Utilisation', get_account_credit: 'Account credit', get_refunds: 'Refunds', get_customer_counts: 'Customer counts', get_jobs: 'Jobs', get_approvals_waiting: 'Approvals waiting', get_approval_rules: 'Approval rules', why_cant_i_sign: 'Approval you asked about', get_approvals_decided: 'Approvals decided', get_team_attendance: 'Team attendance', get_gst: 'GST', list_grounds: 'Grounds',
  };
  const from = typeof i.from === 'string' ? i.from : null, to = typeof i.to === 'string' ? i.to : null;
  return `${names[tool] ?? tool}${from && to ? ` ${niceRange(from, to)}` : typeof i.as_of === 'string' ? ` as at ${i.as_of}` : ''}`;
}
