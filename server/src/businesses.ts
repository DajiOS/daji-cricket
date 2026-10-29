import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { createUser, userRow } from './auth.ts';
import { getSettings, updateSettings } from './settings.ts';
import { sniffImage } from './media.ts';
import { storeUpload } from './intake.ts';

// The businesses on this software. Each one, Daji Cricket Ground first and Antroli Cricket Ground second, is an owner account
// whose bookings, customers, money and team are kept apart by owner_id everywhere else. This list carries only who the business
// is and how far it is set up, never its takings or its customers.

// Each business brands the software as its own (white-label): its name, its ground logo and its app logo, uploaded from its
// own desk. The platform admin says which web address shows which business; the main address shows mainSiteBusinessId.
registerSchema('business-brand-1', `
CREATE TABLE business_brands (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  display_name TEXT,
  app_name TEXT,
  logo_id TEXT, logo_ext TEXT, logo_mime TEXT,
  app_logo_id TEXT, app_logo_ext TEXT, app_logo_mime TEXT,
  site_domain TEXT,
  slug TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE UNIQUE INDEX uq_business_brands_slug ON business_brands(slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX uq_business_brands_domain ON business_brands(site_domain) WHERE site_domain IS NOT NULL;
CREATE UNIQUE INDEX uq_business_brands_logo ON business_brands(logo_id) WHERE logo_id IS NOT NULL;
CREATE UNIQUE INDEX uq_business_brands_app_logo ON business_brands(app_logo_id) WHERE app_logo_id IS NOT NULL;
`);

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_KINDS = ['logo', 'app'] as const;
export type LogoKind = typeof LOGO_KINDS[number];

interface BrandRow {
  owner_id: string; display_name: string | null; app_name: string | null; logo_id: string | null; logo_ext: string | null; logo_mime: string | null;
  app_logo_id: string | null; app_logo_ext: string | null; app_logo_mime: string | null; site_domain: string | null; slug: string | null; updated_at: number;
}
export interface Brand {
  businessId: string; name: string; appName: string; logoUrl: string | null; appLogoUrl: string | null; siteDomain: string | null; mainSite: boolean;
  /** The short name in its booking page's address: /b/<slug>, or <slug>.<platform address> once that is set up. */
  slug: string;
  /** This business keeps the main website's settings (it is the main site's, or no main site is set yet). See requireMainBusiness. */
  mainSettings: boolean;
}

const brandRow = (ownerId: string): BrandRow | undefined => one<BrandRow>('SELECT * FROM business_brands WHERE owner_id = ?', ownerId);
const ownerOr404 = (ownerId: string) => { const o = userRow(ownerId); if (!o || o.role !== 'owner') throw notFound('Business not found'); return o; };

/** The name a business goes by everywhere its customers and team see it: its own brand name, else its account's business name. */
export function businessName(ownerId: string): string {
  const b = brandRow(ownerId); const o = userRow(ownerId);
  return b?.display_name || o?.business_name || o?.name || 'the ground';
}

export function brandOf(ownerId: string): Brand {
  ownerOr404(ownerId);
  const b = brandRow(ownerId);
  const name = businessName(ownerId);
  return {
    businessId: ownerId, name, appName: b?.app_name || name,
    logoUrl: b?.logo_id ? `/api/brand-logo/${b.logo_id}` : null, appLogoUrl: b?.app_logo_id ? `/api/brand-logo/${b.app_logo_id}` : null,
    siteDomain: b?.site_domain ?? null, mainSite: mainSiteBusinessId() === ownerId, slug: slugOf(ownerId), mainSettings: !mainSiteBusinessId() || mainSiteBusinessId() === ownerId,
  };
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Reserved so a business page can never sit on an address the platform itself uses. */
const RESERVED_SLUGS = new Set(['www', 'api', 'app', 'admin', 'desk', 'media', 'mail', 'platform', 'static', 'assets', 'help', 'support', 'status']);
const slugBase = (name: string): string => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'ground';

/** The business's booking-page slug: the one it was given, else made from its name the first time it is asked for, and kept. */
export function slugOf(ownerId: string): string {
  const b = brandRow(ownerId);
  if (b?.slug) return b.slug;
  const base = slugBase(businessName(ownerId));
  let slug = RESERVED_SLUGS.has(base) ? `${base}-ground` : base;
  for (let n = 2; one('SELECT 1 FROM business_brands WHERE slug = ? AND owner_id <> ?', slug, ownerId); n++) slug = `${base}-${n}`;
  ensureRow(ownerId, null);
  run('UPDATE business_brands SET slug = ? WHERE owner_id = ? AND slug IS NULL', slug, ownerId);
  return brandRow(ownerId)!.slug!;
}

const ensureRow = (ownerId: string, actorId: string | null): void => {
  run('INSERT INTO business_brands(owner_id, updated_at, updated_by) VALUES(?,?,?) ON CONFLICT(owner_id) DO NOTHING', ownerId, now(), actorId);
};

/** A web address as typed ("https://www.Antroli.in/") down to the bare host ("antroli.in"). */
export function normHost(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
}

/** The owner saves the name and app name; the web address is the platform admin's to set, since it is where the platform answers. */
export function saveBrand(actor: Actor & { role: string }, ownerId: string, src: unknown): Brand {
  ownerOr404(ownerId);
  const v = new Validator(src);
  const name = v.str('name', { min: 2, max: 80 });
  const appName = v.str('appName', { min: 2, max: 30 });
  const domainIn = v.src.siteDomain;
  if (domainIn !== undefined && actor.role !== 'super_admin') v.fail('siteDomain', 'Only the platform admin sets the web address');
  const slugIn = v.src.slug;
  let slug: string | undefined;
  if (slugIn !== undefined) {
    if (actor.role !== 'super_admin') v.fail('slug', 'Only the platform admin sets the booking page address');
    else if (typeof slugIn !== 'string' || !SLUG_RE.test(slugIn.trim().toLowerCase()) || RESERVED_SLUGS.has(slugIn.trim().toLowerCase())) v.fail('slug', 'Letters, numbers and dashes, like antroli');
    else if (one('SELECT 1 FROM business_brands WHERE slug = ? AND owner_id <> ?', slugIn.trim().toLowerCase(), ownerId)) v.fail('slug', 'Another business already uses this address');
    else slug = slugIn.trim().toLowerCase();
  }
  let domain: string | null | undefined;
  if (domainIn !== undefined && actor.role === 'super_admin') {
    domain = domainIn === null || domainIn === '' ? null : normHost(String(domainIn));
    if (domain !== null && !/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) v.fail('siteDomain', 'A web address like antrolicricket.com');
    else if (domain && one('SELECT 1 FROM business_brands WHERE site_domain = ? AND owner_id <> ?', domain, ownerId)) v.fail('siteDomain', 'Another business already uses this web address');
  }
  v.done();
  ensureRow(ownerId, actor.id);
  const t = now();
  if (name !== undefined) run('UPDATE business_brands SET display_name = ?, updated_at = ?, updated_by = ? WHERE owner_id = ?', name.trim(), t, actor.id, ownerId);
  if (appName !== undefined) run('UPDATE business_brands SET app_name = ?, updated_at = ?, updated_by = ? WHERE owner_id = ?', appName.trim(), t, actor.id, ownerId);
  if (domain !== undefined) run('UPDATE business_brands SET site_domain = ?, updated_at = ?, updated_by = ? WHERE owner_id = ?', domain, t, actor.id, ownerId);
  if (slug !== undefined) run('UPDATE business_brands SET slug = ?, updated_at = ?, updated_by = ? WHERE owner_id = ?', slug, t, actor.id, ownerId);
  audit(actor, 'business.brand_saved', 'business', ownerId, { name: name ?? undefined, appName: appName ?? undefined, siteDomain: domain, slug }, ownerId);
  return brandOf(ownerId);
}

const logoFile = (dir: string, id: string, ext: string): string => join(dir, 'brand', `${id}.${ext}`);
const cols = (kind: LogoKind) => (kind === 'logo' ? ['logo_id', 'logo_ext', 'logo_mime'] : ['app_logo_id', 'app_logo_ext', 'app_logo_mime']) as [string, string, string];
export const logoKind = (k: unknown): LogoKind => {
  if (k !== 'logo' && k !== 'app') throw new HttpError(400, 'VALIDATION_FAILED', 'Say which logo: logo (the ground) or app', { fields: [{ field: 'kind', message: 'logo or app' }] });
  return k;
};

/** A business's ground logo or app logo. Virus-checked before it gets here (upload gate), quarantined, then released with its record. */
export function setLogo(dataDir: string, actor: Actor, ownerId: string, kind: LogoKind, data: Buffer): Brand {
  ownerOr404(ownerId);
  if (!data.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (data.length > MAX_LOGO_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', `A logo can be up to ${MAX_LOGO_BYTES / 1024 / 1024} MB`);
  const t = sniffImage(data);
  if (!t) throw new HttpError(415, 'NOT_A_PHOTO', 'Only PNG, JPEG, WebP or GIF pictures can be used');
  ensureRow(ownerId, actor.id);
  const [idC, extC, mimeC] = cols(kind);
  const old = brandRow(ownerId) as unknown as Record<string, string | null>;
  const id = randomBytes(12).toString('hex');
  storeUpload({
    dataDir, buf: data, finalPath: logoFile(dataDir, id, t.ext), purpose: kind === 'logo' ? 'business_logo' : 'business_app_logo', actor, ownerId,
    versioned: old[idC] && old[extC] ? logoFile(dataDir, old[idC]!, old[extC]!) : false,
    writeMetadata: () => {
      run(`UPDATE business_brands SET ${idC} = ?, ${extC} = ?, ${mimeC} = ?, updated_at = ?, updated_by = ? WHERE owner_id = ?`, id, t.ext, t.mime, now(), actor.id, ownerId);
      audit(actor, kind === 'logo' ? 'business.logo_set' : 'business.app_logo_set', 'business', ownerId, { bytes: data.length }, ownerId);
    },
  });
  return brandOf(ownerId);
}

export function clearLogo(dataDir: string, actor: Actor, ownerId: string, kind: LogoKind): Brand {
  ownerOr404(ownerId);
  const b = brandRow(ownerId) as unknown as Record<string, string | null> | undefined;
  const [idC, extC, mimeC] = cols(kind);
  if (b?.[idC] && b[extC]) { try { unlinkSync(logoFile(dataDir, b[idC]!, b[extC]!)); } catch { /* already gone */ } }
  if (b) run(`UPDATE business_brands SET ${idC} = NULL, ${extC} = NULL, ${mimeC} = NULL, updated_at = ?, updated_by = ? WHERE owner_id = ?`, now(), actor.id, ownerId);
  audit(actor, kind === 'logo' ? 'business.logo_clear' : 'business.app_logo_clear', 'business', ownerId, {}, ownerId);
  return brandOf(ownerId);
}

export function readLogo(dataDir: string, id: string): { data: Buffer; mime: string } {
  const r = one<{ ext: string; mime: string }>('SELECT logo_ext ext, logo_mime mime FROM business_brands WHERE logo_id = ? UNION ALL SELECT app_logo_ext, app_logo_mime FROM business_brands WHERE app_logo_id = ?', id, id);
  if (!r) throw notFound('Logo not found');
  try { return { data: readFileSync(logoFile(dataDir, id, r.ext)), mime: r.mime }; } catch { throw notFound('Logo not found'); }
}

/**
 * Settings that drive the main website and the whole platform (booking window, policies, festival looks, closed days, the
 * compliance register, outside services) are kept by the platform admin and by the main site's own business. Any other
 * business is refused, so one customer can never read or change what another's website runs on.
 */
export function requireMainBusiness(u: { id: string; role: string }): void {
  if (u.role === 'super_admin') return;
  const main = mainSiteBusinessId();
  if (main && u.id !== main) throw new HttpError(403, 'NOT_YOUR_SETTINGS', 'These settings belong to the main website, not to your business. Your own name and logos are under Settings, Your business. For anything else, ask the platform admin.');
}

/** Which business the main web address shows. Empty means every business, as it was before there was more than one. */
/** The GST invoice prefix a business starts with: DCG stays the main business's (its invoices already use it); every other business
 *  gets the first letters of its own name, so its invoice numbers never carry another business's initials. */
export function defaultInvoicePrefix(ownerId: string): string {
  const main = mainSiteBusinessId();
  if (!main || main === ownerId) return 'DCG';
  const letters = businessName(ownerId).split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join('').slice(0, 4);
  return letters || 'INV';
}

export function mainSiteBusinessId(): string | null {
  return getSettings().mainSiteBusinessId || null;
}

const bySlug = (slug: string): string | null => {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const r = one<{ owner_id: string }>("SELECT b.owner_id FROM business_brands b JOIN users u ON u.id = b.owner_id AND u.role = 'owner' AND u.active = 1 WHERE b.slug = ?", s);
  return r?.owner_id ?? null;
};

/** The business a request's own web address belongs to: its own domain, or <slug>.<platform address>. Null: not a business address. */
export function tenantOfHost(host: string | null | undefined, platformHost = ''): string | null {
  const h = normHost(host);
  if (!h) return null;
  const r = one<{ owner_id: string }>("SELECT b.owner_id FROM business_brands b JOIN users u ON u.id = b.owner_id AND u.role = 'owner' AND u.active = 1 WHERE b.site_domain = ?", h);
  if (r) return r.owner_id;
  if (platformHost && h.endsWith('.' + platformHost)) { const sub = h.slice(0, -platformHost.length - 1); if (!sub.includes('.')) return bySlug(sub); }
  return null;
}

/**
 * The business a public request is for: its booking page (?business=<slug>), the business whose own address it came to, else
 * the main site's. Null: every business (the main site before there was more than one). An unknown slug is a 404, never "all".
 */
export function siteBusinessFor(host: string | null | undefined, platformHost = '', slug?: string | null): string | null {
  if (slug) { const o = bySlug(slug); if (!o) throw notFound('No booking page at this address'); return o; }
  return tenantOfHost(host, platformHost) ?? mainSiteBusinessId();
}

/** The public face of the business a page is for: its name and logos. */
export function siteBrand(host: string | null | undefined, platformHost = '', slug?: string | null): { business: Omit<Brand, 'siteDomain' | 'mainSite' | 'mainSettings'> & { contactPhone: string | null } | null } {
  const id = siteBusinessFor(host, platformHost, slug);
  if (!id) return { business: null };
  const { siteDomain: _d, mainSite: _m, mainSettings: _s, ...b } = brandOf(id);
  return { business: { ...b, contactPhone: userRow(id)?.phone ?? null } };
}

export interface Business {
  id: string; businessName: string; ownerName: string; email: string | null; phone: string | null;
  active: boolean; canSignIn: boolean; grounds: number; activeGrounds: number; team: number; createdAt: number;
  siteDomain: string | null; slug: string; mainSite: boolean; hasLogo: boolean; hasAppLogo: boolean;
}

export function listBusinesses(): { mainSiteBusinessId: string | null; items: Business[] } {
  const rows = many<{ id: string; business_name: string | null; name: string; email: string | null; phone: string | null; active: number; has_pw: number; created_at: number; grounds: number; active_grounds: number; team: number }>(
    `SELECT u.id, u.business_name, u.name, u.email, u.phone, u.active, (u.password_hash IS NOT NULL) has_pw, u.created_at,
       (SELECT COUNT(*) FROM grounds g WHERE g.owner_id = u.id) grounds,
       (SELECT COUNT(*) FROM grounds g WHERE g.owner_id = u.id AND g.active = 1) active_grounds,
       (SELECT COUNT(*) FROM users s WHERE s.owner_id = u.id AND s.role = 'staff' AND s.active = 1) team
     FROM users u WHERE u.role = 'owner' ORDER BY u.created_at, u.rowid`);
  const main = mainSiteBusinessId();
  return {
    mainSiteBusinessId: main,
    items: rows.map((r) => {
      const b = brandRow(r.id);
      return {
        id: r.id, businessName: businessName(r.id), ownerName: r.name, email: r.email, phone: r.phone, active: !!r.active,
        canSignIn: !!r.has_pw, grounds: r.grounds, activeGrounds: r.active_grounds, team: r.team, createdAt: r.created_at,
        siteDomain: b?.site_domain ?? null, slug: slugOf(r.id), mainSite: main === r.id, hasLogo: !!b?.logo_id, hasAppLogo: !!b?.app_logo_id,
      };
    }),
  };
}

/**
 * Adds a customer business: its owner's account, with no password yet. Nothing is sent to anyone. The owner sets a password
 * with "Forgot password" when the platform admin tells them it is ready, and adds their own grounds, prices and team.
 */
export function addBusiness(actor: Actor, src: unknown): Business {
  const v = new Validator(src);
  const bizName = v.str('businessName', { required: true, min: 2, max: 80 });
  const ownerName = v.str('ownerName', { required: true, min: 2, max: 80 });
  const email = v.email('email', true);
  const phone = v.phone('phone', true);
  v.done();
  if (one("SELECT 1 FROM users WHERE role = 'owner' AND lower(trim(business_name)) = lower(?)", bizName!.trim()))
    throw new HttpError(409, 'BUSINESS_EXISTS', `${bizName} is already a customer.`);
  if (one("SELECT 1 FROM users WHERE role IN ('owner','staff','super_admin') AND phone = ?", phone!))
    throw new HttpError(409, 'PHONE_TAKEN', 'A business account already uses this phone number.');
  // The main web address has shown every business until now. Before a second one arrives, pin it to the business it has
  // been showing (the first), so the new customer's grounds never appear on someone else's website.
  if (!mainSiteBusinessId()) {
    const first = one<{ id: string }>("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at, rowid LIMIT 1");
    if (first) { updateSettings({ mainSiteBusinessId: first.id }, actor.id); audit(actor, 'settings.update', 'setting', 'mainSiteBusinessId', { from: '', to: first.id }); }
  }
  const row = createUser({ role: 'owner', name: ownerName!, email: email!, phone: phone!, password: null, businessName: bizName!.trim(), upiId: null });
  audit(actor, 'business.create', 'user', row.id, { businessName: row.business_name }, row.id);
  return listBusinesses().items.find((b) => b.id === row.id)!;
}
