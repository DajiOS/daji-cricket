// The desk's menu and routes in one place. To add a page: create src/pages/<Name>.tsx that exports a default component, then add one line to PAGES and one to NAV.
import { lazy, type ComponentType } from 'react';
import { can, type Me } from './lib';
import Dashboard from './pages/Dashboard';
const Compliance = lazy(() => import('./pages/Compliance'));
const Bookings = lazy(() => import('./pages/Bookings'));
const Promos = lazy(() => import('./pages/Promos'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Matches = lazy(() => import('./pages/Matches'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Cards = lazy(() => import('./pages/Cards'));
const Academy = lazy(() => import('./pages/Academy'));
const Accounting = lazy(() => import('./pages/Accounting'));
const Transactions = lazy(() => import('./pages/Transactions'));
const BankImport = lazy(() => import('./pages/BankImport'));
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
const Compare = lazy(() => import('./pages/Compare'));
const Health = lazy(() => import('./pages/Health'));
const Explorer = lazy(() => import('./pages/Explorer'));

export interface NavItem { to: string; label: string; icon: string; perm?: string; ownerOnly?: boolean; superOnly?: boolean; count?: 'approvals'; check?: (me: Me) => boolean }
/** Who may see a menu entry: the same rules the server applies to the page behind it. */
export const navVisible = (me: Me, i: NavItem) => can(me, i.perm) && (!i.ownerOnly || me.role !== 'staff') && (!i.superOnly || me.role === 'super_admin') && (!i.check || i.check(me));
/** The books and the money reports: "view_reports" or "manage_accounting", and "Can see revenue". */
export const seesMoney = (me: Me) => (can(me, 'view_reports') || can(me, 'manage_accounting')) && can(me, 'view_revenue');
/** The sections inside a page (the pills at its top), so the side menu can list them too. The first one is the page's own address. */
export const SUBS: Record<string, [string, string][]> = {
  '/bookings': [['', 'All bookings'], ['day', 'Day view'], ['approvals', 'Approvals'], ['payments', 'UPI to verify']],
  '/academy': [['students', 'Students'], ['attendance', 'Attendance'], ['fees', 'Fees'], ['skills', 'Skills'], ['coaches', 'Coaches']],
  '/accounting': [['overview', 'Overview'], ['review', 'Books review'], ['reports', 'Reports'], ['reconcile', 'Reconcile'], ['recurring', 'Recurring'], ['journals', 'Journals'], ['cashflow', 'Cash flow'], ['budget', 'Budget'], ['gst', 'GST'], ['assets', 'Fixed assets'], ['close', 'Month-end'], ['setup', 'Setup']],
  '/settings': [['prices', 'Prices and timings'], ['booking', 'Booking window'], ['payments', 'Payments'], ['website', 'Website'], ['backups', 'Backups'], ['people', 'People'], ['connections', 'Connections'], ['services', 'Services']],
  '/bills': [['', 'Bills'], ['vendors', 'Vendors']],
  '/compliance': [['rules', 'Rules and review dates'], ['changes', 'Law-change log'], ['gst', 'GST invoices'], ['terms', 'Team terms']],
  '/payroll': [['run', 'Payroll run'], ['attendance', 'Attendance'], ['advances', 'Advances and deductions'], ['staff', 'Staff']],
  '/memberships': [['', 'Members'], ['expiring', 'Expiring soon'], ['plans', 'Plans'], ['activity', 'Activity']],
  '/reminders': [['', 'Queue'], ['templates', 'Templates'], ['one', 'Send one'], ['history', 'History']],
  '/platform': [['requests', 'Owner requests'], ['people', 'People'], ['settings', 'Platform settings'], ['connections', 'Connections'], ['bank', 'Bank connection'], ['services', 'Services'], ['refunds', 'Refunds'], ['costs', 'Software costs']],
};
export const subHref = (to: string, k: string): string => (k ? `${to}/${k}` : to);

/** One job in the menu ("Buy & pay"), inside a section of the rail. */
export interface NavGroup { section: string; group: string; items: NavItem[] }

/** First match wins, so longer paths come before shorter ones. A page receives the rest of the path in `sub` (for example /bills/bil_123 gives sub "bil_123"). */
export const PAGES: { path: string; page: ComponentType<{ sub: string }> }[] = [
  { path: '/bookings', page: Bookings }, { path: '/promos', page: Promos }, { path: '/tasks', page: Tasks }, { path: '/matches', page: Matches },
  { path: '/cards', page: Cards }, { path: '/contacts', page: Contacts }, { path: '/academy', page: Academy },
  { path: '/accounting', page: Accounting }, { path: '/transactions', page: Transactions }, { path: '/bank', page: BankImport },
  { path: '/approvals', page: Approvals }, { path: '/bills', page: Bills }, { path: '/payroll', page: Payroll },
  { path: '/memberships', page: Memberships }, { path: '/tournaments', page: Tournaments }, { path: '/reminders', page: Reminders },
  { path: '/team', page: Team }, { path: '/settings', page: Settings }, { path: '/platform', page: Platform }, { path: '/media', page: Media }, { path: '/cameras', page: Cameras }, { path: '/compliance', page: Compliance },
  { path: '/calendar', page: Calendar }, { path: '/money', page: MoneyFlow }, { path: '/pipeline', page: Pipeline }, { path: '/activity', page: Activity }, { path: '/close', page: CloseWizard }, { path: '/compare', page: Compare }, { path: '/health', page: Health }, { path: '/explore', page: Explorer },
];
export const HOME = Dashboard;

/** The menu: a few sections, each split into plain-language jobs with at most four pages under each.
 *  A page can sit under a job by its own address or by one of its sections (for example /bookings/day). Every page stays reachable. */
export const SECTIONS: { key: string; title: string; icon: string }[] = [
  { key: 'home', title: 'Home', icon: 'dashboard' },
  { key: 'ground', title: 'Ground', icon: 'ball' },
  { key: 'people', title: 'People', icon: 'users' },
  { key: 'money', title: 'Money', icon: 'accounts' },
  { key: 'settings', title: 'Settings', icon: 'settings' },
];
const books = { perm: 'view_revenue' }, acct = { perm: 'manage_accounting' }, owner = { ownerOnly: true };
export const NAV: NavGroup[] = [
  { section: 'home', group: 'Home', items: [{ to: '/', label: 'Home', icon: 'dashboard' }] },

  { section: 'ground', group: 'Take bookings', items: [
    { to: '/bookings', label: 'All bookings', icon: 'list', perm: 'manage_bookings' },
    { to: '/bookings/day', label: 'Day view', icon: 'calendar', perm: 'manage_bookings' },
    { to: '/bookings/approvals', label: 'Bookings to approve', icon: 'check', perm: 'manage_bookings' },
    { to: '/bookings/payments', label: 'UPI to verify', icon: 'payments', perm: 'manage_bookings' },
  ] },
  { section: 'ground', group: 'Fill the ground', items: [
    { to: '/memberships', label: 'Memberships', icon: 'card', perm: 'manage_bookings' },
    { to: '/promos', label: 'Promo codes', icon: 'tag', ...owner },
    { to: '/tournaments', label: 'Tournaments', icon: 'trophy', perm: 'manage_matches' },
    { to: '/matches', label: 'Matches', icon: 'ball', perm: 'manage_matches' },
  ] },
  { section: 'ground', group: 'Keep an eye on it', items: [
    { to: '/calendar', label: 'Calendar', icon: 'calendar' },
    { to: '/activity', label: 'What happened', icon: 'bell' },
    { to: '/health', label: 'Ground health', icon: 'pulse' },
    { to: '/cameras', label: 'Live cameras', icon: 'camera', perm: 'view_cameras' },
  ] },

  { section: 'people', group: 'Talk to customers', items: [
    { to: '/contacts', label: 'Contacts', icon: 'users', perm: 'view_customers' },
    { to: '/reminders', label: 'WhatsApp reminders', icon: 'chat', perm: 'send_broadcasts' },
    { to: '/cards', label: 'Business cards', icon: 'card', perm: 'view_customers' },
    { to: '/explore', label: 'Look anything up', icon: 'search' },
  ] },
  { section: 'people', group: 'Run the academy', items: [
    { to: '/academy', label: 'Students', icon: 'users', perm: 'manage_academy' },
    { to: '/academy/attendance', label: 'Attendance', icon: 'clock', perm: 'manage_academy' },
    { to: '/academy/fees', label: 'Fees', icon: 'payroll', perm: 'manage_academy' },
    { to: '/academy/coaches', label: 'Coaches and skills', icon: 'grad', perm: 'manage_academy' },
  ] },
  { section: 'people', group: 'Look after the team', items: [
    { to: '/tasks', label: 'Jobs to do', icon: 'tasks', perm: 'manage_tasks' },
    { to: '/payroll/attendance', label: 'Staff attendance', icon: 'clock', ...owner },
    { to: '/team', label: 'Users & Access', icon: 'shield', ...owner },
  ] },

  { section: 'money', group: 'Buy & pay', items: [
    { to: '/bills', label: 'Bills', icon: 'billing', ...acct },
    { to: '/approvals', label: 'Approvals', icon: 'check', ...acct, count: 'approvals' },
    { to: '/bills/vendors', label: 'Vendors', icon: 'warehouse', ...acct },
    { to: '/pipeline', label: 'Where things are', icon: 'list', check: (me) => seesMoney(me) || can(me, 'manage_bookings') },
  ] },
  { section: 'money', group: 'Check the money', items: [
    { to: '/money', label: 'Money flow', icon: 'swap', check: seesMoney },
    { to: '/transactions', label: 'Bank and cash lines', icon: 'swap', ...acct },
    { to: '/bank', label: 'Bank import', icon: 'upload', ...acct },
    { to: '/accounting/reconcile', label: 'Reconcile', icon: 'check', ...books },
  ] },
  { section: 'money', group: 'See results', items: [
    { to: '/accounting', label: 'Overview', icon: 'dashboard', ...books },
    { to: '/accounting/reports', label: 'Reports', icon: 'accounts', ...books },
    { to: '/compare', label: 'Compare', icon: 'pie', check: (me) => seesMoney(me) || can(me, 'manage_bookings') },
    { to: '/accounting/budget', label: 'Budget', icon: 'pie', ...books },
  ] },
  { section: 'money', group: 'Close the month', items: [
    { to: '/close', label: 'Month-end, step by step', icon: 'lock', check: seesMoney },
    { to: '/payroll', label: 'Payroll', icon: 'payroll', ...owner },
    { to: '/accounting/gst', label: 'GST', icon: 'percent', ...books },
    { to: '/accounting/review', label: 'Books review', icon: 'audit', ...books },
  ] },

  { section: 'settings', group: 'Set up the ground', items: [
    { to: '/settings', label: 'Prices and timings', icon: 'tag', ...owner },
    { to: '/settings/booking', label: 'Booking window', icon: 'calendar', ...owner },
    { to: '/settings/payments', label: 'Payments', icon: 'payments', ...owner },
    { to: '/settings/website', label: 'Website', icon: 'globe', ...owner },
  ] },
  { section: 'settings', group: 'Connect and share', items: [
    { to: '/settings/people', label: 'People', icon: 'users', ...owner },
    { to: '/settings/connections', label: 'Connections', icon: 'key', ...owner },
    { to: '/settings/services', label: 'Services', icon: 'plug', ...owner },
    { to: '/media', label: 'Photos & videos', icon: 'upload', ...owner },
  ] },
  { section: 'settings', group: 'Keep it safe', items: [
    { to: '/compliance', label: 'Compliance', icon: 'audit', ...owner },
    { to: '/settings/backups', label: 'Backups', icon: 'vault', ...owner },
    { to: '/platform', label: 'Software owner', icon: 'vault', superOnly: true },
  ] },
];
/** The menu item for an address: the longest item address that the address starts with. */
export const itemFor = (route: string, items: NavItem[]): NavItem | undefined => {
  const r = route || '/';
  return items.filter((i) => (i.to === '/' ? r === '/' : r === i.to || r.startsWith(i.to + '/'))).sort((a, b) => b.to.length - a.to.length)[0];
};

/** One symbol for every page inside a group, keyed "path:key" (the same keys as SUBS). */
export const SUB_ICONS: Record<string, string> = {
  '/bookings:': 'list', '/bookings:day': 'calendar', '/bookings:approvals': 'check', '/bookings:payments': 'payments',
  '/academy:students': 'users', '/academy:attendance': 'clock', '/academy:fees': 'payroll', '/academy:skills': 'star', '/academy:coaches': 'grad',
  '/accounting:overview': 'dashboard', '/accounting:review': 'audit', '/accounting:reports': 'accounts', '/accounting:reconcile': 'swap', '/accounting:recurring': 'repeat',
  '/accounting:journals': 'book', '/accounting:cashflow': 'payments', '/accounting:budget': 'pie', '/accounting:gst': 'percent', '/accounting:assets': 'warehouse', '/accounting:close': 'lock', '/accounting:setup': 'settings',
  '/settings:prices': 'tag', '/settings:booking': 'calendar', '/settings:payments': 'payments', '/settings:website': 'globe', '/settings:backups': 'vault', '/settings:people': 'users', '/settings:connections': 'key', '/settings:services': 'plug',
  '/bills:': 'billing', '/bills:vendors': 'warehouse',
  '/compliance:rules': 'audit', '/compliance:changes': 'book', '/compliance:gst': 'percent', '/compliance:terms': 'shield',
  '/payroll:run': 'payroll', '/payroll:attendance': 'clock', '/payroll:advances': 'swap', '/payroll:staff': 'users',
  '/memberships:': 'users', '/memberships:expiring': 'bell', '/memberships:plans': 'tag', '/memberships:activity': 'list',
  '/reminders:': 'inbox', '/reminders:templates': 'edit', '/reminders:one': 'chat', '/reminders:history': 'clock',
  '/platform:requests': 'inbox', '/platform:people': 'users', '/platform:settings': 'settings', '/platform:connections': 'key', '/platform:bank': 'bank', '/platform:services': 'plug', '/platform:refunds': 'swap', '/platform:costs': 'billing',
};
