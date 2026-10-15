// Runs inside the page when it is shown in a Wix widget (address ends ?embed=booking|account|desk|scores|grounds|gallery|academy|contact|platform).
// It trims the page to the one part the widget is for and tells the parent window how tall it is, so the frame never scrolls.
(() => {
  'use strict';
  let kind = '';
  try { kind = new URLSearchParams(location.search).get('embed') || ''; } catch { /* no query */ }
  if (!kind || window.parent === window) return;
  const root = document.documentElement;
  root.setAttribute('data-embed', kind);
  // ?theme=ivory shows the light estate look inside the frame (the default stays the dark obsidian look).
  try { const th = new URLSearchParams(location.search).get('theme'); if (['ivory', 'obsidian', 'onyx-slate', 'emerald', 'navy', 'pearl'].includes(th)) root.setAttribute('data-theme', th); } catch { /* keep default */ }
  // Phone-width home inside Wix: the page is trimmed to the hero, so its buttons open the full booking app.
  if (kind === 'home' && window.innerWidth <= 700) {
    const go = (e) => { e.preventDefault(); e.stopPropagation(); try { window.top.location.href = location.origin + '/#book'; } catch { window.open(location.origin + '/#book', '_blank'); } };
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.cta a, .cta button')) go(e); }, true);
  }
  const sections = ['grounds', 'gallery', 'live', 'visit'];
  if (kind === 'scores') kind = 'live';
  if (kind === 'contact') kind = 'visit';
  if (sections.includes(kind)) root.setAttribute('data-embed-section', kind);
  const post = () => {
    const h = Math.ceil(Math.max(document.body.scrollHeight, root.scrollHeight));
    try { window.parent.postMessage({ daji: 'height', height: h }, '*'); } catch { /* parent gone */ }
  };
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(post, 60); };
  if (window.ResizeObserver) new ResizeObserver(later).observe(document.body);
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true });
  window.addEventListener('load', later);
  window.addEventListener('hashchange', later);
  // Links that leave the app open in the parent's tab rather than inside the frame.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="http"]');
    if (a && !a.href.startsWith(location.origin)) a.target = '_blank';
  });
  later();
})();
