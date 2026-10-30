// The desk's menu and routes in one place. To add a page: create src/pages/<Name>.tsx that exports a default component, then add one line to PAGES and one to NAV.
import { lazy, type ComponentType } from 'react';
import { aiName, can, type Me } from './lib';
import { resolveRoute, mergedPath } from './routes';
import Dashboard from './pages/Dashboard';
const Compliance = lazy(() => import('./pages/Compliance'));
const Documents = lazy(() => import('./pages/Documents'));
const Bookings = lazy(() => import('./pages/Bookings'));
const Promos = lazy(() => import('./pages/Promos'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Cash = lazy(() => import('./pages/Cash'));
const Combined = lazy(() => import('./pages/Combined'));
const WhatsApp = lazy(() => import('./pages/WhatsApp'));
const Matches = lazy(() => import('./pages/Matches'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Cards = lazy(() => import('./pages/Cards'));
const Academy = lazy(() => import('./pages/Academy'));
const Accounting = lazy(() => import('./pages/Accounting'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Bills = lazy(() => import('./pages/Bills'));
const Payroll = lazy(() => import('./pages/Payroll'));
const Memberships = lazy(() => import('./pages/Memberships'));
const Tournaments = lazy(() => import('./pages/Tournaments'));
const Reminders = lazy(() => import('./pages/Reminders'));
const Team = lazy(() => import('./pages/Team'));
const Settings = lazy(() => import('./pages/Settings'));
const Platform = lazy(() => import('./pages/Platform'));
const Media = lazy(() => import('./pages/Media'));
const Cameras = lazy(() => import('./pages/Cameras'));
const Calendar = lazy(() => import('./pages/Calendar'));
const MoneyFlow = lazy(() => import('./pages/MoneyFlow'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const Activity = lazy(() => import('./pages/Activity'));
const CloseWizard = lazy(() => import('./pages/CloseWizard'));
const Health = lazy(() => import('./pages/Health'));
const Explorer = lazy(() => import('./pages/Explorer'));
const Spots = lazy(() => import('./pages/Spots'));
const Hub = lazy(() => import('./pages/Hub'));
const Enquiries = lazy(() => import('./pages/Enquiries'));
const Blocks = lazy(() => import('./pages/Blocks'));
const Waitlist = lazy(() => import('./pages/Waitlist'));
const Guppi = lazy(() => import('./pages/Guppi'));
const BookingsReport = lazy(() => import('./pages/BookingsReport'));

export interface NavItem { to: string; href?: string; label: string; icon: string; perm?: string; ownerOnly?: boolean; superOnly?: boolean; count?: 'approvals'; check?: (me: Me) => boolean }
/** Who may see a menu entry: the same rules the server applies to the page behind it. */
// Platform-wide settings (payments, website, festivals, integrations, go-live) belong to the business on the main website. Every other
// customer business gets 403 there, so its menu does not show them. App sets this from /api/desk/brand.
let mainBiz = true;
export const setMainBusiness = (v: boolean) => { mainBiz = v; };
export const isMainBusiness = () => mainBiz;
const mainOnly = { check: () => mainBiz };
// the sections of those pages that only the main business can open (Settings keeps Your business and Prices; Compliance keeps GST and terms)
const MAIN_ONLY_SUBS = new Set(['/settings/booking', '/settings/payments', '/settings/website', '/settings/festivals', '/settings/ai', '/settings/connections', '/settings/golive', '/compliance/rules', '/compliance/renewals', '/compliance/updates', '/compliance/changes']);
export const subOpen = (href: string) => mainBiz || !MAIN_ONLY_SUBS.has(href);

export const navVisible = (me: Me, i: NavItem) => can(me, i.perm) && (!i.ownerOnly || me.role !== 'staff') && (!i.superOnly || me.role === 'super_admin') && (!i.check || i.check(me));
/** The books and the money reports: "view_reports" or "manage_accounting", and "Can see revenue". */
export const seesMoney = (me: Me) => (can(me, 'view_reports') || can(me, 'manage_accounting')) && can(me, 'view_revenue');
/** The sections inside a page (the pills at its top), so the side menu can list them too. The first one is the page's own address. */
export const SUBS: Record<string, [string, string][]> = {
  '/bookings': [['', 'All bookings'], ['day', 'Day view']],
  '/matches': [['', 'All fixtures'], ['live', 'Live now'], ['leaders', 'Player records'], ['fantasy', 'Fantasy']],
  '/transactions': [['', 'Bank lines'], ['import', 'Import and bank feed']],
  '/booking-report': [['', 'Month by month'], ['compare', 'Compare']],
  '/academy': [['students', 'Students'], ['attendance', 'Attendance'], ['fees', 'Fees'], ['skills', 'Skills'], ['coaches', 'Coaches']],
  '/accounting': [['overview', 'Overview'], ['reports', 'Reports'], ['reconcile', 'Reconcile'], ['recurring', 'Recurring'], ['journals', 'Journals'], ['cashflow', 'Cash flow'], ['budget', 'Budget'], ['gst', 'GST'], ['assets', 'Fixed assets'], ['setup', 'Setup']],
  '/settings': [['business', 'Your business'], ['prices', 'Prices and timings'], ['booking', 'Booking window'], ['payments', 'Payments'], ['website', 'Website'], ['festivals', 'Festivals'], ['ai', 'Platform AI'], ['connections', 'Connections'], ['golive', 'Go-live check']],
  '/bills': [['', 'Bills'], ['vendors', 'Vendors']],
  '/compliance': [['rules', 'Rules and review dates'], ['renewals', 'Renewals'], ['updates', 'Law updates'], ['changes', 'Law-change log'], ['gst', 'GST invoices'], ['terms', 'Team terms']],
  '/payroll': [['run', 'Payroll run'], ['attendance', 'Attendance'], ['advances', 'Advances and deductions'], ['staff', 'Staff']],
  '/memberships': [['', 'Members'], ['expiring', 'Expiring soon'], ['plans', 'Plans'], ['activity', 'Activity']],
  '/reminders': [['', 'Queue'], ['templates', 'Templates'], ['one', 'Send one'], ['history', 'History']],
  '/platform': [['customers', 'Customers'], ['requests', 'Owner requests'], ['people', 'People'], ['settings', 'Platform settings and backups'], ['bank', 'Bank connection'], ['services', 'Services'], ['refunds', 'Refunds'], ['costs', 'Software costs']],
};
export const subHref = (to: string, k: string): string => (k ? `${to}/${k}` : to);

/** One job in the menu ("Buy & pay"), inside a section of the rail. */
export interface NavGroup { section: string; group: string; items: NavItem[] }

/** First match wins, so longer paths come before shorter ones. A page receives the rest of the path in `sub` (for example /bills/bil_123 gives sub "bil_123"). */
export const PAGES: { path: string; page: ComponentType<{ sub: string }> }[] = [
  { path: '/bookings', page: Bookings }, { path: '/promos', page: Promos }, { path: '/tasks', page: Tasks }, { path: '/cash', page: Cash }, { path: '/combined', page: Combined }, { path: '/whatsapp', page: WhatsApp }, { path: '/matches', page: Matches },
  { path: '/cards', page: Cards }, { path: '/contacts', page: Contacts }, { path: '/academy', page: Academy },
  { path: '/accounting', page: Accounting }, { path: '/transactions', page: Transactions },
  { path: '/approvals', page: Approvals }, { path: '/bills', page: Bills }, { path: '/payroll', page: Payroll },
  { path: '/memberships', page: Memberships }, { path: '/tournaments', page: Tournaments }, { path: '/reminders', page: Reminders },
  { path: '/team', page: Team }, { path: '/settings', page: Settings }, { path: '/platform', page: Platform }, { path: '/media', page: Media }, { path: '/cameras', page: Cameras }, { path: '/compliance', page: Compliance },
  { path: '/calendar', page: Calendar }, { path: '/money', page: MoneyFlow }, { path: '/pipeline', page: Pipeline }, { path: '/activity', page: Activity }, { path: '/close', page: CloseWizard }, { path: '/health', page: Health }, { path: '/explore', page: Explorer }, { path: '/hub', page: Hub }, { path: '/grounds', page: Spots },
  { path: '/enquiries', page: Enquiries }, { path: '/blocks', page: Blocks }, { path: '/waitlist', page: Waitlist }, { path: '/guppi', page: Guppi }, { path: '/booking-report', page: BookingsReport }, { path: '/documents', page: Documents },
];
export const HOME = Dashboard;

/** The menu, in the ten sections of the Daji Admin correction register (Construction is a separate package, so nine show here).
 *  Each item has the address the register gives it (`href`, shown in the address bar) and the desk page that serves it (`to`, see routes.ts).
 *  An item without `href` keeps its older address. Every page stays reachable. */
export const SECTIONS: { key: string; title: string; icon: string }[] = [
  { key: 'today', title: 'Today', icon: 'dashboard' },
  { key: 'bookings', title: 'Bookings & Matches', icon: 'calendar' },
  { key: 'customers', title: 'Customers', icon: 'users' },
  { key: 'academy', title: 'Academy', icon: 'grad' },
  { key: 'finance', title: 'Revenue & Accounting', icon: 'accounts' },
  { key: 'work', title: 'Work', icon: 'tasks' },
  { key: 'reports', title: 'Reports', icon: 'pie' },
  { key: 'guppi', get title() { return aiName(); }, icon: 'ai' },
  { key: 'admin', title: 'Admin', icon: 'settings' },
];
const books = { perm: 'view_revenue' }, acct = { perm: 'manage_accounting' }, owner = { ownerOnly: true }, sup = { superOnly: true };
const grounds = { check: (me: Me) => can(me, 'manage_bookings') || can(me, 'manage_tasks') };
export const NAV: NavGroup[] = [
  { section: 'today', group: 'Today', items: [
    { to: '/', href: '/today', label: 'Command center', icon: 'dashboard' },
    { to: '/matches/live', href: '/operations/live', label: 'Live score', icon: 'ball', perm: 'manage_matches' },
    { to: '/grounds', href: '/operations/grounds', label: 'Ground status', icon: 'ball', ...grounds },
  ] },

  { section: 'bookings', group: 'Bookings', items: [
    { to: '/bookings', label: 'All bookings', icon: 'list', perm: 'manage_bookings' },
    { to: '/calendar', href: '/bookings/calendar', label: 'Calendar', icon: 'calendar' },
    { to: '/waitlist', label: 'Waitlist', icon: 'clock', perm: 'manage_bookings' },
  ] },
  { section: 'bookings', group: 'Matches & tournaments', items: [
    { to: '/matches', label: 'Fixtures', icon: 'ball', perm: 'manage_matches' },
    { to: '/tournaments', label: 'Tournaments', icon: 'trophy', perm: 'manage_matches' },
  ] },
  { section: 'bookings', group: 'Grounds & nets', items: [
    { to: '/grounds/layout', href: '/resources', label: 'Grounds & nets', icon: 'map', ...grounds },
    { to: '/blocks', href: '/resources/blocks', label: 'Blocks', icon: 'lock', perm: 'manage_grounds' },
    { to: '/settings/prices', href: '/resources/pricing', label: 'Pricing', icon: 'tag', ...owner },
    { to: '/settings/booking', href: '/resources/hours', label: 'Booking hours', icon: 'clock', ...owner },
  ] },

  { section: 'customers', group: 'Customers', items: [
    { to: '/contacts', href: '/customers', label: 'Directory', icon: 'users', perm: 'view_customers' },
    { to: '/enquiries', label: 'Enquiries', icon: 'inbox', perm: 'manage_enquiries' },
    { to: '/reminders', href: '/broadcasts', label: 'Broadcasts', icon: 'chat', perm: 'send_broadcasts' },
    { to: '/memberships', label: 'Members & plans', icon: 'card', perm: 'manage_bookings' },
  ] },
  { section: 'customers', group: 'Win customers', items: [
    { to: '/promos', label: 'Promo codes', icon: 'tag', ...owner },
    { to: '/cards', label: 'Business cards', icon: 'card', perm: 'view_customers' },
    { to: '/explore', label: 'Look anything up', icon: 'search' },
  ] },

  { section: 'academy', group: 'Academy', items: [
    { to: '/academy/students', label: 'Students', icon: 'users', perm: 'manage_academy' },
    { to: '/academy/attendance', label: 'Attendance', icon: 'clock', perm: 'manage_academy' },
    { to: '/academy/fees', label: 'Fees', icon: 'payroll', perm: 'manage_academy' },
    { to: '/academy/skills', href: '/academy/progress', label: 'Progress', icon: 'star', perm: 'manage_academy' },
    { to: '/academy/coaches', label: 'Coaches', icon: 'grad', perm: 'manage_academy' },
  ] },

  { section: 'finance', group: 'Money in', items: [
    { to: '/accounting', href: '/finance', label: 'Overview', icon: 'dashboard', ...books },
    { to: '/money', href: '/finance/payments', label: 'Payments', icon: 'payments', check: seesMoney },
    { to: '/transactions', href: '/finance/banking', label: 'Banking', icon: 'bank', ...acct },
    { to: '/accounting/reconcile', label: 'Reconcile', icon: 'check', ...books },
  ] },
  { section: 'finance', group: 'Books', items: [
    { to: '/accounting/journals', href: '/finance/books', label: 'Books', icon: 'book', ...books },
    { to: '/accounting/gst', href: '/finance/gst', label: 'GST', icon: 'percent', ...books },
    { to: '/close', href: '/finance/month-end', label: 'Month end', icon: 'lock', check: seesMoney },
    { to: '/accounting/budget', label: 'Budget', icon: 'pie', ...books },
  ] },
  { section: 'finance', group: 'Buy & pay', items: [
    { to: '/bills', label: 'Bills', icon: 'billing', ...acct },
    { to: '/bills/vendors', label: 'Vendors', icon: 'warehouse', ...acct },
    { to: '/pipeline', label: 'Where things are', icon: 'list', check: (me) => seesMoney(me) || can(me, 'manage_bookings') },
  ] },

  { section: 'work', group: 'Work', items: [
    { to: '/tasks', href: '/work/tasks', label: 'Tasks', icon: 'tasks', perm: 'manage_tasks' },
    { to: '/approvals', href: '/work/approvals', label: 'Approvals', icon: 'check', check: (me) => can(me, 'manage_accounting') || can(me, 'manage_bookings'), count: 'approvals' },
    { to: '/bookings/review', href: '/work/exceptions', label: 'Exceptions', icon: 'bell', perm: 'manage_bookings' },
    { to: '/cash', label: 'Cash', icon: 'payments', check: (me) => me.role !== 'staff' || can(me, 'manage_tasks') },
    { to: '/whatsapp', label: 'WhatsApp', icon: 'chat', check: (me) => me.role !== 'staff' || can(me, 'manage_tasks') },
    { to: '/calendar', href: '/work/calendar', label: 'Work calendar', icon: 'calendar' },
    { to: '/documents', label: 'Documents', icon: 'book', check: (me) => me.role !== 'staff' || can(me, 'manage_accounting') },
  ] },

  { section: 'reports', group: 'Reports', items: [
    { to: '/health', href: '/reports/operations', label: 'Operations', icon: 'pulse' },
    // the owner's read-only view across the businesses they marked "Mine" (combined.ts); only an owner's own sign-in has one
    { to: '/combined', label: 'All my businesses', icon: 'pie', check: (me) => me.role === 'owner' },
    { to: '/booking-report', href: '/reports/bookings', label: 'Bookings', icon: 'pie', check: (me) => (can(me, 'view_reports') && can(me, 'view_revenue')) || seesMoney(me) || can(me, 'manage_bookings') },
    { to: '/accounting/reports', href: '/reports/finance', label: 'Finance', icon: 'accounts', ...books },
  ] },
  { section: 'reports', group: 'Compliance', items: [
    { to: '/compliance', label: 'Register', icon: 'audit', ...owner },
    { to: '/compliance/renewals', label: 'Renewals', icon: 'calendar', ...owner, ...mainOnly },
    { to: '/compliance/updates', label: 'Law updates', icon: 'bell', ...owner, ...mainOnly },
    { to: '/compliance/changes', href: '/compliance/change-log', label: 'Change log', icon: 'book', ...owner, ...mainOnly },
  ] },

  { section: 'guppi', get group() { return aiName(); }, items: [
    { to: '/guppi', label: 'Ask', icon: 'ai' },
    { to: '/guppi/history', label: 'History', icon: 'clock' },
    { to: '/guppi/actions', label: 'Available actions', icon: 'list' },
  ] },

  { section: 'admin', group: 'Staff & payroll', items: [
    { to: '/team', href: '/admin/team', label: 'Team, users & access', icon: 'shield', ...owner },
    { to: '/payroll/attendance', href: '/admin/attendance', label: 'Staff attendance', icon: 'clock', ...owner },
    { to: '/payroll', href: '/admin/payroll', label: 'Payroll', icon: 'payroll', ...owner },
  ] },
  { section: 'admin', group: 'Settings', items: [
    { to: '/settings', href: '/admin/settings', label: 'Settings', icon: 'settings', ...owner },
    { to: '/settings/payments', label: 'Payment settings', icon: 'payments', ...owner, ...mainOnly },
    { to: '/settings/website', label: 'Website', icon: 'globe', ...owner, ...mainOnly },
    { to: '/settings/festivals', label: 'Festivals', icon: 'calendar', ...owner, ...mainOnly },
    { to: '/settings/connections', href: '/admin/integrations', label: 'Integrations', icon: 'key', ...owner, ...mainOnly },
    { to: '/settings/golive', label: 'Go-live check', icon: 'check', ...owner, ...mainOnly },
    { to: '/settings/server', label: 'Server', icon: 'pulse', ...owner, ...mainOnly },
  ] },
  { section: 'admin', group: 'Audit & media', items: [
    { to: '/activity', href: '/admin/audit', label: 'Audit', icon: 'bell' },
    { to: '/media', href: '/admin/media', label: 'Photos & videos', icon: 'upload', ...owner },
    { to: '/cameras', href: '/admin/cameras', label: 'Live cameras', icon: 'camera', perm: 'view_cameras' },
  ] },
  { section: 'admin', group: 'Software owner', items: [
    { to: '/platform', label: 'Platform', icon: 'vault', ...sup },
  ] },
];
/** The address a menu item shows and links to. */
export const hrefOf = (i: NavItem) => i.href ?? i.to;
const ALL = () => NAV.flatMap((g) => g.items);

/** The department hubs (/hub/<section>): the jobs of one section around a core. */
export interface RailItem { key: string; label: string; short: string; icon: string; sep?: string; to?: string; section?: string; hub?: boolean; eyebrow?: string; desc?: string; perm?: string; anyPerm?: string[]; ownerOnly?: boolean }
export const RAIL: RailItem[] = [
  { key: 'today', label: 'Today', short: 'Today', icon: 'dashboard', to: '/' },
  ...SECTIONS.filter((x) => x.key !== 'today').map((x) => ({ key: x.key, get label() { return x.title; }, get short() { return x.title; }, icon: x.icon, section: x.key, hub: x.key === 'finance', get eyebrow() { return x.title; }, desc: '' })),
];
/** The left sidebar: one entry per register section. Each opens its first page this login can see; its pages show beneath it while it is open.
 *  `pages` are menu addresses (hrefOf). Every menu item sits under exactly one entry. */
export interface SideItem { key: string; label: string; icon: string; to?: string; pages?: string[]; action?: 'ask'; anyPerm?: string[]; count?: 'approvals' }
export const SIDE: SideItem[] = SECTIONS.map((x) => ({ key: x.key, get label() { return x.title; }, icon: x.icon, pages: NAV.filter((g) => g.section === x.key).flatMap((g) => g.items.map(hrefOf)), ...(x.key === 'work' ? { count: 'approvals' as const } : {}) }));

/** The menu item for an address: first the item whose own address the address starts with (the longest), then the item whose page serves it. */
export const itemFor = (route: string, items: NavItem[] = ALL()): NavItem | undefined => {
  const r = mergedPath(route || '/'); // an old address of a merged page belongs to the page that holds it now
  const longest = (key: (i: NavItem) => string, path: string) => items.filter((i) => { const k = key(i); return k === '/' ? path === '/' : path === k || path.startsWith(k + '/'); }).sort((a, b) => key(b).length - key(a).length)[0];
  return longest(hrefOf, r) ?? longest((i) => i.to, resolveRoute(r).path);
};
/** The sidebar entry an address belongs to. */
export const sideOf = (route: string): SideItem | undefined => {
  const r = route || '/';
  const hub = r.match(/^\/hub\/(\w+)/)?.[1];
  if (hub) return SIDE.find((x) => x.key === hub);
  const it = itemFor(r);
  return it ? SIDE.find((x) => x.pages?.includes(hrefOf(it))) : undefined;
};
/** The menu item for a sidebar page address. */
export const navItem = (href: string): NavItem | undefined => ALL().find((i) => hrefOf(i) === href);

/** One line under each job in a hub (by group name; the assistant's group, whose name each person picks, is under 'ai'). */
export const BLURBS: Record<string, string> = {
  'Today': 'What is happening now and what needs you.',
  'Bookings': 'Every booking and the calendar.',
  'Matches & tournaments': 'Fixtures, live scoring and tournaments.',
  'Grounds & nets': 'The grounds and nets, blocks, prices and hours.',
  'Customers': 'The directory, enquiries, broadcasts and members.',
  'Win customers': 'Promo codes, business cards and look-ups.',
  'Academy': 'Students, attendance, fees, progress and coaches.',
  'Money in': 'Make sure every rupee landed where it should: payments, banking and reconcile.',
  'Books': 'The ledgers, GST and a step-by-step month end.',
  'Buy & pay': 'Order, receive the bill, approve and pay.',
  'Work': 'Tasks, approvals, documents and what needs a second look.',
  'Reports': 'How the ground, the bookings and the money are doing, side by side.',
  'Compliance': 'Rules, review dates and the law-change log.',
  ai: 'Ask about the business in your own words.',
  'Staff & payroll': 'The team, their access, attendance and pay.',
  'Settings': 'Payments, website, festivals and connections.',
  'Audit & media': 'What happened, photos and the live cameras.',
  'Software owner': 'The platform: people, services, backups and owner requests.',
};
/** The hub an address belongs to. */
export const railOf = (route: string): RailItem | undefined => {
  const side = sideOf(route);
  return RAIL.find((x) => x.key === side?.key);
};

/** One symbol for every page inside a group, keyed "path:key" (the same keys as SUBS). */
export const SUB_ICONS: Record<string, string> = {
  '/bookings:': 'list', '/bookings:day': 'calendar', '/matches:': 'ball', '/matches:live': 'ball', '/transactions:': 'bank', '/transactions:import': 'upload', '/booking-report:': 'pie', '/booking-report:compare': 'swap',
  '/academy:students': 'users', '/academy:attendance': 'clock', '/academy:fees': 'payroll', '/academy:skills': 'star', '/academy:coaches': 'grad',
  '/accounting:overview': 'dashboard', '/accounting:reports': 'accounts', '/accounting:reconcile': 'swap', '/accounting:recurring': 'repeat',
  '/accounting:journals': 'book', '/accounting:cashflow': 'payments', '/accounting:budget': 'pie', '/accounting:gst': 'percent', '/accounting:assets': 'warehouse', '/accounting:setup': 'settings',
  '/settings:business': 'map', '/settings:prices': 'tag', '/settings:booking': 'calendar', '/settings:payments': 'payments', '/settings:website': 'globe', '/settings:festivals': 'calendar', '/settings:ai': 'ai', '/settings:connections': 'key',
  '/bills:': 'billing', '/bills:vendors': 'warehouse',
  '/compliance:rules': 'audit', '/compliance:updates': 'bell', '/compliance:changes': 'book', '/compliance:gst': 'percent', '/compliance:terms': 'shield',
  '/payroll:run': 'payroll', '/payroll:attendance': 'clock', '/payroll:advances': 'swap', '/payroll:staff': 'users',
  '/memberships:': 'users', '/memberships:expiring': 'bell', '/memberships:plans': 'tag', '/memberships:activity': 'list',
  '/reminders:': 'inbox', '/reminders:templates': 'edit', '/reminders:one': 'chat', '/reminders:history': 'clock',
  '/platform:customers': 'users', '/platform:requests': 'inbox', '/platform:people': 'users', '/platform:settings': 'settings', '/platform:bank': 'bank', '/platform:services': 'plug', '/platform:refunds': 'swap', '/platform:costs': 'billing',
};
