import type { Config } from '../config.ts';
import { now } from '../clock.ts';
import { audit, type Actor } from '../audit.ts';
import { HttpError } from '../errors.ts';
import type { UserRow } from '../auth.ts';
import { answerBuiltin, classify, EXAMPLES, type Built, type Detail, type Intent, type OpenReport, type Period } from './builtin.ts';
import { askClaude, AiError } from './claude.ts';
import { niceRange } from './dates.ts';
import * as T from './tools.ts';
import { aiNameAnswer, isNameQuestion } from '../aiNames.ts';
import { isReadOnlyQuestion, readOnlyAnswer } from '../readOnly.ts';
import { isDocQuestion, searchDocs, searchWords, seesDocs, waitingCount, type SearchHit } from '../docs.ts';

export const MAX_QUESTION = 500;
/** How a question reached the server: typed (the default) or by voice. */
export type AskVia = 'typed' | 'voice';
export const readVia = (v: unknown): AskVia => (v === 'voice' ? 'voice' : 'typed');

export interface AskAnswer {
  question: string;
  answer: string;
  details: Detail[];
  /** What the question was taken to mean: the topic, the dates and the basis. Shown under the answer so a wrong reading is easy to spot. */
  understood: string;
  period: Period | null;
  intent: Intent | 'claude' | 'documents';
  source: 'builtin' | 'claude';
  /** Built-in answers come straight from the reports. For Claude answers: false when a ₹ amount in the reply is not one the reports returned. */
  verified: boolean;
  open: OpenReport | null;
  notes: string[];
  suggestions: string[];
  /** Claude mode: the reports it looked at. */
  sources?: { tool: string; input: Record<string, unknown>; error?: string }[];
  /** Documents whose pages match, each with the page to show. */
  documents?: SearchHit[];
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
  return [...(T.can(ctx, 'reports') ? EXAMPLES.reports : []), ...(T.can(ctx, 'bookings') ? EXAMPLES.bookings : []), ...(T.can(ctx, 'customers') ? EXAMPLES.customers : []), ...(T.can(ctx, 'compliance') ? EXAMPLES.compliance : [])];
}

/**
 * Answers one question. `fetchImpl` is for tests. Built-in answers never leave the server; Claude is used only when a key is
 * set and either the mode is "claude" or the built-in answerer could not read the question (mode "auto").
 */
export async function ask(cfg: Config, user: UserRow, ownerId: string, rawQuestion: unknown, fetchImpl: typeof fetch = fetch, opts: { via?: AskVia } = {}): Promise<AskAnswer> {
  const question = cleanQuestion(rawQuestion);
  // a question that came by voice (Siri, a shortcut) is logged as such; it is answered exactly like a typed one, with the same access
  const via = opts.via === 'voice' ? { via: 'voice' } : {};
  const ctx: T.Ctx = { ownerId, user, cfg };
  takeSlot(cfg, user.id);
  const actor: Actor = { id: user.id, role: user.role };
  // "What is your name?": the display name this person chose (or the business default) over Platform AI. Answered here, never by Claude.
  if (isNameQuestion(question)) {
    audit(actor, 'ask.question', 'ask', null, { question: question.slice(0, 200), ...via, source: 'builtin', intent: 'assistant_name' }, ownerId);
    return { question, answer: aiNameAnswer(user.id), details: [], understood: 'A question about the assistant itself', period: null, intent: 'help', source: 'builtin', verified: true, open: null, notes: [], suggestions: [] };
  }
  // "Am I view only?", "Who on the team is read only?": answered from the Team page's Read only switch, never by Claude.
  if (isReadOnlyQuestion(question)) {
    audit(actor, 'ask.question', 'ask', null, { question: question.slice(0, 200), ...via, source: 'builtin', intent: 'read_only' }, ownerId);
    const r = readOnlyAnswer(user);
    return { question, answer: r.answer, details: r.details, understood: 'Who can change things', period: null, intent: 'help', source: 'builtin', verified: true, open: null, notes: [], suggestions: [] };
  }
  const { intent } = classify(question);
  // a question that asks for a document is answered from the pages of the uploaded documents, with the page itself to look at;
  // a question nothing else understands is tried against the documents too
  if (seesDocs(user) && (isDocQuestion(question) || intent === 'unknown')) {
    const hits = searchDocs(ownerId, question, 5);
    if (hits.length || isDocQuestion(question)) {
      audit(actor, 'ask.question', 'ask', null, { question: question.slice(0, 200), ...via, source: 'builtin', intent: 'documents', found: hits.length }, ownerId);
      return docAnswer(question, hits, waitingCount(ownerId));
    }
  }
  const useClaude = !!cfg.ai.apiKey && cfg.ai.mode !== 'builtin' && (cfg.ai.mode === 'claude' || intent === 'unknown');

  let claudeNote: string | null = null;
  if (useClaude) {
    try {
      const r = await askClaude(cfg, ctx, question, fetchImpl);
      const used = r.sources.filter((s) => !s.error);
      audit(actor, 'ask.question', 'ask', null, { question: question.slice(0, 200), ...via, source: 'claude', tools: r.sources.map((s) => s.tool), verified: r.verified }, ownerId);
      return {
        question, answer: r.answer, details: [], source: 'claude', intent: 'claude', verified: r.verified, period: null, open: null,
        understood: used.length ? `Answered by Claude from: ${[...new Set(used.map((s) => describeTool(s.tool, s.input)))].join('; ')}` : 'Answered by Claude without looking anything up',
        notes: r.verified ? ['This answer was written by Claude from your own reports. Check the dates it mentions.'] : [`Check these amounts against the reports before relying on them: ${r.unverified.join(', ')}.`],
        suggestions: [], sources: r.sources,
        ...(r.sources.some((x) => x.tool === 'search_documents' && !x.error) ? { documents: r.sources.filter((x) => x.tool === 'search_documents' && !x.error).flatMap((x) => searchDocs(ownerId, String(x.input.text ?? ''), 3)).filter((h, i, a) => a.findIndex((y) => y.docId === h.docId) === i) } : {}),
      };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (!(e instanceof AiError)) throw e;
      claudeNote = cfg.ai.mode === 'claude' ? `Claude could not be reached (${e.message.toLowerCase()}), so this uses the built-in answers.` : null;
    }
  }

  const b: Built = answerBuiltin({ question, ctx });
  audit(actor, 'ask.question', 'ask', null, { question: question.slice(0, 200), ...via, source: 'builtin', intent: b.intent }, ownerId);
  return { question, ...b, notes: claudeNote ? [claudeNote, ...b.notes] : b.notes, intent: b.intent, source: 'builtin', verified: true };
}

function describeTool(tool: string, i: Record<string, unknown>): string {
  const names: Record<string, string> = {
    get_profit_and_loss: 'Profit and loss', get_money_received: 'Money received', get_account_balances: 'Account balances', get_balance_sheet: 'Balance sheet', get_bookings_summary: 'Bookings',
    get_upcoming_sessions: 'Upcoming sessions', get_money_owed: 'Money owed', get_utilisation: 'Utilisation', get_account_credit: 'Account credit', get_refunds: 'Refunds', get_customer_counts: 'Customer counts', get_jobs: 'Jobs', get_branches: 'Branches', get_cash: 'Supervisor cash', get_site_report: 'Daily site report', get_approvals_waiting: 'Approvals waiting', get_approval_rules: 'Approval rules', why_cant_i_sign: 'Approval you asked about', get_approvals_decided: 'Approvals decided', get_team_attendance: 'Team attendance', get_gst: 'GST', get_compliance: 'Compliance register', get_waitlist: 'Waitlist', get_check_ins: 'Check-ins', get_shared_sheet: 'Shared spreadsheet', get_player_records: 'Player records', get_fantasy: 'Fantasy cricket', list_grounds: 'Grounds',
  };
  const from = typeof i.from === 'string' ? i.from : null, to = typeof i.to === 'string' ? i.to : null;
  return `${names[tool] ?? tool}${from && to ? ` ${niceRange(from, to)}` : typeof i.as_of === 'string' ? ` as at ${i.as_of}` : ''}`;
}

function docAnswer(question: string, hits: SearchHit[], waiting: number): AskAnswer {
  const words = searchWords(question);
  const where = (h: SearchHit) => `${h.name}, page ${h.page} of ${h.pages}${h.folder ? ` (in ${h.folder})` : ''}`;
  const answer = !hits.length ? `No document mentions ${words.length ? words.map((w) => `"${w}"`).join(' or ') : 'that'}.`
    : hits.length === 1 ? `Found it: ${where(hits[0]!)}.` : `${hits.length} documents mention ${words.map((w) => `"${w}"`).join(' or ')}. The best match is ${where(hits[0]!)}.`;
  const notes = waiting ? [`${waiting} photo${waiting === 1 ? ' or scan is' : 's or scans are'} not read yet, so ${waiting === 1 ? 'its pages are' : 'their pages are'} not searched. Set up Platform AI (the Claude connection in Settings › Connections) to read them.`] : [];
  return {
    question, answer, details: hits.map((h) => ({ label: where(h), text: h.snippet })), understood: `Searched every page of your documents for: ${words.join(', ') || question}`,
    period: null, intent: 'documents', source: 'builtin', verified: true, open: null, notes, suggestions: hits.length ? [] : ['Upload it in Documents, and every page is searched from then on.'], documents: hits,
  };
}
