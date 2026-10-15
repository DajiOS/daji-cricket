/*
 * Daji Cricket Ground: Wix custom elements.
 * In the Wix editor: Add, Embed code, Custom element, Choose source, Server URL = this file's address, Tag name = one of:
 *   daji-booking   the slot picker and payment          daji-account    "My dashboard" (customers and parents)
 *   daji-accounting the owner desk, books and academy   daji-scores     live scores
 *   daji-grounds, daji-gallery, daji-academy, daji-contact, daji-platform
 * Each one is a frame onto the Daji site, so the booking rules, payments and sign-in are exactly those of the real site.
 * The widget's own address is used as the server, so no settings are needed.
 */
(() => {
  'use strict';
  const me = document.currentScript;
  let origin = '';
  try { origin = new URL(me && me.src ? me.src : '', location.href).origin; } catch { /* leave empty */ }
  const WIDGETS = {
    'daji-booking': ['booking', ''], 'daji-account': ['account', '#bookings'], 'daji-accounting': ['desk', '#desk'], 'daji-scores': ['scores', ''],
    'daji-grounds': ['grounds', ''], 'daji-gallery': ['gallery', ''], 'daji-academy': ['academy', ''], 'daji-contact': ['contact', ''], 'daji-platform': ['platform', '#platform'],
  };
  const make = (kind, hash) => class extends HTMLElement {
    static get observedAttributes() { return ['server']; }
    connectedCallback() {
      if (this._f) return;
      this.style.display = 'block'; this.style.width = '100%';
      const f = document.createElement('iframe');
      const base = (this.getAttribute('server') || origin).replace(/\/$/, '');
      f.src = `${base}/?embed=${kind}${hash}`;
      f.title = 'Daji Cricket Ground';
      f.loading = 'lazy';
      f.allow = 'payment *; clipboard-write';
      f.style.cssText = 'width:100%;border:0;display:block;min-height:420px;background:#0a0c0b';
      f.setAttribute('scrolling', 'no');
      this._on = (e) => { if (e.source === f.contentWindow && e.data && e.data.daji === 'height') f.style.height = Math.max(320, Number(e.data.height) || 0) + 'px'; };
      window.addEventListener('message', this._on);
      this._f = f; this.appendChild(f);
    }
    disconnectedCallback() { window.removeEventListener('message', this._on); if (this._f) { this._f.remove(); this._f = null; } }
  };
  for (const [tag, [kind, hash]] of Object.entries(WIDGETS)) if (!customElements.get(tag)) customElements.define(tag, make(kind, hash));
})();
