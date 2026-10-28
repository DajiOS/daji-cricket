import { HttpError } from './errors.ts';
import { parseRange } from './ask/dates.ts';

// The rules of a player auction. Every auction starts from the generic rules below; the host may change them before the
// bidding starts, either on the form or by asking Platform AI in plain words (draftRuleChange). Platform AI only drafts:
// nothing changes until the host confirms the draft, and it can never turn points into money.
// The purse and every bid are points. No money is collected, held or paid out by an auction (owner's decision, 28 Oct 2026).

export const PLAYER_ORDERS = ['random', 'registration', 'role'] as const;
export type PlayerOrder = typeof PLAYER_ORDERS[number];

export interface Increment { fromPoints: number; step: number }
export interface AuctionRules {
  /** How many teams the host plans for. */
  teamCount: number;
  /** Players each team must buy, and the most it may buy. */
  squadMin: number;
  squadMax: number;
  /** Points each team starts with. */
  pursePoints: number;
  /** The opening bid for every player. */
  basePoints: number;
  /** How much each new bid adds, by how high the bidding already is. */
  increments: Increment[];
  /** Seconds shown on the clock for each bid. The host still brings the hammer down. */
  bidTimerSeconds: number;
  /** Players nobody bid for come back once at the end. */
  unsoldRound: boolean;
  /** A team must keep enough points to fill its minimum squad at the base price. */
  reserveForSquad: boolean;
  /** The order players come up in. */
  playerOrder: PlayerOrder;
  /** The last day players can sign up (empty: until the bidding starts). */
  registrationCloses: string | null;
  /** The most players who can sign up (null: no limit). */
  maxPlayers: number | null;
  /** The host's own house rules, in words. */
  houseRules: string;
}

export const DEFAULT_RULES: AuctionRules = {
  teamCount: 8,
  squadMin: 11,
  squadMax: 15,
  pursePoints: 10000,
  basePoints: 100,
  increments: [{ fromPoints: 0, step: 50 }, { fromPoints: 1000, step: 100 }, { fromPoints: 5000, step: 250 }],
  bidTimerSeconds: 30,
  unsoldRound: true,
  reserveForSquad: true,
  playerOrder: 'random',
  registrationCloses: null,
  maxPlayers: null,
  houseRules: '',
};

const LIMITS = {
  teamCount: [2, 16], squadMin: [1, 25], squadMax: [1, 30], pursePoints: [100, 100_000_000], basePoints: [1, 10_000_000],
  bidTimerSeconds: [5, 300], maxPlayers: [2, 500], step: [1, 10_000_000],
} as const;

export const RULE_LABELS: Record<keyof AuctionRules, string> = {
  teamCount: 'Teams', squadMin: 'Smallest squad', squadMax: 'Largest squad', pursePoints: 'Purse per team', basePoints: 'Base price',
  increments: 'Bid steps', bidTimerSeconds: 'Bid clock', unsoldRound: 'Unsold players come back', reserveForSquad: 'Keep points to fill the squad',
  playerOrder: 'Order players come up', registrationCloses: 'Sign-up closes', maxPlayers: 'Most players who can sign up', houseRules: 'House rules',
};

const fail = (field: string, message: string): never => { throw new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field: `rules.${field}`, message }] }); };
const intIn = (v: unknown, field: string, [lo, hi]: readonly [number, number]): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return fail(field, 'Must be a whole number');
  if (v < lo || v > hi) return fail(field, `Must be from ${lo.toLocaleString('en-IN')} to ${hi.toLocaleString('en-IN')}`);
  return v;
};

/** The full rules after applying a partial change to `base`, checked as a whole. Throws VALIDATION_FAILED naming the field. */
export function checkRules(src: unknown, base: AuctionRules = DEFAULT_RULES): AuctionRules {
  if (src === undefined || src === null) return { ...base, increments: base.increments.map((i) => ({ ...i })) };
  if (typeof src !== 'object' || Array.isArray(src)) return fail('(rules)', 'Send the rules as an object');
  const s = src as Record<string, unknown>;
  for (const k of Object.keys(s)) if (!(k in DEFAULT_RULES)) fail(k, 'Not an auction rule');
  const r: AuctionRules = { ...base, increments: base.increments.map((i) => ({ ...i })) };
  if (s.teamCount !== undefined) r.teamCount = intIn(s.teamCount, 'teamCount', LIMITS.teamCount);
  if (s.squadMin !== undefined) r.squadMin = intIn(s.squadMin, 'squadMin', LIMITS.squadMin);
  if (s.squadMax !== undefined) r.squadMax = intIn(s.squadMax, 'squadMax', LIMITS.squadMax);
  if (s.pursePoints !== undefined) r.pursePoints = intIn(s.pursePoints, 'pursePoints', LIMITS.pursePoints);
  if (s.basePoints !== undefined) r.basePoints = intIn(s.basePoints, 'basePoints', LIMITS.basePoints);
  if (s.bidTimerSeconds !== undefined) r.bidTimerSeconds = intIn(s.bidTimerSeconds, 'bidTimerSeconds', LIMITS.bidTimerSeconds);
  for (const k of ['unsoldRound', 'reserveForSquad'] as const) if (s[k] !== undefined) { if (typeof s[k] !== 'boolean') fail(k, 'Must be true or false'); r[k] = s[k] as boolean; }
  if (s.playerOrder !== undefined) { if (!(PLAYER_ORDERS as readonly unknown[]).includes(s.playerOrder)) fail('playerOrder', `One of ${PLAYER_ORDERS.join(', ')}`); r.playerOrder = s.playerOrder as PlayerOrder; }
  if (s.registrationCloses !== undefined) {
    const v = s.registrationCloses;
    if (v === null || v === '') r.registrationCloses = null;
    else if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail('registrationCloses', 'A date like 2026-11-20, or empty');
    else r.registrationCloses = v;
  }
  if (s.maxPlayers !== undefined) r.maxPlayers = s.maxPlayers === null ? null : intIn(s.maxPlayers, 'maxPlayers', LIMITS.maxPlayers);
  if (s.houseRules !== undefined) {
    if (typeof s.houseRules !== 'string') fail('houseRules', 'Must be text');
    const t = (s.houseRules as string).trim();
    if (t.length > 1500) fail('houseRules', 'At most 1500 characters');
    r.houseRules = t;
  }
  if (s.increments !== undefined) {
    const list = s.increments;
    if (!Array.isArray(list) || list.length < 1 || list.length > 8) fail('increments', 'Give from 1 to 8 bid steps');
    r.increments = (list as unknown[]).map((x, i) => {
      if (!x || typeof x !== 'object') return fail(`increments.${i}`, 'Each bid step needs fromPoints and step');
      const o = x as Record<string, unknown>;
      return { fromPoints: intIn(o.fromPoints, `increments.${i}.fromPoints`, [0, LIMITS.pursePoints[1]]), step: intIn(o.step, `increments.${i}.step`, LIMITS.step) };
    }).sort((a, b) => a.fromPoints - b.fromPoints);
    if (r.increments[0]!.fromPoints !== 0) r.increments.unshift({ fromPoints: 0, step: r.increments[0]!.step });
    if (new Set(r.increments.map((i) => i.fromPoints)).size !== r.increments.length) fail('increments', 'Two bid steps start at the same points');
  }
  // the rules as a whole
  if (r.squadMax < r.squadMin) fail('squadMax', 'The largest squad cannot be smaller than the smallest squad');
  if (r.basePoints > r.pursePoints) fail('basePoints', 'The base price cannot be more than the purse');
  if (r.reserveForSquad && r.basePoints * r.squadMin > r.pursePoints) fail('pursePoints', `The purse must cover the smallest squad at the base price (${(r.basePoints * r.squadMin).toLocaleString('en-IN')} points)`);
  if (r.maxPlayers !== null && r.maxPlayers < r.teamCount) fail('maxPlayers', 'Allow at least one player per team');
  return r;
}

/** The step that applies once the bidding has reached `points`. */
export function stepAt(r: AuctionRules, points: number): number {
  let step = r.increments[0]!.step;
  for (const i of r.increments) if (points >= i.fromPoints) step = i.step;
  return step;
}
/** The lowest bid that can be made now: the base price when nobody has bid, else the current bid plus its step. */
export const nextMinimum = (r: AuctionRules, current: number | null): number => (current === null ? r.basePoints : current + stepAt(r, current));

const n = (x: number): string => x.toLocaleString('en-IN');
const ORDER_WORDS: Record<PlayerOrder, string> = { random: 'in a fair random order', registration: 'in the order they signed up', role: 'by role: wicket keepers, then batters, all-rounders and bowlers' };

export function valueInWords(k: keyof AuctionRules, r: AuctionRules): string {
  switch (k) {
    case 'pursePoints': case 'basePoints': return `${n(r[k])} points`;
    case 'bidTimerSeconds': return `${r.bidTimerSeconds} seconds`;
    case 'unsoldRound': case 'reserveForSquad': return r[k] ? 'Yes' : 'No';
    case 'playerOrder': return ORDER_WORDS[r.playerOrder];
    case 'registrationCloses': return r.registrationCloses ?? 'When the bidding starts';
    case 'maxPlayers': return r.maxPlayers === null ? 'No limit' : String(r.maxPlayers);
    case 'increments': return r.increments.map((i) => (i.fromPoints === 0 ? `+${n(i.step)}` : `+${n(i.step)} from ${n(i.fromPoints)}`)).join(', ');
    case 'houseRules': return r.houseRules || 'None';
    default: return String(r[k]);
  }
}

/** The rules as numbered sentences, for the auction page and for Ask AI. */
export function rulesInWords(r: AuctionRules, mode: 'auction' | 'teams' = 'auction'): string[] {
  if (mode === 'teams') return [`Up to ${r.teamCount} teams enter; the host adds each team.`, 'Matches are played at Daji and the ground is booked for each match day the usual way.', ...(r.houseRules ? [`House rules: ${r.houseRules}`] : [])];
  const out = [
    `Each of the ${r.teamCount} teams starts with ${n(r.pursePoints)} points. Points are not money and nothing is paid for a player.`,
    `Each team buys ${r.squadMin === r.squadMax ? r.squadMin : `from ${r.squadMin} to ${r.squadMax}`} players.`,
    `Every player opens at ${n(r.basePoints)} points. Each new bid adds ${valueInWords('increments', r)} points.`,
    `Players come up ${ORDER_WORDS[r.playerOrder]}. The clock shows ${r.bidTimerSeconds} seconds per bid; the host brings the hammer down and the highest bid wins.`,
    r.reserveForSquad ? `A team must always keep enough points to fill its smallest squad at the base price, so it cannot bid above that.` : `A team may spend all its points on any player.`,
    r.unsoldRound ? 'Players nobody bids for come back once at the end.' : 'Players nobody bids for stay unsold.',
    `Players sign up with their own Daji profile${r.registrationCloses ? ` until ${r.registrationCloses}` : ' until the bidding starts'}${r.maxPlayers ? `, at most ${r.maxPlayers} players` : ''}.`,
  ];
  if (r.houseRules) out.push(`House rules: ${r.houseRules}`);
  return out;
}

export interface RuleChange { field: keyof AuctionRules; label: string; from: string; to: string }
export function diffRules(a: AuctionRules, b: AuctionRules): RuleChange[] {
  return (Object.keys(DEFAULT_RULES) as (keyof AuctionRules)[])
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ field: k, label: RULE_LABELS[k], from: valueInWords(k, a), to: valueInWords(k, b) }));
}

// ------------------------------------------------------------------ change the rules in plain words

export interface RuleDraft {
  /** What was understood, one line each. */
  understood: string[];
  changes: RuleChange[];
  /** The full rules as they would be after the change; null when nothing could be drafted. */
  rules: AuctionRules | null;
  /** Why nothing was drafted, when it was not. */
  message: string | null;
  refused: boolean;
}

// Money in any of the languages customers write in: the purse is points and Platform AI may never make it money.
const MONEY = /₹|\brs\.?\s?\d|\brupees?\b|\brupay|\brupiy|\binr\b|\bpaise\b|\bpaisa\b|\bpaisa\b|real money|\bcash\b|\bupi\b|\bentry fees?\b|\bprize money\b|\bpay(ment|ing)?\b|\brefund|\bdeposit|रुपय|रूपय|रुपए|रूपए|पैस|भुगतान|रकम|રૂપિય|રુપિય|પૈસ|ચુકવણી|ਰੁਪਏ|ਪੈਸੇ|ரூபாய்|రూపాయ|ರೂಪಾಯ|രൂപ|টাকা/i;

/** "10k", "2.5 lakh", "1 crore", "12,000" -> a whole number. Lakh and crore are only counting words here; the result is points. */
function num(raw: string, unit?: string): number {
  let v = Number(raw.replace(/,/g, ''));
  const u = (unit ?? '').toLowerCase();
  if (u === 'k' || u === 'thousand') v *= 1000;
  else if (u.startsWith('lakh') || u.startsWith('lac')) v *= 100_000;
  else if (u.startsWith('cr')) v *= 10_000_000;
  return Math.round(v);
}
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?|cr)?\b`;

/**
 * Platform AI's draft of a rule change asked for in plain words ("make the purse 20,000 and squads 12 to 16").
 * It only reads the request and the current rules: it saves nothing, so the host confirms the draft before it applies.
 */
export function draftRuleChange(current: AuctionRules, rawText: unknown, today: string): RuleDraft {
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, 600) : '';
  const none = (message: string, refused = false): RuleDraft => ({ understood: [], changes: [], rules: null, message, refused });
  if (!text) return none('Tell me what to change, for example "make the purse 20,000 points" or "squads of 12 to 16 players".');
  if (MONEY.test(text)) return none('The purse and every bid are points, not money. I cannot turn them into money, set fees or prize money, or take or send any payment. For anything about money, talk to the ground.', true);
  const t = text.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ');
  const patch: Partial<AuctionRules> = {};
  const understood: string[] = [];
  let m: RegExpExecArray | null;

  if ((m = new RegExp(String.raw`${NUM}\s*(?:points? )?(?:purse|budget)`).exec(t)) || (m = new RegExp(String.raw`(?:purse|budget|wallet|points? (?:each|per team|for each team))[^\d,;]{0,25}?${NUM}`).exec(t))) {
    patch.pursePoints = num(m[1]!, m[2]); understood.push(`Purse of ${n(patch.pursePoints)} points per team`);
  }
  if ((m = new RegExp(String.raw`(?:base|opening|starting|minimum) (?:price|bid|points?|value)[^\d,;]{0,15}?${NUM}`).exec(t))) {
    patch.basePoints = num(m[1]!, m[2]); understood.push(`Base price of ${n(patch.basePoints)} points`);
  }
  if ((m = /(\d{1,2})\s*(?:-|to|–|and)\s*(\d{1,2}) (?:players?|per squad|a squad|in a squad|per team)/.exec(t)) || (m = /squads?(?: size)?(?: of| between| from)?\s*(\d{1,2})\s*(?:-|to|–|and)\s*(\d{1,2})/.exec(t))) {
    patch.squadMin = Number(m[1]); patch.squadMax = Number(m[2]); understood.push(`Squads of ${patch.squadMin} to ${patch.squadMax} players`);
  } else {
    if ((m = /(?:min(?:imum)?|smallest|at least)\s*(?:squad(?: size)?|players?)?\D{0,12}?(\d{1,2})/.exec(t)) && /squad|players?/.test(t)) { patch.squadMin = Number(m[1]); understood.push(`Smallest squad ${patch.squadMin}`); }
    if ((m = /(?:max(?:imum)?|largest|at most|up to)\s*(?:squad(?: size)?|players? per team)?\D{0,12}?(\d{1,2})\b(?! ?(?:seconds?|secs?|teams?))/.exec(t)) && /squad|per team/.test(t)) { patch.squadMax = Number(m[1]); understood.push(`Largest squad ${patch.squadMax}`); }
    if (patch.squadMin === undefined && patch.squadMax === undefined && (m = /squads?(?: size)?(?: of)?\s*(\d{1,2})\b/.exec(t) ?? /(\d{1,2}) players? (?:per|a|each) (?:team|squad)/.exec(t))) {
      patch.squadMax = Number(m[1]); patch.squadMin = Math.min(current.squadMin, patch.squadMax); understood.push(`Squads of up to ${patch.squadMax} players`);
    }
  }
  if ((m = /(\d{1,2}) teams?\b/.exec(t)) || (m = /teams?\s*(?:to|=|:|of)\s*(\d{1,2})\b/.exec(t))) { patch.teamCount = Number(m[1]); understood.push(`${patch.teamCount} teams`); }
  if ((m = /(\d{1,3})\s*(seconds?|secs?|s\b|minutes?|mins?)/.exec(t)) && /timer|clock|countdown|seconds?|secs?|per bid|each bid|minutes?/.test(t)) {
    patch.bidTimerSeconds = Number(m[1]) * (/^min/.test(m[2]!) ? 60 : 1); understood.push(`Bid clock of ${patch.bidTimerSeconds} seconds`);
  }
  if ((m = new RegExp(String.raw`(?:increments?|steps?|raise|raises|bid(?:s|ding)? (?:go(?:es)? up )?by|go up by|jumps?)\D{0,12}?${NUM}`).exec(t))) {
    const step = num(m[1]!, m[2]);
    const from = new RegExp(String.raw`(?:after|above|over|from|once|beyond|past)\s*(?:the bid (?:reaches|hits|is) )?${NUM}`).exec(t.slice(m.index));
    if (from) {
      const at = num(from[1]!, from[2]);
      patch.increments = [...current.increments.filter((i) => i.fromPoints !== at), { fromPoints: at, step }].sort((a, b) => a.fromPoints - b.fromPoints);
      understood.push(`Bids go up by ${n(step)} from ${n(at)} points`);
    } else { patch.increments = [{ fromPoints: 0, step }]; understood.push(`Every bid goes up by ${n(step)} points`); }
  }
  if (/unsold/.test(t)) {
    const off = /\b(no|not|dont|do not|never|without|off|skip|stay unsold|remain unsold|no second)\b/.test(t);
    patch.unsoldRound = !off; understood.push(off ? 'Unsold players stay unsold' : 'Unsold players come back once at the end');
  }
  if (/\b(reserve|keep (enough )?points|spend (all|everything)|all (their|the) points)\b/.test(t)) {
    const off = /\b(no|not|dont|do not|without|off|can spend|may spend|spend all|spend everything|all (their|the) points)\b/.test(t);
    patch.reserveForSquad = !off; understood.push(off ? 'Teams may spend all their points' : 'Teams must keep points to fill their squad');
  }
  if (/random|shuffle|lottery|draw/.test(t) && /order|random|shuffle|come up|players/.test(t)) { patch.playerOrder = 'random'; understood.push('Players come up in a random order'); }
  else if (/sign.?up order|registration order|order (they|of) (sign|regist)|first come/.test(t)) { patch.playerOrder = 'registration'; understood.push('Players come up in the order they signed up'); }
  else if (/by role|role order|keepers? first|batters? first|bowlers? first/.test(t)) { patch.playerOrder = 'role'; understood.push('Players come up by role'); }
  if (/(registration|sign.?ups?|joining|entries)\b.*\b(close|closes|closing|ends?|deadline|until|till|last day|by)\b/.test(t)) {
    if (/\b(no deadline|until the (auction|bidding)|when (the )?(auction|bidding) starts)\b/.test(t)) { patch.registrationCloses = null; understood.push('Sign-up stays open until the bidding starts'); }
    else {
      const r = parseRange(t.replace(/^.*?(close|closes|closing|ends?|deadline|until|till|last day|by)\b/, ''), today, 'future');
      if (r.span) { patch.registrationCloses = r.span.from; understood.push(`Sign-up closes on ${r.span.from}`); }
    }
  }
  if ((m = /(?:max(?:imum)?|at most|up to|limit(?: of)?|only)\s*(\d{1,3})\s*players? (?:can )?(?:sign|join|regist|in total|total|overall)/.exec(t))) { patch.maxPlayers = Number(m[1]); understood.push(`At most ${patch.maxPlayers} players can sign up`); }
  if (/no (player )?limit/.test(t) && /players?|sign/.test(t)) { patch.maxPlayers = null; understood.push('No limit on players signing up'); }
  if ((m = /(?:add (?:a |this )?(?:house )?rule|house rules?|new rule|rule)\s*[:\-]\s*(.{3,})$/i.exec(text))) {
    const add = m[1]!.trim();
    patch.houseRules = [current.houseRules, add].filter(Boolean).join('\n').slice(0, 1500); understood.push(`Add the house rule: "${add}"`);
  } else if (/(clear|remove|delete) (the |all )?house rules/.test(t)) { patch.houseRules = ''; understood.push('Remove the house rules'); }

  if (!understood.length) return none('I could not find a rule to change in that. Try "purse 20,000 points", "base price 200", "squads of 12 to 16", "bids go up by 100 after 2,000", "30 second clock", "unsold players do not come back" or "add rule: each team plays one under-16 player".');
  let rules: AuctionRules;
  try { rules = checkRules(patch, current); }
  catch (e) {
    const field = e instanceof HttpError ? ((e.details as { fields?: { field: string }[] } | undefined)?.fields?.[0]?.field ?? '').replace(/^rules\./, '').split('.')[0] as keyof AuctionRules : undefined;
    const label = field && RULE_LABELS[field] ? `${RULE_LABELS[field]}: ` : '';
    return { understood, changes: [], rules: null, message: `That change does not work. ${label}${e instanceof HttpError ? e.message : 'the rules do not fit together'}.`, refused: false };
  }
  const changes = diffRules(current, rules);
  if (!changes.length) return { understood, changes, rules: null, message: 'The rules already say that, so nothing needs to change.', refused: false };
  return { understood, changes, rules, message: null, refused: false };
}
