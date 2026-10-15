"""Builds Daji-Cricket-Ground-Project-Overview.pdf: renders flowcharts (Mermaid → SVG), inlines them, prints with Chromium."""
import re, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

here = Path(__file__).parent
MMDC = '/home/claude/.npm-global/bin/mmdc'
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

for mmd in sorted((here / 'diagrams').glob('*.mmd')):
    svg = mmd.with_suffix('.svg')
    if not svg.exists() or svg.stat().st_mtime < mmd.stat().st_mtime:
        subprocess.run([MMDC, '-i', str(mmd), '-o', str(svg), '-c', str(here / 'mermaid-config.json'),
                        '-p', str(here / 'puppeteer.json'), '-b', 'transparent'], check=True, capture_output=True)

def inline_svg(path: Path, uid: str, scale: float) -> str:
    s = path.read_text()
    s = re.sub(r'^<\?xml.*?\?>', '', s)
    s = s.replace('id="my-svg"', f'id="{uid}"').replace('#my-svg', f'#{uid}')   # keep per-diagram CSS scoped
    vb = re.search(r'viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)"', s)
    w, h = float(vb.group(3)) * scale, float(vb.group(4)) * scale
    s = re.sub(r'<svg ([^>]*?)width="100%"', rf'<svg \1width="{w:.0f}" height="{h:.0f}"', s, count=1)
    s = re.sub(r'(<svg [^>]*?)style="max-width: [\d.]+px;?"', r'\1', s, count=1)
    return s

html = (here / 'overview.tpl.html').read_text()
html = re.sub(r'\{\{DIAGRAM:([\w-]+)@([\d.]+)\}\}', lambda m: inline_svg(here / 'diagrams' / f'{m.group(1)}.svg', 'd' + m.group(1).replace('-', '_'), float(m.group(2))), html)
out_html = here / 'overview.html'
out_html.write_text(html)

pdf = here / 'Daji-Cricket-Ground-Project-Overview.pdf'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = b.new_page()
    pg.goto(out_html.as_uri())
    pg.wait_for_timeout(500)
    pg.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
    b.close()
print(pdf, pdf.stat().st_size // 1024, 'KB')
