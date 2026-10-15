import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => h.reset());

test('Instagram link and gallery photos are set by the admin and shown in the public config', async () => {
  const admin = await h.login('admin');
  const empty = (await h.get('/api/config')).body;
  assert.equal(empty.instagramUrl, 'https://www.instagram.com/dajicricketground/', 'the ground’s own page is the default'); assert.deepEqual(empty.gallery, []);
  const ok = await h.put('/api/admin/settings', { instagramUrl: 'https://www.instagram.com/dajicricketground/', galleryImages: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] }, admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const cfg = (await h.get('/api/config')).body;
  assert.equal(cfg.instagramUrl, 'https://www.instagram.com/dajicricketground/');
  assert.deepEqual(cfg.gallery, ['https://example.com/a.jpg', 'https://example.com/b.jpg']);
  assert.equal((await h.put('/api/admin/settings', { instagramUrl: '' }, admin)).status, 200);
  assert.equal((await h.get('/api/config')).body.instagramUrl, null, 'empty hides the button');
});

test('only real Instagram and https photo links are accepted, and only the admin can change them', async () => {
  const admin = await h.login('admin'), owner = await h.login('owner1');
  for (const bad of ['http://www.instagram.com/x', 'https://evil.com/instagram.com/x', 'javascript:alert(1)', 'https://instagram.com.evil.com/x']) {
    assert.equal((await h.put('/api/admin/settings', { instagramUrl: bad }, admin)).status, 400, bad);
  }
  for (const bad of [['http://x.com/a.jpg'], ['javascript:alert(1)'], 'nope', Array(25).fill('https://x.com/a.jpg')]) {
    assert.equal((await h.put('/api/admin/settings', { galleryImages: bad }, admin)).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal((await h.put('/api/admin/settings', { instagramUrl: 'https://www.instagram.com/x/' }, await h.login('staff1'))).status, 403);
  assert.equal((await h.put('/api/admin/settings', { instagramUrl: 'https://www.instagram.com/x/' }, owner)).status, 200);
});
