// Run in the page by tools/layout/check.mjs: returns the layout problems on the page as plain sentences.
window.__layoutProblems = () => {
  const out = [], vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  const rc = document.querySelector('#view-home .ratecard');
  if (rc) {
    const par = rc.parentElement, ps = getComputedStyle(par), inner = par.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
    for (const el of [rc, par.querySelector(':scope > .price')].filter(Boolean)) if (el.getBoundingClientRect().width < inner * 0.9) out.push(`${el.className} is ${Math.round(el.getBoundingClientRect().width)} px of ${Math.round(inner)}`);
    const cols = [...rc.querySelectorAll('.rc-col')]; if (vw > 1000 && cols.length > 1 && new Set(cols.map((c) => Math.round(c.getBoundingClientRect().top))).size > 1) out.push('price columns stacked on a wide screen');
  }
  const view = document.querySelector('.view.on') || document.body;
  for (const el of view.querySelectorAll('h1,h2,h3,h4,h5,b,strong,p,a.btn,button,.chip,.eyebrow')) {
    if (el.closest('[aria-hidden="true"],.hero-decor,.hero-3d,.hero-loopbox,dialog,[hidden]')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || !el.textContent.trim()) continue;
    let a = el.parentElement, scroller = false;
    while (a && a !== document.body) { const s = getComputedStyle(a); if (/auto|scroll/.test(s.overflowX)) { scroller = true; break; } if (s.overflowX !== 'visible') break; a = a.parentElement; }
    if (scroller) continue;
    const box = a && a !== document.body ? a.getBoundingClientRect() : { left: 0, right: vw };
    if (r.right > box.right + 2 || r.left < box.left - 2) out.push(`cut off: ${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}" (${Math.round(r.left)}-${Math.round(r.right)} in ${Math.round(box.left)}-${Math.round(box.right)})`);
  }
  return out;
};
