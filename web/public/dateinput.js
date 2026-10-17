/* Dates are typed and shown the Indian way, dd/mm/yyyy, on every date field. The browser's own date box follows the
   computer's language (mm/dd/yyyy on many), so each <input type="date"> keeps working underneath, hidden, and a dd/mm/yyyy
   box with a calendar button sits in front of it. Code that reads or sets .value, min, max or listens for change is unaffected. */
(() => {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const toShow = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
  const toIso = (txt) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt); if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3], dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const mask = (raw) => { const d = raw.replace(/\D/g, '').slice(0, 8); return d.length > 4 ? d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4) : d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; };
  const CAL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

  function upgrade(n) {
    if (n.dataset.dx || n.hasAttribute('data-native')) return; n.dataset.dx = '1'; // data-native: a calendar button that never shows its text, like the day picker on the booking page
    const cs = getComputedStyle(n), block = cs.display === 'block' || cs.display === 'flex', w = n.offsetWidth;
    const wrap = document.createElement('span'); wrap.className = 'dx' + (block ? ' dx-block' : '');
    const t = document.createElement('input'); t.type = 'text'; t.inputMode = 'numeric'; t.autocomplete = 'off'; t.maxLength = 10;
    t.placeholder = 'dd/mm/yyyy'; t.className = (n.className ? n.className + ' ' : '') + 'dx-t'; t.setAttribute('style', n.getAttribute('style') || '');
    const label = n.getAttribute('aria-label'); if (label) t.setAttribute('aria-label', label);
    if (!block && w > 0) t.style.width = Math.max(w, 128) + 'px';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'dx-b'; b.innerHTML = CAL; b.setAttribute('aria-label', 'Open calendar');
    n.parentNode.insertBefore(wrap, n); wrap.append(t, b, n);
    n.classList.add('dx-n'); n.tabIndex = -1; n.setAttribute('aria-hidden', 'true');
    const get = () => desc.get.call(n), set = (v) => desc.set.call(n, v);
    const show = () => { t.value = toShow(get()); t.classList.remove('dx-bad'); t.disabled = n.disabled; };
    Object.defineProperty(n, 'value', { configurable: true, get, set(v) { set(v); show(); } });
    const fire = () => { n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
    const inRange = (iso) => (!n.min || iso >= n.min) && (!n.max || iso <= n.max);
    t.addEventListener('input', () => {
      t.value = mask(t.value);
      if (!t.value) { set(''); t.classList.remove('dx-bad'); fire(); return; }
      if (t.value.length < 10) { t.classList.remove('dx-bad'); return; }
      const iso = toIso(t.value);
      if (!iso || !inRange(iso)) { t.classList.add('dx-bad'); t.title = iso ? 'That day is outside the dates allowed' : 'Not a real date'; return; }
      t.classList.remove('dx-bad'); t.removeAttribute('title'); set(iso); fire();
    });
    t.addEventListener('blur', () => { if (t.value && t.value.length < 10 || t.classList.contains('dx-bad')) show(); });
    b.addEventListener('click', () => { if (t.disabled) return; try { n.showPicker ? n.showPicker() : n.click(); } catch { t.focus(); } });
    n.addEventListener('change', show); n.addEventListener('input', show);
    new MutationObserver(show).observe(n, { attributes: true, attributeFilter: ['value', 'disabled'] });
    show();
  }
  const sweep = (root) => { if (root.nodeType !== 1) return; if (root.matches && root.matches('input[type="date"]')) upgrade(root); if (root.querySelectorAll) root.querySelectorAll('input[type="date"]').forEach(upgrade); };
  const start = () => { sweep(document.body); new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(sweep))).observe(document.body, { childList: true, subtree: true }); };
  document.body ? start() : document.addEventListener('DOMContentLoaded', start);
})();
