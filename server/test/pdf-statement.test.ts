import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPdfStatement } from '../src/accounting/pdfstatement.ts';

const pdf = readFileSync(new URL('./fixtures/bank-statement.pdf', import.meta.url));

test('PDF statement: rows, wrapped narration and balance check', async () => {
  const t = performance.now();
  const r = await readPdfStatement(pdf);
  assert.ok(performance.now() - t < 3000, 'reads fast');
  assert.equal(r.source, 'pdf');
  assert.equal(r.rows.length, 40);
  assert.equal(r.reconcile.mismatched, 0);
  assert.equal(r.reconcile.order, 'oldest-first');
  assert.equal(r.reconcile.openingPaise, 10000000);
  assert.deepEqual([r.rows[0]!.date, r.rows[0]!.amountPaise, r.rows[0]!.balancePaise], ['2024-04-02', -120000, 9880000]);
  assert.equal(r.rows[1]!.amountPaise, 1500000);
  // the bank breaks lines mid-word; the pieces are rejoined
  assert.equal(r.rows[0]!.description, 'UPI/111122223333/10:00:00/DEBIT 111122223333 TEA STALL');
  assert.ok(r.skipped.every((s) => /Opening balance/.test(s.reason)));
});

test('PDF statement: not a PDF and no table are refused clearly', async () => {
  await assert.rejects(readPdfStatement(Buffer.from('%PDF-1.4 nonsense')), (e: any) => e.code === 'PDF_UNREADABLE');
  await assert.rejects(readPdfStatement(Buffer.alloc(0)), (e: any) => e.code === 'EMPTY_FILE');
});
