import { registerSchema } from './db.ts';

// Two schema modules from a release that was rolled back (28 Oct 2026): separate customer businesses with their own brand, and
// one sign-in opening several businesses. Daji runs as one business again. The tables stay:
// a released module is never edited or removed (live databases already have it), and any rows in them are kept. Nothing reads them.
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
