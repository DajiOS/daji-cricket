// Builds the admin desk into ../web/public/desk (desk.js and desk.css). Run: node build.mjs [--watch]
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, chmodSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const esbuild = require(process.env.ESBUILD_PATH || 'esbuild');
const out = (process.env.DESK_OUT || new URL('../web/public/desk/', import.meta.url).pathname).replace(/\/?$/, '/');
const watch = process.argv.includes('--watch');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
// desk.css = the shared sheet, then every file in styles/ (one per page area, so builders never edit the same file); daji.css (the shell) always comes first so the cascade order does not depend on its name
const css = [readFileSync('styles.css', 'utf8'), ...readdirSync('styles').filter((f) => f.endsWith('.css')).sort((a, b) => Number(b === 'daji.css') - Number(a === 'daji.css') || (a < b ? -1 : 1)).map((f) => readFileSync('styles/' + f, 'utf8'))].join('\n');
writeFileSync(out + 'desk.css', css);
writeFileSync(out + 'theme.js', readFileSync('theme-init.js', 'utf8'));
const opts = { entryPoints: ['src/main.tsx'], outdir: out, entryNames: 'desk', chunkNames: 'chunks/[name].[hash]', splitting: true, bundle: true, platform: 'browser', format: 'esm', target: ['es2020', 'safari15'], minify: !watch, sourcemap: false, jsx: 'automatic', logLevel: 'info', define: { 'process.env.NODE_ENV': '"production"' } };
if (watch) { const ctx = await esbuild.context(opts); await ctx.watch(); } else { await esbuild.build(opts); }
const fix = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = d + e.name; if (e.isDirectory()) { chmodSync(f, 0o755); fix(f + '/'); } else chmodSync(f, 0o644); } };
fix(out);
