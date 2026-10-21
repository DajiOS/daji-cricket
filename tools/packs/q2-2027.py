# Writes the CSS for the Apr to Jun 2027 design pack ("Summer season"): colour tokens for the day and night halves of each design,
# its faces and home page shape, and its decoration drawn in CSS. Run: python3 tools/packs/q2-2027.py >> web/public/site.css
# (once; the output is checked in). Colours are kept readable: body text at least 7:1 on the page, the accent at least 3.5:1.

def hx(c): c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
def h(t): return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in t)
def mix(a, b, w): a, b = hx(a), hx(b); return h(tuple(x * (1 - w) + y * w for x, y in zip(a, b)))
def lum(c):
    def ch(v): v /= 255; return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in hx(c)); return 0.2126 * r + 0.7152 * g + 0.0722 * b
def contrast(a, b): la, lb = sorted((lum(a), lum(b)), reverse=True); return (la + 0.05) / (lb + 0.05)
def rgba(c, a): r, g, b = hx(c); return f'rgba({r},{g},{b},{a})'
def readable(acc, bg, need):
    # darken (on light) or lighten (on dark) the accent until it reads on the page
    dark_bg = lum(bg) < 0.2
    for i in range(40):
        if contrast(acc, bg) >= need: return acc
        acc = mix(acc, '#ffffff' if dark_bg else '#000000', 0.06)
    return acc

def tokens(kind, bg, text, acc, canvas):
    light = kind == 'light'
    acc = readable(acc, bg, 3.5)
    assert contrast(text, bg) >= 7, (bg, text, contrast(text, bg))
    raised = mix(bg, '#ffffff', 0.6) if light else mix(bg, text, 0.035)
    surface = '#ffffff' if light else mix(bg, text, 0.06)
    s_high = mix(bg, text, 0.05) if light else mix(bg, text, 0.09)
    s_top = mix(bg, text, 0.10) if light else mix(bg, text, 0.14)
    muted = mix(text, bg, 0.32); faint = mix(text, bg, 0.48)
    if contrast(faint, bg) < 3.2: faint = mix(text, bg, 0.40)
    bright = mix(acc, '#ffffff', 0.16); deep = mix(acc, '#000000', 0.2)
    on = '#ffffff' if contrast('#ffffff', acc) >= contrast('#111111', acc) else '#111111'
    t = [f'color-scheme:{kind}', f'--bg:{bg}', f'--bg-raised:{raised}', f'--surface:{surface}', f'--surface-high:{s_high}', f'--surface-top:{s_top}']
    if light: t += [f'--line:{rgba(text, .13)}', f'--line-strong:{rgba(text, .30)}']
    else: t += [f'--line:{rgba(acc, .20)}', f'--line-strong:{rgba(acc, .42)}']
    t += [f'--text:{text}', f'--text-muted:{muted}', f'--text-faint:{faint}', f'--gold:{acc}', f'--gold-bright:{bright}', f'--gold-deep:{deep}', f'--on-gold:{on}',
          f'--glow:{rgba(acc, .2)}', f'--scrim:{rgba(bg, .8 if light else .76)}']
    if light: t += ['--shadow-card:0 18px 40px -26px rgba(20,24,26,.30),inset 0 1px 0 rgba(255,255,255,.8)', f'--shadow-lift:0 30px 60px -30px rgba(20,24,26,.35),0 0 0 1px {rgba(acc, .2)}']
    t += [f'--gradient-gold:linear-gradient(135deg,{bright} 0%,{acc} 50%,{deep} 100%)', f'--gradient-gold-hover:linear-gradient(135deg,{bright} 0%,{bright} 50%,{acc} 100%)', f'--gradient-canvas:{canvas}']
    return t, acc

# id: (kind of its main half, page, text, accent, canvas, display face, body face, --d-* shape, other half: page, text, accent)
D = {
  'kulfi':     ('light', '#fbf6ea', '#22301f', '#2f8f6b', 'radial-gradient(1100px 520px at 50% -10%,rgba(255,214,150,.35),transparent 60%)', "'Gilda Display',Georgia,serif", "'Albert Sans',system-ui,sans-serif", (999, 400, '-.01em', 'none', 'italic', 'clamp(50px,7.6vw,122px)'), ('#0d1410', '#f6f1e2', '#5fcf9f')),
  'camp':      ('light', '#f2f9ff', '#10233a', '#ff6a1a', 'radial-gradient(1000px 520px at 85% -10%,rgba(255,170,90,.20),transparent 60%)', "'Fredoka',system-ui,sans-serif", "'Nunito',system-ui,sans-serif", (24, 600, '-.01em', 'none', 'normal', 'clamp(46px,6.8vw,108px)'), ('#0a1422', '#eef6ff', '#ff8a45')),
  'neem':      ('light', '#eef3e6', '#1c2a17', '#3c6b2f', 'radial-gradient(1000px 560px at 20% -10%,rgba(90,140,60,.14),transparent 60%)', "'Lora',Georgia,serif", "'Source Sans 3',system-ui,sans-serif", (6, 500, '-.015em', 'none', 'italic', 'clamp(46px,6.6vw,106px)'), ('#0c120a', '#eef3e6', '#8cc46e')),
  'heatwave':  ('light', '#fbefd9', '#2b1608', '#d2381c', 'radial-gradient(1100px 560px at 50% -10%,rgba(255,150,60,.22),transparent 60%)', "'Space Grotesk',system-ui,sans-serif", "'DM Sans',system-ui,sans-serif", (4, 700, '-.03em', 'none', 'normal', 'clamp(44px,6.6vw,106px)'), ('#160b05', '#fbefd9', '#ff6a3d')),
  'gola':      ('light', '#f4fbfd', '#1d1630', '#e0245e', 'radial-gradient(900px 480px at 15% -10%,rgba(120,210,235,.25),transparent 60%),radial-gradient(900px 480px at 90% -10%,rgba(255,120,170,.16),transparent 60%)', "'Shrikhand',Georgia,serif", "'Poppins',system-ui,sans-serif", (18, 400, '0', 'none', 'normal', 'clamp(44px,6.2vw,98px)'), ('#0b0a18', '#f4fbfd', '#ff5c93')),
  'khus':      ('dark', '#0c1a15', '#ecf6ef', '#9fe3b8', 'radial-gradient(1100px 560px at 70% -10%,rgba(159,227,184,.10),transparent 60%)', "'Marcellus',Georgia,serif", "'Mukta',system-ui,sans-serif", (10, 400, '.005em', 'none', 'normal', 'clamp(46px,6.6vw,104px)'), ('#f0f7f2', '#0f2219', '#1f7a4a')),
  'powerplay': ('dark', '#0d0a1f', '#f2f0ff', '#c6ff3d', 'radial-gradient(1000px 520px at 80% -10%,rgba(138,92,255,.22),transparent 60%)', "'Bebas Neue',Impact,sans-serif", "'Lexend',system-ui,sans-serif", (0, 400, '.02em', 'uppercase', 'normal', 'clamp(58px,9vw,150px)'), ('#f5f3ff', '#120d2b', '#5a2fd6')),
  'thunder':   ('dark', '#0e1820', '#eaf1f6', '#ffd23f', 'radial-gradient(1200px 520px at 40% -10%,rgba(111,168,220,.16),transparent 60%)', "'Oswald','Arial Narrow',sans-serif", "'Public Sans',system-ui,sans-serif", (2, 600, '.005em', 'uppercase', 'normal', 'clamp(46px,7vw,112px)'), ('#eef3f7', '#0e1820', '#9a6c00')),
  'firefly':   ('dark', '#06110c', '#eef7ee', '#e4ff6e', 'radial-gradient(1000px 520px at 50% 110%,rgba(228,255,110,.10),transparent 60%)', "'Comfortaa',system-ui,sans-serif", "'Atkinson Hyperlegible',system-ui,sans-serif", (999, 700, '-.02em', 'none', 'normal', 'clamp(42px,6vw,96px)'), ('#f3f8ef', '#0b1d12', '#4f7a00')),
  'jamun':     ('dark', '#150a1f', '#f6eefc', '#c9a7ff', 'radial-gradient(1100px 560px at 30% -10%,rgba(201,167,255,.14),transparent 60%)', "'Playfair Display',Georgia,serif", "'Lato',system-ui,sans-serif", (14, 500, '-.01em', 'none', 'italic', 'clamp(46px,6.6vw,108px)'), ('#f7f2fb', '#1c0e29', '#6b3fb8')),
}
# decorations, drawn in CSS: (decor name, main half, other half)
SVG = lambda body, w, hh: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='" + str(w) + "' height='" + str(hh) + "' viewBox='0 0 " + str(w) + ' ' + str(hh) + "'%3E" + body + "%3C/svg%3E\")"
DECOR = {
  'kulfi': ('swirl', 'radial-gradient(900px 300px at 20% 0%,rgba(255,226,170,.55),transparent 62%),radial-gradient(700px 260px at 85% 12%,rgba(160,220,190,.45),transparent 62%),repeating-radial-gradient(circle at 50% -40%,transparent 0 46px,rgba(47,143,107,.06) 46px 48px)',
            'radial-gradient(900px 300px at 20% 0%,rgba(255,214,150,.10),transparent 62%),repeating-radial-gradient(circle at 50% -40%,transparent 0 46px,rgba(95,207,159,.07) 46px 48px)'),
  'camp': ('bunting', SVG("%3Cpath d='M0 8 Q120 40 240 8' fill='none' stroke='%2310233a' stroke-opacity='.25'/%3E%3Cg fill-opacity='.55'%3E%3Cpath d='M18 14l14 26 12-22z' fill='%23ff6a1a'/%3E%3Cpath d='M66 26l12 26 14-22z' fill='%231e88e5'/%3E%3Cpath d='M114 30l14 26 14-26z' fill='%23ffc21a'/%3E%3Cpath d='M164 26l12 22 14-26z' fill='%2330b37a'/%3E%3Cpath d='M210 14l12 22 14-26z' fill='%23e0245e'/%3E%3C/g%3E", 240, 80) + ',radial-gradient(1000px 420px at 85% -10%,rgba(255,170,90,.25),transparent 62%)',
           SVG("%3Cpath d='M0 8 Q120 40 240 8' fill='none' stroke='%23ffffff' stroke-opacity='.2'/%3E%3Cg fill-opacity='.35'%3E%3Cpath d='M18 14l14 26 12-22z' fill='%23ff8a45'/%3E%3Cpath d='M66 26l12 26 14-22z' fill='%235aa9f0'/%3E%3Cpath d='M114 30l14 26 14-26z' fill='%23ffd23c'/%3E%3Cpath d='M164 26l12 22 14-26z' fill='%2350d39a'/%3E%3Cpath d='M210 14l12 22 14-26z' fill='%23ff5c93'/%3E%3C/g%3E", 240, 80)),
  'neem': ('leaves', SVG("%3Cg fill='%233c6b2f' fill-opacity='.10'%3E%3Cpath d='M20 40c10-16 30-22 44-20-6 14-24 26-44 20z'/%3E%3Cpath d='M110 20c8-14 26-18 38-16-6 12-20 22-38 16z'/%3E%3Cpath d='M150 110c10-16 30-22 44-20-6 14-24 26-44 20z'/%3E%3Cpath d='M60 150c8-14 26-18 38-16-6 12-20 22-38 16z'/%3E%3C/g%3E", 220, 200) + ',radial-gradient(1200px 500px at 50% -20%,rgba(60,107,47,.12),transparent 60%)',
           SVG("%3Cg fill='%238cc46e' fill-opacity='.07'%3E%3Cpath d='M20 40c10-16 30-22 44-20-6 14-24 26-44 20z'/%3E%3Cpath d='M110 20c8-14 26-18 38-16-6 12-20 22-38 16z'/%3E%3Cpath d='M150 110c10-16 30-22 44-20-6 14-24 26-44 20z'/%3E%3Cpath d='M60 150c8-14 26-18 38-16-6 12-20 22-38 16z'/%3E%3C/g%3E", 220, 200)),
  'heatwave': ('haze', 'repeating-linear-gradient(180deg,transparent 0 22px,rgba(210,56,28,.05) 22px 24px),radial-gradient(circle at 78% 10%,#ffd28a 0 90px,rgba(255,170,80,.40) 92px,rgba(255,170,80,0) 420px),linear-gradient(180deg,#ffe0b0 0%,transparent 66%)',
               'repeating-linear-gradient(180deg,transparent 0 22px,rgba(255,106,61,.05) 22px 24px),radial-gradient(circle at 78% 10%,rgba(255,120,70,.30) 0 90px,rgba(255,120,70,.10) 92px,rgba(255,120,70,0) 420px)'),
  'gola': ('ice', 'linear-gradient(135deg,rgba(120,210,235,.30) 0 14%,transparent 14% 28%,rgba(255,120,170,.18) 28% 42%,transparent 42% 56%,rgba(255,214,90,.20) 56% 70%,transparent 70%),radial-gradient(1000px 500px at 50% -20%,rgba(255,255,255,.9),transparent 60%)',
           'linear-gradient(135deg,rgba(120,210,235,.10) 0 14%,transparent 14% 28%,rgba(255,92,147,.10) 28% 42%,transparent 42% 56%,rgba(255,214,90,.08) 56% 70%,transparent 70%)'),
  'khus': ('screen', 'repeating-linear-gradient(90deg,rgba(159,227,184,.07) 0 2px,transparent 2px 10px),repeating-linear-gradient(0deg,rgba(232,195,106,.06) 0 1px,transparent 1px 7px),radial-gradient(1100px 520px at 70% -10%,rgba(159,227,184,.14),transparent 60%)',
           'repeating-linear-gradient(90deg,rgba(31,122,74,.07) 0 2px,transparent 2px 10px),repeating-linear-gradient(0deg,rgba(150,110,30,.05) 0 1px,transparent 1px 7px)'),
  'powerplay': ('neon', 'linear-gradient(115deg,transparent 0 55%,rgba(198,255,61,.16) 55% 56%,transparent 56% 62%,rgba(138,92,255,.22) 62% 64%,transparent 64%),radial-gradient(900px 400px at 85% -10%,rgba(138,92,255,.30),transparent 62%),radial-gradient(700px 300px at 10% 0%,rgba(198,255,61,.10),transparent 62%)',
                'linear-gradient(115deg,transparent 0 55%,rgba(90,47,214,.12) 55% 56%,transparent 56% 62%,rgba(90,47,214,.10) 62% 64%,transparent 64%),radial-gradient(900px 400px at 85% -10%,rgba(90,47,214,.10),transparent 62%)'),
  'thunder': ('clouds', 'radial-gradient(520px 160px at 18% 8%,rgba(160,185,205,.30),transparent 70%),radial-gradient(620px 180px at 52% 2%,rgba(140,165,190,.28),transparent 70%),radial-gradient(520px 170px at 86% 12%,rgba(160,185,205,.26),transparent 70%),linear-gradient(180deg,#1b2b38 0%,transparent 70%)',
              'radial-gradient(520px 160px at 18% 8%,rgba(90,110,130,.16),transparent 70%),radial-gradient(620px 180px at 52% 2%,rgba(90,110,130,.14),transparent 70%),radial-gradient(520px 170px at 86% 12%,rgba(90,110,130,.14),transparent 70%)'),
  'firefly': ('fireflies', SVG("%3Cg fill='%23e4ff6e'%3E%3Ccircle cx='24' cy='30' r='2' opacity='.55'/%3E%3Ccircle cx='130' cy='18' r='1.4' opacity='.4'/%3E%3Ccircle cx='190' cy='96' r='2.2' opacity='.5'/%3E%3Ccircle cx='80' cy='150' r='1.6' opacity='.4'/%3E%3Ccircle cx='170' cy='190' r='1.8' opacity='.45'/%3E%3C/g%3E", 220, 220) + ',radial-gradient(1000px 460px at 50% 105%,rgba(127,214,160,.16),transparent 62%)',
                SVG("%3Cg fill='%234f7a00'%3E%3Ccircle cx='24' cy='30' r='2' opacity='.25'/%3E%3Ccircle cx='130' cy='18' r='1.4' opacity='.2'/%3E%3Ccircle cx='190' cy='96' r='2.2' opacity='.22'/%3E%3Ccircle cx='80' cy='150' r='1.6' opacity='.2'/%3E%3Ccircle cx='170' cy='190' r='1.8' opacity='.2'/%3E%3C/g%3E", 220, 220)),
  'jamun': ('berries', 'radial-gradient(circle at 12% 14%,rgba(201,167,255,.22) 0 6px,transparent 7px),radial-gradient(circle at 16% 20%,rgba(201,167,255,.16) 0 5px,transparent 6px),radial-gradient(circle at 84% 10%,rgba(255,143,200,.18) 0 7px,transparent 8px),radial-gradient(1100px 520px at 30% -10%,rgba(120,70,190,.32),transparent 62%),radial-gradient(800px 380px at 90% 0%,rgba(255,143,200,.12),transparent 62%)',
              'radial-gradient(1100px 520px at 30% -10%,rgba(107,63,184,.12),transparent 62%),radial-gradient(800px 380px at 90% 0%,rgba(200,80,150,.08),transparent 62%)'),
}
SEL = lambda tone, decor: f'html{tone}[data-decor="{decor}"] #view-home .hero-decor,html{tone}[data-decor="{decor}"] :is(#view-academy,#view-bookings,#view-login,#view-platform)::before'

out = ['', '/* ===== Design pack Apr to Jun 2027 ("Summer season", server/src/packs.ts): ten more designer themes, built the same way as',
       '   the others. Written by tools/packs/q2-2027.py: colour tokens for the day and night halves, faces, the home page shape (--d-*)',
       '   and a decoration drawn in CSS. ===== */']
light_ids = [k for k, v in D.items() if v[0] == 'light']
other = []
for k, (kind, bg, text, acc, canvas, fd, fb, d, (bg2, text2, acc2)) in D.items():
    t, acc_main = tokens(kind, bg, text, acc, canvas)
    out.append(f':root[data-theme="{k}"]{{' + ';'.join(t + [f'--font-display:{fd}', f'--font-body:{fb}']) + '}')
    out.append(f'html[data-theme="{k}"]:not([data-embed]):not([data-embed-section]) #view-home{{--font-display:{fd};--lux-line:{rgba(text if kind == "light" else acc_main, .16 if kind == "light" else .18)}}}')
    r, fw, ls, tt, es, h1 = d
    out.append(f'html[data-theme="{k}"]{{--d-r:{r}px;--d-fw:{fw};--d-ls:{ls};--d-tt:{tt};--d-es:{es};--d-h1:{h1}}}')
    kind2 = 'dark' if kind == 'light' else 'light'
    t2, _ = tokens(kind2, bg2, text2, acc2, f'radial-gradient(1100px 560px at 70% -10%,{rgba(acc2, .10)},transparent 60%)')
    other.append(f':root[data-theme="{k}"][data-mode="{"night" if kind == "light" else "day"}"]{{' + ';'.join(t2) + '}')
out.append('html:is(' + ','.join(f'[data-theme="{k}"]' for k in light_ids) + ') #splash::before{background:var(--bg)!important}')
out.append('html:is(' + ','.join(f'[data-theme="{k}"]' for k in light_ids) + ') #view-home header.hero::before,html:is(' + ','.join(f'[data-theme="{k}"]' for k in light_ids) + ') #view-home header.hero::after{display:none}')
for k, (decor, main, alt) in DECOR.items():
    kind = D[k][0]
    out.append(SEL('', decor) + '{background:' + main + ';-webkit-mask-image:linear-gradient(180deg,#000 45%,transparent 92%);mask-image:linear-gradient(180deg,#000 45%,transparent 92%)}')
out.append('/* the bunting hangs in one row along the top, not over the headline */')
out.append(SEL('', 'bunting') + '{background-repeat:repeat-x,no-repeat;background-position:0 96px,0 0}')
out.append('/* their other halves: night versions of the five light designs, day versions of the five dark ones */')
out += other
out.append('/* the decorations in the other half: softer by night for the light designs, no night sky by day for the dark ones */')
for k, (decor, main, alt) in DECOR.items():
    tone = '[data-tone="dark"]' if D[k][0] == 'light' else '[data-tone="light"]'
    out.append(SEL(tone, decor) + '{background:' + alt + '}')
print('\n'.join(out))
