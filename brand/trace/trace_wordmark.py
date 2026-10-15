"""
Traces the sign maker's drawing (reference/signage-drawing.jpg) into vector paths.

    python3 -I brand/trace/trace_wordmark.py        # writes brand/trace/wordmark.trace.json

Needs opencv-python and numpy. The drawing is flat orange artwork on a grey sheet with thin blue dimension lines on top.
  1. the dimension lines and their numbers are painted out (inpainted) so they do not cut notches into the letters;
  2. "orangeness" (red minus blue) is smoothed at 4x and cut half-way, which puts the edge where the anti-aliasing says it is;
  3. every shape is turned into a closed Bezier path, keeping corners sharp (the capitals) and curves smooth (the script).
The O of GROUND is not traced: the drawing shows a cricket ball there, which is drawn from ball geometry (shared/src/ball.ts).
"""
import json, math, pathlib
import cv2, numpy as np

HERE = pathlib.Path(__file__).parent
SCALE = 4

img = cv2.imread(str(HERE.parent / 'reference' / 'signage-drawing.jpg'))
assert img is not None and img.shape[:2] == (688, 1600), 'expected the 1600x688 drawing'
b, g, r = [img[..., i].astype(int) for i in range(3)]

# 1. paint out the blue dimension lines / numbers (blue is clearly above red, orange never is)
blue = ((b - r) > 25).astype(np.uint8) * 255
blue = cv2.dilate(blue, np.ones((3, 3), np.uint8))
img = cv2.inpaint(img, blue, 2, cv2.INPAINT_TELEA)
b, g, r = [img[..., i].astype(np.float32) for i in range(3)]

# 2. orangeness: ~0 on the grey sheet, ~150 on the letters, higher on the ball
f = r - b
big = cv2.resize(f, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
big = cv2.GaussianBlur(big, (0, 0), 3.0)   # 0.75 px of the original: removes JPEG ringing and pixel stair-steps
mask = (big > 70).astype(np.uint8) * 255

n, lab, st, _ = cv2.connectedComponentsWithStats(mask)
comps = []
for i in range(1, n):
    x, y, w, h, a = [int(v) for v in st[i]]
    if a < 40 * SCALE * SCALE: continue        # specks of the sheet
    comps.append((i, x / SCALE, y / SCALE, w / SCALE, h / SCALE, a / SCALE / SCALE))

def num(v): return f'{v:.2f}'.rstrip('0').rstrip('.')

def gauss_kernel(sigma):
    rad = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-rad, rad + 1) / sigma) ** 2)
    return k / k.sum(), rad

def smooth_open(P, sigma):
    """Gaussian-smooth an open polyline, keeping both ends where they are (odd reflection at the ends)."""
    n = len(P)
    if n < 4 or sigma <= 0: return P
    k, rad = gauss_kernel(sigma)
    rad = min(rad, n - 1)
    k = k[len(k) // 2 - rad: len(k) // 2 + rad + 1]; k = k / k.sum()
    pre = 2 * P[0] - P[1:rad + 1][::-1]
    post = 2 * P[-1] - P[-rad - 1:-1][::-1]
    ext = np.vstack([pre, P, post])
    out = np.column_stack([np.convolve(ext[:, 0], k, 'valid'), np.convolve(ext[:, 1], k, 'valid')])
    return out

def smooth_closed(P, sigma):
    n = len(P)
    k, rad = gauss_kernel(sigma)
    rad = min(rad, n // 2 - 1)
    k = k[len(k) // 2 - rad: len(k) // 2 + rad + 1]; k = k / k.sum()
    ext = np.vstack([P[-rad:], P, P[:rad]])
    return np.column_stack([np.convolve(ext[:, 0], k, 'valid'), np.convolve(ext[:, 1], k, 'valid')])

def find_corners(P, win, deg):
    """Indices where the outline turns sharply (angle between the directions `win` points before and after)."""
    n = len(P)
    ang = np.zeros(n)
    for i in range(n):
        a = P[i] - P[i - win]; b = P[(i + win) % n] - P[i]
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        ang[i] = 0 if na == 0 or nb == 0 else math.degrees(math.acos(float(np.clip(np.dot(a, b) / (na * nb), -1, 1))))
    idx = []
    for i in range(n):
        if ang[i] > deg and ang[i] == max(ang[(i + j) % n] for j in range(-win, win + 1)):
            if not idx or i - idx[-1] > win: idx.append(i)
    if len(idx) > 1 and idx[0] + n - idx[-1] <= win: idx.pop()
    return idx

def cross2(ab, V):
    return ab[0] * V[..., 1] - ab[1] * V[..., 0]

def rdp(P, eps):
    P = np.asarray(P, float)
    if len(P) < 3: return P
    a, b = P[0], P[-1]
    ab = b - a; L = np.linalg.norm(ab)
    d = np.abs(cross2(ab, P - a)) / L if L else np.linalg.norm(P - a, axis=1)
    i = int(np.argmax(d))
    if d[i] <= eps: return np.array([a, b])
    left = rdp(P[:i + 1], eps); right = rdp(P[i:], eps)
    return np.vstack([left[:-1], right])

def seg_path(P, first):
    """One open smoothed segment -> straight line if it is straight, else Catmull-Rom Beziers. P starts at a corner/vertex."""
    out = ''
    if len(P) < 2: return out
    a, b = P[0], P[-1]
    ab = b - a; L = np.linalg.norm(ab)
    dev = (np.abs(cross2(ab, P - a)) / L).max() if L else 0
    if dev < 0.22:                                   # straight edge
        return f'L{num(b[0])} {num(b[1])}'
    Q = rdp(P, 0.06)
    for i in range(len(Q) - 1):
        p0 = Q[i - 1] if i > 0 else Q[i]; p1 = Q[i]; p2 = Q[i + 1]; p3 = Q[i + 2] if i + 2 < len(Q) else Q[i + 1]
        c1 = p1 + (p2 - p0) / 6 if i > 0 else p1 + (p2 - p1) / 3
        c2 = p2 - (p3 - p1) / 6 if i + 2 < len(Q) else p2 - (p2 - p1) / 3
        out += f'C{num(c1[0])} {num(c1[1])} {num(c2[0])} {num(c2[1])} {num(p2[0])} {num(p2[1])}'
    return out

# Gaussian sigma in 1/4-pixel steps. The knot and the brush script are curves, so they take a heavier smoothing than the
# capitals, whose corners are found separately and kept sharp. Larger = cleaner edges, but thin tips start to round off.
SMOOTH_SCRIPT = 9
SMOOTH_CAPS = 2.5

def contour_path(P, sigma, eps):
    """P: closed contour (orig-pixel units, points 1/4 px apart). Light periodic smoothing removes the stair-steps of the
    pixel grid; then a polygon whose corners stay within `eps` pixels of the smoothed outline. At that tolerance the facets
    are far below anything visible (a Catmull-Rom curve through unevenly spaced points bows long straight edges, so we do not use one)."""
    S = smooth_closed(P, sigma)
    Q = rdp(np.vstack([S, S[:1]]), eps)[:-1]
    return 'M' + 'L'.join(f'{num(x)} {num(y)}' for x, y in Q) + 'Z'

def trace(i, script, small=False):
    ys, xs = np.where(lab == i)
    x0, x1, y0, y1 = xs.min() - 4, xs.max() + 5, ys.min() - 4, ys.max() + 5
    sub = (lab[y0:y1, x0:x1] == i).astype(np.uint8) * 255
    cs, _ = cv2.findContours(sub, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    d = ''
    for cnt in cs:
        if cv2.contourArea(cnt) < 3 * SCALE * SCALE: continue       # ignore pin-holes
        P = (cnt[:, 0, :].astype(float) + 0.5 + [x0, y0]) / SCALE
        # contour points are 1/4 px apart: sigma in 4x steps
        d += contour_path(P, sigma=(4 if small else SMOOTH_SCRIPT if script else SMOOTH_CAPS), eps=(0.04 if script else 0.03))
    return d

groups = {'mark': [], 'script': [], 'dots': [], 'caps': []}
ball = None
for i, x, y, w, h, a in sorted(comps, key=lambda c: c[1]):
    cx, cy = x + w / 2, y + h / 2
    if x < 600 and y < 400:                       # the knot
        groups['mark'].append({'d': trace(i, True), 'x': x})
    elif 1000 < x < 1085 and 380 < y < 392 and h > 55:   # the ball (a different colour from the letters)
        ball = {'cx': round(cx, 2), 'cy': round(cy, 2), 'r': round(max(w, h) / 2, 2)}
    elif y < 400 and w < 30 and h < 30:            # the two dots
        groups['dots'].append({'d': trace(i, True, small=True), 'x': x})
    elif y < 392:                                  # D, a, j, i (the j drops into the caps row)
        groups['script'].append({'d': trace(i, True), 'x': x, 'bbox': [x, y, w, h]})
    else:
        groups['caps'].append({'d': trace(i, False), 'x': x, 'bbox': [x, y, w, h]})

print({k: len(v) for k, v in groups.items()}, 'ball', ball)
print('caps x:', [round(c['x']) for c in groups['caps']])
print('script bboxes:', [c['bbox'] for c in groups['script']])
assert ball, 'ball not found'
x0 = min(c[1] for c in comps); y0 = min(c[2] for c in comps)
x1 = max(c[1] + c[3] for c in comps); y1 = max(c[2] + c[4] for c in comps)
out = {
    'source': 'reference/signage-drawing.jpg (1600x688)',
    'box': [round(x0, 2), round(y0, 2), round(x1 - x0, 2), round(y1 - y0, 2)],
    'mark': [m['d'] for m in groups['mark']],
    'script': [s['d'] for s in groups['script']],
    'dots': [d['d'] for d in groups['dots']],
    'caps': [c['d'] for c in groups['caps']],
    'ball': ball,
}
(HERE / 'wordmark.trace.json').write_text(json.dumps(out, separators=(',', ':')))
ts = pathlib.Path(__file__).resolve().parents[2] / 'shared' / 'src' / 'wordmarkData.ts'
ts.write_text('// Generated by brand/trace/trace_wordmark.py from reference/signage-drawing.jpg. Do not edit by hand.\n'
              '// Coordinates are in pixels of the 1600x688 drawing; `box` is the tight outline of everything.\n'
              'export const WORDMARK_DATA = ' + json.dumps(out, separators=(',', ':')) + ' as const;\n')
print('bytes', len(json.dumps(out)), '->', ts.name)
