#!/usr/bin/env node
// Daji camera bridge: runs on a PC at the ground, pulls pictures from the Dahua NVR/XVR and sends them to the Daji server.
// It only makes outbound HTTPS calls. Nothing at the ground is opened to the internet.
// Needs: Node 18 or newer, and ffmpeg on the PATH. Usage: node bridge.mjs [path/to/bridge.json]
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { FrameSplitter, makeGate, redact, rtspUrl } from './lib.mjs';

const file = process.argv[2] || new URL('./bridge.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let cfg;
try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`Cannot read ${file}: ${e.message}`); process.exit(1); }
const server = String(cfg.server || '').replace(/\/$/, '');
const nvr = { ...cfg.nvr, password: process.env.BRIDGE_NVR_PASSWORD || cfg.nvr?.password };
if (!server || !nvr.host || !nvr.user || !nvr.password || !Array.isArray(cfg.cameras) || !cfg.cameras.length) {
  console.error('bridge.json needs: server, nvr.host, nvr.user, nvr.password and at least one camera ({ id, token, channel }).');
  process.exit(1);
}
const FPS = Math.min(Math.max(Number(cfg.fps) || 4, 1), 12);
const WIDTH = Math.min(Math.max(Number(cfg.width) || 960, 320), 1920);
const log = (...a) => console.log(new Date().toISOString(), ...a);

function runCamera(cam) {
  const gate = makeGate({ watchingMs: Math.round(1000 / FPS) - 20, idleMs: 10_000 });
  let sending = false;
  let failures = 0;

  async function send(frame) {
    if (sending) return; // the server is slower than the camera: skip, never queue
    sending = true;
    try {
      const r = await fetch(`${server}/api/cameras/${cam.id}/frame`, { method: 'PUT', headers: { authorization: `Bearer ${cam.token}`, 'content-type': 'image/jpeg' }, body: frame, signal: AbortSignal.timeout(8000) });
      if (r.ok) { gate.setWatchers((await r.json()).watchers || 0); if (failures) log(`${cam.id} sending again`); failures = 0; }
      else { if (failures++ % 20 === 0) log(`${cam.id} server answered ${r.status}${r.status === 401 ? ' (check the camera token in bridge.json)' : ''}`); }
    } catch (e) { if (failures++ % 20 === 0) log(`${cam.id} cannot reach the server: ${e.message}`); }
    finally { sending = false; }
  }

  let delay = 2000;
  function start() {
    const url = rtspUrl(nvr, cam.channel);
    const args = ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url, '-an', '-vf', `fps=${FPS},scale=${WIDTH}:-2`, '-q:v', '7', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'];
    log(`${cam.id} starting (channel ${cam.channel})`);
    const p = spawn(cfg.ffmpeg || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const split = new FrameSplitter((f) => { delay = 2000; if (gate.allow(Date.now())) void send(f); });
    p.stdout.on('data', (c) => split.push(c));
    p.stderr.on('data', (c) => log(`${cam.id} ffmpeg: ${redact(c.toString().trim())}`));
    p.on('error', (e) => { log(`${cam.id} cannot run ffmpeg: ${e.message}. Is ffmpeg installed?`); });
    p.on('close', (code) => { log(`${cam.id} ffmpeg stopped (${code}); retrying in ${delay / 1000}s`); setTimeout(start, delay); delay = Math.min(delay * 2, 60_000); });
  }
  start();
}

cfg.cameras.forEach(runCamera);
log(`Daji camera bridge running: ${cfg.cameras.length} camera(s) to ${server}`);
