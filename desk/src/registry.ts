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

/** "daily" groups sit under Every day at the top of the menu, the rest under Departments (the starter kit's split). */
export interface NavGroup { group: string; items: NavItem[]; part?: 'daily' }
export const PART_TITLES = { daily: 'Every day', dept: 'Departments' } as const;

/** First match wins, so longer paths come before shorter ones. A page receives the rest of the path in `sub` (for example /bills/bil_123 gives sub "bil_123"). */
export const PAGES: { path: string; page: ComponentType<{ sub: string }> }[] = [
  { path: '/bookings', page: Bookings }, { path: '/promos', page: Promos }, { path: '/tasks', page: Tasks }, { path: '/matches', page: Matches },
  { path: '/cards', page: Cards }, { path: '/contacts', page: Contacts }, { path: '/academy', page: Academy },
  { path: '/accounting', page: Accounting }, { path: '/transactions', page: Transactions }, { path: '/bank', page: BankImport },
  { path: '/approvals', page: Approvals }, { path: '/bills', page: Bills }, { path: '/payroll', page: Payroll },
  { path: '/memberships', page: Memberships }, { path: '/tournaments', page: Tournaments }, { path: '/reminders', page: Reminders },
  { path: '/team', page: Team }, { path: '/settings', page: Settings }, { path: '/platform', page: Platform }, { path: '/media', page: Media }, { path: '/cameras', page: Cameras }, { path: '/compliance', page: Compliance },
  { path: '/calendar', page: Calendar }, { path: '/money', page: MoneyFlow }, { path: '/pipeline', page: Pipeline }, { path: '/activity', page: Activity }, { path: '/close', page: CloseWizard }, { path: '/compare', page: Compare }, { path: '/health', page: Health },
];
export const HOME = Dashboard;

export const NAV: NavGroup[] = [
  { group: 'Portfolio', part: 'daily', items: [{ to: '/', label: 'Dashboard', icon: 'dashboard' }] },
  { group: 'Views', part: 'daily', items: [
    { to: '/health', label: 'Ground health', icon: 'pulse' },
    { to: '/calendar', label: 'Operations calendar', icon: 'calendar' },
    { to: '/money', label: 'Money flow', icon: 'swap', check: seesMoney },
    { to: '/pipeline', label: 'Pipeline', icon: 'list', check: (me) => seesMoney(me) || can(me, 'manage_bookings') },
    { to: '/activity', label: 'Activity', icon: 'bell' },
    { to: '/close', label: 'Month-end close', icon: 'lock', check: seesMoney },
    { to: '/compare', label: 'Compare', icon: 'pie', check: (me) => seesMoney(me) || can(me, 'manage_bookings') },
  ] },
  { group: 'Task Management', part: 'daily', items: [{ to: '/tasks', label: 'Tasks', icon: 'tasks', perm: 'manage_tasks' }] },
  { group: 'Ground', items: [
    { to: '/bookings', label: 'Bookings', icon: 'calendar', perm: 'manage_bookings' },
    { to: '/promos', label: 'Promo codes', icon: 'tag', ownerOnly: true },
    { to: '/matches', label: 'Matches', icon: 'ball', perm: 'manage_matches' },
    { to: '/memberships', label: 'Memberships', icon: 'card', perm: 'manage_bookings' },
    { to: '/tournaments', label: 'Tournaments', icon: 'trophy', perm: 'manage_matches' },
  ] },
  { group: 'Ground cameras', items: [{ to: '/cameras', label: 'Live cameras', icon: 'camera', perm: 'view_cameras' }] },
  { group: 'People & Messages', items: [
    { to: '/contacts', label: 'Contacts', icon: 'users', perm: 'view_customers' },
    { to: '/cards', label: 'Business cards', icon: 'card', perm: 'view_customers' },
    { to: '/reminders', label: 'WhatsApp reminders', icon: 'chat', perm: 'send_broadcasts' },
  ] },
  { group: 'MP13 Academy', items: [{ to: '/academy', label: 'MP13 Academy', icon: 'grad', perm: 'manage_academy' }] },
  { group: 'Finance', items: [
    { to: '/approvals', label: 'Approvals', icon: 'check', perm: 'manage_accounting', count: 'approvals' },
    { to: '/bills', label: 'Bills', icon: 'billing', perm: 'manage_accounting' },
    { to: '/transactions', label: 'Transactions', icon: 'swap', perm: 'manage_accounting' },
    { to: '/bank', label: 'Bank import', icon: 'upload', perm: 'manage_accounting' },
    { to: '/accounting', label: 'Accounting', icon: 'accounts', perm: 'view_revenue' },
    { to: '/payroll', label: 'Staff & payroll', icon: 'payroll', ownerOnly: true },
  ] },
  { group: 'Settings', items: [
    { to: '/team', label: 'Users & Access', icon: 'shield', ownerOnly: true },
    { to: '/media', label: 'Photos & videos', icon: 'upload', ownerOnly: true },
    { to: '/compliance', label: 'Compliance', icon: 'audit', ownerOnly: true },
    { to: '/settings', label: 'Settings', icon: 'settings', ownerOnly: true },
    { to: '/platform', label: 'Platform', icon: 'vault', superOnly: true },
  ] },
];

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
