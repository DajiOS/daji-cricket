// Every phone number the suite shows carries its country code (Sunny, 28 Oct 2026). Indian numbers are stored as their 10 digits,
// so they are shown with +91; a number from another country is stored with its own +code and shown as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatPhone } from '@daji/shared';

test('formatPhone: +91 for Indian numbers, others keep their own code', () => {
  assert.equal(formatPhone('9510508030'), '+91 95105 08030');
  assert.equal(formatPhone('919510508030'), '+91 95105 08030');
  assert.equal(formatPhone('+919510508030'), '+91 95105 08030');
  assert.equal(formatPhone('+91 95105 08030'), '+91 95105 08030');
  assert.equal(formatPhone('09510508030'), '+91 95105 08030');
  assert.equal(formatPhone('+447911123456'), '+447911123456');
  assert.equal(formatPhone('+1 415 555 2671'), '+1 415 555 2671');
  assert.equal(formatPhone(''), '');
  assert.equal(formatPhone(null), '');
  assert.equal(formatPhone(undefined), '');
});

test('the desk, the website and the app use the same rule as shared/src/money.ts', () => {
  const body = (src: string) => /function formatPhone\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src)?.[1]?.trim();
  const shared = body(readFileSync(new URL('../../shared/src/money.ts', import.meta.url), 'utf8'));
  assert.ok(shared);
  for (const f of ['../../desk/src/lib.ts', '../../web/public/app.js', '../../mobile/src/theme.ts']) {
    assert.equal(body(readFileSync(new URL(f, import.meta.url), 'utf8')), shared, f);
  }
});
