// The Daji Admin correction register's 82 left-panel routes, each tied to the desk page that serves it. This file has no imports so the
// server tests can load it and check every register route resolves. A register route opens its page without changing the address bar, so a
// bookmarked /finance/gst keeps working; the older addresses (/accounting/gst) keep working too.

export type Finding = 'MATCHES' | 'PARTIAL' | 'MISSING' | 'NOT APPLICABLE';
export interface RegisterRoute {
  /** The register's own row number, 1 to 82, in the order of its Navigation Register sheet. */
  row: number;
  /** The register's Proposed_Route without the "/desk" prefix: the desk is one page and its addresses live after the "#". */
  route: string;
  /** The desk address that serves it. ":id" is copied across. null: nothing in this repository serves it yet. */
  to: string | null;
  finding: Finding;
  section: string;
  label: string;
  /** What is missing or different, in a sentence. */
  note?: string;
}

const R = (row: number, section: string, label: string, route: string, to: string | null, finding: Finding, note?: string): RegisterRoute => ({ row, section, label, route, to, finding, note });
const CONSTRUCTION = 'Construction projects are a separate Daji Admin package with their own server and data. They are not in this repository, so the desk cannot open them yet.';

export const REGISTER: RegisterRoute[] = [
  R(1, 'Today', 'Today Command Center', '/today', '/', 'MATCHES'),
  R(2, 'Today', 'Live Score', '/operations/live', '/matches/live', 'MATCHES', 'Renamed from Live Board at the owner\'s request: every match being scored now, updating by itself. It is the Live now tab of Fixtures. The day view stays under Bookings.'),
  R(3, 'Today', 'Check-in', '/operations/check-in', '/bookings/day', 'PARTIAL', 'Staff see who is due and can mark a no-show. The server has no "arrived" record yet, so a check-in cannot be saved.'),
  R(4, 'Today', 'Ground Status', '/operations/grounds', '/grounds', 'MATCHES'),
  R(5, 'Today', 'Incidents', '/operations/incidents', null, 'MISSING', 'The server has no incident record. Faults on a ground or net are tracked on the status board and as jobs.'),
  R(6, 'Bookings & Matches', 'All Bookings', '/bookings', '/bookings', 'MATCHES'),
  R(7, 'Bookings & Matches', 'Calendar', '/bookings/calendar', '/calendar', 'MATCHES'),
  R(8, 'Bookings & Matches', 'Create Booking', '/bookings/new', '/bookings/new', 'MATCHES'),
  R(9, 'Bookings & Matches', 'Booking: Summary', '/bookings/:id', '/bookings/:id', 'MATCHES'),
  R(10, 'Bookings & Matches', 'Booking: Customer', '/bookings/:id/customer', '/bookings/:id/customer', 'MATCHES'),
  R(11, 'Bookings & Matches', 'Booking: Money', '/bookings/:id/money', '/bookings/:id/money', 'MATCHES'),
  R(12, 'Bookings & Matches', 'Booking: Match', '/bookings/:id/match', '/bookings/:id/match', 'PARTIAL', 'A multi-day booking links to its tournament. A single booking has no match record behind it.'),
  R(13, 'Bookings & Matches', 'Booking: Messages', '/bookings/:id/messages', '/bookings/:id/messages', 'PARTIAL', 'Shows the reminders sent for this booking. Free-text chat per booking is not stored.'),
  R(14, 'Bookings & Matches', 'Booking: Documents', '/bookings/:id/documents', '/bookings/:id/documents', 'MATCHES', 'The GST invoice, and every uploaded document whose pages mention the booking number.'),
  R(15, 'Bookings & Matches', 'Booking: Timeline', '/bookings/:id/timeline', '/bookings/:id/timeline', 'MATCHES'),
  R(16, 'Bookings & Matches', 'Move Booking', '/bookings/:id/move', '/bookings/:id/move', 'MATCHES'),
  R(17, 'Bookings & Matches', 'Fixtures', '/matches', '/matches', 'MATCHES'),
  R(18, 'Bookings & Matches', 'Live Score', '/matches/live', '/matches/live', 'MATCHES', 'The Live now tab of Fixtures, the same as Today, Live score.'),
  R(19, 'Bookings & Matches', 'Tournament', '/tournaments', '/tournaments', 'MATCHES'),
  R(20, 'Bookings & Matches', 'Settlement', '/matches/settlement', null, 'MISSING', 'The server has no match fee split or team settlement. Booking money settles on the booking.'),
  R(21, 'Bookings & Matches', 'Resources', '/resources', '/grounds/layout', 'MATCHES'),
  R(22, 'Bookings & Matches', 'Availability', '/resources/availability', '/bookings/day', 'MATCHES'),
  R(23, 'Bookings & Matches', 'Pricing', '/resources/pricing', '/settings/prices', 'MATCHES'),
  R(24, 'Bookings & Matches', 'Hours', '/resources/hours', '/settings/booking', 'MATCHES'),
  R(25, 'Bookings & Matches', 'Blocks', '/resources/blocks', '/blocks', 'MATCHES'),
  R(26, 'Customers', 'Directory', '/customers', '/contacts', 'MATCHES'),
  R(27, 'Customers', 'Customer: Overview', '/customers/:id', '/contacts/:id', 'MATCHES'),
  R(28, 'Customers', 'Customer: Bookings', '/customers/:id/bookings', '/contacts/:id/bookings', 'MATCHES'),
  R(29, 'Customers', 'Customer: Money', '/customers/:id/money', '/contacts/:id/money', 'MATCHES'),
  R(30, 'Customers', 'Customer: Teams / Players', '/customers/:id/teams', null, 'MISSING', 'The server has no team or player roster per customer.'),
  R(31, 'Customers', 'Customer: Messages', '/customers/:id/messages', null, 'MISSING', 'Messages are sent to groups of customers. The server keeps no per-customer message history to show.'),
  R(32, 'Customers', 'Customer: Documents', '/customers/:id/documents', '/contacts/:id/documents', 'MATCHES', 'Every uploaded document whose pages mention the customer or one of their bookings.'),
  R(33, 'Customers', 'Customer: Activity', '/customers/:id/activity', '/contacts/:id/activity', 'MATCHES'),
  R(34, 'Customers', 'Enquiries', '/enquiries', '/enquiries', 'PARTIAL', 'List, notes, prices sent and closing are on the desk. Turning an enquiry into a booking is still only on the server API.'),
  R(35, 'Customers', 'Broadcasts', '/broadcasts', '/reminders', 'MATCHES'),
  R(36, 'Customers', 'Members & Plans', '/memberships', '/memberships', 'MATCHES'),
  R(37, 'Academy', 'Students', '/academy/students', '/academy/students', 'MATCHES'),
  R(38, 'Academy', 'Batches', '/academy/batches', '/academy/students', 'PARTIAL', 'Batches are a field on each student, so they are filtered on the student list rather than kept as their own records.'),
  R(39, 'Academy', 'Attendance', '/academy/attendance', '/academy/attendance', 'MATCHES'),
  R(40, 'Academy', 'Fees', '/academy/fees', '/academy/fees', 'MATCHES'),
  R(41, 'Academy', 'Progress', '/academy/progress', '/academy/skills', 'MATCHES'),
  R(42, 'Revenue & Accounting', 'Finance Overview', '/finance', '/accounting', 'MATCHES'),
  R(43, 'Revenue & Accounting', 'Payments', '/finance/payments', '/money', 'MATCHES'),
  R(44, 'Revenue & Accounting', 'Banking', '/finance/banking', '/transactions', 'MATCHES'),
  R(45, 'Revenue & Accounting', 'Books', '/finance/books', '/accounting/journals', 'MATCHES'),
  R(46, 'Revenue & Accounting', 'GST', '/finance/gst', '/accounting/gst', 'MATCHES'),
  R(47, 'Revenue & Accounting', 'Month End', '/finance/month-end', '/close', 'MATCHES'),
  R(48, 'Construction', 'Construction Projects', '/construction', null, 'NOT APPLICABLE', CONSTRUCTION),
  R(49, 'Construction', 'Project: Plan', '/construction/:id/plan', null, 'NOT APPLICABLE', CONSTRUCTION),
  R(50, 'Construction', 'Project: Commercial', '/construction/:id/commercial', null, 'NOT APPLICABLE', CONSTRUCTION),
  R(51, 'Construction', 'Project: Site', '/construction/:id/site', null, 'NOT APPLICABLE', CONSTRUCTION),
  R(52, 'Construction', 'Project: Plans & Documents', '/construction/:id/documents', null, 'NOT APPLICABLE', CONSTRUCTION),
  R(53, 'Construction', 'Project: Finance', '/construction/:id/finance', null, 'NOT APPLICABLE', CONSTRUCTION),
  R(54, 'Work', 'Tasks', '/work/tasks', '/tasks', 'MATCHES'),
  R(55, 'Work', 'Approvals', '/work/approvals', '/approvals', 'MATCHES'),
  R(56, 'Work', 'Exceptions', '/work/exceptions', '/bookings/review', 'PARTIAL', 'Bookings the server flagged for review. Other modules show their own exceptions on their pages.'),
  R(57, 'Work', 'Work Calendar', '/work/calendar', '/calendar', 'MATCHES'),
  R(58, 'Reports', 'Operations', '/reports/operations', '/health', 'MATCHES'),
  R(59, 'Reports', 'Bookings', '/reports/bookings', '/booking-report', 'MATCHES'),
  R(60, 'Reports', 'Customers', '/reports/customers', '/contacts', 'PARTIAL', 'The directory has the play counts, last played and paid totals, with a CSV download. There is no separate customer report.'),
  R(61, 'Reports', 'Finance', '/reports/finance', '/accounting/reports', 'MATCHES'),
  R(62, 'Reports', 'Academy', '/reports/academy', '/academy/fees', 'PARTIAL', 'Fees collected and due per month. There is no separate academy report.'),
  R(63, 'Reports', 'Construction', '/reports/construction', null, 'NOT APPLICABLE', CONSTRUCTION),
  R(64, 'Reports', 'Compliance Register', '/compliance', '/compliance', 'MATCHES'),
  R(65, 'Reports', 'Renewals', '/compliance/renewals', '/compliance/renewals', 'MATCHES'),
  R(66, 'Reports', 'Compliance Incidents', '/compliance/incidents', null, 'MISSING', 'The server has no incident record.'),
  R(67, 'Reports', 'Change Log', '/compliance/change-log', '/compliance/changes', 'MATCHES'),
  R(68, 'Guppi', 'Ask', '/guppi', '/guppi', 'MATCHES'),
  R(69, 'Guppi', 'History', '/guppi/history', '/guppi/history', 'PARTIAL', 'Each person sees their own questions from the audit trail. Answers are not stored, so they are not shown again.'),
  R(70, 'Guppi', 'Available Actions', '/guppi/actions', '/guppi/actions', 'MATCHES'),
  R(71, 'Guppi', 'Language Tests', '/guppi/languages', null, 'MISSING', 'Language checks run as automated tests (guppi-web-parity and the Guppi language tests), not as a desk page.'),
  R(72, 'Admin', 'Team', '/admin/team', '/team', 'MATCHES'),
  R(73, 'Admin', 'Attendance', '/admin/attendance', '/payroll/attendance', 'MATCHES'),
  R(74, 'Admin', 'Payroll', '/admin/payroll', '/payroll', 'MATCHES'),
  R(75, 'Admin', 'Access', '/admin/access', '/team', 'MATCHES'),
  R(76, 'Admin', 'Users & Roles', '/admin/users', '/team', 'MATCHES'),
  R(77, 'Admin', 'Settings', '/admin/settings', '/settings', 'MATCHES'),
  R(78, 'Admin', 'Integrations', '/admin/integrations', '/settings/connections', 'MATCHES'),
  R(79, 'Admin', 'Feature Switches', '/admin/features', null, 'MISSING', 'There are no feature switches on the server. Booking, website and payment options are set in Settings.'),
  R(80, 'Admin', 'Audit', '/admin/audit', '/activity', 'MATCHES'),
  R(81, 'Admin', 'Photos & Videos', '/admin/media', '/media', 'MATCHES'),
  R(82, 'Admin', 'Cameras', '/admin/cameras', '/cameras', 'MATCHES'),
];

const toParts = (p: string) => p.split('/').filter(Boolean);
/** Does `route` match the register pattern, and with which :id? Exact only: "/finance" does not match "/finance/gst". */
function matchPattern(pattern: string, route: string): Record<string, string> | null {
  const a = toParts(pattern), b = toParts(route);
  if (a.length !== b.length) return null;
  const got: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) { if (!b[i]) return null; got[a[i]!.slice(1)] = b[i]!; } else if (a[i] !== b[i]) return null;
  }
  return got;
}

/** Pages merged into another (28 Oct 2026, the owner chose all seven): the old address opens the page that now holds it, with the rest of the
 *  path carried across, so bookmarks, server links and the activity feed keep working. Longer addresses first. */
export const MERGED: [string, string][] = [
  ['/accounting/close', '/close'], // Month end: the step-by-step close, with the signed-off months under it
  ['/accounting/review', '/accounting/reconcile'], // Books review is the top of Reconcile
  ['/bank', '/transactions/import'], // Bank import is a tab of Banking
  ['/bookings/approvals', '/approvals/book'], ['/bookings/payments', '/approvals/upi'], // the Approvals board, filtered
  ['/settings/people', '/platform/people'], ['/settings/services', '/platform/services'], ['/settings/backups', '/platform/settings'], ['/platform/connections', '/settings/connections'],
  ['/live', '/matches/live'], // Live score is the Live now tab of Fixtures
  ['/compare', '/booking-report/compare'], // Compare is a tab of Reports, Bookings
];
/** The address a merged page now lives at; any other address is returned as it is. */
export function mergedPath(path: string): string {
  for (const [from, to] of MERGED) if (path === from || path.startsWith(from + '/')) return to + path.slice(from.length);
  return path;
}

/** A register route that this desk cannot serve, with its reason. */
export interface Unserved { row: RegisterRoute }
/** What an address opens: the desk path, or the register row that nothing serves yet. Addresses outside the register pass through.
 *  Fixed routes are checked before ":id" ones, so /bookings/calendar is the calendar and not a booking called "calendar". */
export function resolveRoute(route: string): { path: string; unserved?: RegisterRoute; row?: RegisterRoute } {
  const clean = (route || '/').split('?')[0]!.replace(/\/+$/, '') || '/';
  const fixed = REGISTER.filter((r) => !r.route.includes(':'));
  const hit = fixed.find((r) => r.route === clean)
    ?? REGISTER.filter((r) => r.route.includes(':')).find((r) => {
      const m = matchPattern(r.route, clean);
      // a booking or customer id never looks like one of the fixed words beside it
      return m && !fixed.some((f) => f.route === clean);
    });
  if (!hit) return { path: mergedPath(clean) };
  if (!hit.to) return { path: clean, unserved: hit, row: hit };
  const params = matchPattern(hit.route, clean) ?? {};
  return { path: mergedPath(hit.to.replace(/:(\w+)/g, (_, k: string) => params[k] ?? '')), row: hit };
}
