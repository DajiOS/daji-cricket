"""Renders the wordmark and ball SVGs to transparent PNGs (for Wix uploads, social images, anywhere SVG is not accepted).
    python3 -I brand/export_png.py
Needs Playwright with Chromium."""
import asyncio, pathlib, re
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).parent
JOBS = [('wordmark-gold', 2400), ('wordmark-copper', 2400), ('wordmark-ink', 2400), ('wordmark-proof', 2400), ('ball-o', 600)]

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, width in JOBS:
            svg = (HERE / f'{name}.svg').read_text()
            vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
            w, h = width, round(width * vb[3] / vb[2])
            svg = re.sub(r'<svg ', f'<svg width="{w}" height="{h}" ', svg, 1)
            pg = await b.new_page(viewport={'width': w, 'height': h})
            await pg.set_content(f'<body style="margin:0;background:transparent">{svg}</body>')
            await pg.screenshot(path=str(HERE / f'{name}.png'), omit_background=True)
            await pg.close()
            print(name, w, h)
        await b.close()
asyncio.run(main())
