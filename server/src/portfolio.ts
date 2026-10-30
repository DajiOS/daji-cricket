import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { userRow, type UserRow } from './auth.ts';
import { Validator } from './input.ts';
import { addBusiness, businessName, mainSiteBusinessId, type Business } from './businesses.ts';

// A portfolio: one business owner's sign-in opens more than one business. The platform admin puts a business in an owner's
// portfolio (Platform > Customers); the owner then switches to it in the desk. While switched, every request is answered
// exactly as for that business's own owner, so its data stays kept apart from the owner's own business by the same owner_id
// checks as always: nothing is merged or copied. Taking the business out of the portfolio splits them again at once, and
// nothing else has to move. The audit log names the real person, never the business owner they switched to.
registerSchema('business-portfolio-1', `
CREATE TABLE business_portfolio (
  user_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  added_at INTEGER NOT NULL,
  added_by TEXT,
  removed_at INTEGER,
  removed_by TEXT,
  PRIMARY KEY (user_id, owner_id)
);
CREATE INDEX ix_business_portfolio_owner ON business_portfolio(owner_id);
`);

// Whether a business in the portfolio is the owner's own ("mine": it counts in their combined view across their areas) or one
// they only support (Antroli, a friend's ground: never in their combined view). Anything added before this is "support".
registerSchema('business-portfolio-relation-1', `ALTER TABLE business_portfolio ADD COLUMN relation TEXT NOT NULL DEFAULT 'support' CHECK (relation IN ('mine','support'));`);
export const RELATIONS = ['mine', 'support'] as const;
export type Relation = typeof RELATIONS[number];

export interface PortfolioItem { id: string; businessName: string; own: boolean; relation: Relation }

const activeOwner = (id: string): UserRow | undefined => { const o = userRow(id); return o && o.role === 'owner' && o.active ? o : undefined; };

/** The businesses this owner's sign-in opens: their own first, then the ones put in their portfolio. */
export function portfolioOf(u: UserRow): PortfolioItem[] {
  if (u.role !== 'owner') return [];
  const rows = many<{ owner_id: string; relation: Relation }>('SELECT owner_id, relation FROM business_portfolio WHERE user_id = ? AND removed_at IS NULL ORDER BY added_at, rowid', u.id);
  return [{ id: u.id, businessName: businessName(u.id), own: true, relation: 'mine' as Relation },
    ...rows.filter((r) => r.owner_id !== u.id && activeOwner(r.owner_id)).map((r) => ({ id: r.owner_id, businessName: businessName(r.owner_id), own: false, relation: r.relation }))];
}

/** The owner says whether a business in their portfolio is their own or one they support. Only their own portfolio. */
export function setRelation(u: UserRow, ownerId: string, src: unknown): PortfolioItem[] {
  if (u.role !== 'owner') throw new HttpError(403, 'FORBIDDEN', 'Only a business owner has a portfolio.');
  const v = new Validator(src);
  const relation = v.oneOf('relation', RELATIONS, true);
  v.done();
  const c = run('UPDATE business_portfolio SET relation = ? WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', relation!, u.id, ownerId);
  if (c.changes === 0) throw notFound('That business is not in your portfolio');
  audit({ id: u.id, role: u.role }, 'portfolio.relation', 'business', ownerId, { relation }, ownerId);
  return portfolioOf(u);
}

/** A business this signed-in owner holds: their own, or one in their portfolio now. */
export function holdsBusiness(u: UserRow, ownerId: string): boolean {
  if (u.role !== 'owner') return false;
  if (u.id === ownerId) return true;
  return !!one('SELECT 1 FROM business_portfolio WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', u.id, ownerId) && !!activeOwner(ownerId);
}

/**
 * The business owner a switched request acts as. Refused (403) unless the business is in this owner's portfolio now and is
 * switched on: a removed or unknown business is never opened, and a team member or customer cannot switch at all.
 */
export function switchTo(u: UserRow, ownerId: string): UserRow {
  if (ownerId === u.id) return u;
  const refuse = () => new HttpError(403, 'NOT_IN_PORTFOLIO', 'That business is not in your portfolio. Ask the platform admin to add it.');
  if (u.role !== 'owner') throw refuse();
  if (!one('SELECT 1 FROM business_portfolio WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', u.id, ownerId)) throw refuse();
  const o = activeOwner(ownerId);
  if (!o) throw refuse();
  return o;
}

export interface PortfolioPerson { userId: string; name: string; businessName: string; addedAt: number }

/** Who else has this business in their portfolio. */
export function portfolioMembers(ownerId: string): PortfolioPerson[] {
  return many<{ user_id: string; added_at: number }>('SELECT user_id, added_at FROM business_portfolio WHERE owner_id = ? AND removed_at IS NULL ORDER BY added_at, rowid', ownerId)
    .map((r) => ({ userId: r.user_id, name: userRow(r.user_id)?.name ?? '', businessName: businessName(r.user_id), addedAt: r.added_at }));
}

/** Puts a business in another business owner's portfolio. Only for owner accounts; adding one already there changes nothing. */
export function addToPortfolio(actor: Actor, ownerId: string, userId: string): PortfolioPerson[] {
  if (!activeOwner(ownerId)) throw notFound('Business not found');
  const p = userRow(userId);
  if (!p || p.role !== 'owner') throw new HttpError(400, 'NOT_AN_OWNER', 'Only a business owner\'s account can have a portfolio. Choose the owner of another business.');
  if (p.id === ownerId) throw new HttpError(400, 'OWN_BUSINESS', 'This is already their own business.');
  const t = now();
  run(`INSERT INTO business_portfolio(user_id, owner_id, added_at, added_by) VALUES(?,?,?,?)
       ON CONFLICT(user_id, owner_id) DO UPDATE SET added_at = CASE WHEN removed_at IS NULL THEN added_at ELSE excluded.added_at END,
         added_by = CASE WHEN removed_at IS NULL THEN added_by ELSE excluded.added_by END, removed_at = NULL, removed_by = NULL`, userId, ownerId, t, actor.id);
  audit(actor, 'portfolio.add', 'business', ownerId, { userId }, ownerId);
  return portfolioMembers(ownerId);
}

/** Takes a business out of someone's portfolio: from the next request they cannot open it. The row is kept as history. */
export function removeFromPortfolio(actor: Actor, ownerId: string, userId: string): PortfolioPerson[] {
  const changed = run('UPDATE business_portfolio SET removed_at = ?, removed_by = ? WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', now(), actor.id, userId, ownerId);
  if (changed.changes > 0) audit(actor, 'portfolio.remove', 'business', ownerId, { userId }, ownerId);
  return portfolioMembers(ownerId);
}

/**
 * The main website's business owner (Sunny, for Daji Cricket Ground) may add another ground straight into their own portfolio,
 * without the platform admin's sign-in. It is a new, empty business with its own owner account (no password, nothing sent),
 * kept apart like any other; taking it out of the portfolio later is the whole split. No other owner may do this.
 */
export function mayAddBusinesses(u: UserRow): boolean {
  if (u.role !== 'owner' || !u.active) return false;
  const main = mainSiteBusinessId() ?? one<{ id: string }>("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at, rowid LIMIT 1")?.id;
  return main === u.id;
}

export function addBusinessToOwnPortfolio(u: UserRow, src: unknown): Business {
  if (!mayAddBusinesses(u)) throw new HttpError(403, 'FORBIDDEN', 'Only the main website\'s business owner or the platform admin can add a business.');
  const b = addBusiness({ id: u.id, role: u.role }, src);
  addToPortfolio({ id: u.id, role: u.role }, b.id, u.id);
  return b;
}
