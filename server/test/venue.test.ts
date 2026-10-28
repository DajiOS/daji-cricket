import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, setNow, HOUR, type Harness, type GroundLite } from './helpers.ts';
import { cleanMapUrl, directionsUrl } from '../src/grounds.ts';
import { runSweeps } from '../src/jobs.ts';
import { DAJI_LOCATION } from '../src/seed.ts';
import { many, one, registeredSchemaIds } from '../src/db.ts';
import { BRAND } from '@daji/shared';

let h: Harness;
let g: GroundLite;
let owner: string;
let admin: string;
let cust: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  owner = await h.login('owner1');
  admin = await h.login('admin');
  cust = await h.login('customer');
});

const MAP = 'https://maps.app.goo.gl/wGawo7LdNzKT8k4Y9';

// ------------------------------------------------------------------ the map link

test('only real Google Maps links are accepted', () => {
  for (const ok of [
    MAP,
    'https://www.google.com/maps/place/Daji+Cricket+Ground/@21.18,72.91,17z',
    'https://google.com/maps?q=21.18,72.91',
    'https://maps.google.com/?q=21.18,72.91',
    'https://goo.gl/maps/abc123',
    '  https://maps.app.goo.gl/wGawo7LdNzKT8k4Y9  ',
  ]) assert.ok(cleanMapUrl(ok), `should accept ${ok}`);
  for (const bad of [
    'http://maps.app.goo.gl/wGawo7LdNzKT8k4Y9', // not https
    'https://maps.app.goo.gl/', // no place in it
    'https://maps.app.goo.gl.evil.com/abc',
    'https://evil.com/?u=maps.app.goo.gl/abc',
    'https://evil.com/maps/abc',
    'https://www.google.com/search?q=cricket', // Google, but not a map
    'https://goo.gl/abc', // a different Google short-link service
    'https://user:pw@maps.app.goo.gl/abc',
    'https://maps.app.goo.gl:8443/abc',
    'javascript:alert(1)',
    'maps.app.goo.gl/abc',
    '',
  ]) assert.equal(cleanMapUrl(bad), null, `should refuse ${bad}`);
});

test('the Daji grounds are where the owner pinned them, and "Get directions" opens that link', async () => {
  const r = await h.get(`/api/grounds/${g.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.lat, DAJI_LOCATION.lat);
  assert.equal(r.body.lng, DAJI_LOCATION.lng);
  assert.equal(r.body.mapUrl, MAP);
  assert.equal(r.body.directionsUrl, MAP);
  assert.equal(r.body.city, 'Surat');
  assert.equal(r.body.address, null, 'the street address is not known, so none is invented');
  const all = (await h.get('/api/grounds')).body.items as { name: string; city: string }[];
  assert.ok(all.filter((x) => x.name.startsWith('Daji')).every((x) => x.city === 'Surat'));
});

test('without a map link, directions fall back to a pin at the coordinates, and to nothing without them', async () => {
  assert.equal(directionsUrl({ map_url: null, lat: 21.5, lng: 72.25 }), 'https://www.google.com/maps/search/?api=1&query=21.5,72.25');
  assert.equal(directionsUrl({ map_url: null, lat: null, lng: null }), null);
  const r = await h.post('/api/staff/grounds', { name: 'Pin Only', city: 'Surat', pricePaise: 50000, lat: 21.1, lng: 72.8 }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.mapUrl, null);
  assert.equal(r.body.directionsUrl, 'https://www.google.com/maps/search/?api=1&query=21.1,72.8');
});

test('an owner can change or remove the map link; a bad link is refused and nothing changes', async () => {
  const bad = await h.patch(`/api/staff/grounds/${g.id}`, { mapUrl: 'https://evil.example/maps/x' }, owner);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details.fields[0].field, 'mapUrl');
  assert.equal((await h.get(`/api/grounds/${g.id}`)).body.mapUrl, MAP);

  const set = await h.patch(`/api/staff/grounds/${g.id}`, { mapUrl: 'https://www.google.com/maps/place/Daji' }, owner);
  assert.equal(set.status, 200);
  assert.equal(set.body.mapUrl, 'https://www.google.com/maps/place/Daji');

  const other = await h.patch(`/api/staff/grounds/${g.id}`, { description: 'New text' }, owner);
  assert.equal(other.body.mapUrl, 'https://www.google.com/maps/place/Daji', 'an update that does not mention the link keeps it');

  const cleared = await h.patch(`/api/staff/grounds/${g.id}`, { mapUrl: null }, owner);
  assert.equal(cleared.body.mapUrl, null);
  assert.equal(cleared.body.directionsUrl, `https://www.google.com/maps/search/?api=1&query=${DAJI_LOCATION.lat},${DAJI_LOCATION.lng}`);
});

test('another owner cannot change the map link of a ground that is not theirs', async () => {
  const o2 = await h.login('owner2');
  const r = await h.patch(`/api/staff/grounds/${g.id}`, { mapUrl: MAP }, o2);
  assert.ok(r.status === 403 || r.status === 404, `got ${r.status}`);
});

test('the map_url column exists, added by a registered migration', () => {
  assert.ok(registeredSchemaIds().includes('grounds-map-url-1'));
  const cols = many<{ name: string }>("SELECT name FROM pragma_table_info('grounds')").map((c) => c.name);
  assert.ok(cols.includes('map_url'));
});

// ------------------------------------------------------------------ contact, academy and tagline

test('the public config carries the tagline, the contact person and the academy', async () => {
  const r = await h.get('/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.tagline, 'Project by Daji Parivar');
  assert.equal(BRAND.tagline, r.body.tagline, 'website, app and server read one tagline');
  assert.deepEqual(r.body.contact, { name: 'Hemanshu Patel', phone: '7567156000', email: 'dajicricket@gmail.com' });
  assert.equal(r.body.academy.name, 'MP13 Academy');
  assert.equal(r.body.academy.runBy, 'Munaf Patel');
  assert.equal(r.body.academy.brand, 'MP13');
  assert.match(r.body.academy.about, /MP13 Academy is associated with Daji Cricket Ground/);
  assert.match(r.body.academy.about, /MP13/);
});

test('the admin can change the contact details; they are checked and the change is audited', async () => {
  const bad = await h.put('/api/admin/settings', { contactPhone: '756715600', contactEmail: 'not-an-email', contactName: 'H', academyBrand: '' }, admin);
  assert.equal(bad.status, 400);
  const f = bad.body.error.details.fields.map((x: { field: string }) => x.field).sort();
  assert.deepEqual(f, ['academyBrand', 'contactEmail', 'contactName', 'contactPhone']);
  assert.equal((await h.get('/api/config')).body.contact.phone, '7567156000', 'a refused update changes nothing');

  const ok = await h.put('/api/admin/settings', { contactPhone: '+91 75671 56000', contactEmail: 'Hello@DajiCricket.com', contactName: 'Hemanshu Patel' }, admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const c = (await h.get('/api/config')).body.contact;
  assert.equal(c.phone, '7567156000', 'stored as 10 digits');
  assert.equal(c.email, 'hello@dajicricket.com');
  assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'settings.update' AND entity_id = 'contactEmail'"));
});

test('customers and staff cannot change the contact details (the owner and super admin can)', async () => {
  assert.equal((await h.put('/api/admin/settings', { contactName: 'Someone Else' }, await h.login('staff1'))).status, 403);
  assert.equal((await h.put('/api/admin/settings', { contactName: 'Someone Else' }, cust)).status, 403);
  assert.equal((await h.put('/api/admin/settings', { contactName: 'Someone Else' })).status, 401);
});

// ------------------------------------------------------------------ messages

const bodyOf = (bookingId: string, template: string): string =>
  one<{ body: string }>("SELECT body FROM notifications WHERE booking_id = ? AND template = ? AND channel = 'email'", bookingId, template)!.body;

test('the booking confirmation tells the customer how to get there and who to call', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  const text = bodyOf(b.id, 'booking_confirmed');
  assert.ok(text.includes(`Directions: ${MAP}`), text);
  assert.ok(text.includes('Call Hemanshu Patel on +91 75671 56000'), text);
});

test('the 24-hour reminder carries the same directions and contact', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  setNow(b.startAt - 23 * HOUR);
  assert.equal((await runSweeps(h.cfg)).reminders, 1);
  const text = bodyOf(b.id, 'booking_reminder');
  assert.ok(text.includes(`Directions: ${MAP}`), text);
  assert.ok(text.includes('+91 75671 56000'), text);
});

test('a ground with no location still gets a clean message, with just the contact', async () => {
  const o2 = await h.login('owner2');
  const riverside = (await grounds(h)).find((x) => x.name === 'Riverside Box Cricket')!;
  void o2;
  const b = await bookAndPay(h, cust, riverside.id, dayFromNow(3), '19:00', 1);
  const text = bodyOf(b.id, 'booking_confirmed');
  assert.ok(!text.includes('Directions:'), text);
  assert.ok(!/undefined|null/.test(text), text);
  assert.ok(text.includes('Call Hemanshu Patel on +91 75671 56000'), text);
});
