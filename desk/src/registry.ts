// The desk's menu and routes in one place. To add a page: create src/pages/<Name>.tsx that exports a default component, then add one line to PAGES and one to NAV.
import type { ComponentType } from 'react';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Promos from './pages/Promos';
import Tasks from './pages/Tasks';
import Matches from './pages/Matches';
import Contacts from './pages/Contacts';
import Academy from './pages/Academy';
import Accounting from './pages/Accounting';
import Transactions from './pages/Transactions';
import BankImport from './pages/BankImport';
import Approvals from './pages/Approvals';
import Bills from './pages/Bills';
import Payroll from './pages/Payroll';
import Memberships from './pages/Memberships';
import Tournaments from './pages/Tournaments';
import Reminders from './pages/Reminders';
import Team from './pages/Team';
import Settings from './pages/Settings';
import Platform from './pages/Platform';

export interface NavItem { to: string; label: string; icon: string; perm?: string; ownerOnly?: boolean; superOnly?: boolean; count?: 'approvals' }
/** The sections inside a page (the pills at its top), so the side menu can list them too. The first one is the page's own address. */
export const SUBS: Record<string, [string, string][]> = {
  '/bookings': [['', 'All bookings'], ['day', 'Day view'], ['approvals', 'Approvals'], ['payments', 'UPI to verify']],
  '/academy': [['students', 'Students'], ['attendance', 'Attendance'], ['fees', 'Fees'], ['skills', 'Skills'], ['coaches', 'Coaches']],
  '/accounting': [['overview', 'Overview'], ['review', 'Books review'], ['reports', 'Reports'], ['reconcile', 'Reconcile'], ['recurring', 'Recurring'], ['journals', 'Journals'], ['cashflow', 'Cash flow'], ['budget', 'Budget'], ['gst', 'GST'], ['assets', 'Fixed assets'], ['close', 'Month-end'], ['setup', 'Setup']],
  '/settings': [['prices', 'Prices and timings'], ['booking', 'Booking window'], ['payments', 'Payments'], ['website', 'Website'], ['backups', 'Backups'], ['people', 'People'], ['connections', 'Connections'], ['services', 'Services']],
  '/platform': [['requests', 'Owner requests'], ['people', 'People'], ['settings', 'Platform settings'], ['connections', 'Connections'], ['bank', 'Bank connection'], ['services', 'Services'], ['costs', 'Software costs']],
};
export const subHref = (to: string, k: string): string => (k ? `${to}/${k}` : to);

export interface NavGroup { group: string; items: NavItem[] }

/** First match wins, so longer paths come before shorter ones. A page receives the rest of the path in `sub` (for example /bills/bil_123 gives sub "bil_123"). */
export const PAGES: { path: string; page: ComponentType<{ sub: string }> }[] = [
  { path: '/bookings', page: Bookings }, { path: '/promos', page: Promos }, { path: '/tasks', page: Tasks }, { path: '/matches', page: Matches },
  { path: '/contacts', page: Contacts }, { path: '/academy', page: Academy },
  { path: '/accounting', page: Accounting }, { path: '/transactions', page: Transactions }, { path: '/bank', page: BankImport },
  { path: '/approvals', page: Approvals }, { path: '/bills', page: Bills }, { path: '/payroll', page: Payroll },
  { path: '/memberships', page: Memberships }, { path: '/tournaments', page: Tournaments }, { path: '/reminders', page: Reminders },
  { path: '/team', page: Team }, { path: '/settings', page: Settings }, { path: '/platform', page: Platform },
];
export const HOME = Dashboard;

export const NAV: NavGroup[] = [
  { group: 'Portfolio', items: [{ to: '/', label: 'Dashboard', icon: 'dashboard' }] },
  { group: 'Ground', items: [
    { to: '/bookings', label: 'Bookings', icon: 'calendar', perm: 'manage_bookings' },
    { to: '/promos', label: 'Promo codes', icon: 'tag', ownerOnly: true },
    { to: '/tasks', label: 'Tasks', icon: 'tasks', perm: 'manage_tasks' },
    { to: '/matches', label: 'Matches', icon: 'ball', perm: 'manage_matches' },
    { to: '/contacts', label: 'Contacts', icon: 'users', perm: 'view_customers' },
  ] },
  { group: 'MP13 Academy', items: [{ to: '/academy', label: 'MP13 Academy', icon: 'grad', perm: 'manage_academy' }] },
  { group: 'Members & Events', items: [
    { to: '/memberships', label: 'Memberships', icon: 'card', perm: 'manage_bookings' },
    { to: '/tournaments', label: 'Tournaments', icon: 'trophy', perm: 'manage_matches' },
  ] },
  { group: 'Finance', items: [
    { to: '/approvals', label: 'Approvals', icon: 'check', perm: 'manage_accounting', count: 'approvals' },
    { to: '/bills', label: 'Bills', icon: 'billing', perm: 'manage_accounting' },
    { to: '/transactions', label: 'Transactions', icon: 'swap', perm: 'manage_accounting' },
    { to: '/bank', label: 'Bank import', icon: 'upload', perm: 'manage_accounting' },
    { to: '/accounting', label: 'Accounting', icon: 'accounts', perm: 'view_reports' },
  ] },
  { group: 'People & Messages', items: [
    { to: '/payroll', label: 'Staff & payroll', icon: 'payroll', ownerOnly: true },
    { to: '/reminders', label: 'WhatsApp reminders', icon: 'chat', perm: 'send_broadcasts' },
  ] },
  { group: 'Administration', items: [
    { to: '/team', label: 'Users & Access', icon: 'shield', ownerOnly: true },
    { to: '/settings', label: 'Settings', icon: 'settings', ownerOnly: true },
    { to: '/platform', label: 'Platform', icon: 'vault', superOnly: true },
  ] },
];
