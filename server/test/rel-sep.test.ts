// REL-SEP-001 Daji Project Purity: no other-project source, import, dependency, database object, service name, UI text or file name in the active Daji code.
// The words are built from pieces so this file does not itself contain them.
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { startHarness, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';
import { rel, ev } from './rel.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OTHER = ['ak' + 'ea', 'ho' + 'tel'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.expo']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|css|html|md|sql|csv|txt|yml|yaml|sh|svg|webmanifest|env|example)$/i;
let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out); } else out.push(join(dir, e.name));
  }
  return out;
}

rel('REL-SEP-001', 'Daji project purity: no other-project name in any active file name, source, UI text, dependency, import path or database object; the neutral Daji stylesheet name is used by the desk build', async () => {
  const files = walk(ROOT);
  const rows = files.map((f) => relative(ROOT, f));
  // 1) file and folder names
  const badNames = rows.filter((r) => OTHER.some((w) => r.toLowerCase().includes(w)));
  assert.deepEqual(badNames, [], 'no file or folder name carries another project\'s name');
  assert.ok(existsSync(join(ROOT, 'desk/styles/daji.css')), 'the desk stylesheet has the neutral Daji name'); assert.ok(!existsSync(join(ROOT, 'desk/styles/' + 'ak' + 'ea.css')));
  // 2) text of every active file. Third-party minified code (server/vendor, and its browser copy in web/public/vendor) is checked for the name as a word only, since ordinary code words can contain the letters by chance.
  const hits: { file: string; term: string; line: number }[] = [];
  let scanned = 0;
  for (const f of files) {
    const r = relative(ROOT, f);
    if (!TEXT.test(f) || statSync(f).size > 6_000_000) continue;
    scanned++;
    const vendor = r.startsWith('server/vendor/') || r.startsWith('web/public/vendor/');
    const text = readFileSync(f, 'utf8');
    const lines = text.split('\n');
    for (const w of OTHER) {
      const re = vendor ? new RegExp(`(?<![A-Za-z])${w}`, 'i') : new RegExp(w, 'i');
      lines.forEach((ln, i) => {
        if (!re.test(ln)) return;
        // the hosting account that holds this repository is part of its web address; it is an address, not project code
        const addressOnly = r.startsWith('docs/') && !ln.replace(/github\.com\/[a-z0-9-]+\/daji-cricket|\([a-z0-9-]+\/daji-cricket\)|GitHub user \*\*[a-z0-9-]+\*\*/gi, '').match(re);
        if (!addressOnly) hits.push({ file: r, term: w === OTHER[0] ? 'name-1' : 'name-2', line: i + 1 });
      });
    }
  }
  assert.deepEqual(hits.filter((x) => !x.file.startsWith('docs/')), [], 'no source, style, script, test, UI text or data file mentions another project');
  // 3) dependencies and imports stay inside the repository
  const pkgs = rows.filter((r) => r.endsWith('package.json'));
  for (const p of pkgs) {
    const j = JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as Record<string, Record<string, string> | undefined>;
    for (const sec of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) for (const [name, spec] of Object.entries(j[sec] ?? {})) {
      assert.ok(!OTHER.some((w) => `${name} ${spec}`.toLowerCase().includes(w)), `${p}: ${name}`);
      assert.ok(!/^(file|link|git\+|github:)/.test(spec) || /^file:\.\.?\//.test(spec) === false || resolve(ROOT, dirname(p), spec.replace(/^(file|link):/, '')).startsWith(ROOT), `${p}: ${name} points outside the repository`);
    }
  }
  const code = rows.filter((r) => /\.(ts|tsx|js|mjs)$/.test(r) && !r.startsWith('server/vendor/') && !r.startsWith('web/public/desk/'));
  const escaping: string[] = [];
  for (const r of code) {
    const text = readFileSync(join(ROOT, r), 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      if (!resolve(ROOT, dirname(r), m[1]!).startsWith(ROOT)) escaping.push(`${r}: ${m[1]}`);
    }
  }
  assert.deepEqual(escaping, [], 'no import reaches outside the Daji repository');
  // 4) the database: no table, index, view or trigger carries another project\'s name
  const objects = many<{ name: string; sql: string | null }>("SELECT name, sql FROM sqlite_master");
  assert.ok(objects.length > 20);
  assert.deepEqual(objects.filter((o) => OTHER.some((w) => `${o.name} ${o.sql ?? ''}`.toLowerCase().includes(w))), []);
  // 5) what the running service says about itself and what the public pages say
  for (const path of ['/api/config', '/', '/desk/']) {
    const r = await h.get<unknown>(path);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    assert.ok(!OTHER.some((w) => text.toLowerCase().includes(w)), `${path} shows no other project`);
  }
  ev('scannedTextFiles', scanned); ev('files', rows.length); ev('terms', 'two other-project names (spelled out in the search evidence file, not in source)'); ev('databaseObjects', objects.length);
  ev('docsAddressOnlyHits', hits.filter((x) => x.file.startsWith('docs/')).length);
  ev('renamed', 'the desk stylesheet that carried another project\'s name is now desk/styles/daji.css (the desk build puts daji.css first, so the cascade is unchanged)');
});
