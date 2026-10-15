import { one } from './db.ts';
import { createUser, userByEmail } from './auth.ts';
import { createGround } from './grounds.ts';
import { run } from './db.ts';
import type { Config } from './config.ts';
import { updateSettings } from './settings.ts';

export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@daji.test', password: 'Admin@12345' },
  owner1: { email: 'owner1@daji.test', password: 'Owner@12345' },
  owner2: { email: 'owner2@daji.test', password: 'Owner@12345' },
  staff1: { email: 'staff1@daji.test', password: 'Staff@12345' },
  customer: { email: 'customer@daji.test', password: 'Customer@12345' },
} as const;

/**
 * Where Daji Cricket Ground is, from the Google Maps link the owner sent (https://maps.app.goo.gl/Qs2Wivwv76jt9zjG7).
 * The street address is not known yet: the owner can type it into the ground's settings.
 */
export const DAJI_LOCATION = { lat: 21.1818855, lng: 72.9134859, mapUrl: 'https://maps.app.goo.gl/Qs2Wivwv76jt9zjG7' } as const;

/**
 * Demo data with well-known passwords. It refuses to run unless DEMO_MODE is on, which defaults to off for any real domain.
 */
export function seedDemo(cfg: Config): { created: boolean } {
  if (!cfg.demoMode) throw new Error('Refusing to create demo accounts: DEMO_MODE is off');
  if (one('SELECT 1 FROM users LIMIT 1')) return { created: false };
  createUser({ role: 'super_admin', name: 'Platform Admin', email: DEMO_ACCOUNTS.admin.email, phone: '9000000001', password: DEMO_ACCOUNTS.admin.password });
  const o1 = createUser({ role: 'owner', name: 'Daji Owner', email: DEMO_ACCOUNTS.owner1.email, phone: '9000000002', password: DEMO_ACCOUNTS.owner1.password, businessName: 'Daji Cricket Ground', upiId: 'dajicricket@okhdfcbank' });
  const o2 = createUser({ role: 'owner', name: 'Riverside Owner', email: DEMO_ACCOUNTS.owner2.email, phone: '9000000003', password: DEMO_ACCOUNTS.owner2.password, businessName: 'Riverside Sports', upiId: 'riverside@oksbi' });
  createUser({ role: 'staff', name: 'Ground Staff', email: DEMO_ACCOUNTS.staff1.email, phone: '9000000004', password: DEMO_ACCOUNTS.staff1.password, ownerId: o1.id, permissions: ['manage_bookings', 'verify_payments', 'record_payments', 'manage_enquiries', 'view_customers'] });
  createUser({ role: 'customer', name: 'Demo Customer', email: DEMO_ACCOUNTS.customer.email, phone: '9876543210', password: DEMO_ACCOUNTS.customer.password });

  createGround(o1.id, { name: 'Cricket Ground', city: 'Surat', ...DAJI_LOCATION, description: 'Full-size turf wicket with floodlights for evening matches.', facilities: ['Floodlights', 'Changing rooms', 'Parking', 'Drinking water', 'Scoreboard'], surface: 'Turf wicket', openTime: '06:00', closeTime: '23:00', slotMinutes: 60, pricePaise: 180000, weekendPricePaise: 220000, eveningSurchargePaise: 40000, eveningFrom: '18:00', maxSlots: 6 });
  createGround(o1.id, { name: 'Practice Nets', city: 'Surat', ...DAJI_LOCATION, description: 'Four practice nets with bowling machine on request.', facilities: ['Floodlights', 'Parking'], surface: 'Matting nets', openTime: '06:00', closeTime: '22:00', slotMinutes: 60, pricePaise: 60000, maxSlots: 4 });
  createGround(o2.id, { name: 'Riverside Box Cricket', city: 'Vadodara', area: 'Gotri', address: 'Gotri, Vadodara, Gujarat', description: 'Box-cricket turf by the river.', facilities: ['Floodlights', 'Parking'], surface: 'Synthetic turf', openTime: '07:00', closeTime: '23:00', slotMinutes: 60, pricePaise: 150000, weekendPricePaise: 180000, maxSlots: 5 });
  updateSettings({ upiId: 'dajicricket@okhdfcbank' }, null);
  run("UPDATE settings SET updated_by = NULL");
  return { created: true };
}

export const hasAdmin = (): boolean => !!one("SELECT 1 FROM users WHERE role = 'super_admin' AND active = 1 AND password_hash IS NOT NULL");
export { userByEmail };
