import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { one } from '../src/db.ts';

let h: Harness;
before(async () => { h = await startHarness({ FIELD_KEY: 'a-long-test-field-key-0123456789' }); });
after(async () => { await h.close(); });

test('a staff member\'s PAN is encrypted in the database and shown plainly to the owner', async () => {
  const owner = await h.login('owner1');
  const r = await h.post('/api/accounting/payroll/staff', { name: 'Ravi', role: 'Groundsman', payType: 'monthly', ratePaise: 2000000, joinedOn: '2020-01-01', pan: 'abcde1234f' }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.pan, 'ABCDE1234F');
  const raw = one<{ pan: string }>('SELECT pan FROM payroll_staff WHERE id = ?', r.body.id)!.pan;
  assert.ok(raw.startsWith('enc1:') && !raw.includes('ABCDE'), raw);
  const list = await h.get('/api/accounting/payroll/staff', owner);
  assert.equal(list.body.items.find((x: { id: string }) => x.id === r.body.id).pan, 'ABCDE1234F');
});
