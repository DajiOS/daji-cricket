import { createHash } from 'node:crypto';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError } from './errors.ts';
import { audit } from './audit.ts';
import type { UserRow } from './auth.ts';

// Versioned terms that team members must accept before they use the app. Each acceptance stores the SHA-256 of the exact
// wording that was shown, the time (UTC milliseconds) and the IP address, so it can be shown later as evidence of what
// the person agreed to. Changing the wording below (even one character) makes a new hash; bump STAFF_TERMS_VERSION too and
// everybody is asked again. Old versions stay in the table, so past acceptances can always be matched to their text.
// The wording is a working draft for the advocate to review (docs/LEGAL-REVIEW.md); it is not legal advice.

export const STAFF_TERMS_KEY = 'staff_terms';
export const STAFF_TERMS_VERSION = 1;
export const STAFF_TERMS_TITLE = 'Team member terms of use';
export const STAFF_TERMS_BODY = `Team member terms of use, Daji Cricket Ground, version 1

1. Who this is for. These terms apply to every person who is given a team login for the Daji Cricket Ground and Daji Sports systems ("the system").

2. Your login is yours. Keep your password private, never share your login and sign out on shared devices. What is done with your login is treated as done by you.

3. Use the system only for the ground's work. Do not copy, export, photograph or share customer details, phone numbers, bookings, payments or any business figures except as your job needs.

4. Customer and business data stays confidential. This duty continues after you stop working with us. We process personal data under the Digital Personal Data Protection Act, 2023 and our Privacy notice.

5. Money. Record every payment you take, exactly as received. Never hold back, round off or reuse a customer payment. Cash is recorded the same day. You must not accept cash that the law does not allow (Rs 2,00,000 or more from one person in a day).

6. Records and monitoring. The system keeps a log of what you view and change, with the time and device address. We may review it to protect customers, staff and the business.

7. Safety and conduct. Follow ground safety rules, treat customers and colleagues with respect, and report any injury, damage or security problem immediately.

8. Access can change. Your access may be limited, suspended or removed at any time, and you may be asked to accept updated terms before you can continue.

9. Law and disputes. These terms are governed by the laws of India. Courts at Surat have jurisdiction.

By ticking "I accept" you confirm that you have read and agree to these terms.`;

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

registerSchema('legal-1', `
CREATE TABLE legal_documents (
  doc_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  PRIMARY KEY (doc_key, version)
);
CREATE TABLE legal_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  doc_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE UNIQUE INDEX ux_legal_accept ON legal_acceptances(user_id, doc_key, version);
CREATE INDEX ix_legal_accept_user ON legal_acceptances(user_id, accepted_at);
`);

/** Makes sure the current wording is stored; refuses to start a version whose wording was already stored differently. */
export function ensureTerms(): void {
  const have = one<{ sha256: string }>('SELECT sha256 FROM legal_documents WHERE doc_key = ? AND version = ?', STAFF_TERMS_KEY, STAFF_TERMS_VERSION);
  const h = sha256(STAFF_TERMS_BODY);
  if (!have) run('INSERT INTO legal_documents(doc_key, version, title, body, sha256, published_at) VALUES(?,?,?,?,?,?)', STAFF_TERMS_KEY, STAFF_TERMS_VERSION, STAFF_TERMS_TITLE, STAFF_TERMS_BODY, h, now());
  else if (have.sha256 !== h) throw new HttpError(500, 'TERMS_CHANGED_WITHOUT_VERSION', 'The terms wording changed but the version number did not. Raise STAFF_TERMS_VERSION.');
}

export function currentTerms(): { docKey: string; version: number; title: string; body: string; sha256: string } {
  ensureTerms();
  return { docKey: STAFF_TERMS_KEY, version: STAFF_TERMS_VERSION, title: STAFF_TERMS_TITLE, body: STAFF_TERMS_BODY, sha256: sha256(STAFF_TERMS_BODY) };
}

export function acceptanceOf(userId: string): { version: number; sha256: string; acceptedAt: number; ip: string | null } | null {
  const r = one<{ version: number; sha256: string; accepted_at: number; ip: string | null }>('SELECT version, sha256, accepted_at, ip FROM legal_acceptances WHERE user_id = ? AND doc_key = ? AND version = ?', userId, STAFF_TERMS_KEY, STAFF_TERMS_VERSION);
  return r ? { version: r.version, sha256: r.sha256, acceptedAt: r.accepted_at, ip: r.ip } : null;
}

export const needsTerms = (u: UserRow): boolean => u.role === 'staff' && !acceptanceOf(u.id);

/** The person confirms by sending back the hash of the wording they were shown. A stale or altered copy is refused. */
export function acceptTerms(u: UserRow, input: { version: number; sha256: string }, ip: string, userAgent: string | undefined) {
  const cur = currentTerms();
  if (input.version !== cur.version || input.sha256 !== cur.sha256) throw new HttpError(409, 'TERMS_OUT_OF_DATE', 'The terms were updated. Reload and read the latest version before accepting.');
  if (!acceptanceOf(u.id)) {
    run('INSERT INTO legal_acceptances(id, user_id, doc_key, version, sha256, accepted_at, ip, user_agent) VALUES(?,?,?,?,?,?,?,?)', newId('acc'), u.id, cur.docKey, cur.version, cur.sha256, now(), ip, (userAgent ?? '').slice(0, 300));
    audit({ id: u.id, role: u.role }, 'legal.accept', 'legal_document', `${cur.docKey}:${cur.version}`, { sha256: cur.sha256, ip });
  }
  return acceptanceOf(u.id)!;
}

/** For the owner: every team member, and whether, when and from where they accepted the current terms. */
export function acceptanceReport(ownerId: string) {
  return many<{ id: string; name: string; version: number | null; sha256: string | null; accepted_at: number | null; ip: string | null }>(
    `SELECT u.id, u.name, a.version, a.sha256, a.accepted_at, a.ip FROM users u LEFT JOIN legal_acceptances a ON a.user_id = u.id AND a.doc_key = ? AND a.version = ?
     WHERE u.role = 'staff' AND u.owner_id = ? ORDER BY u.name COLLATE NOCASE`, STAFF_TERMS_KEY, STAFF_TERMS_VERSION, ownerId)
    .map((r) => ({ userId: r.id, name: r.name, version: r.version, sha256: r.sha256, acceptedAt: r.accepted_at, ip: r.ip }));
}
