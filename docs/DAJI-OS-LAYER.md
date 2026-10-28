# The Daji OS layer (software owner) and how to take it out later

Daji OS owns and runs the software. Daji Cricket Ground, Antroli Cricket Ground and any later ground are its customer businesses.
For now the software owner's layer lives in this repository, next to Daji Cricket Ground's own code. Sunny's plan (28 Oct 2026)
is to pull it out on its own later. This page lists what belongs to the layer, so the split is a move and not a rewrite.

## What belongs to the software owner

| Part | Where | What it does |
|---|---|---|
| Name | `shared/src/brand.ts` (`SOFTWARE_OWNER`), setting `softwareOwnerName` | "Daji OS", shown as "Software by Daji OS" |
| Customer businesses | `server/src/businesses.ts`, routes `/api/admin/businesses*` | Add a business, list its setup state (never its figures), choose the main website's business (`mainSiteBusinessId`) |
| White-label brand | `business_brands` table, `/api/desk/brand*`, `/api/site-brand`, `/api/brand-logo/:id` | Each business's name, app name, ground logo, app logo, booking-page slug and own domain |
| Booking page per business | `web/public/book.html`, `book.js`, `server/src/site.ts` (`/b/<slug>` and tenant hosts) | A booking page for a business with no website of its own |
| Domains and certificates | `server/src/businesses.ts` (`tenantOfHost`), `/api/platform/domain-check`, `deploy/Caddyfile` | Which web address shows which business |
| Portfolio | `server/src/portfolio.ts`, `business_portfolio` table, `/api/admin/businesses/:id/portfolio`, `/api/me/portfolio`, the `X-Daji-Business` header (`server/src/http.ts`) | One owner's sign-in opens several businesses, each still kept apart |
| Main-site gate | `requireMainBusiness` in `server/src/businesses.ts` | Platform-wide settings stay with the main website's business and the software owner |
| Desk screens | `desk/src/pages/Platform.tsx` (Customers tab), `desk/src/parts/admin/Businesses.tsx`, `desk/src/parts/admin/Brand.tsx` | Platform › Customers and Settings › Your business |
| Tests | `server/test/tenants.test.ts` | Proves the businesses never see each other's data, also while switched through a portfolio |

## Why the split stays clean

- Every business's data is already keyed by its owner account (`owner_id`). The layer adds tables keyed the same way and never
  copies one business's rows into another's.
- A portfolio only says "this sign-in may open that business". Nothing is shared or merged, so separating two businesses is
  "Remove" in Platform › Customers: from the next request the person cannot open it, and both businesses keep all their records.
- While someone works in another business through a portfolio, the audit log records the real person (`viaPortfolio` names the
  business). Records the screens create, such as a bill's "created by", show that business's owner account, because the request
  is answered as that owner. That is how each business's own checks keep working unchanged.

## Splitting Daji OS out later

1. Move the files above into the Daji OS project, keeping the table names and the schema modules (`business-brand-1`,
   `business-portfolio-1`): released schema modules are never edited.
2. Remove anyone's portfolio access that should not cross the line, in Platform › Customers.
3. Daji Cricket Ground keeps its own data and settings. With no other business, `mainSiteBusinessId` can stay as Daji's id.
