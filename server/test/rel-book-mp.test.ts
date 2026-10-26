import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { openDb, closeDb, many, one } from '../src/db.ts';
import { setNow, resetClock } from '../src/clock.ts';
import { seedDemo } from '../src/seed.ts';
import { createUser } from '../src/auth.ts';
import { updateSettings } from '../src/settings.ts';
import { listGrounds } from '../src/grounds.ts';
import { dayFromNow, slotStart, T0 } from './helpers.ts';
import { rel, ev } from './rel.ts';

// REL-BOOK-001 (multi-process half): separate operating-system processes racing for one slot on one database file. Only one may win.

const dir = mkdtempSync(join(tmpdir(), 'daji-mp-'));
const file = join(dir, 'race.db');
const PROCS = 8;
let groundId = '';
const emails: string[] = [];
before(() => {
  setNow(T0);
  openDb(file);
  const cfg = loadConfig({ PUBLIC_URL: 'http://localhost:4000', RATE_LIMIT: 'off', LOG: 'off', DEMO_MODE: 'on' });
  seedDemo(cfg);
  updateSettings({ requireApproval: false, bookingsOpenFrom: '', bookingsCloseFrom: '' }, null);
  for (let i = 0; i < PROCS; i++) {
    const email = `racer${i}@x.test`;
    createUser({ role: 'customer', name: `Racer ${i}`, email, phone: `97000000${String(i).padStart(2, '0')}`, password: 'Passw0rd!x' });
    emails.push(email);
  }
  groundId = listGrounds()[0]!.id;
});
after(() => { closeDb(); resetClock(); rmSync(dir, { recursive: true, force: true }); });

function child(email: string, startAt: number, date: string, time: string, slots: number): Promise<{ ok: boolean; bookingId?: string; code?: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('./fixtures/hold-child.ts', import.meta.url))], {
      env: { ...process.env, DB_FILE: file, TEST_NOW: String(T0), CUSTOMER_EMAIL: email, START_AT: String(startAt), GROUND_ID: groundId, DATE: date, TIME: time, SLOTS: String(slots) },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop()!)); } catch { reject(new Error(`child failed: ${out} ${err}`)); } });
  });
}

rel('REL-BOOK-001', 'separate processes racing for the same slot: exactly one booking exists afterwards', async () => {
  const date = dayFromNow(3);
  const startAt = Date.now() + 1500;
  const results = await Promise.all(emails.map((e) => child(e, startAt, date, '20:00', 1)));
  const wins = results.filter((r) => r.ok);
  const codes = results.filter((r) => !r.ok).map((r) => r.code);
  assert.equal(wins.length, 1, JSON.stringify(results));
  assert.ok(codes.every((c) => c === 'SLOT_TAKEN'), `losers got SLOT_TAKEN, got ${codes.join(',')}`);
  const slots = many('SELECT booking_id FROM booking_slots WHERE ground_id = ? AND slot_start = ?', groundId, slotStart(date, '20:00'));
  assert.equal(slots.length, 1);
  const held = one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE status = 'held' AND ground_id = ?", groundId)!.n;
  assert.equal(held, 1, 'the losers left no held booking behind');
  ev('processes', PROCS); ev('wins', wins.length); ev('loserCodes', codes); ev('slotRows', slots.length);
});

rel('REL-BOOK-001', 'overlapping multi-slot holds from separate processes never share a slot', async () => {
  const date = dayFromNow(4);
  const startAt = Date.now() + 1500;
  const spec: [string, number][] = [['17:00', 3], ['18:00', 3], ['19:00', 2], ['16:00', 2], ['20:00', 1], ['18:00', 1], ['17:00', 1], ['21:00', 1]];
  const results = await Promise.all(emails.map((e, i) => child(e, startAt, date, spec[i]![0], spec[i]![1])));
  const rows = many<{ slot_start: number; n: number }>('SELECT slot_start, COUNT(*) n FROM booking_slots WHERE ground_id = ? GROUP BY slot_start HAVING n > 1', groundId);
  assert.equal(rows.length, 0, 'no slot is held twice');
  const wonSlots = many<{ booking_id: string; c: number }>('SELECT booking_id, COUNT(*) c FROM booking_slots WHERE ground_id = ? AND slot_start >= ? GROUP BY booking_id', groundId, slotStart(date, '00:00'));
  // all-or-nothing: every winning booking holds exactly the number of slots it asked for
  for (const w of results.map((r, i) => ({ r, want: spec[i]![1] })).filter((x) => x.r.ok)) {
    assert.equal(wonSlots.find((x) => x.booking_id === w.r.bookingId)?.c, w.want);
  }
  for (const r of results.filter((x) => !x.ok)) assert.equal(r.code, 'SLOT_TAKEN');
  ev('winners', results.filter((r) => r.ok).length); ev('duplicateSlotRows', rows.length);
});
