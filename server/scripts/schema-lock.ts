// Records the checksum of every schema module in schema.lock.json. A released module is never run again on a
// database that already has it, so editing one silently splits the live schema from a fresh one; the lock lets
// test/schema-lock.test.ts catch that in CI.
//   node scripts/schema-lock.ts           add the modules that are new (run this after adding a registerSchema call)
//   node scripts/schema-lock.ts --check   only report, change nothing
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadSchemaModules, compareLock, LOCK_PATH } from './schema-modules.ts';

const current = await loadSchemaModules();
const lock: Record<string, string> = existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, 'utf8')) : {};
const { added, changed, removed } = compareLock(lock, current);
for (const id of changed) console.error(`changed after release: ${id} (add a new schema module instead; the lock is not updated for it)`);
for (const id of removed) console.error(`removed: ${id} (existing databases still have it; keep the registration)`);
if (process.argv.includes('--check')) {
  for (const id of added) console.log(`new, not in the lock yet: ${id}`);
  process.exit(added.length || changed.length || removed.length ? 1 : 0);
}
const next = { ...lock };
for (const id of added) next[id] = current[id]!;
writeFileSync(LOCK_PATH, JSON.stringify(Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
console.log(added.length ? `added ${added.length}: ${added.join(', ')}` : 'nothing new');
process.exit(changed.length || removed.length ? 1 : 0);
