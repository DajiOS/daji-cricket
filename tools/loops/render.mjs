// Renders the hero background films: node tools/loops/render.mjs [name ...]  (needs Playwright's Chromium and ffmpeg).
// Each film is 8 seconds at 24 frames a second, 960 x 540, written to web/public/assets/loops/<name>.webm (VP9, smaller, for most
// browsers) and <name>.mp4 (H.264, for older Safari).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || 'playwright');
const here = dirname(fileURLToPath(import.meta.url)), out = join(here, '../../web/public/assets/loops');
const W = 960, H = 540, FPS = 24, SECONDS = 8, N = FPS * SECONDS;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.setContent(`<canvas id="c" width="${W}" height="${H}"></canvas><script>${readFileSync(join(here, 'motifs.js'), 'utf8')}</script>`);
const names = process.argv.slice(2).length ? process.argv.slice(2) : await page.evaluate(() => Object.keys(window.LOOPS));
for (const name of names) {
  const tmp = mkdtempSync(join(tmpdir(), 'loop-'));
  for (let i = 0; i < N; i++) {
    const png = await page.evaluate(([n, t, w, h]) => { const c = document.getElementById('c').getContext('2d'); window.drawLoop(n, t, w, h, c); return document.getElementById('c').toDataURL('image/png').slice(22); }, [name, i / N, W, H]);
    writeFileSync(join(tmp, `f${String(i).padStart(4, '0')}.png`), Buffer.from(png, 'base64'));
  }
  const file = join(out, `${name}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(tmp, 'f%04d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', file]);
  const webm = join(out, `${name}.webm`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(tmp, 'f%04d.png'), '-c:v', 'libvpx-vp9', '-crf', '42', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-an', webm]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(name, 'mp4', Math.round(statSync(file).size / 1024) + ' KB', 'webm', Math.round(statSync(webm).size / 1024) + ' KB');
}
await browser.close();
