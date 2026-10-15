#!/usr/bin/env python3
"""Builds the hosted website preview: the real site files plus a small in-page stand-in for the server.

Usage: python3 web/preview/build_preview.py OUT_DIR

The real website (web/public) is never changed by this. The preview adds:
  - mock-api.js, which answers the /api routes in memory with sample data
  - a thin notice bar saying the data is sample data
and removes the <html>/<head>/<body> wrapper, because the host page adds its own.
"""
import json
import re
import shutil
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
pub = here.parent / 'public'
out = Path(sys.argv[1]) if len(sys.argv) > 1 else here / 'dist'

if out.exists():
    shutil.rmtree(out)
(out / 'assets').mkdir(parents=True)

# the stand-in server, with the sample data written into it
sample = json.loads((here / 'sample.json').read_text())
mock = (here / 'mock-api.js').read_text().replace('/*SAMPLE*/null', json.dumps(sample, separators=(',', ':')))
mock = mock.replace('/*EXTRA*/', (here / 'mock-extra.js').read_text())
(out / 'mock-api.js').write_text(mock)

for name in ('app.js', 'books.js', 'club.js', 'contacts.js', 'embed.js', 'site.css', 'tokens.css'):
    shutil.copy(pub / name, out / name)
for f in (pub / 'assets').iterdir():
    shutil.copy(f, out / 'assets' / f.name)

html = (pub / 'index.html').read_text()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
head = head.replace('<meta charset="utf-8">', '').replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '')
head = head.replace('<title>', '<meta name="claude:viewport-fit-sides" content="cover">\n<title>', 1)

bar = '''<style>
.preview-bar{display:block;background:var(--surface-top);border-bottom:1px solid var(--line-strong);color:var(--text-muted);font-size:11px;letter-spacing:.14em;text-transform:uppercase;text-align:center;line-height:1.6;padding:9px max(16px,env(safe-area-inset-right,0px)) 9px max(16px,env(safe-area-inset-left,0px))}
.preview-bar b{color:var(--gold-bright);font-weight:500}
</style>
<div class="preview-bar"><b>Preview</b> with sample data. Nothing you do here is saved. Use Sign in, then pick a demo account.</div>
'''
body = bar + body
body = body.replace('<script src="app.js"></script>', '<script src="mock-api.js"></script>\n<script src="app.js"></script>')
(out / 'index.html').write_text(head.strip() + '\n' + body.strip() + '\n')
print('built', out, sorted(p.name for p in out.rglob('*') if p.is_file()))
