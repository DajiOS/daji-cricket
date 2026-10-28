import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { Config } from './config.ts';
import type { Reply } from './http.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

/** Serves the built website, falling back to index.html for client-side routes. */
export function serveWeb(cfg: Config, url: URL, ifNoneMatch?: string): Reply {
  let p = decodeURIComponent(url.pathname);
  if (p.includes('\0')) return { status: 400, body: { error: { code: 'BAD_URL', message: 'Bad address' } } };
  const root = normalize(cfg.webDir);
  const file = normalize(join(root, p === '/' ? 'index.html' : p));
  if (file !== root && !file.startsWith(root + sep)) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  if (existsSync(file) && statSync(file).isFile()) {
    const ext = extname(file).toLowerCase();
    const hashed = /\.[0-9A-Za-z_-]{8,}\.(js|css)$/.test(file);
    const st = statSync(file);
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    // the background films change only when they are drawn again, so browsers and the CDN may keep them for a week
    const film = file.startsWith(join(root, 'assets', 'loops') + sep);
    const headers: Record<string, string> = { 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : film ? 'public, max-age=604800' : 'no-cache', ETag: etag };
    if (film) headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
    // The Wix custom element loads its script from here, so /embed/* is readable from any site. It is public code with no credentials.
    if (file.startsWith(join(root, 'embed') + sep)) {
      headers['Access-Control-Allow-Origin'] = '*';
      headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
    }
    if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)) return { status: 304, headers };
    return { status: 200, raw: readFileSync(file), contentType: TYPES[ext] ?? 'application/octet-stream', headers };
  }
  if (extname(p)) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    return { status: 404, raw: 'The website files were not found. Check WEB_DIR (default: ../web/public).', contentType: 'text/plain; charset=utf-8' };
  }
  return { status: 200, raw: readFileSync(index), contentType: TYPES['.html']!, headers: { 'Cache-Control': 'no-cache' } };
}
