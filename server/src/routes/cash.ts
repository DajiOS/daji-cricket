import { Router, ok, created } from '../http.ts';
import type { Reply } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { aiConfigured } from '../config.ts';
import { MAX_RECEIPT_BYTES, addExpense, attachReceipt, countCash, giveOrTakeBack, hideEntry, holdersToPick, listEntries, listWallets, readReceipt, receiptFile, withdrawExpense } from '../cashbook.ts';

// Supervisor Cash (cashbook.ts): the owner hands out cash, the holder enters spends with receipts, the owner signs them on
// the Approvals board, and counts are kept against what was expected.
export function cashRoutes(r: Router): void {
  const TEAM = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };
  const FILE = { ...TEAM, maxBody: MAX_RECEIPT_BYTES + 1024, upload: 'cash_receipt' };
  const o = (c: Parameters<Parameters<Router['get']>[1]>[0], what: string) => ownerOrFail(c, what);

  r.get('/api/cash/status', (c) => ok({ ocr: aiConfigured(c.cfg) }), TEAM);
  r.get('/api/cash/wallets', (c) => ok(listWallets(U(c), o(c, 'see the cash'))), TEAM);
  r.get('/api/cash/people', (c) => ok(holdersToPick(U(c), o(c, 'hand out cash'))), TEAM);
  r.get('/api/cash/wallets/:holderId/entries', (c) => ok(listEntries(U(c), o(c, 'see the cash'), c.params.holderId!, c.query.get('queue'))), TEAM);
  r.post('/api/cash/advances', (c) => created(giveOrTakeBack(U(c), o(c, 'hand out cash'), 'advance', c.json())), TEAM);
  r.post('/api/cash/returns', (c) => created(giveOrTakeBack(U(c), o(c, 'take cash back'), 'return', c.json())), TEAM);
  r.post('/api/cash/expenses', (c) => created(addExpense(U(c), o(c, 'enter a spend'), c.json())), TEAM);
  r.post('/api/cash/expenses/:id/withdraw', (c) => ok(withdrawExpense(U(c), o(c, 'take a spend back'), c.params.id!)), TEAM);
  r.post('/api/cash/entries/:id/hide', (c) => ok(hideEntry(U(c), o(c, 'hide a cash entry'), c.params.id!, c.json())), TEAM);
  r.post('/api/cash/counts', (c) => created(countCash(U(c), o(c, 'count the cash'), c.json())), TEAM);

  // POST the photo as the request body. Reading returns a draft to check; nothing is saved until the spend is entered.
  r.post('/api/cash/receipts/read', async (c) => ok(await readReceipt(c.cfg, U(c), o(c, 'read a receipt'), c.raw)), FILE);
  r.post('/api/cash/entries/:id/receipt', (c) => ok(attachReceipt(c.cfg.dataDir, U(c), o(c, 'attach a receipt'), c.params.id!, c.raw)), FILE);
  r.get('/api/cash/entries/:id/receipt', (c): Reply => {
    const f = receiptFile(c.cfg.dataDir, U(c), o(c, 'see a receipt'), c.params.id!);
    return { status: 200, raw: f.buf, contentType: f.mime, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } };
  }, TEAM);
}
