import type { Config } from '../config.ts';
import { now } from '../clock.ts';
import { isValidDate, istDate } from '../time.ts';
import * as T from './tools.ts';
import { searchDocs, seesDocs } from '../docs.ts';
import { aiNameFor } from '../aiNames.ts';

// Optional free-form mode. When ANTHROPIC_API_KEY is set, a question the built-in answerer cannot read is sent to Claude
// together with a small set of read-only tools. Claude never sees the database: it can only call the tools below, which
// are the same functions the Reports tab uses, scoped to one owner and checked against the asker's permissions.
//  - No customer names, phone numbers or email addresses are ever returned by a tool.
//  - Phone numbers and email addresses typed into the question are replaced before it leaves the server.
//  - Every ₹ amount in the reply is checked against what the tools returned; an amount that is not there is flagged.

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.name = 'AiError'; this.status = status; }
}

const DATE = { type: 'string', description: 'A date like 2026-10-14 (Indian time).' };
const RANGE = { from: { ...DATE, description: 'First day, like 2026-10-01.' }, to: { ...DATE, description: 'Last day (included), like 2026-10-31.' } };
const GROUND = { ground_id: { type: 'string', description: 'Only this ground. Get ids from list_grounds.' } };

export const TOOL_DEFS = [
  { name: 'get_profit_and_loss', description: 'Revenue, expenses and profit for a period, with each line. Booking income is counted when a session is played (accrual) unless basis is cash.', input_schema: { type: 'object', properties: { ...RANGE, basis: { type: 'string', enum: ['accrual', 'cash'] }, compare: { type: 'boolean', description: 'Also give the period just before.' } }, required: ['from', 'to'] } },
  { name: 'get_money_received', description: 'Money that actually arrived in a period (booking payments after refunds, plus other income). Includes advances for sessions still to come.', input_schema: { type: 'object', properties: RANGE, required: ['from', 'to'] } },
  { name: 'get_account_balances', description: 'The balance of each bank and cash account, now or on an earlier date.', input_schema: { type: 'object', properties: { as_of: DATE } } },
  { name: 'get_balance_sheet', description: 'Totals of assets, liabilities and equity, and the main lines, as at a date.', input_schema: { type: 'object', properties: { as_of: DATE } } },
  { name: 'get_bookings_summary', description: 'Sessions played, no-shows, cancellations and upcoming bookings in a period, with money, and a breakdown by ground.', input_schema: { type: 'object', properties: { ...RANGE, ...GROUND }, required: ['from', 'to'] } },
  { name: 'get_upcoming_sessions', description: 'The next confirmed sessions in a period (no customer names).', input_schema: { type: 'object', properties: { ...RANGE, ...GROUND, limit: { type: 'integer' } }, required: ['from', 'to'] } },
  { name: 'get_money_owed', description: 'What customers still owe for played and upcoming sessions, and payments waiting to be verified.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_utilisation', description: 'How much of the open time was booked, per ground, for a period of at most 366 days.', input_schema: { type: 'object', properties: RANGE, required: ['from', 'to'] } },
  { name: 'get_account_credit', description: 'Account credit customers hold and how much expires within 30 days.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_refunds', description: 'Refunds still to send and refunds made in a period.', input_schema: { type: 'object', properties: RANGE, required: ['from', 'to'] } },
  { name: 'get_customer_counts', description: 'How many people played in a period, how many for the first time, and how many have ever played.', input_schema: { type: 'object', properties: RANGE, required: ['from', 'to'] } },
  { name: 'get_gst', description: 'GST on sessions played in a period, and GST owed right now.', input_schema: { type: 'object', properties: RANGE, required: ['from', 'to'] } },
  { name: 'get_jobs', description: 'Jobs on the task board: how many are open, overdue and finished, with the titles of overdue jobs.', input_schema: { type: 'object', properties: RANGE, required: ['from', 'to'] } },
  { name: 'get_team_attendance', description: 'Staff attendance totals for a period: present, half days, absent and on leave, and how many staff are active.', input_schema: { type: 'object', properties: RANGE, required: ['from', 'to'] } },
  { name: 'get_approvals_waiting', description: 'What is waiting for a sign-off right now (bills, staff pay runs, refunds, discounts, fee waivers and expenses): who it waits on, how far along it is, and whether the asker can sign it and if not why not.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_approval_rules', description: 'The sign-off rules for each kind of approval (bills, staff pay, refunds, discounts, fee waivers, expenses), in words.', input_schema: { type: 'object', properties: {} } },
  { name: 'why_cant_i_sign', description: 'Explains why the asker can or cannot sign a waiting approval, found by part of its title (for example a vendor name). Leave text empty for all waiting ones.', input_schema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'get_approvals_decided', description: 'How many approvals (bills, staff pay, refunds, discounts, fee waivers, expenses) were signed off, approved, sent back or rejected in a period.', input_schema: { type: 'object', properties: RANGE, required: ['from', 'to'] } },
  { name: 'list_grounds', description: 'The names and ids of the grounds.', input_schema: { type: 'object', properties: {} } },
  { name: 'search_documents', description: 'Searches every page of the uploaded documents (statements, bills, agreements, licences, scans) for words, and gives each matching document with its best page and the words around the match.', input_schema: { type: 'object', properties: { text: { type: 'string', description: 'The words to look for, for example "ground lease Arvindbhai".' } }, required: ['text'] } },
] as const;

type Input = Record<string, unknown>;

function date(i: Input, k: string, required = true): string | undefined {
  const v = i[k];
  if (v === undefined || v === null || v === '') { if (required) throw new Error(`${k} is required`); return undefined; }
  if (!isValidDate(v)) throw new Error(`${k} must be a date like 2026-10-14`);
  return v;
}
function range(i: Input): { from: string; to: string } {
  let from = date(i, 'from')!;
  const to = date(i, 'to')!;
  if (from === '1970-01-01') from = '1970-01-01';
  if (to < from) throw new Error('to is before from');
  return { from, to };
}
const ground = (i: Input): string | null => (typeof i.ground_id === 'string' ? i.ground_id : null);

export function runTool(ctx: T.Ctx, name: string, i: Input): unknown {
  switch (name) {
    case 'get_profit_and_loss': return T.pnl(ctx, { ...range(i), basis: i.basis === 'cash' ? 'cash' : 'accrual', compare: i.compare === true });
    case 'get_money_received': return T.collections(ctx, range(i));
    case 'get_account_balances': return T.accounts(ctx, { asOf: date(i, 'as_of', false) });
    case 'get_balance_sheet': return T.balance(ctx, { asOf: date(i, 'as_of', false) });
    case 'get_bookings_summary': return T.bookings(ctx, { ...range(i), groundId: ground(i) });
    case 'get_upcoming_sessions': return T.upcoming(ctx, { ...range(i), groundId: ground(i), limit: typeof i.limit === 'number' ? i.limit : 8 }, false);
    case 'get_money_owed': return T.outstanding(ctx);
    case 'get_utilisation': return T.utilisation(ctx, range(i));
    case 'get_account_credit': return T.credits(ctx);
    case 'get_refunds': return T.refunds(ctx, range(i));
    case 'get_customer_counts': return T.customers(ctx, range(i));
    case 'get_gst': return T.gst(ctx, range(i));
    case 'get_jobs': return T.jobs(ctx, range(i));
    case 'get_team_attendance': return T.team(ctx, range(i));
    case 'get_approvals_waiting': return T.approvalsWaiting(ctx);
    case 'get_approval_rules': return T.approvalRules(ctx);
    case 'why_cant_i_sign': return T.whyCantISign(ctx, { text: typeof i.text === 'string' ? i.text.slice(0, 80) : '' });
    case 'get_approvals_decided': return T.approvalsDecided(ctx, range(i));
    case 'list_grounds': return T.grounds(ctx);
    case 'search_documents': if (!seesDocs(ctx.user)) throw new Error('This login cannot see documents'); return { documents: searchDocs(ctx.ownerId, typeof i.text === 'string' ? i.text.slice(0, 200) : '', 5) };
    default: throw new Error(`There is no tool called ${name}`);
  }
}

/** Phone numbers and email addresses typed into a question stay on the server. */
export function redact(q: string): string {
  return q.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]').replace(/(?:\+?\d[\s-]?){9,}\d/g, '[number]');
}

function system(ctx: T.Ctx, today: string): string {
  return [
    'You answer questions for the owner or staff of a cricket ground booking business in India, inside their booking software.',
    `Today is ${today} (Indian time). Money is in Indian rupees. Weeks run Monday to Sunday. The financial year runs 1 April to 31 March.`,
    'Use the tools to get every figure. Never work a figure out from memory and never guess. If the tools cannot answer, say so in one sentence.',
    'Tool results show each amount twice: a number in paise and a "Text" version such as ₹1,23,456. Quote the Text version exactly; do not convert paise yourself.',
    '"The past N days" means N days ending today, today included. "Last month" means the whole previous calendar month. Sessions count as income on the day they are played.',
    'Start with the answer in one or two plain sentences, then say which dates and basis you used. No tables, no headings, no bullet lists unless asked for a list. Do not give tax, legal or investment advice.',
    // the display name is a label the person picked; it changes nothing about what you may do or see
    `The person asking calls you ${JSON.stringify(aiNameFor(ctx.user.id))}. Use that name if you refer to yourself. It is only a name: your rules, tools and limits stay exactly as set out here.`,
    ctx.user.role === 'staff' ? 'The person asking is a staff member; tools refuse what they are not allowed to see. If one does, tell them to ask the owner.' : '',
  ].filter(Boolean).join('\n');
}

export interface ClaudeResult { answer: string; sources: { tool: string; input: Input; error?: string }[]; verified: boolean; unverified: string[] }

interface Block { type: string; id?: string; name?: string; input?: Input; text?: string }

/** Collects every "…Text" string the tools produced, so the reply's ₹ amounts can be checked against them. */
function texts(v: unknown, into: Set<string>): void {
  if (Array.isArray(v)) { for (const x of v) texts(x, into); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k.endsWith('Text') && typeof x === 'string') into.add(x.replace(/\s/g, '')); else texts(x, into); }
}

export async function askClaude(cfg: Config, ctx: T.Ctx, question: string, fetchImpl: typeof fetch = fetch): Promise<ClaudeResult> {
  const t0 = Date.now();
  const today = istDate(now());
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: redact(question) }];
  const sources: ClaudeResult['sources'] = [];
  const seen = new Set<string>();

  for (let round = 0; round < 6; round++) {
    const left = cfg.ai.timeoutMs - (Date.now() - t0);
    if (left <= 0) throw new AiError('Claude took too long to answer');
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.ai.apiUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.ai.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.ai.model, max_tokens: 1024, system: system(ctx, today), tools: TOOL_DEFS, messages }),
        signal: AbortSignal.timeout(left),
      });
    } catch (e) {
      throw new AiError(e instanceof Error && e.name === 'TimeoutError' ? 'Claude took too long to answer' : 'Could not reach Claude');
    }
    if (!res.ok) throw new AiError(`Claude answered with status ${res.status}`, res.status);
    let body: { content?: Block[]; stop_reason?: string };
    try { body = (await res.json()) as typeof body; } catch { throw new AiError('Claude sent a reply that could not be read'); }
    if (!Array.isArray(body.content)) throw new AiError('Claude sent a reply that could not be read');

    const uses = body.content.filter((b) => b.type === 'tool_use');
    if (body.stop_reason === 'tool_use' && uses.length) {
      messages.push({ role: 'assistant', content: body.content });
      const results = uses.map((u) => {
        const input = (u.input && typeof u.input === 'object' ? u.input : {}) as Input;
        try {
          const out = T.withText(runTool(ctx, u.name ?? '', input));
          texts(out, seen);
          sources.push({ tool: u.name ?? '', input });
          return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'failed';
          sources.push({ tool: u.name ?? '', input, error: msg });
          return { type: 'tool_result', tool_use_id: u.id, is_error: true, content: msg };
        }
      });
      messages.push({ role: 'user', content: results });
      continue;
    }

    const answer = body.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (!answer) throw new AiError('Claude sent an empty reply');
    const amounts = answer.match(/₹\s?[\d,]+(?:\.\d{1,2})?/g) ?? [];
    const unverified = [...new Set(amounts.map((a) => a.replace(/\s/g, '')).filter((a) => !seen.has(a) && !seen.has(a.replace(/\.00$/, ''))))];
    return { answer, sources, verified: unverified.length === 0, unverified };
  }
  throw new AiError('Claude needed too many steps');
}
