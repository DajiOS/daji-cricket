// Daji Cricket Ground: the website. Plain JavaScript, no build step. Everything here talks to the same server's /api.
// When the pages live on Wix and the server on api.dajicricket.com, set window.DAJI_API = 'https://api.dajicricket.com' first.
(() => {
'use strict';

const API = (window.DAJI_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage can be blocked */ } },
};

// colour theme: the theme button at the top right, ?theme= in the address or the admin picker; remembered in this browser.
// On a festival day the server's festival calendar (/api/festival) switches the look by itself; see loadFestival().
const THEMES = [['obsidian', 'Onyx & gold', '#0a0c0b', '#c9a96b'], ['emerald', 'Pitch green & gold', '#0b2e23', '#d3b26a'], ['navy', 'Navy & brass', '#0e192d', '#c8a96b'], ['ivory', 'Ivory & emerald', '#f6f2e9', '#0f3d2e'], ['pearl', 'White, red & green', '#ffffff', '#b3261e'], ['rose-onyx', 'Onyx & rose gold', '#0b0909', '#d9a08e'], ['rose-plum', 'Plum & rose gold', '#150d14', '#e0a9a0'], ['rose-wine', 'Wine & rose gold', '#1c0a10', '#e8b09c'], ['rose-slate', 'Slate & rose gold', '#101417', '#dfa592'], ['slate-gold', 'Slate & gold', '#101417', '#c9a96b'], ['slate-black', 'Slate-black & gold', '#0a0d0f', '#c9a96b'], ['onyx-slate', 'Onyx & gold (slate glow)', '#0a0c0b', '#c9a96b'],
  // designer themes
  ['noir', 'Floodlight Noir', '#07090a', '#d6b36a'], ['pavilion', 'Emerald Pavilion', '#0b2a20', '#dcc289'], ['whites', 'Test Whites', '#fbfbf8', '#b3261e'], ['pinkball', 'Pink Ball Night', '#0b0c22', '#ff7ab6'], ['monsoon', 'Monsoon Glass', '#0d1a1e', '#7fd6c3'], ['maroon', 'Royal Maroon', '#260a10', '#e4bb6a'], ['carbon', 'Carbon T20', '#0c0e11', '#9fd8ff'], ['champagne', 'Champagne Minimal', '#ffffff', '#9a7a3e'], ['stadium', 'Stadium Royal Blue', '#06184a', '#ffcb3d'], ['willow', 'Willow & Leather', '#1c120b', '#dca66b'],
  // festival looks
  ['uttarayan', 'Uttarayan', '#eef6fc', '#d9461a'], ['tiranga', 'Tiranga (Republic and Independence Day)', '#fffdf8', '#c45800'], ['holi', 'Holi', '#fff8fc', '#c41f6f'], ['ganesh', 'Ganesh Chaturthi', '#2b0d06', '#ffa21a'], ['navratri', 'Navratri', '#1a0626', '#ffb703'], ['diwali', 'Diwali', '#0d0820', '#ffb547'], ['christmas', 'Christmas and New Year', '#0c1f17', '#d9b25e']];
const DESIGNER_THEMES = ['noir', 'pavilion', 'whites', 'pinkball', 'monsoon', 'maroon', 'carbon', 'champagne', 'stadium', 'willow'];
const FESTIVAL_THEMES = ['uttarayan', 'tiranga', 'holi', 'ganesh', 'navratri', 'diwali', 'christmas'];
const FEST_ICON = {
  uttarayan: '<path d="M12 2 20 11 12 20 4 11Z" fill="#e8501f"/><path d="M12 2v18M4 11h16" stroke="#fff" stroke-width="1.2"/><path d="M12 20c-1 2 1 2 0 4" stroke="#0a8ac8" stroke-width="1.4" fill="none"/>',
  tiranga: '<rect x="2" y="4" width="20" height="5" fill="#ff9933"/><rect x="2" y="9" width="20" height="6" fill="#fff" stroke="#ddd" stroke-width=".4"/><rect x="2" y="15" width="20" height="5" fill="#138808"/><circle cx="12" cy="12" r="2.2" fill="none" stroke="#000080" stroke-width=".8"/>',
  holi: '<circle cx="7" cy="8" r="4" fill="#f0479a"/><circle cx="16" cy="7" r="3.5" fill="#ffc800"/><circle cx="9" cy="16" r="3.6" fill="#00bedc"/><circle cx="17" cy="15.5" r="4" fill="#8c3cdc"/>',
  ganesh: '<path d="M6 15c0-5 2.7-9 6-11 3.3 2 6 6 6 11a6 6 0 0 1-12 0Z" fill="#ffa21a"/><path d="M8 14c1.5 1 6.5 1 8 0" stroke="#c42828" stroke-width="1.4" fill="none"/>',
  navratri: '<path d="M5 20 15 4M9 20 19 4" stroke="#ffb703" stroke-width="2" stroke-linecap="round"/><circle cx="15" cy="4" r="1.6" fill="#ff3ca0"/><circle cx="19" cy="4" r="1.6" fill="#00beb4"/>',
  diwali: '<path d="M12 3c2 3 2.6 5 0 8-2.6-3-2-5 0-8Z" fill="#ffc94d"/><path d="M3 13h18c-1 5-5 7-9 7s-8-2-9-7Z" fill="#e08a1e"/>',
  christmas: '<path d="M12 2l2.6 6.4 6.9.5-5.3 4.4 1.7 6.7L12 16.4 6.1 20l1.7-6.7L2.5 8.9l6.9-.5Z" fill="#d9b25e"/>',
};
/** Faces the newer themes use, fetched from Google Fonts only when that theme is shown. */
const THEME_FONTS = {
  noir: 'Bodoni+Moda:ital,wght@0,500;0,600;1,500&family=Manrope:wght@400;500;600;700', pavilion: 'Manrope:wght@400;500;600;700', whites: 'DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600',
  pinkball: 'Unbounded:wght@400;500;700&family=Sora:wght@400;500;600', monsoon: 'Syne:wght@500;600;700&family=Manrope:wght@400;500;600;700', maroon: 'Marcellus&family=Mulish:wght@400;500;600;700',
  carbon: 'Barlow+Condensed:ital,wght@0,400;0,600;0,800;1,800&family=Barlow:wght@400;500;600', champagne: 'Italiana&family=Jost:wght@300;400;500;600', stadium: 'Big+Shoulders+Display:wght@400;700;900&family=Figtree:wght@400;500;600;700',
  willow: 'Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,400&family=Karla:wght@400;500;600', uttarayan: 'Baloo+2:wght@400;500;600;700&family=Mulish:wght@400;500;600;700', tiranga: 'Baloo+2:wght@400;500;600;700&family=Mulish:wght@400;500;600;700',
  holi: 'Baloo+2:wght@400;500;600;700&family=Mulish:wght@400;500;600;700', ganesh: 'Yatra+One&family=Mulish:wght@400;500;600;700', navratri: 'Yatra+One&family=Mulish:wght@400;500;600;700', diwali: 'Yatra+One&family=Mulish:wght@400;500;600;700', christmas: 'Manrope:wght@400;500;600;700',
};
function loadThemeFonts(t) { const f = THEME_FONTS[t]; if (!f || document.getElementById('tf-' + t)) return; const l = document.createElement('link'); l.id = 'tf-' + t; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + f + '&display=swap'; document.head.appendChild(l); }
/** The ten designer themes change the whole home page, as in the design concepts: the hero layout, its decoration, the
 *  headline and the 3D scene (scene3d.js). layout: split (copy left, scene right), split-rev, center (scene above the
 *  copy), overlay (scene full width behind the copy, booking card floating on the right) or editorial (huge headline over
 *  copy and scene). g is the scene: spin (ball turning, optionally in gold rings), delivery (ball bowled into the stumps)
 *  or orbit (camera circling the wicket). The other themes keep the usual home page. */
const DESIGNS = {
  noir: { layout: 'split', decor: 'beams', eyebrow: 'Surat · Floodlit until 11 pm', h1: ['Floodlit ground.', '<em>Reserved</em> for you.'],
    lede: 'Choose your time, from early morning to late night. Pay the advance online and the wicket is held in your name.',
    g: { mode: 'delivery', parts: 'dust', pc: '#f6e3b0', key: '#fff3d8', rim: '#d6b36a', acc: '#ffd890', grass: ['#163a24', '#1b4529'], exp: 1.05 } },
  pavilion: { layout: 'center', decor: 'arcs', eyebrow: 'Turf wicket · Changing rooms · Parking', h1: ['Your match,', 'on <em>our</em> turf.'],
    lede: 'Pick a day, pick a time, pay a small advance. That is the whole booking, and you see what is free before you choose.',
    g: { mode: 'spin', rings: true, parts: 'dust', pc: '#e9d7a4', key: '#fff6e2', rim: '#dcc289', acc: '#3fa37a', exp: 1.1 } },
  whites: { layout: 'editorial', decor: 'rules', eyebrow: 'Full-size turf wicket · Surat', h1: ['Play it <em>proper.</em>'],
    lede: 'A full-size turf wicket, kept the way a Test match deserves. Book your slot in three taps and pay the advance online.',
    g: { mode: 'orbit', parts: 'none', key: '#ffffff', rim: '#ffe9c8', acc: '#ffffff', grass: ['#5d9a45', '#68a64e'], exp: 1.15, day: true } },
  pinkball: { layout: 'overlay', decor: 'none', eyebrow: 'Day-night cricket', h1: ['Bowl under', 'the <em>lights.</em>'],
    lede: 'Evening slots run until 11 pm with the floodlights on. Book tonight before someone else does.',
    g: { mode: 'delivery', parts: 'stars', pc: '#ffffff', key: '#e6e9ff', rim: '#ff7ab6', acc: '#ff9ccb', grass: ['#13253a', '#162b44'], exp: 1.1, ox: 0.2 } },
  monsoon: { layout: 'overlay', decor: 'glass', eyebrow: 'Rain or shine', h1: ['Book in', '<em>three</em> taps.'],
    lede: 'Day, time, pay. Every free slot is shown, so there is nothing to guess.',
    g: { mode: 'spin', parts: 'rain', pc: '#bfeee4', key: '#e6fff9', rim: '#7fd6c3', acc: '#3c8f9c', exp: 1.05, ox: 0.06, wet: true } },
  maroon: { layout: 'split-rev', decor: 'jali', eyebrow: 'Daji Cricket Ground · Surat', h1: ['A <em>royal</em> evening', 'of cricket.'],
    lede: 'Floodlit turf, changing rooms and parking on site. Reserve the ground for your team in under a minute.',
    g: { mode: 'spin', rings: true, parts: 'dust', pc: '#f0c97a', key: '#fff0dc', rim: '#e4bb6a', acc: '#b0303f', exp: 1.1 } },
  carbon: { layout: 'split', decor: 'grid', eyebrow: 'T20 nights · Leather and tennis ball', h1: ['Your squad.', '<em>Our</em> wicket.'],
    lede: 'Book the full ground for a T20 with your team, or a net for practice. Floodlights are switched on for you after 6 pm.',
    g: { mode: 'delivery', parts: 'dust', pc: '#cfeaff', key: '#eef6ff', rim: '#9fd8ff', acc: '#9fd8ff', grass: ['#14261d', '#182c22'], exp: 1.0 } },
  champagne: { layout: 'center', decor: 'quiet', eyebrow: 'Book a slot', h1: ['Cricket,', '<em>beautifully</em> simple.'],
    lede: 'One ground, clear prices and a booking that takes three taps. Pay a small advance and the slot is yours.',
    g: { mode: 'spin', parts: 'none', key: '#ffffff', rim: '#f2e2c2', acc: '#ffffff', exp: 1.2, day: true } },
  stadium: { layout: 'overlay', decor: 'blue', eyebrow: 'Matches · Nets · Tournaments', h1: ['Stadium nights', 'for <em>your</em> team.'],
    lede: 'Hire the floodlit ground for league matches and tournaments. Pick the date, pick the hours, pay the advance.',
    g: { mode: 'orbit', parts: 'dust', pc: '#ffe08a', key: '#fff7dc', rim: '#ffcb3d', acc: '#4f7dff', grass: ['#1c4a2c', '#21553a'], exp: 1.05, ox: 0.2 } },
  willow: { layout: 'editorial', decor: 'stitch', eyebrow: 'Leather ball · Tennis ball · Nets', h1: ['Willow, leather', 'and <em>a good wicket.</em>'],
    lede: 'Full-size turf for matches and practice nets for training. Book any of them in three taps.',
    g: { mode: 'spin', parts: 'dust', pc: '#f2c690', key: '#fff0dc', rim: '#dca66b', acc: '#9a5a2c', exp: 1.1 } },
};
let heroOrig = null;
function syncDesign() {
  const root = document.documentElement, t = root.getAttribute('data-theme'), hero = document.querySelector('#view-home header.hero');
  if (!hero) return;
  const d = !root.hasAttribute('data-embed') && !root.hasAttribute('data-embed-section') ? DESIGNS[t] : null;
  const h1 = hero.querySelector('h1'), lead = hero.querySelector('p.lead'), eye = document.getElementById('hero-eyebrow'), box = document.getElementById('hero-3d');
  if (!heroOrig) heroOrig = { h1: h1.innerHTML, lead: lead.textContent };
  if (!d) {
    if (!root.hasAttribute('data-layout')) return;
    root.removeAttribute('data-layout'); root.removeAttribute('data-decor');
    h1.innerHTML = heroOrig.h1; lead.textContent = heroOrig.lead; eye.hidden = true; box.hidden = true;
    if (window.DajiScene) window.DajiScene.unmount(); else window.DajiScenePending = null;
    return;
  }
  root.setAttribute('data-layout', d.layout); root.setAttribute('data-decor', d.decor);
  eye.textContent = d.eyebrow; eye.hidden = false;
  h1.innerHTML = d.h1.map((l) => `<span class="ln"><span>${l}</span></span>`).join(' ');
  lead.textContent = d.lede; box.hidden = false;
  if (window.DajiScene) window.DajiScene.mount(box, d.g); else window.DajiScenePending = { el: box, p: d.g };
}
/** Light pages use the brass logo; the dark ones keep the gold. */
const LIGHT_LOGO_THEMES = ['ivory', 'whites', 'champagne', 'uttarayan', 'tiranga', 'holi'];
function swapLogos() { const light = LIGHT_LOGO_THEMES.includes(document.documentElement.getAttribute('data-theme')); for (const i of document.querySelectorAll('img.wm-nav, .wmbox img')) { const want = light ? 'assets/logo-brass.svg' : 'assets/logo.svg'; if (i.getAttribute('src') !== want) i.setAttribute('src', want); } }
try { matchMedia('(min-width:1021px)').addEventListener('change', swapLogos); } catch { /* older browser: logo stays as loaded */ }
// A festival look is never saved as the visitor's own choice: it comes and goes with the festival.
function applyTheme(t, save) { if (!THEMES.some((x) => x[0] === t)) return; loadThemeFonts(t); document.documentElement.setAttribute('data-theme', t); swapLogos(); try { syncThemeIcon(); syncDesign(); syncFest(); } catch { /* not ready yet */ } if (save && !FESTIVAL_THEMES.includes(t)) store.set('daji.theme', t); }
/** The visitor's own look: what they picked in this browser, or Light. */
const ownTheme = () => { const s = store.get('daji.theme'); return s && s !== 'auto' && !FESTIVAL_THEMES.includes(s) && THEMES.some((x) => x[0] === s) ? s : 'ivory'; };
// light / dark icon at the far right of the top bar: ivory is the light look, obsidian the dark one
const DARK_THEMES = THEMES.filter((t) => { const h = t[2].slice(1); return (parseInt(h.slice(0, 2), 16) * 299 + parseInt(h.slice(2, 4), 16) * 587 + parseInt(h.slice(4, 6), 16) * 114) / 1000 < 110; }).map((t) => t[0]);
const isDarkTheme = () => DARK_THEMES.includes(document.documentElement.getAttribute('data-theme'));
function syncThemeIcon() { const b = document.getElementById('theme-toggle'); if (!b) return; const d = isDarkTheme(); b.setAttribute('aria-label', d ? 'Switch to light theme' : 'Switch to dark theme'); b.dataset.mode = d ? 'dark' : 'light'; }
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#theme-toggle')) { applyTheme(isDarkTheme() ? 'ivory' : 'obsidian', true); syncThemeIcon(); } });
// the theme button left of the light / dark switch: Light, Dark and the designer themes, plus today's festival look on a festival day
function themeMenu() {
  let m = document.getElementById('theme-menu');
  if (!m) {
    m = document.createElement('div'); m.id = 'theme-menu'; m.className = 'theme-menu'; m.hidden = true; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Colour theme');
    const item = (id, label, sub) => { const x = THEMES.find((t) => t[0] === id); return `<button type="button" role="menuitemradio" data-pick="${id}"><span class="sw" style="--sw-in:${x ? x[2] : 'conic-gradient(#ff9933,#f0479a,#ffb547,#138808,#ff9933)'};--sw:${x ? x[3] : '#d9b25e'}"></span><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></button>`; };
    const name = (id) => THEMES.find((t) => t[0] === id)[1];
    m.innerHTML = '<h6>Built in</h6>' + item('ivory', 'Light') + item('obsidian', 'Dark')
      + '<h6>Designer themes</h6>' + DESIGNER_THEMES.map((id) => item(id, name(id))).join('')
      + '<div id="theme-menu-fest"></div><p>Saved on this device only. On festival days the website dresses up by itself.</p>';
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; if (b.dataset.pick === 'festival' && fest.today) applyTheme(fest.today.look); else applyTheme(b.dataset.pick, true); markThemeMenu(); });
    document.body.appendChild(m);
  }
  return m;
}
function markThemeMenu() {
  const m = document.getElementById('theme-menu'); if (!m) return;
  const f = fest.today, slot = m.querySelector('#theme-menu-fest'), t = document.documentElement.getAttribute('data-theme');
  if (slot) slot.innerHTML = f ? `<h6>Today</h6><button type="button" role="menuitemradio" data-pick="festival"><span class="sw" style="--sw-in:${(THEMES.find((x) => x[0] === f.look) || [])[2] || '#fff'};--sw:${f.dayLook.colour || (THEMES.find((x) => x[0] === f.look) || [])[3] || '#d9b25e'}"></span><span></span></button>` : '';
  if (f && slot) { const sp = slot.querySelector('button span:last-child'); sp.textContent = f.name; const sm = document.createElement('small'); sm.textContent = f.of > 1 ? `Day ${f.day} of ${f.of}: ${f.dayLook.title}` : 'The festival look'; sp.appendChild(sm); }
  const cur = f && t === f.look ? 'festival' : t;
  for (const b of m.querySelectorAll('[data-pick]')) b.setAttribute('aria-checked', String(b.dataset.pick === cur));
}
function closeThemeMenu() { const m = document.getElementById('theme-menu'), b = document.getElementById('theme-pick'); if (m && !m.hidden) { m.hidden = true; if (b) b.setAttribute('aria-expanded', 'false'); } }
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#theme-pick');
  if (b) { const m = themeMenu(), open = m.hidden; m.hidden = !open; b.setAttribute('aria-expanded', String(open)); if (open) { markThemeMenu(); (m.querySelector('[aria-checked="true"]') || m.querySelector('button')).focus(); } return; }
  if (!(e.target.closest && e.target.closest('#theme-menu'))) closeThemeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = document.getElementById('theme-menu'); if (m && !m.hidden) { closeThemeMenu(); const b = document.getElementById('theme-pick'); if (b) b.focus(); } } });
try {
  const q = new URLSearchParams(location.search).get('theme'), saved = store.get('daji.theme');
  if (window.parent === window) { if (q) applyTheme(q, true); else applyTheme(ownTheme()); }
} catch { /* keep the default */ }
swapLogos();
// ------------------------------------------------------------------ festival days
// The owner keeps the festival calendar in the desk (Settings, Festivals). On a festival day the server says which festival
// and which of its days it is; the site then wears that look (for everyone, or only for visitors who have not picked a
// theme, as the owner chose), with the day's greeting, headline, colour, offer and decoration (festive.js). When the
// festival is over it goes back to the visitor's own look. New Year's Eve counts down to midnight India time.
// ?festival=<id>&day=<n> previews one festival day, ?fdate=YYYY-MM-DD shows a date, and ?fat=HH:MM:SS sets the time.
const fest = { today: null, forEveryone: true, skew: 0, params: null, orig: null, timer: 0, midnight: 0, celebrated: false };
const IST_MS = 5.5 * 3600000;
const istMidnightMs = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) - IST_MS; };
const nextDay = (iso) => new Date(Date.UTC(...iso.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) + 86400000).toISOString().slice(0, 10);
const festNow = () => Date.now() + fest.skew;
const festToday = () => new Date(festNow() + IST_MS).toISOString().slice(0, 10);
const scriptOf = (s) => (/[઀-૿]/.test(s) ? 'gu' : /[ऀ-ॿ]/.test(s) ? 'hi' : '');
const dm = (iso) => `${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]}`;
const festSpan = (f) => (f.from === f.to ? dm(f.from) : f.from.slice(5, 7) === f.to.slice(5, 7) ? `${+f.from.slice(8)} to ${dm(f.to)}` : `${dm(f.from)} to ${dm(f.to)}`);
const festMode = (f) => (f.date.endsWith('-01-01') ? 'newyear' : f.dayLook.countdown ? 'eve' : f.look === 'christmas' ? 'christmas' : '');
function festIcon(look) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = FEST_ICON[look] || FEST_ICON.diwali; return s; }
function localFonts(text) { if (!scriptOf(text) || document.getElementById('tf-local')) return; const l = document.createElement('link'); l.id = 'tf-local'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Hind+Vadodara:wght@500;600&family=Hind:wght@500;600&display=swap'; document.head.appendChild(l); }

async function loadFestival(next) {
  if (window.parent !== window || document.documentElement.hasAttribute('data-embed')) return;
  const p = fest.params || (fest.params = (() => { const q = new URLSearchParams(location.search), d = q.get('fdate'); return { id: q.get('festival'), day: Number(q.get('day')) || 1, date: d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null, at: q.get('fat') }; })());
  const pretend = !!(p.id || p.date);
  if (next && pretend) { if (p.id) p.day += 1; else p.date = nextDay(p.date); p.at = '00:00:05'; }
  let r;
  try { const res = await fetch(API + '/api/festival' + (p.id ? `?preview=${encodeURIComponent(p.id)}&day=${p.day}` : p.date ? `?date=${p.date}` : '')); if (!res.ok) return; r = await res.json(); } catch { return; }
  const f = r.festival || null;
  fest.forEveryone = r.forEveryone !== false;
  if (f && pretend) {
    // a preview stands on that day: the clock moves to it (?fat sets the time; 8 pm on a countdown day, noon on others)
    if (p.at !== undefined) { const [hh, mm, ss] = String(p.at || (f.dayLook.countdown ? '20:00:00' : '12:00:00')).split(':').map(Number); fest.skew = istMidnightMs(f.date) + ((hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0)) * 1000 - Date.now(); p.at = undefined; }
    if (p.id && p.day > f.of) { fest.today = null; festOff(); return; }
  } else if (!pretend) fest.skew = (r.time || Date.now()) - Date.now();
  const was = fest.today;
  fest.today = f; fest.celebrated = false;
  const saved = store.get('daji.theme'), picked = !!saved && saved !== 'auto' && !FESTIVAL_THEMES.includes(saved);
  if (f && (pretend || fest.forEveryone || !picked)) applyTheme(f.look);
  else if (was && document.documentElement.getAttribute('data-theme') === was.look) applyTheme(ownTheme());
  else syncFest();
  festBanner(); festTimers(); markThemeMenu();
}
function festOff() { festBanner(); festTimers(); const t = document.documentElement.getAttribute('data-theme'); if (FESTIVAL_THEMES.includes(t)) applyTheme(ownTheme()); else syncFest(); markThemeMenu(); }

/** The day's look on the home page: decoration, greeting, headline, colour, countdown and the offer on the booking card. */
function syncFest() {
  const root = document.documentElement, f = fest.today, t = root.getAttribute('data-theme');
  const hero = document.querySelector('#view-home header.hero'); if (!hero) return;
  const on = !!f && t === f.look && !root.hasAttribute('data-embed');
  const h1 = hero.querySelector('h1'), lead = hero.querySelector('p.lead');
  let layer = document.getElementById('fest-layer');
  if (!on) {
    if (layer) { if (window.DajiFestive) window.DajiFestive.unmount(); layer.remove(); }
    for (const id of ['fest-greet', 'fest-offer', 'fest-count']) { const el = document.getElementById(id); if (el) el.remove(); }
    root.removeAttribute('data-fest'); root.style.removeProperty('--fest-day');
    if (fest.orig && !DESIGNS[t]) { h1.innerHTML = fest.orig.h1; lead.textContent = fest.orig.lead; }
    fest.orig = null;
    return;
  }
  const d = f.dayLook;
  if (!fest.orig) fest.orig = { h1: h1.innerHTML, lead: lead.textContent };
  root.setAttribute('data-fest', f.look);
  if (d.colour) root.style.setProperty('--fest-day', d.colour); else root.style.removeProperty('--fest-day');
  // decoration, drawn again only when the day changes
  const key = `${f.id}:${f.day}:${festMode(f)}`;
  if (!layer) { layer = document.createElement('div'); layer.id = 'fest-layer'; layer.className = 'fest-layer'; layer.setAttribute('aria-hidden', 'true'); hero.appendChild(layer); }
  if (layer.dataset.key !== key && window.DajiFestive) { layer.dataset.key = key; window.DajiFestive.mount(layer, f.look, { colour: d.colour, mode: festMode(f) }); }
  // greeting chip above the headline, in English and Gujarati or Hindi
  let g = document.getElementById('fest-greet');
  if (!g) { g = document.createElement('p'); g.id = 'fest-greet'; g.className = 'fest-greet'; h1.parentNode.insertBefore(g, h1); }
  g.textContent = ''; g.append(festIcon(f.look));
  const en = document.createElement('span'); en.textContent = d.greeting || f.name; g.append(en);
  if (d.local) { localFonts(d.local); const lo = document.createElement('span'); lo.className = 'fg-local'; lo.lang = scriptOf(d.local) || 'hi'; lo.textContent = d.local; g.append(lo); }
  // headline and lead line of the day
  if (d.headline || d.headline2) {
    h1.textContent = '';
    for (const [i, text] of [d.headline, d.headline2].entries()) { if (!text) continue; const ln = document.createElement('span'); ln.className = 'ln'; const sp = document.createElement('span'); if (i === 1) sp.className = 'fest-h2'; sp.textContent = text; ln.append(sp); h1.append(ln, ' '); }
  }
  if (d.lede) lead.textContent = d.lede;
  // the festival offer on the booking card
  let o = document.getElementById('fest-offer');
  if (f.offer) {
    if (!o) { o = document.createElement('div'); o.id = 'fest-offer'; o.className = 'fest-offer'; const sub = document.getElementById('p-sub'); if (sub) sub.after(o); }
    o.textContent = ''; o.append(festIcon(f.look)); const s = document.createElement('span'); s.textContent = f.offer; o.append(s);
  } else if (o) o.remove();
  festTick();
}

/** The strip at the very top: the festival, which day it is, the dates, the offer, and the countdown on New Year's Eve. */
function festBanner() {
  const view = document.getElementById('view-home'), f = fest.today;
  let b = document.getElementById('fest-banner');
  if (!f || !view) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'fest-banner'; b.className = 'fest-banner'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Festival'); }
  placeBanner(b);
  b.dataset.look = f.look; b.textContent = '';
  const inner = document.createElement('div'); inner.className = 'fb-in';
  const add = (cls, text, tag = 'span') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; inner.append(e); return e; };
  inner.append(festIcon(f.look));
  add('fb-greet', f.dayLook.greeting || f.name, 'b');
  if (f.dayLook.local) { const lo = add('fb-local', f.dayLook.local); lo.lang = scriptOf(f.dayLook.local) || 'hi'; localFonts(f.dayLook.local); }
  add('fb-meta', [f.name, f.of > 1 ? `Day ${f.day} of ${f.of}${f.dayLook.title && f.dayLook.title !== f.name ? ': ' + f.dayLook.title : ''}` : '', festSpan(f)].filter(Boolean).join(' · '));
  const c = add('fb-count', ''); c.id = 'fb-count'; c.hidden = true; c.setAttribute('role', 'timer');
  if (f.offer) add('fb-offer', f.offer);
  b.append(inner);
}

// across the top on a computer; under the top bar on a phone, where the theme buttons float over the top edge
const narrow = (() => { try { return matchMedia('(max-width:1020px)'); } catch { return { matches: false, addEventListener() {} }; } })();
function placeBanner(b) {
  const view = document.getElementById('view-home'), nav = view && view.querySelector('.wrap > nav');
  b.classList.toggle('fb-under', !!(narrow.matches && nav));
  if (narrow.matches && nav) { if (nav.nextSibling !== b) nav.after(b); } else if (view.firstChild !== b) view.insertBefore(b, view.firstChild);
}
try { narrow.addEventListener('change', () => { const b = document.getElementById('fest-banner'); if (b) placeBanner(b); }); } catch { /* older browser: stays where it was put */ }
function festTimers() {
  clearInterval(fest.timer); fest.timer = 0; clearTimeout(fest.midnight);
  const f = fest.today;
  if (f && f.countdownTo) { fest.timer = setInterval(festTick, 1000); festTick(); return; }
  // look again just after midnight India time, so a page left open moves to the next day (or out of the festival)
  const p = fest.params || {};
  if (p.id || p.date) return;
  const wait = istMidnightMs(nextDay(festToday())) - festNow() + 2000;
  fest.midnight = setTimeout(() => loadFestival(), Math.min(Math.max(wait, 5000), 2147483000));
}
const two = (n) => String(n).padStart(2, '0');
function festTick() {
  const f = fest.today; if (!f || !f.countdownTo) return;
  const now = festNow(), left = f.countdownTo - now, year = new Date(f.countdownTo + IST_MS).getUTCFullYear();
  const showing = now >= (f.countdownStart || 0) && left > 0;
  const hh = Math.floor(left / 3600000), mm = Math.floor(left / 60000) % 60, ss = Math.floor(left / 1000) % 60;
  const bc = document.getElementById('fb-count');
  if (bc) { bc.hidden = !showing; if (showing) bc.textContent = `${hh}h ${two(mm)}m ${two(ss)}s to ${year}`; }
  const hero = document.querySelector('#view-home header.hero h1'), on = document.documentElement.getAttribute('data-fest') === f.look;
  let box = document.getElementById('fest-count');
  if (showing && on && hero) {
    if (!box) {
      box = document.createElement('div'); box.id = 'fest-count'; box.className = 'fest-count'; box.setAttribute('role', 'timer'); box.setAttribute('aria-label', `Countdown to ${year}`);
      box.innerHTML = '<div><b></b><span>hours</span></div><div><b></b><span>minutes</span></div><div><b></b><span>seconds</span></div><p></p>';
      hero.after(box);
    }
    const bs = box.querySelectorAll('b'); bs[0].textContent = two(hh); bs[1].textContent = two(mm); bs[2].textContent = two(ss);
    box.querySelector('p').textContent = `to ${year}`;
  } else if (box && !(left <= 0 && fest.celebrated)) box.remove();
  if (left <= 0 && !fest.celebrated) festCelebrate(year);
}
/** Midnight: Happy New Year, fireworks, then the New Year's Day look. */
function festCelebrate(year) {
  fest.celebrated = true; clearInterval(fest.timer); fest.timer = 0;
  const h1 = document.querySelector('#view-home header.hero h1'), box = document.getElementById('fest-count'), bc = document.getElementById('fb-count');
  if (box) box.remove();
  if (bc) { bc.hidden = false; bc.textContent = `Happy New Year ${year}!`; }
  if (h1 && document.documentElement.getAttribute('data-fest')) {
    h1.textContent = ''; const a = document.createElement('span'); a.className = 'ln'; a.innerHTML = '<span></span>'; a.firstChild.textContent = 'Happy New Year'; const b = document.createElement('span'); b.className = 'ln'; b.innerHTML = '<span class="fest-h2"></span>'; b.firstChild.textContent = `${year}!`; h1.append(a, ' ', b);
    h1.classList.add('fest-pop');
  }
  if (window.DajiFestive) window.DajiFestive.celebrate();
  setTimeout(() => loadFestival(true), 9000);
}
loadFestival();

const state = {
  config: null, grounds: [], ground: null, date: null, slots: [], sel: [],
  token: store.get('daji.token'), user: null, creditPaise: 0, useCredit: false, loading: false,
};

// ------------------------------------------------------------------ small helpers

/** Builds DOM without innerHTML, so a customer's name or message can never become markup. */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return e;
}
const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

const inr = (p) => { const r = p / 100; return '₹' + r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 }); };
const IST = 330 * 60000;
const ist = (ms) => new Date(ms + IST);
const pad = (n) => String(n).padStart(2, '0');
const istToday = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
/** "27:00" (closing past midnight) → "03:00". */
const clock = (t) => { const [a, b] = String(t).split(':').map(Number); return `${pad(a % 24)}:${pad(b)}`; };
/** Opening and closing for a ground on a date (YYYY-MM-DD), allowing for winter hours (Nov–Feb unless set otherwise). */
function hoursFor(g, date) {
  const m = Number((date || '').slice(5, 7)), a = g.winterFromMonth || 11, b = g.winterToMonth || 2;
  const w = g.winterOpenTime && g.winterCloseTime && (a <= b ? m >= a && m <= b : m >= a || m <= b);
  return w ? [g.winterOpenTime, g.winterCloseTime] : [g.openTime, g.closeTime];
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** [2,3,4,5,6,0] → "Tue–Sun"; runs of consecutive days (Monday first) are joined. */
function dayRange(days) {
  const order = [1, 2, 3, 4, 5, 6, 0], on = order.filter((d) => days.includes(d)), parts = [];
  for (let i = 0; i < on.length;) { let j = i; while (j + 1 < on.length && order.indexOf(on[j + 1]) === order.indexOf(on[j]) + 1) j++; parts.push(j - i >= 1 ? (j - i === 1 ? `${DAY_NAMES[on[i]]}, ${DAY_NAMES[on[j]]}` : `${DAY_NAMES[on[i]]}–${DAY_NAMES[on[j]]}`) : DAY_NAMES[on[i]]); i = j + 1; }
  return parts.join(', ');
}
// "7 pm" slot starting at 19:00 reads "7–8 pm"; the suffix is repeated only when it changes ("11 pm–12 am").
const hourSpan = (t) => { const [a, b] = t.split(':').map(Number); const m = (a % 24) * 60 + (b || 0), e = (m + 60) % 1440, f = (x) => { const hh = Math.floor(x / 60), mm = x % 60; return [`${hh % 12 || 12}${mm ? ':' + pad(mm) : ''}`, hh < 12 ? 'am' : 'pm']; }; const [s1, s2] = f(m), [e1, e2] = f(e); return s2 === e2 ? `${s1}–${e1} ${s2}` : `${s1} ${s2}–${e1} ${e2}`; };
const niceHour = (t) => { const [a, b] = t.split(':').map(Number), x = a % 24; return `${x % 12 || 12}${b ? ':' + pad(b) : ''} ${x < 12 ? 'am' : 'pm'}`; };
const BALL_SHORT = { combo: 'Red & White combo ball', leather: 'Leather ball', red: 'Leather ball', white: 'Leather ball', tennis: 'Tennis ball', practice: 'Practice session' };
const money = (paise) => inr(paise);
/** The cheapest hourly price (or, with none, the cheapest session) for the "From" line. */
function fromPrice(g) {
  const hourly = (g.rates || []).filter((r) => r.mode === 'hourly');
  if (hourly.length) return { paise: Math.min(...hourly.map((r) => r.pricePaise)), unit: ' / hour' };
  return { paise: Math.min(...g.rates.map((r) => r.pricePaise)), unit: ' / session' };
}
const priceText = (r) => (r.mode === 'hourly' ? `${money(r.pricePaise)} / hour` : money(r.pricePaise));
/** The price list as readable lines, grouped by ball. */
function rateCardEl(g) {
  const box = h('div', { class: 'ratecard' }), cols = h('div', { class: 'rc-cols' });
  for (const ball of ['leather', 'tennis', 'practice']) {
    const rows = g.rates.filter((r) => r.ball === ball).sort((a, b) => a.from.localeCompare(b.from));
    if (!rows.length) continue;
    const col = h('div', { class: 'rc-col ball-' + ball }, h('div', { class: 'eyebrow' }, BALL_SHORT[ball]));
    for (const r of rows) col.append(h('div', { class: 'rc-tile' }, h('div', { class: 'rb' }, r.label), h('div', { class: 'rd' }, `${dayRange(r.days)} · ${niceHour(r.from)} – ${niceHour(r.to)}${r.bundleDays > 1 ? ` (${r.bundleDays} days)` : ''}`), h('b', {}, priceText(r))));
    cols.append(col);
  }
  box.append(cols);
  if (g.closedDays && g.closedDays.length) box.append(h('div', { class: 'rl closed' }, `Closed every ${g.closedDays.map((d) => DAY_FULL[d]).join(' and ')}${g.closedDays.length === 1 ? ' for maintenance' : ''}.`));
  if (g.ratesNote) box.append(h('div', { class: 'rl closed' }, g.ratesNote));
  return box;
}
const hhmm = (ms) => { const d = ist(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const todayIst = () => ist(Date.now()).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const parts = (date) => { const d = new Date(date + 'T00:00:00Z'); return { dow: DOW[d.getUTCDay()], day: d.getUTCDate(), mon: MON[d.getUTCMonth()] }; };
/** The first day a customer can book: today, or the opening day when bookings have not opened yet. */
const firstDay = () => { const t = todayIst(), o = state && state.config && state.config.bookingsOpenFrom; return o && o > t ? o : t; };
/** The last day a customer can book: a year ahead, or the day before bookings close. */
const lastDay = () => { const mx = addDays(todayIst(), (state.config && state.config.maxDaysAhead) || 365), c = state.config && state.config.bookingsCloseFrom; return c && addDays(c, -1) < mx ? addDays(c, -1) : mx; };
const niceDate = (date) => { const p = parts(date); return `${p.dow} ${p.day} ${p.mon}` + (date.slice(0, 4) !== todayIst().slice(0, 4) ? ` ${date.slice(0, 4)}` : ''); };
const niceDateTime = (ms) => { const d = ist(ms); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${hhmm(ms)}`; };

let toastTimer = 0;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), bad ? 6500 : 3800);
}

class ApiError extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; } }

const OWNER_SCOPED = ['/api/tasks', '/api/projects', '/api/staff', '/api/accounting', '/api/books', '/api/media', '/api/ask'];
async function api(path, opts = {}) {
  if (state.user && state.user.role === 'super_admin' && state.viewOwner && OWNER_SCOPED.some((p) => path.startsWith(p)) && !/[?&]ownerId=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'ownerId=' + encodeURIComponent(state.viewOwner);
  const headers = {};
  if (state.token) headers.authorization = 'Bearer ' + state.token;
  let body;
  if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  let res;
  try { res = await fetch(API + path, { method: opts.method || 'GET', headers, body }); }
  catch { throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is it running?'); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const e = (data && data.error) || {};
    if (res.status === 401 && state.token && !opts.keepToken) signOut(true);
    throw new ApiError(res.status, e.code || 'ERROR', e.message || `Something went wrong (${res.status}).`, e.details);
  }
  return data;
}

const deskTabs = [], bookingsExtras = [], adminPanels = [];
const can = (u, perm) => !perm || u.role === 'owner' || u.role === 'super_admin' || (u.permissions || []).includes(perm);

/** Sends a file (or any bytes) as the whole request body, for receipts and bank statements. */
async function apiFile(path, file, opts = {}) {
  const headers = { 'content-type': 'application/octet-stream', ...(opts.headers || {}) };
  if (state.token) headers.authorization = 'Bearer ' + state.token;
  let res;
  try { res = await fetch(API + path, { method: opts.method || 'POST', headers, body: file }); }
  catch { throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is it running?'); }
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) { const e = (data && data.error) || {}; throw new ApiError(res.status, e.code || 'ERROR', e.message || `Something went wrong (${res.status}).`, e.details); }
  return data;
}
/** Downloads a file the server makes (report, receipt). The sign-in token travels in a header, so it is fetched first and then saved. */
async function apiDownload(path, filename) {
  const headers = {}; if (state.token) headers.authorization = 'Bearer ' + state.token;
  let res; try { res = await fetch(API + path, { headers }); } catch { throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is it running?'); }
  if (!res.ok) { let e = {}; try { e = (await res.json()).error || {}; } catch { /* not JSON */ } throw new ApiError(res.status, e.code || 'ERROR', e.message || 'The download failed.'); }
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

window.DAJI = { refreshCoaches: () => fillCoaches(), h, clear, $, $$, api, apiFile, apiDownload, ApiError, fieldErrors: null, toast, openModal, closeModal, field, input, inr, niceDate, todayIst, addDays, hhmm, niceDateTime, state, can, MON,
  deskSub: (tab, sub, quiet) => deskNav(tab, sub, quiet), registerDeskTab: (t) => deskTabs.push(t), registerBookingsExtra: (f) => bookingsExtras.push(f), registerAdminPanel: (f) => adminPanels.push(f) };

const fieldErrors = (e) => Object.fromEntries(((e.details && e.details.fields) || []).map((f) => [f.field, f.message]));
window.DAJI.fieldErrors = fieldErrors;

// ------------------------------------------------------------------ dialogs

function openModal(content, { wide = false, onClose, photo = false } = {}) {
  const sheet = clear($('#sheet'));
  sheet.classList.toggle('wide', wide); sheet.classList.toggle('photo', photo);
  sheet.append(h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: () => closeModal() }, '×'), ...[].concat(content).filter((x) => x != null));
  $('#modal').classList.add('open');
  $('#modal')._onClose = onClose || null;
  const first = $('input,textarea,select,button.primary', sheet); if (first && !matchMedia('(pointer:coarse)').matches) first.focus();
}
function closeModal() {
  const m = $('#modal');
  m.classList.remove('open');
  const f = m._onClose; m._onClose = null;
  if (f) f();
}
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').classList.contains('open')) closeModal(); });

function field(label, input, err) { return h('label', { class: 'field' }, h('span', {}, label), input, err ? h('div', { class: 'fe' }, err) : null); }
function input(name, type = 'text', attrs = {}) { return h('input', { name, type, autocomplete: attrs.autocomplete, ...attrs }); }

/** Calling codes offered in front of a mobile number. India first: it is the default. */
const COUNTRY_CODES = [['+91', 'India'], ['+971', 'UAE'], ['+44', 'UK'], ['+1', 'USA / Canada'], ['+61', 'Australia'], ['+64', 'New Zealand'], ['+65', 'Singapore'],
  ['+966', 'Saudi Arabia'], ['+974', 'Qatar'], ['+968', 'Oman'], ['+965', 'Kuwait'], ['+973', 'Bahrain'], ['+977', 'Nepal'], ['+880', 'Bangladesh'], ['+94', 'Sri Lanka'],
  ['+60', 'Malaysia'], ['+27', 'South Africa'], ['+254', 'Kenya'], ['+49', 'Germany'], ['+353', 'Ireland']];
function countrySelect(value = '+91') {
  return h('select', { name: 'countryCode', 'aria-label': 'Country code', autocomplete: 'tel-country-code', style: 'width:118px;flex:0 0 118px;padding:0 8px' },
    COUNTRY_CODES.map(([c, n]) => h('option', { value: c, selected: c === value, title: n }, `${c} ${n}`)));
}
/** The country code picker and the number side by side. */
const phoneRow = (cc, phone) => h('div', { style: 'display:flex;gap:8px;align-items:flex-end' }, cc, phone);
/** Splits a saved number into the country code and the rest, for a form. Indian numbers are saved as 10 digits, others as +E.164. */
function splitPhone(p) {
  if (!p || p[0] !== '+') return ['+91', p || ''];
  const c = COUNTRY_CODES.map((x) => x[0]).sort((a, b) => b.length - a.length).find((x) => p.startsWith(x));
  return c ? [c, p.slice(c.length)] : ['+91', p];
}

// ------------------------------------------------------------------ sign in

function setUser(auth) {
  state.token = auth.token; state.user = auth.user;
  store.set('daji.token', auth.token);
  renderAuth();
}
function signOut(silent) {
  // tell the server first, so the token stops working everywhere (a 401 means it already has)
  if (state.token && !silent) { try { fetch(API + '/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + state.token }, keepalive: true }).catch(() => {}); } catch { /* offline: the token still expires */ } }
  state.token = null; state.user = null; state.creditPaise = 0; state.useCredit = false;
  store.set('daji.token', null);
  renderAuth(); renderCreditRow();
  if (!silent) toast('Signed out.');
  if (location.hash === '#bookings' || DESK_HASH.test(location.hash)) location.hash = '';
  route();
}

/** The sign in / create account page. `after` runs once the person is signed in (for example, holding the slots they chose). */
function openAuth({ after, mode = 'in', note } = {}) {
  const cfg = state.config || {};
  let current = mode;
  const body = h('div');
  let method = 'pw'; // default: email or mobile and password; a phone code is the small alternative
  /** Capital first letter on every part of a name, as the person types. */
  const capName = (el) => el.addEventListener('input', () => { const p = el.selectionStart; el.value = el.value.replace(/(^|[\s'’-])(\p{L})/gu, (_m, a, c) => a + c.toUpperCase()); try { el.setSelectionRange(p, p); } catch { /* not supported */ } });
  /** Phone number, then the code sent to it. Creates the account when the number is new. */
  const otpForm = (signUp) => {
    const form = h('form', { novalidate: true }), errBox = h('div', { class: 'fe', style: 'margin:0 0 12px' });
    const first = input('firstName', 'text', { autocomplete: 'given-name', autocapitalize: 'words', placeholder: 'First name' }), last = input('lastName', 'text', { autocomplete: 'family-name', autocapitalize: 'words', placeholder: 'Last name' });
    capName(first); capName(last);
    const phone = input('phone', 'tel', { autocomplete: 'tel', inputmode: 'numeric', required: true, placeholder: '98765 43210' });
    const code = input('code', 'text', { autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: '8', placeholder: '6-digit code' });
    const cE = h('input', { type: 'checkbox' }), cW = h('input', { type: 'checkbox' }), cS = h('input', { type: 'checkbox' });
    const namesRow = h('div', { class: 'namesrow' }, field('First name', first), field('Last name', last));
    const codeRow = h('div', {}, field('Code from WhatsApp', code)), info = h('div', { class: 'hint', style: 'margin:0 0 10px' });
    const consent = h('div', {}, h('p', { class: 'hint', style: 'margin:6px 0 10px' }, 'Optional: ground updates (closed days, rain, new timings). You can change this any time. Booking messages are always sent.'),
      h('label', { class: 'check' }, cE, h('span', {}, 'Email me ground updates')), h('label', { class: 'check' }, cW, h('span', {}, 'WhatsApp me ground updates')), h('label', { class: 'check' }, cS, h('span', {}, 'Text me ground updates')));
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Send me a code');
    let sent = false, wait = 0, timer = null;
    namesRow.hidden = !signUp; consent.hidden = !signUp; codeRow.hidden = true; info.hidden = true;
    const resend = h('button', { type: 'button', class: 'linkbtn', hidden: true }, 'Send a new code');
    const tick = () => { if (wait > 0) { resend.disabled = true; resend.textContent = `Send a new code in ${wait}s`; wait--; timer = setTimeout(tick, 1000); } else { resend.disabled = false; resend.textContent = 'Send a new code'; } };
    const send = async () => {
      errBox.textContent = ''; submit.disabled = true;
      try {
        const r = await api('/api/auth/otp/request', { method: 'POST', body: { phone: phone.value.trim() } });
        sent = true; codeRow.hidden = false; info.hidden = false; resend.hidden = false; phone.readOnly = true; wait = 30; clearTimeout(timer); tick();
        clear(info); info.append(`We sent a 6-digit code to ${formatPhone(phone.value.trim())}. It works for 10 minutes.`);
        if (r.devCode) info.append(h('div', { style: 'margin-top:6px;color:var(--accent,#c9a96a)' }, `Demo mode: no WhatsApp message is sent. Your code is ${r.devCode}.`));
        submit.textContent = signUp ? 'Create my account' : 'Sign in'; code.focus();
      } catch (e) { const f = fieldErrors(e); errBox.textContent = f.phone || e.message; }
      submit.disabled = false;
    };
    resend.addEventListener('click', send);
    form.append(namesRow, field('Mobile number', phone), info, codeRow, resend, consent, errBox, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!sent) { if (signUp && (!first.value.trim() || !last.value.trim())) { errBox.textContent = 'Enter your first and last name.'; return; } await send(); return; }
      errBox.textContent = ''; submit.disabled = true;
      try {
        const body = { phone: phone.value.trim(), code: code.value.trim(), ...(first.value.trim() && last.value.trim() ? { firstName: first.value.trim(), lastName: last.value.trim() } : {}), consent: { email: cE.checked, whatsapp: cW.checked, sms: cS.checked } };
        const a = await api('/api/auth/otp/verify', { method: 'POST', body, keepToken: true });
        finishAuth(a, after);
      } catch (e) {
        if (e.code === 'NAME_REQUIRED') { namesRow.hidden = false; consent.hidden = false; submit.textContent = 'Create my account'; errBox.textContent = e.message; first.focus(); }
        else errBox.textContent = e.message;
        submit.disabled = false;
      }
    });
    return form;
  };
  /** Forgot password: a code goes to the email, then the code and a new password. Also gives a password to someone who never had one. */
  const forgotForm = () => {
    const form = h('form', { novalidate: true }), errBox = h('div', { class: 'fe', style: 'margin:0 0 12px' }), info = h('div', { class: 'hint', style: 'margin:0 0 12px' });
    const email = input('email', 'email', { autocomplete: 'email', required: true, autocapitalize: 'none', spellcheck: 'false' });
    const code = input('code', 'text', { autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: '8' }), password = input('password', 'password', { autocomplete: 'new-password' });
    const codeRow = h('div', { hidden: true }, field('Code from the email', code), field('New password', password), h('div', { class: 'hint', style: 'margin:-4px 0 12px;font-size:12px' }, 'At least 8 characters with a capital letter, a small letter and a number.'));
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Email me a code');
    let sent = false;
    form.append(h('p', { class: 'hint', style: 'margin:0 0 12px' }, 'Enter the email on your account and we will send you a code to set a new password.'), field('Email', email), info, codeRow, errBox, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); errBox.textContent = ''; submit.disabled = true;
      try {
        if (!sent) {
          const r = await api('/api/auth/password/forgot', { method: 'POST', body: { email: email.value.trim() } });
          sent = true; codeRow.hidden = false; submit.textContent = 'Set new password';
          info.textContent = `If ${email.value.trim()} has an account, a code is on its way. It works for ${Math.round(r.expiresInSeconds / 60)} minutes. Check your spam folder too.`;
          if (r.devCode) info.append(h('div', { style: 'margin-top:6px;color:var(--accent,#c9a96a)' }, `Demo mode: no email is sent. Your code is ${r.devCode}.`));
          code.focus();
        } else {
          await api('/api/auth/password/reset', { method: 'POST', body: { email: email.value.trim(), code: code.value.trim(), password: password.value } });
          toast('Password changed. You are signed out on other devices.');
          try { const a = await api('/api/auth/login', { method: 'POST', body: { identifier: email.value.trim(), password: password.value }, keepToken: true }); finishAuth(a, after); }
          catch { method = 'pw'; render(); }
          return;
        }
      } catch (e) { const f = fieldErrors(e); errBox.textContent = f.password || f.email || f.code || e.message; }
      submit.disabled = false;
    });
    return form;
  };
  let upMethod = cfg.codesEnabled ? 'otp' : 'email';
  /** Create an account with an email, a mobile number and a password. Either the email or the number signs in afterwards. */
  const emailSignup = () => {
    const form = h('form', { novalidate: true }), errBox = h('div', { class: 'fe', style: 'margin:0 0 12px' });
    const first = input('firstName', 'text', { autocomplete: 'given-name', autocapitalize: 'words', placeholder: 'First name', required: true }), last = input('lastName', 'text', { autocomplete: 'family-name', autocapitalize: 'words', placeholder: 'Last name', required: true });
    capName(first); capName(last);
    const email = input('email', 'email', { autocomplete: 'email', required: true }), phone = input('phone', 'tel', { autocomplete: 'tel-national', inputmode: 'tel', required: true, placeholder: '98765 43210', style: 'flex:1 1 auto;min-width:0' }), password = input('password', 'password', { autocomplete: 'new-password', required: true });
    const cc = countrySelect();
    const cE = h('input', { type: 'checkbox' }), cW = h('input', { type: 'checkbox' }), cS = h('input', { type: 'checkbox' });
    const fe = { firstName: h('div', { class: 'fe' }), lastName: h('div', { class: 'fe' }), email: h('div', { class: 'fe' }), phone: h('div', { class: 'fe' }), countryCode: h('div', { class: 'fe' }), password: h('div', { class: 'fe' }) };
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Create account');
    form.append(h('div', { class: 'namesrow' }, h('label', { class: 'field' }, h('span', {}, 'First name'), first, fe.firstName), h('label', { class: 'field' }, h('span', {}, 'Last name'), last, fe.lastName)),
      h('label', { class: 'field' }, h('span', {}, 'Email'), email, fe.email), h('label', { class: 'field' }, h('span', {}, 'Mobile number'), phoneRow(cc, phone), fe.phone, fe.countryCode),
      h('label', { class: 'field' }, h('span', {}, 'Password'), password, fe.password, h('div', { class: 'hint', style: 'margin-top:6px;font-size:12px' }, 'At least 8 characters with a capital letter, a small letter and a number.')),
      h('p', { class: 'hint', style: 'margin:6px 0 10px' }, 'Optional: ground updates (closed days, rain, new timings). You can change this any time. Booking messages are always sent.'),
      h('label', { class: 'check' }, cE, h('span', {}, 'Email me ground updates')), h('label', { class: 'check' }, cW, h('span', {}, 'WhatsApp me ground updates')), h('label', { class: 'check' }, cS, h('span', {}, 'Text me ground updates')), errBox, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); errBox.textContent = ''; for (const k in fe) fe[k].textContent = ''; submit.disabled = true;
      try {
        const a = await api('/api/auth/register', { method: 'POST', body: { firstName: first.value.trim(), lastName: last.value.trim(), email: email.value.trim(), countryCode: cc.value, phone: phone.value.trim(), password: password.value, consent: { email: cE.checked, whatsapp: cW.checked, sms: cS.checked } }, keepToken: true });
        finishAuth(a, after);
      } catch (e) { const f = fieldErrors(e); for (const k in fe) if (f[k]) fe[k].textContent = f[k]; if (!Object.keys(f).length) errBox.textContent = e.message; submit.disabled = false; }
    });
    return form;
  };
  const render = () => {
    clear(body);
    if (current === 'up') {
      const pick = (m, text) => h('button', { type: 'button', class: 'tab' + (upMethod === m ? ' on' : ''), onclick: () => { upMethod = m; render(); } }, text);
      body.append(h('div', { class: 'tabs', style: 'margin:0 0 16px' }, ...(cfg.codesEnabled ? [pick('otp', 'With my mobile number'), pick('email', 'With my email')] : [])), upMethod === 'otp' ? otpForm(true) : emailSignup());
      return;
    }
    if (method === 'otp') {
      body.append(otpForm(false), h('div', { style: 'margin-top:14px' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => { method = 'pw'; render(); } }, 'Use my password instead')));
      return;
    }
    if (method === 'forgot') {
      body.append(forgotForm(), h('div', { style: 'margin-top:14px' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => { method = 'pw'; render(); } }, 'Back to sign in')));
      return;
    }
    const errBox = h('div', { class: 'fe', style: 'margin:0 0 12px' });
    const form = h('form', { novalidate: true });
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');
    const email = input('email', 'text', { autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: 'false', placeholder: 'Email or mobile number', style: 'flex:1 1 auto;min-width:0' });
    const password = input('password', 'password', { autocomplete: 'current-password', required: true });
    // The country code picker shows once the person starts typing a number without its own +code.
    const cc = countrySelect(), isNumber = () => /^[\d\s()-]+$/.test(email.value.trim());
    const syncCc = () => { cc.hidden = !isNumber(); };
    email.addEventListener('input', syncCc); syncCc();
    form.append(field('Email or mobile number', phoneRow(cc, email)), field('Password', password), errBox, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); errBox.textContent = ''; submit.disabled = true;
      try { const a = await api('/api/auth/login', { method: 'POST', body: { identifier: email.value.trim(), password: password.value, ...(isNumber() ? { countryCode: cc.value } : {}) }, keepToken: true }); finishAuth(a, after); }
      catch (e) { errBox.textContent = e.message; submit.disabled = false; }
    });
    const forgotLink = h('div', { style: 'margin-top:14px' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => { method = 'forgot'; render(); } }, 'Forgot password?'));
    if (cfg.demoMode) {
      const fill = (e, p) => { email.value = e; password.value = p; form.requestSubmit(); };
      body.append(form, h('div', { class: 'demo' }, 'Demo mode is on. Try: ',
        h('button', { type: 'button', onclick: () => fill('customer@daji.test', 'Customer@12345') }, 'customer'), ' · ',
        h('button', { type: 'button', onclick: () => fill('owner1@daji.test', 'Owner@12345') }, 'owner'), ' · ',
        h('button', { type: 'button', onclick: () => fill('staff1@daji.test', 'Staff@12345') }, 'staff'), ' · ',
        h('button', { type: 'button', onclick: () => fill('admin@daji.test', 'Admin@12345') }, 'super admin')), forgotLink);
    } else body.append(form, forgotLink);
  };
  const tabs = h('div', { class: 'tabs', style: 'margin:14px 0 22px' },
    h('button', { class: 'tab' + (current === 'in' ? ' on' : ''), type: 'button', onclick: (e) => { current = 'in'; method = 'pw'; sync(); } }, 'Sign in'),
    h('button', { class: 'tab' + (current === 'up' ? ' on' : ''), type: 'button', onclick: (e) => { current = 'up'; upMethod = cfg.codesEnabled ? 'otp' : 'email'; sync(); } }, 'Create account'));
  const sync = () => { $$('.tab', tabs).forEach((t, i) => t.classList.toggle('on', (i === 0) === (current === 'in'))); render(); };
  render();
  const root = clear($('#login-body'));
  root.append(...[note ? h('p', { class: 'hint', style: 'font-size:15px;color:var(--text);margin:0 0 6px' }, note) : null, tabs, body].filter(Boolean));
  if (location.hash !== '#login') location.hash = '#login';
  show('login'); window.scrollTo(0, 0);
  const first = $('input', body); if (first && !matchMedia('(pointer:coarse)').matches) first.focus();
}
function leaveLogin() {
  clear($('#login-body'));
  history.replaceState(null, '', location.pathname + location.search);
  show('home');
}
async function finishAuth(a, after) {
  setUser(a);
  const wasLogin = location.hash === '#login';
  if (wasLogin) leaveLogin(); else closeModal();
  toast(`Signed in as ${a.user.name}.`);
  if (a.user.role === 'customer') await loadCredit();
  if (after && a.user.role === 'customer') { route(); after(); return; }
  if (after) { toast('Online booking needs a customer account. Opening the owner desk instead.'); location.hash = '#desk'; }
  else if (wasLogin) location.hash = a.user.role === 'customer' ? '#bookings' : '#desk';
  route();
}

function renderAuth() {
  // each nav bar gets its own fresh elements, because the buttons carry click handlers
  for (const el of $$('#authlinks')) { clear(el); el.append(...buildAuthItems()); }
  for (const el of $$('#profile-slot')) clear(el); // the profile button now takes the place of the Sign in button
  for (const el of $$('[data-navclone]')) { clear(el); el.append(h('a', { href: '#top', 'data-home': true, onclick: goHome }, 'Home'), h('a', { href: '#book', 'data-jump': 'book' }, 'Reserve'), ...buildAuthItems()); }
}
function buildAuthItems() {
  const u = state.user;
  if (!u) return [h('button', { type: 'button', class: 'linkbtn', onclick: () => openAuth() }, 'Sign in')];
  return [u.role === 'customer' ? h('a', { href: '#bookings' }, 'My dashboard') : h('a', { href: '#desk' }, u.role === 'super_admin' ? 'Platform desk' : u.role === 'owner' ? 'Owner desk' : 'Team desk'), profileButton(), h('button', { type: 'button', class: 'linkbtn', onclick: () => signOut() }, 'Sign out')];
}

// ------------------------------------------------------------------ profile

const initialOf = (u) => ((u.name || u.email || '?').trim()[0] || '?').toUpperCase();
function avatarEl(u, size = 36) {
  const box = h('span', { class: 'avatar', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px` });
  if (u.avatarUrl) { const img = h('img', { src: /^(https?:|data:)/.test(u.avatarUrl) ? u.avatarUrl : API + u.avatarUrl, alt: '' }); img.addEventListener('error', () => { img.remove(); box.textContent = initialOf(u); }); box.append(img); }
  else box.textContent = initialOf(u);
  return box;
}
function profileButton() {
  return h('button', { type: 'button', class: 'profilebtn', title: 'Your profile', 'aria-label': 'Your profile', onclick: () => openProfile() }, avatarEl(state.user, 36));
}
/** Shrinks a chosen picture to a small square so it loads fast and never needs a big upload. */
function squarePhoto(file, side = 320) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = Math.min(side, s);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('That picture could not be read.'))), 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Choose a PNG, JPEG, WebP or GIF picture.')); };
    img.src = url;
  });
}
function openProfile() {
  const u = state.user; if (!u) return;
  const err = h('div', { class: 'fe' }), pic = h('div', { class: 'pf-pic' }, avatarEl(u, 84));
  const refreshPic = () => { clear(pic); pic.append(avatarEl(state.user, 84)); renderAuth(); };
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return; err.textContent = '';
    try { const blob = await squarePhoto(f); const r = await apiFile('/api/me/avatar', blob); state.user = r.user; refreshPic(); toast('Profile picture saved.'); }
    catch (e) { err.textContent = e.message; }
    file.value = '';
  });
  const sn = (u.name || '').trim().split(/\s+/);
  const first = h('input', { type: 'text', maxlength: '40', autocomplete: 'given-name', value: u.firstName || sn.slice(0, -1).join(' ') || sn[0] || '' }), last = h('input', { type: 'text', maxlength: '40', autocomplete: 'family-name', value: u.lastName || (sn.length > 1 ? sn[sn.length - 1] : '') }), email = h('input', { type: 'email', value: u.email || '' });
  const [ccNow, phoneNow] = splitPhone(u.phone), cc = countrySelect(ccNow), phone = h('input', { type: 'tel', value: phoneNow, autocomplete: 'tel-national', style: 'flex:1 1 auto;min-width:0' });
  const biz = u.role === 'owner' ? h('input', { type: 'text', maxlength: '80', value: u.businessName || '' }) : null, upi = u.role === 'owner' ? h('input', { type: 'text', maxlength: '80', value: u.upiId || '', placeholder: 'name@bank' }) : null;
  const f = (l, el) => { el.style.width = '100%'; return h('label', { class: 'lbl', style: 'display:grid;gap:6px;margin-top:12px' }, l, el); };
  const save = h('button', { class: 'btn primary block', type: 'button', style: 'margin-top:16px', onclick: async () => {
    err.textContent = ''; save.disabled = true;
    try {
      const body = { firstName: first.value.trim(), lastName: last.value.trim(), ...(phone.value.trim() ? { countryCode: cc.value, phone: phone.value.trim() } : {}), email: email.value.trim() || undefined };
      if (biz) { body.businessName = biz.value.trim(); body.upiId = upi.value.trim(); }
      const r = await api('/api/me', { method: 'PATCH', body }); state.user = r.user; renderAuth(); toast('Profile saved.'); closeModal();
    } catch (e) { const fe = fieldErrors(e); err.textContent = Object.values(fe)[0] || e.message; save.disabled = false; }
  } }, 'Save profile');
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' }), pwErr = h('div', { class: 'fe' });
  const pwBtn = h('button', { class: 'btn outline block', type: 'button', style: 'margin-top:12px', onclick: async () => {
    pwErr.textContent = ''; pwBtn.disabled = true;
    try { const r = await api('/api/me/password', { method: 'POST', body: { ...(u.hasPassword === false ? {} : { currentPassword: cur.value }), newPassword: nw.value } }); setUser(r); cur.value = nw.value = ''; toast(u.hasPassword === false ? 'Password set. You can now sign in with your email or mobile number.' : 'Password changed.'); if (u.hasPassword === false) closeModal(); }
    catch (e) { const fe = fieldErrors(e); pwErr.textContent = Object.values(fe)[0] || e.message; }
    pwBtn.disabled = false;
  } }, u.hasPassword === false ? 'Set password' : 'Change password');
  openModal([h('div', { class: 'eyebrow' }, roleName(u)), h('h3', {}, 'Your profile'),
    h('div', { class: 'pf-head' }, pic, h('div', { class: 'pf-acts' },
      h('button', { class: 'btn outline sm', type: 'button', onclick: () => file.click() }, 'Choose a picture'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { closeModal(); signOut(); } }, 'Sign out'),
      u.avatarUrl ? h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { await api('/api/me/avatar', { method: 'DELETE' }); state.user = { ...state.user, avatarUrl: null }; refreshPic(); } catch (e) { err.textContent = e.message; } } }, 'Use my initial') : null, file)),
    f('First name', first), f('Last name', last), f('Email', email), f('Mobile number', phoneRow(cc, phone)), biz ? f('Business name', biz) : null, upi ? f('UPI ID for payments', upi) : null, err, save,
    h('div', { class: 'eyebrow', style: 'margin:22px 0 4px' }, 'Password'), u.hasPassword === false ? h('p', { class: 'hint', style: 'margin:4px 0 0' }, 'Set a password to sign in with your email or mobile number.') : f('Current password', cur), f('New password', nw), pwErr, pwBtn,
    h('button', { class: 'btn ghost block', type: 'button', style: 'margin-top:18px', onclick: () => { closeModal(); signOut(); } }, 'Sign out')]);
}

async function loadCredit() {
  try { const c = await api('/api/credits'); state.creditPaise = c.balancePaise || 0; }
  catch { state.creditPaise = 0; }
  renderCreditRow();
  $('#p-promo-row').hidden = false;
}

// ------------------------------------------------------------------ the page's static content

/** An uploaded photo is a path on the server; on Wix the server is another address, so put it in front. */
const photoSrc = (u) => (u.startsWith('/api/media/') ? API + u : u);
function fillAcademyPhotos() {
  const box = $('#ac-gal'); if (!box) return; clear(box);
  const secG = $('#ac-galsec');
  const list = (state.config.academyGallery || []).filter((u) => /^(https:\/\/|\/api\/media\/)/.test(u)).slice(0, 12);
  for (const u of list) box.append(h('img', { src: photoSrc(u), alt: 'Academy photo', loading: 'lazy' }));
  box.hidden = !list.length; if (secG) secG.hidden = !list.length;
}
function fillCoaches() {
  const wrap = $('#ac-coaches'); if (!wrap) return;
  const grid = clear($('#ac-coach-grid')), list = ((state.config.academy && state.config.academy.coaches) || []).slice(0, 12);
  for (const c of list) {
    const ok = c.photo && /^(https:\/\/|\/api\/media\/)/.test(c.photo);
    grid.append(h('article', { class: 'coach' },
      ok ? h('img', { src: photoSrc(c.photo), alt: c.name, loading: 'lazy' }) : h('div', { class: 'ph', 'aria-hidden': 'true' }, (c.name || '?').trim().charAt(0).toUpperCase()),
      h('h4', {}, c.name), h('div', { class: 'role' }, c.title), c.bio ? h('p', {}, c.bio) : null));
  }
  wrap.hidden = !list.length;
}
function fillGallery() {
  const c = state.config;
  const ig = c.instagramUrl;
  for (const a of $$('[data-terms]')) a.onclick = (e) => { e.preventDefault(); openTerms(); };
  for (const a of $$('[data-instagram]')) { if (ig) { a.href = ig; a.hidden = false; } else a.hidden = true; }
  const seen = new Set(), urls = [];
  for (const u of [...(c.gallery || []), ...state.grounds.flatMap((g) => g.images || [])]) if (/^(https:\/\/|data:image\/svg\+xml|\/api\/media\/)/.test(u) && !seen.has(u)) { seen.add(u); urls.push(photoSrc(u)); }
  const grid = clear($('#gal-grid'));
  if (!urls.length) { grid.append(h('div', { class: 'none' }, ig ? 'New photos are on our Instagram page.' : 'Photos are on the way.')); return; }
  const feature = (urls.length + 3) % 4 === 0; // one big tile only when the grid then fills every row
  urls.forEach((u, i) => grid.append(h('button', { type: 'button', class: feature && i === 0 ? 'feature' : null, 'aria-label': `Open photo ${i + 1}`, onclick: () => openModal([h('div', { class: 'lightbox' }, h('img', { src: u, alt: 'Daji Cricket Ground photo' }))], { photo: true }) }, h('img', { src: u, alt: '', loading: 'lazy' }))));
}

// Photos and videos uploaded in the admin desk (Photos and videos): the "top banner" ones play at the top of the home page,
// the "gallery" ones join the gallery grid. A video plays muted in the banner and with controls when opened from the gallery.
async function fillLibrary() {
  let items = [];
  try { const r = await fetch(API + '/api/library/public'); if (r.ok) items = (await r.json()).items || []; } catch { return; }
  if (!items.length) return;
  const src = (it) => API + it.url;
  const hero = items.filter((i) => i.tag === 'hero').reverse()[0];
  const lead = $('#top .lead');
  if (hero && lead && !$('#hero-media')) {
    const box = h('div', { id: 'hero-media', class: 'hero-media' });
    if (hero.kind === 'video') {
      const v = h('video', { muted: '', loop: '', playsinline: '', autoplay: '', preload: 'auto', 'aria-label': 'The ground' });
      if (hero.thumb) v.poster = src({ url: hero.thumb });
      v.muted = true; v.defaultMuted = true; v.setAttribute('playsinline', ''); v.src = src({ url: hero.web || hero.url });
      box.append(v); v.play && v.play().catch(() => {});
    } else box.append(h('img', { src: src(hero), alt: 'The ground', loading: 'eager' }));
    lead.parentNode.insertBefore(box, lead);
  }
  const grid = $('#gal-grid');
  const pics = items.filter((i) => i.tag === 'gallery').reverse();
  if (grid && pics.length) {
    const none = grid.querySelector('.none'); if (none) none.remove();
    for (const it of pics) {
      const open = () => openModal([h('div', { class: 'lightbox' }, it.kind === 'video'
        ? h('video', { src: src({ url: it.web || it.url }), controls: '', autoplay: '', playsinline: '', preload: 'auto' })
        : h('img', { src: src(it), alt: 'Daji Cricket Ground photo' }))], { photo: true });
      const thumb = it.thumb
        ? h('img', { src: src({ url: it.thumb }), alt: '', loading: 'lazy' })
        : it.kind === 'video' ? h('div', { class: 'vid-fallback' }) : h('img', { src: src(it), alt: '', loading: 'lazy' });
      grid.append(h('button', { type: 'button', class: it.kind === 'video' ? 'is-video' : null, 'aria-label': it.kind === 'video' ? 'Play video' : 'Open photo', onclick: open }, thumb));
    }
  }
}

function fillStatic() {
  fillGallery();
  fillLibrary();
  const c = state.config, gs = state.grounds, g0 = gs[0];
  for (const el of $$('[data-tagline]')) el.textContent = c.tagline;
  const minPrice = gs.length ? Math.min(...gs.map((g) => (g.rates && g.rates.length ? fromPrice(g).paise : g.pricePaise))) : 0;
  const facts = clear($('#facts'));
  facts.append(
    h('div', {}, h('strong', {}, g0 ? (() => { const [o, c2] = hoursFor(g0, istToday()); return `${niceHour(o)}–${niceHour(clock(c2))}`.replace(/ /g, ''); })() : '—'), h('span', {}, g0 && g0.closedDays && g0.closedDays.length ? `Open ${dayRange([1, 2, 3, 4, 5, 6, 0].filter((d) => !g0.closedDays.includes(d)))}. Closed every ${g0.closedDays.map((d) => (g0.closedDays.length === 1 ? DAY_FULL[d] : DAY_NAMES[d])).join(' & ')}` : 'Open every day')),
    h('div', {}, h('strong', {}, minPrice ? inr(minPrice) : '—'), h('span', {}, 'From, per hour')),
    h('div', {}, h('strong', {}, `${c.holdMinutesOnline} min`), h('span', {}, 'Slot held')));
  // academy
  const an = c.academy.name || '';
  const m = /^(.*?)\s*\bAcademy$/i.exec(an);
  for (const id of ['#ac-h', '#t-h']) { const ah = clear($(id)); if (m) ah.append(`${m[1]} `, h('em', {}, 'Academy')); else ah.append(an); }
  $('#ac-about').textContent = c.academy.about || ''; $('#t-about').textContent = c.academy.about || '';
  fillAcademyPhotos();
  fillCoaches();
  $('#ac-by').textContent = `Run by ${c.academy.runBy}  ·  ${c.academy.brand}`;
  for (const id of ['#ac-brand', '#t-brand']) $(id).textContent = c.academy.brand;
  for (const id of ['#ac-line', '#t-line']) $(id).textContent = `${an}  ·  at Daji Cricket Ground`;
  { const d = String(c.contact.phone).replace(/\D/g, '').slice(-10), w = $('#ac-wa');
    if (w) { w.href = `https://wa.me/91${d}?text=${encodeURIComponent('Hi, I would like to know about ' + an + '.')}`; w.hidden = d.length !== 10; }
    $('#ac-contact').textContent = `${c.contact.name}  ·  ${formatPhone(c.contact.phone)}  ·  ${c.contact.email}`; }
  // contact
  $('#ct-name').textContent = c.contact.name;
  const ph = $('#ct-phone'); ph.textContent = formatPhone(c.contact.phone); ph.href = 'tel:+91' + String(c.contact.phone).replace(/\D/g, '').slice(-10);
  const wa = $('#ct-wa'); if (wa) { const d = String(c.contact.phone).replace(/\D/g, '').slice(-10); wa.href = `https://wa.me/91${d}?text=${encodeURIComponent('Hi, I would like to know more about Daji Cricket Ground.')}`; wa.hidden = d.length !== 10; }
  const em = $('#ct-email'); em.textContent = c.contact.email; em.href = 'mailto:' + c.contact.email;
  $('#ct-where').textContent = g0 ? [g0.address, g0.lat != null ? `${g0.lat.toFixed(4)}° N, ${g0.lng.toFixed(4)}° E` : ''].filter(Boolean).join('  ·  ') : '';
  const dir = $('#ct-dir'); if (g0 && g0.directionsUrl) dir.href = g0.directionsUrl; else dir.hidden = true;
  if (g0) {
    const seasonal = g0.winterOpenTime && g0.winterCloseTime;
    $('#ct-open').textContent = `${g0.openTime} – ${clock(g0.closeTime)}`;
    $('#ct-open-sub').textContent = [seasonal ? `Summer. Winter (Nov–Feb): ${g0.winterOpenTime} – ${clock(g0.winterCloseTime)}.` : '', g0.closedDays && g0.closedDays.length ? `Closed on ${g0.closedDays.map((d) => DAY_FULL[d] + 's').join(' and ')}.` : 'Every day.', g0.eveningSurchargePaise > 0 ? `Floodlights from ${g0.eveningFrom}.` : ''].filter(Boolean).join(' ');
  } else { $('#ct-open').textContent = ''; $('#ct-open-sub').textContent = ''; }
  $('#tagline').textContent = c.tagline;
  $('#foot-l').textContent = `© Daji Cricket Ground & Daji Sports  ·  ${c.tagline}`;
  $('#foot-r').textContent = `${c.contact.email}  ·  dajicricket.com`;
  // grounds
  const list = clear($('#grounds-list'));
  if (!gs.length) list.append(h('div', { class: 'empty' }, 'No grounds are open for booking yet.'));
  for (const g of gs) {
    list.append(h('div', { class: 'card' + (g.rates && g.rates.length ? ' wide' : '') },
      null,
      h('div', { class: 'body' },
        h('h4', {}, g.name),
        h('div', { class: 'chips' }, (g.facilities || []).map((f) => h('span', { class: 'chip' }, f))),
        g.description ? h('div', { class: 'hint', style: 'margin:0' }, g.description) : null,
        g.rates && g.rates.length ? rateCardEl(g) : null,
        h('div', { class: 'price' }, g.rates && g.rates.length ? h('div', {}, h('span', {}, 'From '), h('b', {}, inr(fromPrice(g).paise)), h('span', {}, fromPrice(g).unit)) : g.formats && g.formats.length ? h('div', {}, h('span', {}, 'From '), h('b', {}, inr(Math.min(...g.formats.map((f) => f.pricePaise)))), h('span', {}, ' / session')) : h('div', {}, h('b', {}, inr(g.pricePaise)), h('span', {}, ' / hour')),
          h('button', { class: 'arrow', type: 'button', onclick: () => { pickGround(g.id); jump('book'); } }, 'Book →')))));
  }
}
function formatPhone(p) { const d = String(p).replace(/\D/g, '').slice(-10); return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p; }

// ------------------------------------------------------------------ booking panel

function pickGround(id) {
  const g = state.grounds.find((x) => x.id === id);
  if (!g) return;
  state.ground = g; state.sel = []; state.ball = null; state.fmt = null; state.win = null; state.hr = null;
  if (!state.date || state.date < firstDay()) state.date = firstDay();
  renderPanel();
}

function renderPanel() {
  const g = state.ground;
  if (!g) return;
  $('#p-name').textContent = g.name;
  $('#p-sub').textContent = [g.surface, (g.facilities || []).slice(0, 2).join(' · ')].filter(Boolean).join(' · ');
  const tabs = clear($('#p-tabs'));
  if (state.grounds.length > 1) for (const x of state.grounds) tabs.append(h('button', { class: 'tab' + (x.id === g.id ? ' on' : ''), type: 'button', onclick: () => pickGround(x.id) }, x.name));
  // days: two weeks from today (or from the chosen day when it is later), and a date box for anything up to a year ahead
  const days = clear($('#p-days'));
  const t = firstDay(), maxD = lastDay();
  const from = state.date && state.date > addDays(t, 13) ? state.date : t;
  for (let i = 0; i < 14; i++) {
    const d = addDays(from, i); if (d > maxD) break;
    const p = parts(d);
    const shut = shutDay(d);
    days.append(h('button', { class: 'day' + (d === state.date ? ' on' : '') + (shut ? ' shut' : ''), type: 'button', 'data-date': d, disabled: shut ? true : null, title: shut ? 'Online booking is closed this day' : null, onclick: () => { state.date = d; state.sel = []; state.win = null; state.hr = null; renderPanel(); } }, p.dow, h('b', {}, p.day), p.mon));
  }
  const pick = $('#p-date'); pick.min = t; pick.max = maxD; pick.value = state.date || t;
  const on = $('.day.on', days); if (on) days.scrollLeft = Math.max(0, on.offsetLeft - days.offsetLeft - 8);
  $('#p-note').textContent = `Free cancellation more than ${state.config.freeCancelHours} hours before the start.` + (state.config.bookingsOpenFrom && state.config.bookingsOpenFrom > todayIst() ? ` Online bookings open on ${niceDate(state.config.bookingsOpenFrom)}.` : '') + (state.config.bookingsCloseFrom ? ` Bookings are closed from ${niceDate(state.config.bookingsCloseFrom)} for now.` : '');
  loadSlots();
}

async function loadSlots() {
  const g = state.ground, date = state.date, hint = $('#p-hint'), grid = clear($('#p-slots'));
  hint.className = 'hint'; hint.textContent = 'Checking availability…';
  let a;
  try { a = await api(`/api/grounds/${encodeURIComponent(g.id)}/availability?date=${date}`); }
  catch (e) { hint.className = 'hint err'; hint.textContent = e.message; renderSummary(); return; }
  if (g.id !== state.ground.id || date !== state.date) return; // the person moved on while this was loading
  state.slots = a.slots; state.avail = a;
  const hasR = !!a.rates, hasF = !hasR && !!(g.formats && g.formats.length);
  $('#p-step2').hidden = !(hasF || hasR); $('#p-step3 i').textContent = hasF || hasR ? '3' : '2';
  $('#p-step2').lastChild.textContent = hasR ? 'Choose the ball' : 'Choose the ball and match length';
  $('#p-step3').lastChild.textContent = hasR ? 'Pick your session' : 'Pick your time';
  fillCallNote(hasR);
  if (hasR) { renderRates(); return; }
  if (hasF) { renderFormats(); return; }
  clear($('#p-formats')).hidden = true;
  hint.textContent = a.slots.length ? `Choose up to ${g.maxSlots} slots in a row. ${niceDate(date)}.${a.slots.some((x) => x.time < a.slots[0].time) ? ' Times after midnight belong to this evening.' : ''}` : (a.closed ? 'The ground is closed on this day. Please pick another day.' : 'The ground is closed on this day.');
  a.slots.forEach((s, i) => {
    const sel = state.sel.includes(i);
    const cls = sel ? 'sel' : s.state === 'available' ? 'av' : s.state;
    const label = s.state === 'available' || sel ? inr(s.pricePaise) : { held: 'Held', booked: 'Booked', blocked: 'Closed', past: 'Past' }[s.state] || s.state;
    grid.append(h('button', { class: 'slot ' + cls, type: 'button', disabled: s.state !== 'available' && !sel, 'aria-pressed': sel ? 'true' : 'false', onclick: () => clickSlot(i) }, s.time, h('small', {}, label)));
  });
  renderSummary();
}

const BALL_NAMES = { combo: 'Red & White combo ball', leather: 'Leather ball', red: 'Red ball', white: 'White ball', tennis: 'Tennis ball', practice: 'Practice session' };
function fillCallNote(show) {
  const n = $('#p-callnote'); if (!n) return; clear(n);
  const g = state.ground, c = state.config.contact;
  n.hidden = !(show && (g.ratesNote || (g.closedDays || []).length));
  if (n.hidden) return;
  const parts = [];
  if ((g.closedDays || []).length) parts.push(`Closed every ${g.closedDays.map((d) => DAY_FULL[d]).join(' and ')} for maintenance.`);
  if (g.ratesNote) parts.push(g.ratesNote);
  n.append(parts.join(' '), ' ', h('a', { href: 'tel:+91' + String(c.phone).replace(/\D/g, '').slice(-10) }, formatPhone(c.phone)));
}
const lenText = (m) => { const hr = Math.floor(m / 60), r = m % 60; return r === 0 ? `${hr} hours` : r === 30 ? `${hr}½ hours` : `${hr} h ${r} min`; };
/** Grounds with play formats: pick the ball, then the match length, then one of the sessions that length allows. */
function renderFormats() {
  const g = state.ground, a = state.avail, box = clear($('#p-formats')), grid = clear($('#p-slots')), hint = $('#p-hint');
  box.hidden = false;
  const balls = ['red', 'white', 'tennis'].filter((b) => g.formats.some((f) => f.ball === b));
  if (!balls.includes(state.ball)) state.ball = balls.length === 1 ? balls[0] : null;
  const fs = g.formats.filter((f) => f.ball === state.ball);
  if (!fs.some((f) => f.id === state.fmt)) state.fmt = fs.length === 1 ? fs[0].id : null;
  const f = fs.find((x) => x.id === state.fmt);
  box.append(h('div', { class: 'fmtrow' }, h('span', { class: 'lbl' }, 'Choose ball'), h('div', { class: 'chips2' }, balls.map((b) => h('button', { type: 'button', class: 'chip2 ball-' + b + (b === state.ball ? ' on' : ''), onclick: () => { state.ball = b; state.fmt = null; state.win = null; renderFormats(); } }, BALL_NAMES[b])))));
  if (state.ball) box.append(h('div', { class: 'fmtrow' }, h('span', { class: 'lbl' }, 'Match'), h('div', { class: 'chips2' }, fs.map((x) => h('button', { type: 'button', class: 'chip2' + (x.id === state.fmt ? ' on' : ''), onclick: () => { state.fmt = x.id; state.win = null; renderFormats(); } }, x.label, h('small', {}, lenText(x.minutes)))))));
  if (!f) { hint.className = 'hint'; hint.textContent = state.ball ? 'Choose the match length to see the sessions.' : 'Choose the ball you want to play with.'; renderSummary(); return; }
  const wins = (a.formats.find((x) => x.formatId === f.id) || { windows: [] }).windows;
  hint.className = 'hint'; hint.textContent = wins.length ? `${f.label} · ${BALL_NAMES[f.ball]} · ${lenText(f.minutes)}. ${niceDate(state.date)}.` : (a.closed ? 'The ground is closed on this day. Please pick another day.' : 'No sessions of this length fit on this day.');
  wins.forEach((w) => {
    const on = state.win === w.time, ok = w.state === 'available';
    grid.append(h('button', { class: 'slot wide ' + (on ? 'sel' : ok ? 'av' : w.state), type: 'button', disabled: !ok, 'aria-pressed': on ? 'true' : 'false', onclick: () => { state.win = w.time; renderFormats(); } },
      `${w.time} – ${w.endTime}`, h('small', {}, ok ? inr(w.pricePaise) : { held: 'Held', booked: 'Booked', blocked: 'Closed', past: 'Past' }[w.state] || w.state)));
  });
  renderSummary();
}

/** Grounds with a price list: pick the ball, then a fixed session or some hours. */
function renderRates() {
  const g = state.ground, a = state.avail, box = clear($('#p-formats')), grid = clear($('#p-slots')), hint = $('#p-hint');
  box.hidden = false;
  const balls = ['leather', 'tennis', 'practice'].filter((b) => g.rates.some((r) => r.ball === b));
  if (!balls.includes(state.ball)) state.ball = balls.length === 1 ? balls[0] : null;
  box.append(h('div', { class: 'fmtrow' }, h('span', { class: 'lbl' }, 'Choose ball & session'), h('div', { class: 'chips2' }, balls.map((b) => h('button', { type: 'button', class: 'chip2 ball-' + b + (b === state.ball ? ' on' : ''), onclick: () => { state.ball = b; state.win = null; state.hr = null; renderRates(); } }, BALL_NAMES[b])))));
  hint.className = 'hint';
  if (a.closed) { hint.textContent = 'The ground is closed on this day. Please pick another day.'; renderSummary(); return; }
  if (!state.ball) { hint.textContent = 'Choose the ball you want to play with.'; renderSummary(); return; }
  const opts = a.rates.filter((o) => o.ball === state.ball);
  if (!opts.length) { hint.textContent = 'Nothing is on sale for this ball on this day. Pick another day, or call us for a custom booking.'; renderSummary(); return; }
  const STATE = { held: 'Held', booked: 'Booked', blocked: 'Closed', past: 'Past' };
  hint.textContent = `${BALL_NAMES[state.ball]} · ${niceDate(state.date)}. Pick a session, or choose hours.`;
  const fixed = opts.filter((o) => o.mode === 'fixed');
  if (fixed.length) grid.append(h('div', { class: 'grp' }, 'Sessions'));
  for (const o of fixed) {
    const on = state.win === o.ruleId, ok = o.state === 'available';
    grid.append(h('button', { class: 'slot wide ' + (on ? 'sel' : ok ? 'av' : o.state), type: 'button', disabled: !ok, 'aria-pressed': on ? 'true' : 'false', onclick: () => { state.win = o.ruleId; state.hr = null; renderRates(); } },
      h('span', { class: 'sname' }, o.label), o.proRated ? h('span', { class: 'prn' }, `Part-session · ${o.hoursLeft} hour${o.hoursLeft === 1 ? '' : 's'} left (full ${inr(o.fullPricePaise)})`) : null, `${niceHour(o.time)} – ${niceHour(o.endTime)}${o.bundleDays > 1 ? ` + ${o.bundleDays - 1} more day${o.bundleDays > 2 ? 's' : ''}` : ''}`, h('small', {}, ok || on ? inr(o.pricePaise) : STATE[o.state] || o.state)));
  }
  for (const o of opts.filter((x) => x.mode === 'hourly')) {
    grid.append(h('div', { class: 'grp' }, `${o.label} · ${inr(o.pricePaise)} per hour · up to ${g.maxSlots} hours in a row`));
    const sel = state.hr && state.hr.ruleId === o.ruleId ? state.hr.idx : [];
    o.slots.forEach((sl, i) => {
      const on = sel.includes(i), ok = sl.state === 'available';
      grid.append(h('button', { class: 'slot ' + (on ? 'sel' : ok ? 'av' : sl.state), type: 'button', disabled: !ok && !on, 'aria-pressed': on ? 'true' : 'false', onclick: () => clickHour(o, i) }, hourSpan(sl.time), h('small', {}, ok || on ? inr(sl.pricePaise) : STATE[sl.state] || sl.state)));
    });
  }
  renderSummary();
}
function clickHour(o, i) {
  const g = state.ground, cur = state.hr && state.hr.ruleId === o.ruleId ? state.hr.idx : [], free = (k) => o.slots[k] && o.slots[k].state === 'available';
  let idx;
  if (!cur.length) idx = [i];
  else {
    const lo = cur[0], hi = cur[cur.length - 1];
    if (cur.includes(i)) idx = i === lo || i === hi ? cur.filter((x) => x !== i) : [i];
    else if (i === hi + 1 && free(i) && cur.length < g.maxSlots) idx = [...cur, i];
    else if (i === lo - 1 && free(i) && cur.length < g.maxSlots) idx = [i, ...cur];
    else if ((i === hi + 1 || i === lo - 1) && cur.length >= g.maxSlots) { toast(`You can book up to ${g.maxSlots} hours at once.`, true); return; }
    else idx = [i];
  }
  state.hr = idx.length ? { ruleId: o.ruleId, idx } : null; state.win = null;
  renderRates();
}

function clickSlot(i) {
  const g = state.ground, sel = state.sel, slots = state.slots;
  const free = (k) => slots[k] && slots[k].state === 'available';
  if (!sel.length) state.sel = [i];
  else {
    const lo = sel[0], hi = sel[sel.length - 1];
    if (sel.includes(i)) state.sel = (i === lo || i === hi) ? sel.filter((x) => x !== i) : [i];
    else if (i === hi + 1 && free(i) && sel.length < g.maxSlots) state.sel = [...sel, i];
    else if (i === lo - 1 && free(i) && sel.length < g.maxSlots) state.sel = [i, ...sel];
    else if (i === hi + 1 && sel.length >= g.maxSlots) { toast(`You can book up to ${g.maxSlots} slots at once.`, true); return; }
    else state.sel = [i];
  }
  // repaint the grid without another request
  $$('#p-slots .slot').forEach((el, k) => {
    const s = slots[k], on = state.sel.includes(k);
    el.className = 'slot ' + (on ? 'sel' : s.state === 'available' ? 'av' : s.state);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.disabled = s.state !== 'available' && !on;
    $('small', el).textContent = s.state === 'available' || on ? inr(s.pricePaise) : { held: 'Held', booked: 'Booked', blocked: 'Closed', past: 'Past' }[s.state] || s.state;
  });
  renderSummary();
}

function advanceFor(total, startAt) {
  const g = state.ground, c = state.config;
  if (startAt - Date.now() <= c.fullPaymentWithinHours * 3600000) return { paise: total, label: `Full payment (starts within ${c.fullPaymentWithinHours} hours)` };
  const mode = g.advanceMode || c.advanceMode, value = g.advanceValue != null && g.advanceMode ? g.advanceValue : c.advanceValue;
  const raw = mode === 'fixed' ? value : Math.ceil((total * value) / 100);
  return { paise: Math.min(Math.max(raw, 100), total), label: mode === 'fixed' ? 'Advance' : `Advance (${value}%)` };
}

/** The selection with any applied promo code taken off, so the advance is worked out on the price the customer will actually pay. */
function selection() {
  const s = selection0();
  if (!s) return s;
  if (state.promo && state.promo.key === promoKey(s)) {
    const a = advanceFor(s.total - state.promo.discountPaise, s.first.start);
    return { ...s, ...a, discount: state.promo.discountPaise, promoCode: state.promo.code };
  }
  return s;
}
const promoKey = (s) => JSON.stringify([state.ground && state.ground.id, state.date, s.ruleId || s.formatId || '', s.startTime || (s.first && s.first.time), s.count, s.total]);
function promoBody(s) {
  const startTime = s.startTime || s.first.time;
  return { groundId: state.ground.id, date: state.date, startTime, ...(s.ruleId ? (s.hourly ? { ruleId: s.ruleId, slots: s.count } : { ruleId: s.ruleId }) : s.formatId ? { formatId: s.formatId } : { slots: s.count }) };
}
function selection0() {
  const g = state.ground;
  if (g && g.rates && g.rates.length && state.avail && state.avail.rates) {
    const opts = state.avail.rates;
    if (state.win) {
      const o = opts.find((x) => x.ruleId === state.win && x.state === 'available'); if (!o) return null;
      return { first: o, last: o, total: o.pricePaise, count: 1, ruleId: o.ruleId, startTime: o.time, text: `${o.label}${o.proRated ? ' (hours left today)' : ''} · ${BALL_NAMES[o.ball]} · ${niceDate(state.date)} · ${niceHour(o.time)} – ${niceHour(o.endTime)}${o.bundleDays > 1 ? ` (${o.bundleDays} days)` : ''}`, ...advanceFor(o.pricePaise, o.start) };
    }
    if (state.hr) {
      const o = opts.find((x) => x.ruleId === state.hr.ruleId); if (!o || !o.slots) return null;
      const sl = state.hr.idx.map((i) => o.slots[i]); if (!sl.length || sl.some((x) => !x || x.state !== 'available')) return null;
      const total = sl.reduce((n, x) => n + x.pricePaise, 0);
      return { first: sl[0], last: sl[sl.length - 1], total, count: sl.length, ruleId: o.ruleId, startTime: sl[0].time, hourly: true, text: `${BALL_NAMES[o.ball]} · ${niceDate(state.date)} · ${niceHour(sl[0].time)} – ${niceHour(hhmm(sl[sl.length - 1].end))} (${sl.length} ${sl.length === 1 ? 'hour' : 'hours'})`, ...advanceFor(total, sl[0].start) };
    }
    return null;
  }
  if (g && g.formats && g.formats.length) {
    const f = g.formats.find((x) => x.id === state.fmt), fa = state.avail && state.avail.formats.find((x) => x.formatId === state.fmt);
    const w = fa && fa.windows.find((x) => x.time === state.win && x.state === 'available');
    if (!f || !w) return null;
    return { first: w, last: w, total: w.pricePaise, count: 1, formatId: f.id, text: `${f.label} · ${BALL_NAMES[f.ball]} · ${niceDate(state.date)} · ${w.time} – ${w.endTime}`, ...advanceFor(w.pricePaise, w.start) };
  }
  if (!state.sel.length) return null;
  const first = state.slots[state.sel[0]], last = state.slots[state.sel[state.sel.length - 1]];
  const total = state.sel.reduce((n, i) => n + state.slots[i].pricePaise, 0);
  return { first, last, total, count: state.sel.length, ...advanceFor(total, first.start) };
}

function renderSummary() {
  const sum = clear($('#p-sum')), btn = $('#p-hold'), s = selection();
  $('#p-promo-row').hidden = !s; if (!s) $('#p-promo-msg').textContent = '';
  $('#p-repeat-row').hidden = !s; if (!s) { $('#p-repeat').value = ''; $('#p-repeat-n').hidden = true; }
  const holdMin = state.config.razorpayEnabled ? state.config.holdMinutesOnline : state.config.holdMinutesUpi;
  if (!s) { btn.disabled = true; btn.textContent = state.ground && state.ground.rates && state.ground.rates.length ? 'Choose ball and session' : state.ground && state.ground.formats && state.ground.formats.length ? 'Choose ball, match and time' : 'Choose your slots'; renderCreditRow(); return; }
  if (state.promo && !s.discount) { state.promo = null; $('#p-promo-msg').textContent = ''; $('#p-promo').value = ''; }
  let due = s.paise;
  const credit = state.useCredit ? Math.min(state.creditPaise, s.paise) : 0;
  due = s.paise - credit;
  sum.append(...[
    h('div', { class: 'row' }, h('span', {}, s.text || `${s.count} ${s.count === 1 ? 'slot' : 'slots'} · ${niceDate(state.date)} · ${s.first.time} – ${hhmm(s.last.end)}`), h('b', {}, inr(s.total))),
    h('div', { class: 'row' }, h('span', {}, s.label), h('b', {}, inr(s.paise))),
    s.discount ? h('div', { class: 'row' }, h('span', {}, `Promo ${s.promoCode}`), h('b', {}, '− ' + inr(s.discount))) : null,
    credit ? h('div', { class: 'row' }, h('span', {}, 'Account credit used'), h('b', {}, '− ' + inr(credit))) : null,
    h('div', { class: 'row total' }, h('span', {}, 'Due now'), h('b', {}, inr(due))),
    repeatSpec() ? h('div', { class: 'note' }, `Repeats ${REPEATS[repeatSpec().frequency].word}, ${repeatSpec().count} times in all. You pay for the first date now; the other ${repeatSpec().count - 1} are reserved for you and their balance is paid at the ground${state.config.autoDebitEnabled ? ' (or by auto-debit)' : ''}. Dates that are closed or already taken are left out.`) : null].filter(Boolean));
  btn.disabled = false;
  btn.textContent = `${s.formatId || (s.ruleId && !s.hourly) ? 'Hold this session' : s.hourly ? 'Hold these hours' : 'Hold these slots'}  ·  ${holdMin}:00`;
  renderCreditRow();
}

const REPEATS = { daily: { word: 'every day', def: 5, max: 60 }, weekly: { word: 'every week', def: 4, max: 52 }, monthly: { word: 'every month', def: 3, max: 12 }, yearly: { word: 'every year', def: 2, max: 3 } };
function repeatSpec() {
  const f = $('#p-repeat').value; if (!f) return null;
  const r = REPEATS[f], n = Math.max(2, Math.min(r.max, parseInt($('#p-repeat-count').value, 10) || r.def));
  return { frequency: f, count: n };
}
$('#p-repeat').addEventListener('change', (e) => {
  const f = e.target.value, n = $('#p-repeat-count');
  $('#p-repeat-n').hidden = !f; $('#p-repeat-msg').textContent = '';
  if (f) { n.max = REPEATS[f].max; n.value = REPEATS[f].def; }
  renderSummary();
});
$('#p-repeat-count').addEventListener('input', () => { const r = repeatSpec(); if (r) { const mx = REPEATS[r.frequency].max; if (parseInt($('#p-repeat-count').value, 10) > mx) $('#p-repeat-count').value = mx; } renderSummary(); });

function renderCreditRow() {
  const row = $('#p-credit-row');
  const show = state.user && state.user.role === 'customer' && state.creditPaise > 0 && state.sel.length > 0;
  row.hidden = !show;
  if (show) { $('#p-credit').checked = state.useCredit; $('#p-credit-text').textContent = `Use my account credit (${inr(state.creditPaise)} available)`; }
}
$('#p-date').addEventListener('click', (e) => { try { e.target.showPicker && e.target.showPicker(); } catch { /* native picker not available */ } });
$('#p-date').addEventListener('change', (e) => { const v = e.target.value; if (!v) return; const t = firstDay(), mx = lastDay(); state.date = v < t ? t : v > mx ? mx : v; if (shutDay(state.date)) toast('Online booking is closed on that day. Please pick another, or call us.', true); state.sel = []; state.win = null; state.hr = null; renderPanel(); });
$('#p-promo-apply').addEventListener('click', async () => {
  const s = selection(), msg = $('#p-promo-msg'), code = $('#p-promo').value.trim();
  msg.textContent = ''; msg.classList.remove('good');
  if (!s) { msg.textContent = 'Choose your session first.'; return; }
  if (!code) { state.promo = null; renderSummary(); return; }
  if (!state.user) { openAuth({ note: 'Sign in to use a promo code.', after: () => $('#p-promo-apply').click() }); return; }
  try {
    const full = state.promo ? { ...s, total: s.total } : s;
    const r = await api('/api/promo/check', { method: 'POST', body: { ...promoBody(full), promoCode: code, total: s.total } });
    state.promo = { code: r.code, discountPaise: r.discountPaise, key: promoKey(s) };
    renderSummary();
    msg.classList.add('good'); msg.textContent = `${r.code} applied. You save ${inr(r.discountPaise)}.`;
  } catch (e) { state.promo = null; renderSummary(); msg.textContent = e.message; }
});
$('#p-credit').addEventListener('change', (e) => { state.useCredit = e.target.checked; renderSummary(); });

$('#p-hold').addEventListener('click', () => {
  if (!selection()) return;
  if (!state.user) return openAuth({ note: 'Sign in or create an account to hold these slots. Your choice is kept.', after: holdNow });
  if (state.user.role !== 'customer') { toast('Online booking is for customer accounts. Staff add walk-in bookings from the owner desk.', true); return; }
  holdNow();
});

async function holdNow() {
  const s = selection();
  if (!s || state.loading) return;
  state.loading = true; const btn = $('#p-hold'); btn.disabled = true; btn.textContent = 'Holding…';
  try {
    const startTime = s.startTime || s.first.time;
    const res = await api('/api/bookings', { method: 'POST', body: { groundId: state.ground.id, date: state.date, startTime, ...(s.ruleId ? (s.hourly ? { ruleId: s.ruleId, slots: s.count } : { ruleId: s.ruleId }) : s.formatId ? { formatId: s.formatId } : { slots: s.count }), useCredit: !!(state.useCredit && state.creditPaise > 0), ...(s.promoCode ? { promoCode: s.promoCode } : {}), ...(repeatSpec() ? { repeat: repeatSpec() } : {}) } });
    $('#p-repeat').value = ''; $('#p-repeat-n').hidden = true;
    if (res.series) toast(`Repeat booking: ${res.series.created} dates reserved` + (res.series.skipped.length ? `, ${res.series.skipped.length} left out (${res.series.skipped.slice(0, 3).map((x) => niceDate(x.date)).join(', ')}${res.series.skipped.length > 3 ? '…' : ''}).` : '.'));
    state.sel = []; state.promo = null; $('#p-promo').value = ''; $('#p-promo-msg').textContent = '';
    openPay(res);
    loadSlots(); loadCredit();
  } catch (e) {
    toast(e.message, true);
    if (e.status === 409 || e.code === 'SLOT_TAKEN') { state.sel = []; loadSlots(); }
    renderSummary();
  } finally { state.loading = false; }
}

// ------------------------------------------------------------------ paying

let holdTimer = 0;
function stopHoldTimer() { clearInterval(holdTimer); holdTimer = 0; }

function bookingRows(b, extra = []) {
  return h('div', { class: 'kv' },
    h('div', { class: 'row' }, h('span', {}, 'Reference'), h('b', { class: 'mono' }, b.ref)),
    h('div', { class: 'row' }, h('span', {}, 'Ground'), h('b', {}, b.groundName)),
    h('div', { class: 'row' }, h('span', {}, 'When'), h('b', {}, `${niceDate(b.date)}, ${hhmm(b.startAt)} – ${hhmm(b.endAt)}`)),
    h('div', { class: 'row' }, h('span', {}, 'Total'), h('b', {}, inr(b.totalPaise))),
    ...extra);
}

function openPay(res) {
  const b = res.booking, p = res.payment;
  if (p.mode === 'none') return showConfirmed(b);
  const timer = h('span', { class: 'timer' }, '');
  const status = h('div', { class: 'hint', style: 'margin:8px 0 0' });
  const actions = h('div', { style: 'display:grid;gap:10px;margin-top:6px' });
  const close = () => { stopHoldTimer(); };
  const tick = () => {
    const left = Math.max(0, b.holdExpiresAt - Date.now());
    timer.textContent = `${pad(Math.floor(left / 60000))}:${pad(Math.floor(left / 1000) % 60)}`;
    if (left <= 0) { stopHoldTimer(); clear(actions); status.className = 'hint err'; status.textContent = 'This hold has run out and the slots were released. Please choose them again.'; loadSlots(); }
  };
  const extra = [];
  if (res.creditAppliedPaise) extra.push(h('div', { class: 'row' }, h('span', {}, 'Paid from account credit'), h('b', {}, inr(res.creditAppliedPaise))));
  extra.push(h('div', { class: 'row' }, h('span', {}, 'Due now'), h('b', { style: 'color:var(--gold-bright);font-size:20px' }, inr(p.amountPaise))));
  const content = [h('div', { class: 'eyebrow' }, 'Slots held'), h('h3', {}, 'Complete your payment'),
    h('p', { class: 'hint' }, 'Your slots are held for ', timer, '. They are released if payment does not arrive in time.'),
    bookingRows(b, extra), actions, status];

  if (p.mode === 'razorpay' && p.razorpay.demo) {
    actions.append(
      h('button', { class: 'btn primary block', type: 'button', onclick: (e) => payDemo(p, b, e.currentTarget, status, 'success') }, `Pay ${inr(p.amountPaise)} with the demo card`),
      h('button', { class: 'btn ghost', type: 'button', onclick: (e) => payDemo(p, b, e.currentTarget, status, 'failure') }, 'Pretend the card is declined'));
    status.textContent = 'Demo payment: no real money moves. It is signed the same way Razorpay signs a real one.';
  } else if (p.mode === 'razorpay') {
    actions.append(h('button', { class: 'btn primary block', type: 'button', onclick: (e) => payRazorpay(p, b, e.currentTarget, status) }, `Pay ${inr(p.amountPaise)}`));
  } else if (p.mode === 'upi') {
    const utr = h('input', { type: 'text', inputmode: 'numeric', maxlength: '30', placeholder: '12-digit UPI reference (UTR)', autocomplete: 'off' });
    actions.append(
      h('div', { class: 'kv', style: 'margin:0' },
        h('div', { class: 'row' }, h('span', {}, 'Pay to UPI ID'), h('b', { class: 'mono' }, p.upi.upiId)),
        h('div', { class: 'row' }, h('span', {}, 'Name'), h('b', {}, p.upi.payee)),
        h('div', { class: 'row' }, h('span', {}, 'Amount'), h('b', {}, inr(p.amountPaise)))),
      h('a', { class: 'btn outline block', href: p.upi.uri }, 'Open my UPI app'),
      field('After paying, enter the UPI reference', utr),
      h('button', { class: 'btn primary block', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true; status.className = 'hint'; status.textContent = 'Sending…';
        try { const r = await api(`/api/bookings/${encodeURIComponent(b.id)}/upi-reference`, { method: 'POST', body: { utr: utr.value.trim() } }); stopHoldTimer(); clear(actions); status.className = 'hint'; status.textContent = `Thank you. Staff will check this against the bank and confirm. Your slots stay held until ${hhmm(p.upi.deadline)}. We will message you.`; toast('UPI reference sent.'); void r; }
        catch (err) { status.className = 'hint err'; status.textContent = err.message; btn.disabled = false; }
      } }, 'I have paid'));
  }
  openModal(content, { onClose: close });
  tick(); stopHoldTimer(); holdTimer = setInterval(tick, 1000);
}

async function payDemo(p, b, btn, status, outcome) {
  btn.disabled = true; status.className = 'hint'; status.textContent = outcome === 'success' ? 'Paying…' : 'Trying the card…';
  try {
    const r = await api('/api/gateway/demo/pay', { method: 'POST', body: { orderId: p.razorpay.orderId, outcome } });
    const v = await api('/api/payments/razorpay/verify', { method: 'POST', body: { orderId: r.orderId, paymentId: r.paymentId, signature: r.signature } });
    stopHoldTimer();
    showConfirmed(v.booking);
  } catch (e) { status.className = 'hint err'; status.textContent = e.message; btn.disabled = false; }
}

/** Real Razorpay Checkout. Not exercised here: it needs live or test keys and the public webhook. */
function payRazorpay(p, b, btn, status) {
  btn.disabled = true; status.className = 'hint'; status.textContent = 'Opening the payment window…';
  const open = () => {
    const u = state.user || {};
    const rz = new window.Razorpay({
      key: p.razorpay.keyId, order_id: p.razorpay.orderId, amount: p.amountPaise, currency: 'INR', name: 'Daji Cricket Ground', description: `Booking ${b.ref}`,
      prefill: { name: u.name, email: u.email, contact: u.phone }, theme: { color: '#c9a96b' },
      handler: async (r) => {
        try {
          const v = await api('/api/payments/razorpay/verify', { method: 'POST', body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } });
          stopHoldTimer(); showConfirmed(v.booking);
        } catch (e) { status.className = 'hint err'; status.textContent = e.message; btn.disabled = false; }
      },
      modal: { ondismiss: () => { btn.disabled = false; status.textContent = ''; } },
    });
    rz.open();
  };
  if (window.Razorpay) return open();
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = open;
  s.onerror = () => { status.className = 'hint err'; status.textContent = 'Could not load the payment window. Check your connection and try again.'; btn.disabled = false; };
  document.head.append(s);
}

function showConfirmed(b) {
  stopHoldTimer();
  const g = state.grounds.find((x) => x.id === b.groundId) || state.ground;
  const c = state.config.contact;
  if (b.status !== 'confirmed') {
    openModal([h('div', { class: 'eyebrow' }, 'Payment received'), h('h3', {}, 'Almost there'), h('p', { class: 'hint' }, 'We have your payment and are confirming the booking.'), bookingRows(b)]);
    return;
  }
  openModal([
    h('div', { class: 'eyebrow' }, 'Confirmed'), h('h3', {}, "You're booked"),
    bookingRows(b, [
      h('div', { class: 'row' }, h('span', {}, 'Paid'), h('b', {}, inr(b.paidPaise))),
      b.balancePaise > 0 ? h('div', { class: 'row' }, h('span', {}, 'Balance at the ground'), h('b', {}, inr(b.balancePaise))) : null]),
    h('p', { class: 'hint' }, `Free cancellation more than ${state.config.freeCancelHours} hours before the start. Questions? Call ${c.name} on ${formatPhone(c.phone)}.`),
    h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:18px' },
      g && g.directionsUrl ? h('a', { class: 'btn primary', href: g.directionsUrl, target: '_blank', rel: 'noopener' }, 'Get directions') : null,
      h('button', { class: 'btn outline', type: 'button', onclick: () => { closeModal(); location.hash = '#bookings'; } }, 'My bookings'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => closeModal() }, 'Close'))]);
  loadSlots();
}

// ------------------------------------------------------------------ enquiry

function openEnquiry(kind) {
  const u = state.user && state.user.role === 'customer' ? state.user : null;
  const gsel = h('select', {}, state.grounds.map((g) => h('option', { value: g.id, selected: state.ground && g.id === state.ground.id }, g.name)));
  const first = input('firstName', 'text', { value: u ? (u.firstName || u.name.split(' ')[0] || '') : '', autocomplete: 'given-name', autocapitalize: 'words' });
  const last = input('lastName', 'text', { value: u ? (u.lastName || u.name.split(' ').slice(1).join(' ')) : '', autocomplete: 'family-name', autocapitalize: 'words' });
  const phone = input('phone', 'tel', { value: u && u.phone ? u.phone : '', autocomplete: 'tel' });
  const email = input('email', 'email', { value: u && u.email ? u.email : '', autocomplete: 'email' });
  const date = input('preferredDate', 'date', { min: firstDay() });
  const players = input('players', 'number', { min: '1', max: '500' });
  const msg = h('textarea', { placeholder: kind === 'academy' ? 'Tell us about the player and what you are looking for.' : 'What are you planning? Match, practice, tournament…' }, kind === 'academy' ? 'I would like to know about MP13 Academy. ' : '');
  const err = h('div', { class: 'fe' });
  const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Send enquiry');
  const form = h('form', { novalidate: true },
    field('Ground', gsel), h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px' }, field('First name', first), field('Last name', last)), field('Mobile number', phone), field('Email (optional)', email),
    h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px' }, field('Preferred date', date), field('Players', players)),
    field('Message', msg), err, submit);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.textContent = ''; submit.disabled = true;
    const body = { groundId: gsel.value, firstName: first.value.trim(), lastName: last.value.trim(), phone: phone.value.trim(), message: msg.value.trim() };
    if (email.value.trim()) body.email = email.value.trim();
    if (date.value) body.preferredDate = date.value;
    if (players.value) body.players = Number(players.value);
    try { await api('/api/enquiries', { method: 'POST', body }); closeModal(); toast('Thank you. We have your enquiry and will get back to you soon.'); }
    catch (e) { const f = fieldErrors(e); err.textContent = Object.keys(f).length ? Object.entries(f).map(([k, m]) => `${k}: ${m}`).join('  ·  ') : e.message; submit.disabled = false; }
  });
  openModal([h('div', { class: 'eyebrow' }, 'Enquiry'), h('h3', {}, kind === 'academy' ? 'Ask about MP13 Academy' : 'Send an enquiry'), form]);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-enquiry]'); if (b) { e.preventDefault(); openEnquiry(b.dataset.enquiry); } });

// ------------------------------------------------------------------ my bookings

const STATUS = {
  confirmed: ['ok', 'Confirmed'], held: ['warn', 'Held'], cancelled: ['mute', 'Cancelled'], expired: ['mute', 'Expired'],
  no_show: ['danger', 'No-show'], completed: ['info', 'Played'],
};

async function loadBookings() {
  const list = clear($('#bk-list')); list.append(h('div', { class: 'skeleton' }, 'Loading…'));
  const ex = clear($('#bk-extra')); for (const f of bookingsExtras) f(ex);
  renderMyDash(clear($('#bk-dash')));
  await loadCredit();
  $('#bk-credit').textContent = state.creditPaise > 0 ? `Account credit: ${inr(state.creditPaise)}. It is used first on your next booking if you tick the box.` : 'Your confirmed, played and cancelled bookings.';
  try {
    const res = await api('/api/bookings?limit=50');
    clear(list);
    if (!res.items.length) { list.append(h('div', { class: 'empty' }, 'No bookings yet. Pick a ground and a time to get started.')); return; }
    for (const b of res.items) {
      const pending = b.status === 'confirmed' && b.approval === 'pending';
      const [cls, label] = pending ? ['warn', 'Pending approval'] : b.status === 'cancelled' && b.cancelledByOwner ? ['danger', 'Cancelled by the ground'] : (STATUS[b.status] || ['mute', b.status]);
      const canCancel = (b.status === 'confirmed' || b.status === 'held') && b.startAt > Date.now();
      const choosing = b.status === 'cancelled' && b.cancelledByOwner && b.resolution === 'awaiting';
      list.append(h('div', { class: 'bk' + (choosing ? ' needs' : '') },
        h('div', {},
          h('h4', {}, b.groundName),
          h('div', { class: 'meta' }, `${niceDate(b.date)}, ${hhmm(b.startAt)} – ${hhmm(b.endAt)}  ·  ${b.formatLabel ? b.formatLabel + ' (' + b.ball + ' ball)' : b.slotCount + (b.slotCount === 1 ? ' slot' : ' slots')}  ·  `, h('span', { class: 'mono' }, b.ref)),
          h('div', { class: 'meta' }, `Total ${inr(b.totalPaise)}  ·  Paid ${inr(b.paidPaise)}` + (b.status === 'confirmed' && b.balancePaise > 0 ? `  ·  Balance ${inr(b.balancePaise)}` : '')
            + (b.status === 'held' && b.holdExpiresAt ? `  ·  Hold ends ${hhmm(b.holdExpiresAt)}` : '')
            + (b.cancelKind === 'credit' && b.creditPaise ? `  ·  ${inr(b.creditPaise)} returned as credit` : '') + (b.refundPaise ? `  ·  ${inr(b.refundPaise)} refunded` : '')),
          b.seriesId ? h('div', { class: 'meta' }, `Repeat booking, date ${b.seriesIndex + 1}`, (b.status === 'confirmed' || b.status === 'held') && b.startAt > Date.now() ? h('a', { href: '#', style: 'margin-left:8px', onclick: (e) => { e.preventDefault(); cancelSeriesOf(b); } }, 'Cancel unpaid repeats') : null) : null,
          pending ? h('div', { class: 'meta' }, 'Your deposit is holding the slot. The ground will approve it shortly and you will get a message.') : null,
          b.status === 'cancelled' && b.cancelledByOwner ? cancelledByGround(b) : null),
        h('div', { class: 'acts' }, h('span', { class: 'st ' + cls }, label), canCancel ? h('button', { class: 'btn outline sm', type: 'button', onclick: () => openCancel(b) }, 'Cancel') : null)));
    }
  } catch (e) { clear(list); list.append(h('div', { class: 'empty' }, e.message)); }
}

async function cancelSeriesOf(b) {
  if (!confirm('Cancel every upcoming date of this repeat booking that has no payment on it? A date you have already paid for stays until you cancel it yourself.')) return;
  try { const r = await api(`/api/bookings/${encodeURIComponent(b.id)}/cancel-series`, { method: 'POST', body: {} }); toast(`${r.cancelled} dates cancelled` + (r.kept ? `, ${r.kept} paid date kept.` : '.')); loadBookings(); }
  catch (e) { toast(e.message, true); }
}

/** Auto-debit card in My bookings: approve once, and the balance is charged shortly before each booking. */
bookingsExtras.push((ex) => {
  if (!state.config.autoDebitEnabled || !state.user || state.user.role !== 'customer') return;
  const card = h('div', { class: 'card', style: 'margin:0 0 14px' }); ex.append(card);
  const draw = async () => {
    clear(card);
    let m; try { m = await api('/api/autodebit'); } catch { return; }
    const err = h('div', { class: 'fe' });
    card.append(h('h4', { style: 'margin:0 0 4px' }, 'Auto-debit'));
    if (m.status === 'active') {
      card.append(h('p', { class: 'hint' }, `On. The balance of each booking is charged from your bank ${m.hoursBefore} hours before it starts, up to ${inr(m.maxAmountPaise)} at a time. You get a message each time.`),
        h('button', { class: 'btn outline sm', type: 'button', onclick: async () => { try { await api('/api/autodebit', { method: 'DELETE' }); toast('Auto-debit turned off.'); draw(); } catch (e) { err.textContent = e.message; } } }, 'Turn off'), err);
      return;
    }
    const sel = h('select', { 'aria-label': 'Most to charge at once' }, ...[200000, 500000, 1000000, 1500000].map((v) => h('option', { value: v, selected: v === 500000 }, `Up to ${inr(v)}`)));
    const go = h('button', { class: 'btn primary sm', type: 'button' }, 'Set up auto-debit');
    go.addEventListener('click', async () => {
      err.textContent = ''; go.disabled = true;
      try {
        const st = await api('/api/autodebit/start', { method: 'POST', body: { maxAmountPaise: Number(sel.value) } });
        if (st.razorpay.demo) { await api('/api/autodebit/confirm', { method: 'POST', body: { mandateId: st.mandateId } }); toast('Auto-debit is on (demo).'); return draw(); }
        const open = () => new window.Razorpay({ key: st.razorpay.keyId, order_id: st.razorpay.orderId, customer_id: st.razorpay.customerId, recurring: '1', amount: st.razorpay.amountPaise, currency: 'INR', name: 'Daji Cricket Ground', description: 'Approve auto-debit (₹1 is charged and refunded)', theme: { color: '#c9a96b' },
          handler: async (r) => { try { await api('/api/autodebit/confirm', { method: 'POST', body: { mandateId: st.mandateId, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } }); toast('Auto-debit is on.'); draw(); } catch (e) { err.textContent = e.message; go.disabled = false; } },
          modal: { ondismiss: () => { go.disabled = false; } } }).open();
        if (window.Razorpay) open(); else { const sc = document.createElement('script'); sc.src = 'https://checkout.razorpay.com/v1/checkout.js'; sc.onload = open; document.head.append(sc); }
      } catch (e) { err.textContent = e.message; go.disabled = false; }
    });
    card.append(h('p', { class: 'hint' }, `Approve once with UPI and the balance of every booking is charged ${m.hoursBefore} hours before it starts, so there is nothing to pay at the ground. You can turn it off at any time. A ₹1 check is made and refunded.`), h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, sel, go), err);
  };
  draw();
});

/** The ground cancelled this booking: show why, and let the customer choose a full refund, credit, or another slot. */
function cancelledByGround(b) {
  const box = h('div', { class: 'whybox' }, h('b', {}, 'Why the ground cancelled'), h('p', {}, b.cancelReason || ''));
  if (b.resolution === 'awaiting') {
    const err = h('div', { class: 'fe' });
    const pick = async (choice) => {
      err.textContent = '';
      try {
        const r = await api(`/api/bookings/${encodeURIComponent(b.id)}/resolve`, { method: 'POST', body: { choice } });
        toast(choice === 'refund' || choice === 'half' ? 'Your refund is on its way.' : choice === 'rebook' ? 'Your credit is ready. Pick your new slot.' : 'Added to your account credit.');
        await loadBookings();
        if (r.rebook) jump('book');
      } catch (e) { err.textContent = e.message; }
    };
    const offers = b.cancelOffers && b.cancelOffers.length ? b.cancelOffers : ['refund', 'credit'];
    const pct = state.config.cashRefundPercent;
    box.append(h('p', { class: 'hint' }, `You paid ${inr(b.paidPaise)}. The ground is offering:`),
      h('div', { class: 'choices' },
        offers.includes('refund') ? h('button', { class: 'btn primary sm', type: 'button', onclick: () => pick('refund') }, `Full refund (${inr(b.paidPaise)})`) : null,
        offers.includes('half') ? h('button', { class: 'btn primary sm', type: 'button', onclick: () => pick('half') }, `${pct}% refund to my payment method`) : null,
        offers.includes('credit') ? h('button', { class: 'btn outline sm', type: 'button', onclick: () => pick('credit') }, 'Keep as account credit') : null,
        offers.includes('credit') ? h('button', { class: 'btn outline sm', type: 'button', onclick: () => pick('rebook') }, 'Pick another slot') : null),
      h('p', { class: 'hint' }, h('a', { href: '#terms', onclick: (e) => { e.preventDefault(); openTerms(); } }, 'Terms and conditions')), err);
  } else box.append(h('p', { class: 'hint' }, b.resolution === 'half' ? `You chose the ${state.config.cashRefundPercent}% refund${b.refundPaise ? ` (${inr(b.refundPaise)})` : ''}.` : b.resolution === 'refund' ? `You chose a full refund${b.refundPaise ? ` (${inr(b.refundPaise)})` : ''}.` : `You chose account credit${b.creditPaise ? ` (${inr(b.creditPaise)})` : ''}.`));
  return box;
}

async function openCancel(b) {
  let pv;
  try { pv = await api(`/api/bookings/${encodeURIComponent(b.id)}/cancel-preview`); } catch (e) { return toast(e.message, true); }
  let prefer = 'refund';
  const choice = pv.kind === 'free' && pv.creditOptionPaise > pv.creditPaise && pv.refundPaise >= 0 && pv.paidPaise > 0
    ? h('div', { style: 'margin:0 0 14px' },
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'prefer', checked: true, onchange: () => { prefer = 'refund'; } }), h('span', {}, `Refund ${inr(pv.refundPaise)} to my payment method (${pv.cashRefundPercent}% of what I paid)`)),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'prefer', onchange: () => { prefer = 'credit'; } }), h('span', {}, `Keep all ${inr(pv.creditOptionPaise)} as account credit for a future booking`)))
    : null;
  const err = h('div', { class: 'fe' });
  const go = h('button', { class: 'btn primary block', type: 'button', onclick: async () => {
    go.disabled = true;
    try { await api(`/api/bookings/${encodeURIComponent(b.id)}/cancel`, { method: 'POST', body: { prefer } }); closeModal(); toast('Booking cancelled.'); loadBookings(); loadSlots(); }
    catch (e) { err.textContent = e.message; go.disabled = false; }
  } }, 'Yes, cancel this booking');
  openModal([h('div', { class: 'eyebrow' }, 'Cancel'), h('h3', {}, 'Cancel this booking?'), h('p', { class: 'hint', style: 'font-size:15px;color:var(--text)' }, pv.message), bookingRows(b), choice, err, go,
    h('button', { class: 'btn ghost block', type: 'button', style: 'margin-top:8px', onclick: () => closeModal() }, 'Keep my booking')]);
}

// ------------------------------------------------------------------ promo codes (owner desk tab, and a panel on the admin desk)

function promoText(p) {
  const what = p.kind === 'percent' ? `${p.value}% off${p.maxDiscountPaise ? `, up to ${inr(p.maxDiscountPaise)}` : ''}` : `${inr(p.value)} off`;
  const bits = [what, p.minTotalPaise ? `min ${inr(p.minTotalPaise)}` : '', p.validFrom || p.validTo ? `${p.validFrom ? 'from ' + niceDate(p.validFrom) : ''} ${p.validTo ? 'to ' + niceDate(p.validTo) : ''}`.trim() : '', p.usageLimit ? `${p.used} of ${p.usageLimit} used` : `${p.used} used`];
  return bits.filter(Boolean).join(' · ');
}

function renderPromos(box) {
  const list = h('div', { class: 'list' }, h('div', { class: 'skeleton' }, 'Loading…'));
  const fresh = h('div', { class: 'whybox', hidden: true });
  const load = async () => {
    try {
      const r = await api('/api/staff/promos');
      clear(list);
      if (!r.items.length) list.append(h('p', { class: 'hint' }, 'No promo codes yet. Build one above.'));
      for (const p of r.items) list.append(h('div', { class: 'li' },
        h('span', {}, h('b', { style: 'letter-spacing:.06em' }, p.code), p.label ? `  ·  ${p.label}` : '', h('br'), h('span', { class: 'hint' }, promoText(p))),
        h('span', { class: 'acts' }, h('b', {}, p.active ? 'Active' : 'Off'),
          h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { await api(`/api/staff/promos/${encodeURIComponent(p.id)}/active`, { method: 'POST', body: { active: !p.active } }); load(); } catch (e) { toast(e.message, true); } } }, p.active ? 'Switch off' : 'Switch on'))));
    } catch (e) { clear(list); list.append(h('p', { class: 'fe' }, e.message)); }
  };
  const f = (label, el) => { el.style.width = '100%'; return h('label', { class: 'lbl', style: 'display:grid;gap:6px' }, label, el); };
  const mode = h('select', {}, h('option', { value: 'auto' }, 'Generate codes for me'), h('option', { value: 'manual' }, 'I will type the code'));
  const code = h('input', { type: 'text', maxlength: '20', placeholder: 'For example DIWALI10', autocapitalize: 'characters' });
  const prefix = h('input', { type: 'text', maxlength: '10', placeholder: 'Optional start, for example VIP', autocapitalize: 'characters' });
  const count = h('input', { type: 'number', min: '1', max: '50', value: '1' });
  const one = h('input', { type: 'checkbox', checked: true });
  const kind = h('select', {}, h('option', { value: 'percent' }, 'Percentage off'), h('option', { value: 'flat' }, 'Rupees off'));
  const value = h('input', { type: 'number', min: '1', value: '10' });
  const cap = h('input', { type: 'number', min: '0', placeholder: 'No cap' });
  const min = h('input', { type: 'number', min: '0', placeholder: 'No minimum' });
  const from = h('input', { type: 'date' }), to = h('input', { type: 'date' });
  const lim = h('input', { type: 'number', min: '1', placeholder: 'Unlimited' });
  const label = h('input', { type: 'text', maxlength: '80', placeholder: 'Note for yourself, for example Diwali weekend' });
  const err = h('div', { class: 'fe' });
  const autoOnly = [f('How many codes', count), f('Code starts with', prefix), h('label', { class: 'check', style: 'align-self:center' }, one, h('span', {}, 'One-time codes (each works once)'))];
  const manualOnly = [f('Code', code), f('Times it can be used in total', lim)];
  const sync = () => { const a = mode.value === 'auto'; autoOnly.forEach((e) => { e.hidden = !a; }); manualOnly.forEach((e) => { e.hidden = a; }); };
  mode.addEventListener('change', sync); sync();
  const go = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    err.textContent = ''; go.disabled = true;
    const body = { kind: kind.value, value: kind.value === 'flat' ? Math.round(Number(value.value) * 100) : Number(value.value), label: label.value.trim() || undefined };
    if (kind.value === 'percent' && cap.value) body.maxDiscountPaise = Math.round(Number(cap.value) * 100);
    if (min.value) body.minTotalPaise = Math.round(Number(min.value) * 100);
    if (from.value) body.validFrom = from.value;
    if (to.value) body.validTo = to.value;
    if (mode.value === 'auto') Object.assign(body, { auto: true, count: Number(count.value) || 1, prefix: prefix.value.trim() || undefined, oneTime: one.checked });
    else { body.code = code.value.trim(); if (lim.value) body.usageLimit = Number(lim.value); }
    try {
      const r = await api('/api/staff/promos', { method: 'POST', body });
      clear(fresh); fresh.hidden = false;
      fresh.append(h('b', {}, r.items.length === 1 ? 'Code ready' : `${r.items.length} codes ready`), h('p', { class: 'hint' }, 'Share these with your customers:'), h('pre', { style: 'white-space:pre-wrap;user-select:all;margin:0;font-size:16px;letter-spacing:.06em' }, r.items.map((p) => p.code).join('\n')));
      load();
    } catch (e) { err.textContent = e.message; }
    go.disabled = false;
  } }, 'Create');
  box.append(h('div', { class: 'eyebrow', style: 'margin-bottom:12px' }, 'Promo codes'),
    h('div', { class: 'box', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;align-items:end' }, f('Code', mode), ...autoOnly, ...manualOnly, f('Discount type', kind), f('Amount (percent, or rupees)', value), f('Largest discount in rupees (percentage codes)', cap), f('Smallest booking in rupees', min), f('Valid from', from), f('Valid until', to), f('Note', label), err, go, h('div', { style: 'grid-column:1/-1' }, fresh)),
    h('div', { style: 'margin-top:18px' }, list));
  load();
}
deskTabs.push({ id: 'promos', label: 'Promo codes', perm: 'owner_only', render: renderPromos });

// ------------------------------------------------------------------ owner desk

/** A tab's pages: each one is its own screen with its own address. */
function subPages(pane, tabId, items) {
  const bar = h('div', { class: 'tabs subbar' }), view = h('div', { style: 'margin-top:22px' });
  const open = (id, quiet) => {
    const it = items.find((x) => x[0] === id) || items[0];
    for (const b of bar.children) b.classList.toggle('on', b.dataset.id === it[0]);
    deskNav(tabId, it[0], quiet);
    clear(view); it[2](view);
  };
  for (const it of items) bar.append(h('button', { class: 'tab', type: 'button', 'data-id': it[0], onclick: () => open(it[0]) }, it[1]));
  pane.append(bar, view);
  const want = state.deskSub; state.deskSub = null;
  open(want || items[0][0], true);
}

const roleName = (u) => u.role === 'super_admin' ? 'Software owner' : u.role === 'owner' ? 'Owner' : (u.permissions || []).includes('manage_accounting') ? 'Accountant' : 'Team';

const SERVICE_STATUS = { not_started: 'Not started', account_created: 'Account created', connected: 'Connected', live: 'Live', problem: 'Needs attention' };
/** A notebook of the outside services we use and the account each one was opened with. Never passwords or keys. */
const CONN_LABEL = { ready: 'Ready', partial: 'Partly set up', missing: 'Not connected', not_built: 'Not built yet' };
/** Every outside service, whether the server has what it needs to use it, and a safe test where there is one. */
function renderConnections(view) {
  const box = h('div', { class: 'box', style: 'margin-bottom:24px' }), list = h('div', { class: 'list' }, h('div', { class: 'skeleton' }, 'Loading…'));
  box.append(h('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Connections'), h('p', { class: 'hint' }, 'What the server needs for each service. Only the names of missing settings are shown, never their values. New services appear here as they are added.'), list);
  view.append(box);
  async function load() {
    try {
      const r = await api('/api/admin/integrations'); clear(list);
      for (const c of r.items) {
        const res = h('div', { class: 'hint', style: 'margin-top:4px' }, c.lastTest ? `Last test ${niceDateTime(c.lastTest.at)}: ${c.lastTest.message}` : '');
        const test = c.canTest ? h('button', { class: 'btn outline sm', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Testing…'; try { const t = await api(`/api/admin/integrations/${encodeURIComponent(c.id)}/test`, { method: 'POST', body: {} }); res.textContent = (t.ok ? '✓ ' : '✗ ') + t.message; res.style.color = t.ok ? '' : '#e07a5f'; } catch (er) { res.textContent = er.message; } b.disabled = false; b.textContent = 'Test'; } }, 'Test') : null;
        list.append(h('div', { class: 'li', style: 'align-items:flex-start;gap:14px' },
          h('span', { style: 'min-width:0' }, h('b', {}, c.name), h('span', { class: 'hint' }, `  ·  ${c.what}`),
            c.status === 'ready' ? null : h('div', { class: 'hint', style: 'margin-top:4px' }, c.note || (c.missing.length ? `Missing: ${c.missing.join(', ')}. ` : '') + c.setup), res),
          h('span', { class: 'acts' }, h('b', { style: c.status === 'ready' ? 'color:#7fb685' : c.status === 'partial' ? '#d9bb73' : '' }, CONN_LABEL[c.status] || c.status), test)));
      }
    } catch (e) { clear(list); list.append(h('p', { class: 'fe' }, e.message)); }
  }
  load();
}
function renderServices(view) {
  renderConnections(view);
  const box = h('div', { class: 'box' }), list = h('div', { class: 'list' }, h('div', { class: 'skeleton' }, 'Loading…'));
  box.append(h('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Services and accounts'),
    h('p', { class: 'hint' }, 'Which email and phone each service was opened with, so it is never forgotten. Do not write passwords or keys here; those go in the server settings file.'),
    h('div', { style: 'margin:10px 0 16px' }, h('button', { class: 'btn primary sm', type: 'button', onclick: () => editService(null, load) }, 'Add a service')), list);
  view.append(box);
  async function load() {
    try {
      const r = await api('/api/admin/services'); clear(list);
      for (const s of r.items) list.append(h('div', { class: 'li', style: 'align-items:flex-start;gap:14px' },
        h('span', { style: 'min-width:0' }, h('b', {}, s.name), s.purpose ? h('span', { class: 'hint' }, `  ·  ${s.purpose}`) : null,
          h('div', { class: 'hint', style: 'margin-top:4px' }, [s.accountEmail ? 'Email: ' + s.accountEmail : '', s.phone ? 'Phone: ' + s.phone : ''].filter(Boolean).join('   ·   ') || 'No account details yet'),
          s.loginUrl ? h('div', { class: 'hint' }, h('a', { href: s.loginUrl, target: '_blank', rel: 'noopener' }, 'Open ' + s.name)) : null,
          s.notes ? h('div', { class: 'hint', style: 'margin-top:4px;white-space:pre-wrap' }, s.notes) : null),
        h('span', { class: 'acts' }, h('b', { style: s.status === 'problem' ? 'color:#e07a5f' : '' }, SERVICE_STATUS[s.status] || s.status), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => editService(s, load) }, 'Edit'))));
    } catch (e) { clear(list); list.append(h('p', { class: 'fe' }, e.message)); }
  }
  load();
}
function editService(s, done) {
  const v = s || {}, err = h('div', { class: 'fe' });
  const f = (l, el) => { el.style.width = '100%'; return h('label', { class: 'lbl', style: 'display:grid;gap:6px;margin-top:12px' }, l, el); };
  const name = h('input', { type: 'text', maxlength: '80', value: v.name || '' }), purpose = h('input', { type: 'text', maxlength: '200', value: v.purpose || '', placeholder: 'What we use it for' });
  const email = h('input', { type: 'email', value: v.accountEmail || '', placeholder: 'Email the account was opened with' }), phone = h('input', { type: 'text', maxlength: '30', value: v.phone || '', placeholder: 'Phone number on the account' });
  const url = h('input', { type: 'url', value: v.loginUrl || '', placeholder: 'https://…' });
  const status = h('select', {}, Object.entries(SERVICE_STATUS).map(([k, l]) => h('option', { value: k, selected: (v.status || 'not_started') === k }, l)));
  const notes = h('textarea', { rows: '4', maxlength: '2000', placeholder: 'What is done, what is left, who to call' }, v.notes || '');
  const save = h('button', { class: 'btn primary block', type: 'button', style: 'margin-top:16px', onclick: async () => {
    err.textContent = ''; save.disabled = true;
    const body = { name: name.value.trim(), purpose: purpose.value.trim(), accountEmail: email.value.trim(), phone: phone.value.trim(), loginUrl: url.value.trim(), status: status.value, notes: notes.value.trim() };
    try { await api(s ? '/api/admin/services/' + encodeURIComponent(s.id) : '/api/admin/services', { method: s ? 'PATCH' : 'POST', body }); closeModal(); toast('Saved'); done(); }
    catch (e) { const fe = fieldErrors(e); err.textContent = Object.values(fe)[0] || e.message; save.disabled = false; }
  } }, 'Save');
  openModal([h('div', { class: 'eyebrow' }, s ? 'Edit' : 'New'), h('h3', {}, s ? s.name : 'Add a service'), f('Name', name), f('What it is for', purpose), f('Account email', email), f('Phone number', phone), f('Login link', url), f('Where it stands', status), f('Notes', notes), err, save,
    s ? h('button', { class: 'btn ghost block', type: 'button', style: 'margin-top:8px', onclick: async () => { try { await api('/api/admin/services/' + encodeURIComponent(s.id), { method: 'DELETE' }); closeModal(); done(); } catch (e) { err.textContent = e.message; } } }, 'Remove from the list') : null]);
}

function renderPlatform(pane) {
  const pages = [
    ['settings', 'Platform settings', (v) => loadAdminDesk(v)],
    ['prices', 'Prices and timings', (v) => { const b = h('div', { class: 'box' }); v.append(b); loadTimings(b); }],
    ['people', 'People', (v) => { const b = h('div', { class: 'box' }); v.append(b); loadPeople(b); }],
    ['services', 'Services and connections', renderServices],
  ];
  adminPanels.forEach((f, i) => pages.push([f.pageId || 'requests' + (i || ''), f.pageLabel || 'Owner requests', (v) => v.append(f())]));
  subPages(pane, 'platform', pages);
}

function renderToday(pane) {
  const u = state.user;
  const pages = [['overview', 'Overview', (v) => renderTodayParts(v, ['overview'])], ['approvals', 'Approvals', (v) => renderTodayParts(v, ['approvals'])]];
  if (u.role === 'owner' || (u.permissions || []).includes('manage_grounds')) pages.push(['prices', 'Prices and timings', (v) => renderTodayParts(v, ['prices'])], ['people', 'People', (v) => renderTodayParts(v, ['people'])]);
  subPages(pane, 'today', pages);
}

/** The owner's team: an Admin has fewer rights than the owner, and the owner can change them any time. */
function renderTeam(pane) {
  const box = h('div', { class: 'box' }, h('div', { class: 'skeleton' }, 'Loading…'));
  pane.append(box);
  const load = async () => {
    try {
      const r = await api('/api/staff/team');
      clear(box);
      const first = h('input', { type: 'text', maxlength: '40', placeholder: 'First name' }), last = h('input', { type: 'text', maxlength: '40', placeholder: 'Last name' }), email = h('input', { type: 'email', placeholder: 'Email' }), phone = h('input', { type: 'tel', placeholder: '10 digit mobile number' }), pw = h('input', { type: 'text', placeholder: 'First password', autocomplete: 'off' });
      const preset = h('select', {}, Object.entries(r.presets).map(([k, p]) => h('option', { value: k }, p.title)));
      const err = h('div', { class: 'fe' });
      const f = (l, el) => { el.style.width = '100%'; return h('label', { class: 'lbl', style: 'display:grid;gap:6px' }, l, el); };
      const add = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        err.textContent = ''; add.disabled = true;
        try { await api('/api/staff/team', { method: 'POST', body: { firstName: first.value.trim(), lastName: last.value.trim(), email: email.value.trim(), phone: phone.value.trim() || undefined, password: pw.value, preset: preset.value } }); toast('Added. They can sign in with their email or mobile number.'); load(); }
        catch (e) { err.textContent = e.message; add.disabled = false; }
      } }, 'Add to team');
      const list = h('div', { class: 'list' });
      if (!r.items.length) list.append(h('p', { class: 'hint' }, 'No one on your team yet.'));
      for (const m of r.items) {
        const perms = h('div', { style: 'display:none;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px;margin:8px 0' });
        const boxes = r.allPermissions.map((p) => { const c = h('input', { type: 'checkbox', checked: (m.permissions || []).includes(p) }); perms.append(h('label', { class: 'check' }, c, h('span', {}, p.replace(/_/g, ' ')))); return [p, c]; });
        const save = async (body) => { try { await api('/api/staff/team/' + encodeURIComponent(m.id), { method: 'PATCH', body }); toast('Saved'); load(); } catch (e) { toast(e.message, true); } };
        list.append(h('div', { class: 'li', style: 'flex-wrap:wrap' },
          h('span', {}, h('b', {}, m.name), `  ·  ${m.email || ''}${m.phone ? '  ·  ' + m.phone : ''}`, h('br'), h('span', { class: 'hint' }, `${(m.permissions || []).length} permissions${m.active ? '' : '  ·  switched off'}`)),
          h('span', { class: 'acts' },
            h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { perms.style.display = perms.style.display === 'none' ? 'grid' : 'none'; } }, 'Rights'),
            h('button', { class: 'btn ghost sm', type: 'button', onclick: () => save({ active: !m.active }) }, m.active ? 'Switch off' : 'Switch on')),
          h('div', { style: 'flex-basis:100%' }, perms, h('button', { class: 'btn outline sm', type: 'button', style: 'display:none', onclick: () => save({ permissions: boxes.filter(([, c]) => c.checked).map(([p]) => p) }) }, 'Save rights'))));
        const saveBtn = list.lastChild.querySelector('button.outline'); const toggle = list.lastChild.querySelector('.acts button'); toggle.addEventListener('click', () => { saveBtn.style.display = perms.style.display === 'none' ? 'none' : ''; });
      }
      box.append(h('div', { class: 'eyebrow', style: 'margin-bottom:12px' }, 'Your team'), h('p', { class: 'hint' }, 'An Admin runs the day to day (bookings, payments, customers, the academy and matches) and can read reports. Prices, the books, promo codes, the team and settings stay with you.'),
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;align-items:end;margin:14px 0' }, f('First name', first), f('Last name', last), f('Email', email), f('Mobile number', phone), f('Role', preset), f('First password', pw), add), err, list);
    } catch (e) { clear(box); box.append(h('div', { class: 'empty' }, e.message)); }
  };
  load();
}
deskTabs.push({ id: 'team', label: 'Team', perm: 'owner_only', ownerOnly: true, render: renderTeam });

// ------------------------------------------------------------------ tasks: jobs for the team, closed with camera photos

/** A photo from the server needs the sign-in header, so it is fetched and shown from a blob. */
function taskPhoto(p) {
  const img = h('img', { alt: 'Task photo', class: 'tphoto', loading: 'lazy' });
  if (/^data:/.test(p.url)) img.src = p.url;
  else (async () => { try { const r = await fetch(API + p.url, { headers: { authorization: 'Bearer ' + state.token } }); if (r.ok) img.src = URL.createObjectURL(await r.blob()); } catch { /* shows empty */ } })();
  img.title = 'Taken ' + new Date(p.takenAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + (p.uploadedByName ? ' by ' + p.uploadedByName : '') + (p.note ? ' · ' + p.note : '');
  return img;
}

function renderTasks(box) {
  const u = state.user, manager = can(u, 'manage_tasks');
  const COLS = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'Review'], ['done', 'Done']];
  const PRI = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
  let tasks = [], projects = [], team = [], projectId = '';
  const msg = h('div', { class: 'fe' }), board = h('div', { class: 'kanban' }), bar = h('div', { class: 'kbar2' });
  const when = (ms) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const initials = (n) => (n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const fieldMsg = (e) => (e.details && e.details.fields && e.details.fields[0] ? e.details.fields[0].message : e.message);

  /** Camera only: the phone opens its camera (capture), and the file goes up untouched, because re-saving a picture would wipe its camera time. */
  const takePhoto = (t, after, onErr) => {
    const pick = h('input', { type: 'file', accept: 'image/jpeg', capture: 'environment', style: 'display:none' });
    pick.addEventListener('change', async () => {
      const f = pick.files[0]; if (!f) return;
      try { await apiFile(`/api/tasks/${encodeURIComponent(t.id)}/photos`, f); toast('Photo added.'); after(); }
      catch (e) { onErr(e.message); toast(e.message, true); }
      pick.value = '';
    });
    document.body.append(pick); pick.click(); setTimeout(() => pick.remove(), 60000);
  };

  const move = async (id, stage, index) => {
    msg.textContent = '';
    try { await api(`/api/tasks/${encodeURIComponent(id)}/move`, { method: 'POST', body: { stage, index } }); }
    catch (e) { msg.textContent = e.message; toast(e.message, true); }
    load();
  };

  const card = (t) => {
    const el = h('div', { class: 'kcard p-' + t.priority, draggable: 'true', tabindex: '0', 'data-id': t.id, role: 'button', 'aria-label': t.title },
      h('div', { class: 'ktop' }, h('span', { class: 'kpri' }, PRI[t.priority]), t.projectName ? h('span', { class: 'kproj' }, t.projectName) : null),
      h('b', { class: 'ktitle' }, t.title),
      t.milestoneTitle ? h('div', { class: 'kmile' }, '◆ ' + t.milestoneTitle) : null,
      h('div', { class: 'kmeta' },
        h('span', { class: t.overdue ? 'kdue bad' : 'kdue' }, t.stage === 'done' ? 'Done' : t.dueDate ? (t.overdue ? 'Overdue · ' : 'Due ') + niceDate(t.dueDate) : 'No due day'),
        t.photosRequired ? h('span', { title: 'Photos' }, `📷 ${t.photos.length}/${t.photosRequired}`) : null,
        t.commentCount ? h('span', { title: 'Comments' }, `💬 ${t.commentCount}`) : null,
        h('span', { class: 'kwho', title: t.assignedName || 'Open to the whole team' }, t.assignedName ? initials(t.assignedName) : '·')));
    el.addEventListener('click', () => detail(t.id));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') detail(t.id); });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('drag'); });
    el.addEventListener('dragend', () => { el.classList.remove('drag'); $$('.kcol.over', board).forEach((c) => c.classList.remove('over')); });
    return el;
  };

  const drawBoard = () => {
    clear(board);
    const visible = tasks.filter((t) => t.status !== 'cancelled' && (!projectId || t.projectId === projectId));
    for (const [stage, label] of COLS) {
      const items = visible.filter((t) => t.stage === stage);
      const shown = stage === 'done' ? items.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 25) : items;
      const body = h('div', { class: 'kbody' }, shown.length ? shown.map(card) : h('div', { class: 'kempty' }, stage === 'todo' ? 'Nothing waiting.' : 'Drop a card here.'));
      const col = h('section', { class: 'kcol', 'data-stage': stage }, h('header', {}, h('span', {}, label), h('em', {}, String(items.length))), body);
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain'); if (!id) return;
        const cards = $$('.kcard', body).filter((c) => c.dataset.id !== id);
        let index = cards.length;
        for (let k = 0; k < cards.length; k++) { const r = cards[k].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { index = k; break; } }
        move(id, stage, index);
      });
      board.append(col);
    }
  };

  async function load() {
    try {
      const [t, p] = await Promise.all([api('/api/tasks'), api('/api/projects').catch(() => ({ items: [] }))]);
      tasks = t.items; projects = p.items; drawBar(); drawBoard();
    } catch (e) { clear(board); board.append(h('p', { class: 'fe' }, e.message)); }
  }

  const drawBar = () => {
    clear(bar);
    const sel2 = h('select', { 'aria-label': 'Project' }, h('option', { value: '' }, 'All projects'), projects.filter((p) => p.status === 'active').map((p) => h('option', { value: p.id, selected: p.id === projectId ? true : null }, p.name)));
    sel2.addEventListener('change', () => { projectId = sel2.value; drawBoard(); });
    bar.append(sel2, h('span', { class: 'hint kcount' }, `${tasks.filter((t) => t.status === 'open').length} open`),
      h('span', { class: 'dls' }, manager ? h('button', { class: 'btn outline sm', type: 'button', onclick: projectsDialog }, 'Projects & milestones') : null, manager ? h('button', { class: 'btn primary sm', type: 'button', onclick: () => detail(null) }, 'New task') : null));
  };

  const loadTeam = async () => { try { team = (await api('/api/staff/team')).items.filter((m) => m.active !== false); } catch { team = []; } };

  // ---- one card: edit, move, photos, comments
  async function detail(id) {
    const t = id ? tasks.find((x) => x.id === id) : null, isNew = !t, editable = manager && (isNew || t.status === 'open');
    if (!team.length && manager) await loadTeam();
    const err = h('div', { class: 'fe' });
    const title = h('input', { type: 'text', maxlength: '120', value: t ? t.title : '', placeholder: 'What needs doing? e.g. Roll the pitch', disabled: editable ? null : true });
    const details = h('textarea', { maxlength: '1000', rows: '3', placeholder: 'Details (optional)', disabled: editable ? null : true }, t ? t.details || '' : '');
    const who = h('select', { disabled: editable ? null : true }, h('option', { value: '' }, 'Anyone on the team'), team.map((m) => h('option', { value: m.id, selected: t && t.assignedTo === m.id ? true : null }, m.name)));
    const pri = h('select', { disabled: editable ? null : true }, Object.entries(PRI).map(([k, l]) => h('option', { value: k, selected: (t ? t.priority : 'medium') === k ? true : null }, l)));
    const due = h('input', { type: 'date', value: t && t.dueDate ? t.dueDate : '', disabled: editable ? null : true });
    const need = h('input', { type: 'number', min: '0', max: '10', value: String(t ? t.photosRequired : 1), disabled: editable ? null : true });
    const proj = h('select', { disabled: editable ? null : true }, h('option', { value: '' }, 'No project'), projects.filter((p) => p.status === 'active' || (t && t.projectId === p.id)).map((p) => h('option', { value: p.id, selected: t && t.projectId === p.id ? true : (isNew && projectId === p.id ? true : null) }, p.name)));
    const mile = h('select', { disabled: editable ? null : true });
    const fillMile = () => { clear(mile).append(h('option', { value: '' }, 'No milestone')); const p = projects.find((x) => x.id === proj.value); if (p) for (const m of p.milestones) mile.append(h('option', { value: m.id, selected: t && t.milestoneId === m.id ? true : null }, m.title + (m.done ? ' ✓' : ''))); };
    proj.addEventListener('change', () => { if (t) t.milestoneId = null; fillMile(); }); fillMile();
    const fld = (l, c) => h('label', { class: 'field' }, h('span', {}, l), c);
    const parts = [h('h3', {}, isNew ? 'New task' : 'Task'), fld('Title', title), fld('Details', details),
      h('div', { class: 'kform' }, fld('Assigned to', who), fld('Priority', pri), fld('Due day', due), fld('Photos needed', need), fld('Project', proj), fld('Milestone', mile))];
    if (editable) parts.push(h('div', { class: 'acts', style: 'display:flex;gap:10px;margin-top:12px;flex-wrap:wrap' },
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        err.textContent = '';
        const body = { title: title.value.trim(), details: details.value.trim() || undefined, assignedTo: who.value || null, priority: pri.value, dueDate: due.value || null, photosRequired: Number(need.value), projectId: proj.value || null, milestoneId: mile.value || null };
        try { await api(isNew ? '/api/tasks' : `/api/tasks/${encodeURIComponent(t.id)}`, { method: isNew ? 'POST' : 'PATCH', body }); closeModal(); toast(isNew ? 'Task added.' : 'Saved.'); load(); } catch (e) { err.textContent = fieldMsg(e); }
      } }, isNew ? 'Add task' : 'Save changes'),
      !isNew ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => { try { await api(`/api/tasks/${encodeURIComponent(t.id)}/cancel`, { method: 'POST', body: {} }); closeModal(); load(); } catch (e) { err.textContent = e.message; } } }, 'Cancel task') : null));
    parts.push(err);
    if (t) {
      const refresh = async () => { closeModal(); await load(); detail(t.id); };
      const moveSel = h('select', { 'aria-label': 'Move to' }, COLS.map(([k, l]) => h('option', { value: k, selected: t.stage === k ? true : null }, l)));
      moveSel.addEventListener('change', async () => { try { await api(`/api/tasks/${encodeURIComponent(t.id)}/move`, { method: 'POST', body: { stage: moveSel.value, index: 0 } }); closeModal(); load(); } catch (e) { err.textContent = e.message; moveSel.value = t.stage; } });
      parts.push(h('div', { class: 'ksec' }, h('div', { class: 'eyebrow' }, 'Move to'), moveSel));
      const need2 = Math.max(0, t.photosRequired - t.photos.length);
      parts.push(h('div', { class: 'ksec' }, h('div', { class: 'eyebrow' }, `Photos (${t.photos.length} of ${t.photosRequired})`),
        t.photos.length ? h('div', { class: 'tphotos' }, t.photos.map(taskPhoto)) : h('p', { class: 'hint' }, need2 ? 'Taken with the phone camera, within the last 5 minutes. Gallery pictures and screenshots are turned away.' : 'No photos needed.'),
        t.status === 'open' ? h('button', { class: 'btn outline sm', type: 'button', onclick: () => takePhoto(t, refresh, (m) => { err.textContent = m; }) }, '📷 Take photo') : null,
        t.status === 'done' ? h('p', { class: 'hint' }, `Done ${when(t.completedAt)}${t.completedByName ? ' by ' + t.completedByName : ''}`) : null));
      const list = h('div', { class: 'kcomments' }), box2 = h('input', { type: 'text', maxlength: '1000', placeholder: 'Write a comment…' });
      const loadC = async () => { try { const r = await api(`/api/tasks/${encodeURIComponent(t.id)}/comments`); clear(list); if (!r.items.length) list.append(h('p', { class: 'hint' }, 'No comments yet.')); for (const c of r.items) list.append(h('div', { class: 'kc' + (c.mine ? ' mine' : '') }, h('b', {}, c.authorName), h('span', { class: 'hint' }, ' · ' + when(c.at)), h('p', {}, c.body))); } catch (e) { list.textContent = e.message; } };
      const send = async () => { const v = box2.value.trim(); if (!v) return; try { await api(`/api/tasks/${encodeURIComponent(t.id)}/comments`, { method: 'POST', body: { body: v } }); box2.value = ''; loadC(); load(); } catch (e) { err.textContent = e.message; } };
      box2.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
      parts.push(h('div', { class: 'ksec' }, h('div', { class: 'eyebrow' }, 'Comments'), list, h('div', { class: 'kcsend' }, box2, h('button', { class: 'btn outline sm', type: 'button', onclick: send }, 'Send'))));
      loadC();
    }
    openModal(parts, { wide: true });
  }

  // ---- projects and milestones
  function projectsDialog() {
    const body = h('div');
    const draw = () => {
      clear(body);
      if (!projects.length) body.append(h('p', { class: 'hint' }, 'No projects yet. A project groups tasks, and its milestones show how far it has got.'));
      for (const p of projects) {
        const pct = p.tasks ? Math.round(p.tasksDone / p.tasks * 100) : 0;
        const mi = h('input', { type: 'text', maxlength: '100', placeholder: 'New milestone, e.g. Poles installed' }), md = h('input', { type: 'date' });
        body.append(h('div', { class: 'box kproject' },
          h('div', { class: 'kph' }, h('b', {}, p.name), h('span', { class: 'hint' }, `${p.tasksDone} of ${p.tasks} tasks done${p.status === 'archived' ? ' · archived' : ''}`), h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { status: p.status === 'active' ? 'archived' : 'active' } }); await load(); draw(); } }, p.status === 'active' ? 'Archive' : 'Restore')),
          h('div', { class: 'kbar' }, h('i', { style: `width:${pct}%` })),
          p.milestones.map((m) => h('div', { class: 'kms' + (m.done ? ' done' : '') },
            h('label', {}, h('input', { type: 'checkbox', checked: m.done ? true : null, onchange: async (e) => { try { await api(`/api/milestones/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: { done: e.target.checked } }); await load(); draw(); } catch (er) { toast(er.message, true); } } }), ' ', m.title),
            h('span', { class: m.overdue ? 'hint bad' : 'hint' }, `${m.tasksDone}/${m.tasks} tasks${m.dueDate ? ' · ' + (m.overdue ? 'overdue ' : 'due ') + niceDate(m.dueDate) : ''}`))),
          h('div', { class: 'kmadd' }, mi, md, h('button', { class: 'btn outline sm', type: 'button', onclick: async () => { try { await api(`/api/projects/${encodeURIComponent(p.id)}/milestones`, { method: 'POST', body: { title: mi.value.trim(), dueDate: md.value || undefined } }); await load(); draw(); } catch (e) { toast(fieldMsg(e), true); } } }, 'Add milestone'))));
      }
      const name = h('input', { type: 'text', maxlength: '80', placeholder: 'New project, e.g. Floodlight upgrade' });
      body.append(h('div', { class: 'kmadd' }, name, h('button', { class: 'btn primary sm', type: 'button', onclick: async () => { try { await api('/api/projects', { method: 'POST', body: { name: name.value.trim() } }); await load(); draw(); } catch (e) { toast(fieldMsg(e), true); } } }, 'Add project')));
    };
    draw(); openModal([h('h3', {}, 'Projects & milestones'), body], { wide: true });
  }

  box.append(h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Task board'),
    h('p', { class: 'hint' }, 'Drag a card between columns. A card can only be closed (Done) once its camera photos are in, so work is proven on the spot.'), bar, msg, board);
  load();
}
deskTabs.push({ id: 'tasks', label: 'Tasks', render: renderTasks });

let deskHead = null;
async function loadDesk() {
  // the page heading is moved into the shell; put it back before the shell is rebuilt
  deskHead = deskHead || $('#view-desk .head');
  const holder = $('#dk-body'); if (deskHead && holder && deskHead.parentNode !== holder.parentNode) holder.parentNode.insertBefore(deskHead, holder);
  const body = clear($('#dk-body')), u = state.user;
  body.classList.remove('dshell');
  const sa = u.role === 'super_admin';
  $('#dk-eyebrow').textContent = sa ? 'Software owner' : u.role === 'owner' ? 'Owner desk' : 'Team desk';
  const slot = clear($('#dk-ask-slot'));
  if (!sa) slot.append(h('button', { class: 'iconbtn', type: 'button', title: 'Ask AI', 'aria-label': 'Ask AI', onclick: openAskDialog }, sparkIcon()));
  const t = clear($('#dk-title'));
  if (sa) { t.append('The platform, ', h('em', {}, 'in one place.')); $('#dk-sub').textContent = 'Settings and people for the whole platform. Choose an owner to see their bookings and accounting.'; }
  else { t.append('Today, ', h('em', {}, 'at a glance.')); }
  const owns = u.role === 'owner';
  // the owner and the super admin both hold the platform controls; the super admin also works inside any owner's desk (team included)
  const tabs = [...(sa ? [{ id: 'platform', label: 'Platform', render: renderPlatform }] : [{ id: 'today', label: 'Today', render: renderToday }]), ...(sa ? [{ id: 'today', label: 'Bookings', render: renderToday }] : []), ...deskTabs.filter((x) => can(u, x.perm)), ...(owns ? [{ id: 'platform', label: 'Platform', render: renderPlatform }] : [])];
  if (!sa && tabs.length > 1) $('#dk-sub').textContent = 'Today, accounting, MP13 Academy and live scoring, in one place.';
  if (sa && !state.viewOwner) {
    try { const o = await api('/api/admin/users?role=owner&limit=100'); state.owners = o.items; if (o.items.length) state.viewOwner = o.items[0].id; } catch { /* the picker just stays empty */ }
  }
  if (sa) {
    if (!state.owners) { try { state.owners = (await api('/api/admin/users?role=owner&limit=100')).items; } catch { state.owners = []; } }
  }
  buildDeskShell(body, u, sa, tabs);
}

// ---- the admin shell: sidebar, top bar and page, laid out like the Prince Estate console
const NAV_ICONS = {
  today: 'M3 3h7v7H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 14h7v7H3z',
  promos: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01',
  tasks: 'M9 11l3 3 8-8M4 5h5M4 12h3M4 19h13',
  matches: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3.5 9c4 1 8 1 17 0M3.5 15c4-1 8-1 17 0',
  contacts: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 4-6 8-6s8 2 8 6',
  academy: 'M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5',
  books: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h4',
  team: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  platform: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.7h4l.4-2.7c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  soon: 'M12 8v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  menu: 'M4 7h16M4 12h16M4 17h16',
};
function navIcon(id) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', NAV_ICONS[id] || NAV_ICONS.soon); svg.append(p); return svg;
}
// which side-menu group each tab sits under; anything new that registers itself lands in "Ground"
const NAV_GROUP = { today: 'Portfolio', promos: 'Ground', tasks: 'Ground', matches: 'Ground', contacts: 'Ground', academy: 'MP13 Academy', books: 'Finance', team: 'Administration', platform: 'Administration' };
const NAV_ORDER = ['Portfolio', 'Ground', 'MP13 Academy', 'Finance', 'Administration'];
const NAV_LABEL = { today: 'Dashboard', books: 'Accounting', team: 'Users & Access', platform: 'Settings' };
const COMING_NEXT = [['Bill pay & approvals', 'P2'], ['Staff & payroll', 'P3'], ['Memberships', 'P3'], ['Tournaments', 'P4'], ['WhatsApp reminders', 'P4']];

function buildDeskShell(body, u, sa, tabs) {
  const label = (tb) => (sa && tb.id === 'today') ? 'Bookings' : (NAV_LABEL[tb.id] || tb.label);
  const side = h('aside', { class: 'dside', id: 'dside' });
  const nav = h('nav', { class: 'dnav', 'aria-label': 'Admin' });
  side.append(h('a', { class: 'dbrand', href: '#top', onclick: goHome, 'aria-label': 'Daji Cricket Ground' }, h('img', { src: 'assets/logo.svg', alt: 'Daji Cricket Ground', class: 'dlogo' })), nav);
  const pane = h('div', { class: 'dpane' });
  const buttons = new Map();
  const show = (id, quiet) => {
    const tb = tabs.find((x) => x.id === id) || tabs[0];
    state.deskTab = tb.id;
    for (const [k, b] of buttons) b.classList.toggle('on', k === tb.id);
    $$('.dbottom button').forEach((b) => b.classList.toggle('on', b.dataset.id === tb.id));
    side.classList.remove('open'); document.documentElement.classList.remove('dside-open');
    if (!quiet) { state.deskSub = null; deskNav(tb.id, null); }
    if (tb.id === 'books' && state.deskSub) { state.booksTab = state.deskSub; state.deskSub = null; }
    if (tb.id === 'academy' && state.deskSub) { state.acTab = state.deskSub; state.deskSub = null; }
    const t = $('#dk-title'); if (t) { clear(t); if (tb.id === 'today' && !sa) t.append('Today, ', h('em', {}, 'at a glance.')); else t.append(label(tb)); }
    clear(pane); tb.render(pane); window.scrollTo(0, 0);
  };
  const addItem = (host, tb) => { const b = h('button', { class: 'nv', type: 'button', 'data-id': tb.id, onclick: () => show(tb.id) }, navIcon(tb.id), h('span', {}, label(tb))); buttons.set(tb.id, b); host.append(b); };
  for (const g of NAV_ORDER) {
    const its = tabs.filter((tb) => (NAV_GROUP[tb.id] || 'Ground') === g);
    if (!its.length) continue;
    nav.append(h('div', { class: 'ngroup' }, g));
    its.forEach((tb) => addItem(nav, tb));
  }
  nav.append(h('div', { class: 'ngroup' }, 'Coming next'));
  for (const [n, ph] of COMING_NEXT) nav.append(h('div', { class: 'nv soon', title: 'Planned', 'aria-disabled': 'true' }, navIcon('soon'), h('span', {}, n), h('em', {}, ph)));
  side.append(h('div', { class: 'duser' }, h('b', {}, u.name), h('span', {}, `${u.role === 'super_admin' ? 'Software owner' : u.role === 'owner' ? 'Owner' : 'Team'} (${u.role === 'super_admin' ? 'Super Admin' : u.role === 'owner' ? 'Admin' : 'Staff'})`), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => signOut() }, 'Sign out')));

  // top bar: business tabs, and the role badge
  const top = h('div', { class: 'dtop' });
  top.append(h('button', { class: 'dmenu', type: 'button', 'aria-label': 'Menu', onclick: () => { side.classList.toggle('open'); document.documentElement.classList.toggle('dside-open'); } }, navIcon('menu')));
  const biz = h('div', { class: 'dbiz' });
  const owners = sa ? (state.owners || []) : [{ id: u.id, name: u.name, businessName: u.businessName }];
  for (const o of owners) biz.append(h('button', { class: 'bz' + ((sa ? o.id === state.viewOwner : true) ? ' on' : ''), type: 'button', onclick: () => { if (sa && o.id !== state.viewOwner) { state.viewOwner = o.id; loadDesk(); } } }, o.businessName || o.name));
  top.append(biz, h('span', { class: 'dbadge' }, h('i', {}), u.role === 'super_admin' ? 'Super Admin' : u.role === 'owner' ? 'Owner' : 'Team'));

  // page: heading block that already exists in the page, moved into the shell
  const head = $('#view-desk .head');
  const main = h('main', { class: 'dmain' }, top, head, pane);
  body.classList.add('dshell');
  body.append(side, main, h('div', { class: 'dscrim', onclick: () => { side.classList.remove('open'); document.documentElement.classList.remove('dside-open'); } }),
    h('nav', { class: 'dbottom', 'aria-label': 'Main' }, tabs.slice(0, 5).map((tb) => h('button', { type: 'button', 'data-id': tb.id, onclick: () => show(tb.id) }, navIcon(tb.id), h('span', {}, label(tb))))));
  show(state.deskTab, true);
}

function sparkIcon() {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const d of ['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 'M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z']) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
function openAskDialog() {
  const out = h('div'); openModal([h('h3', {}, 'Ask AI'), askBox(out), out]);
}

/** The ground cancels a booking: the owner must explain why. The customer reads it, then chooses a full refund, credit or another slot. */
function openStaffCancel(b, after) {
  const why = h('textarea', { rows: '4', maxlength: '300', placeholder: 'For example: the tournament is not going ahead because too few teams entered.', style: 'width:100%' });
  const err = h('div', { class: 'fe' });
  const pct = state.config.cashRefundPercent;
  const offerBoxes = [['refund', `Full refund (${inr(b.paidPaise)})`, true], ['half', `${pct}% refund to the payment method`, false], ['credit', 'Full amount as account credit, or another slot', true]]
    .map(([id, label, on]) => { const i = h('input', { type: 'checkbox', checked: on }); return { id, i, row: h('label', { class: 'check' }, i, h('span', {}, label)) }; });
  const go = h('button', { class: 'btn primary block', type: 'button', onclick: async () => {
    const offers = offerBoxes.filter((o) => o.i.checked).map((o) => o.id);
    if (!offers.length) { err.textContent = 'Offer the customer at least one option.'; return; }
    if (why.value.trim().length < 10) { err.textContent = 'Please explain to the customer why (at least 10 characters).'; return; }
    go.disabled = true;
    try { await api(`/api/staff/bookings/${encodeURIComponent(b.id)}/cancel`, { method: 'POST', body: { reason: why.value.trim(), offers } }); closeModal(); toast('Cancelled. The customer has been told and can choose a refund, credit or another slot.'); if (after) after(); }
    catch (e) { err.textContent = e.message; go.disabled = false; }
  } }, 'Cancel this booking');
  openModal([h('div', { class: 'eyebrow' }, 'Cancel'), h('h3', {}, 'Cancel this booking?'),
    h('p', { class: 'hint', style: 'font-size:15px;color:var(--text)' }, `${b.customerName}, ${niceDate(b.date)}, ${hhmm(b.startAt)} – ${hhmm(b.endAt)}. They paid ${inr(b.paidPaise)}.`),
    h('p', { class: 'hint' }, 'The customer will read your explanation, then choose from the options you tick, as set out in the terms and conditions. Nothing is paid out until they choose.'),
    h('label', { class: 'lbl' }, 'What the customer may choose'), ...offerBoxes.map((o) => o.row),
    h('label', { class: 'lbl' }, 'Explanation for the customer'), why, err, go,
    h('button', { class: 'btn ghost block', type: 'button', style: 'margin-top:8px', onclick: () => closeModal() }, 'Keep the booking')]);
}

/** The terms and conditions, filled in from the live settings so the numbers always match what the system does. */
function openTerms() {
  const c = state.config, contact = c.contact || {};
  const sec = (title, ...items) => h('div', { style: 'margin-top:18px' }, h('b', {}, title), h('ul', { style: 'margin:6px 0 0 18px;padding:0;line-height:1.6' }, ...items.map((t) => h('li', {}, t))));
  openModal([h('div', { class: 'eyebrow' }, 'Terms and conditions'), h('h3', {}, 'Booking, cancelling and refunds'),
    h('div', { style: 'max-height:60vh;overflow:auto;padding-right:6px' },
      sec('Booking', 'Pay the advance online to hold your slot. Your booking is confirmed once the ground approves it' + (c.requireApproval === false ? '.' : '; until then it shows as Pending approval and the slot stays held for you.'),
        'The ground may decline a booking. If it does, it will tell you why and you choose what happens to your money (see "If the ground cancels").'),
      sec('If you cancel', `More than ${c.freeCancelHours} hours before the start: choose a refund of ${c.cashRefundPercent}% of what you paid to your original payment method, or keep the full amount as account credit for future bookings.`,
        `Within ${c.freeCancelHours} hours of the start: no cash refund. ${c.lateCancelCreditPercent}% of what you paid becomes account credit.`,
        'No-show: no refund and no credit.', `Account credit can only be used at the ground that issued it and expires ${c.creditExpiryDays} days after it is issued.`),
      sec('If the ground cancels', 'The ground must tell you why in writing. You will see the reason in My bookings and be told by notification.',
        'The ground then offers you one or more of: a full refund; a part refund to your original payment method (' + c.cashRefundPercent + '%); the full amount as account credit; or another slot.',
        'A full refund or full credit is offered when the cancellation is the ground\'s doing: weather or ground condition, a tournament that does not go ahead, or a ground-side problem. A part refund may be offered where the booking is cancelled because of the customer, for example breaking the ground rules.',
        'Nothing is paid out or credited until you choose. Refunds go back to the original payment method and may take 5 to 7 working days to show.'),
      sec('Weather and play', 'If rain stops play before it starts, the ground may cancel and you will be offered a full refund or credit. Play stopped part-way is not refunded unless the ground says so.'),
      sec('Safety and liability', 'Cricket carries a risk of injury and you play at your own risk. The full terms of use, ground rules, limits on liability and grievance officer are on the Legal notices page (legal.html). By booking you accept them.'),
      sec('Contact', `Questions about a booking: ${contact.name || 'the ground'}${contact.phone ? ' on ' + formatPhone(contact.phone) : ''}.`)),
    h('button', { class: 'btn ghost block', type: 'button', style: 'margin-top:12px', onclick: () => closeModal() }, 'Close')]);
}

function renderDeskAgain() { loadDesk(); }

function renderTodayParts(body, parts) {
  const has = (p) => parts.includes(p);
  const u = state.user;
  const kp = (t, sub) => h('div', { class: 'kpi' }, h('span', {}, t), h('b', {}, '…'), h('small', {}, sub || ''));
  const kpis = h('div', { class: 'kpis' }, kp('Sessions today'), kp('Revenue · ' + MON[Number(todayIst().slice(5, 7)) - 1], 'booked and received this month'), kp('Net profit · ' + MON[Number(todayIst().slice(5, 7)) - 1], 'after expenses'), kp('To collect today', 'balances on today\'s sessions'));
  const today = h('div', { class: 'list' }, h('div', { class: 'skeleton' }, 'Loading…'));
  const contacts = h('div', { class: 'list' }, h('div', { class: 'skeleton' }, 'Loading…'));
  const approvals = h('div', { class: 'list' }, h('div', { class: 'skeleton' }, 'Loading…'));
  const pnlHint = h('p', { class: 'hint', style: 'margin:0' });
  const boxOf = (title, el) => h('div', { class: 'box' }, h('div', { class: 'eyebrow', style: 'margin-bottom:10px' }, title), el);
  const chartBody = h('div', {}, h('div', { class: 'skeleton' }, 'Loading…'));
  const card = (title, note, el) => h('div', { class: 'dcard' }, h('header', {}, h('span', {}, title), h('small', {}, note || '')), h('div', {}, el));
  if (has('overview')) body.append(kpis, pnlHint, h('div', { class: 'dgrid two' }, card('Revenue vs expenses', 'Last 6 months', chartBody), card('Today', niceDate(todayIst()), today)),
    h('div', { class: 'dmods' },
      h('div', { class: 'dmod' }, h('small', {}, 'Live'), h('h4', {}, 'Ground bookings'), h('p', {}, 'Slots, rates, approvals and payments.')),
      h('div', { class: 'dmod' }, h('small', {}, 'Live'), h('h4', {}, 'MP13 Academy'), h('p', {}, 'Students, attendance, progress cards and fees.')),
      h('div', { class: 'dmod' }, h('small', {}, 'Next'), h('h4', {}, 'Bill pay & payroll'), h('p', {}, 'Approval limits, staff attendance and salaries.'))));
  if (has('approvals')) body.append(boxOf('Waiting for your approval', approvals));
  if (has('people')) body.append(boxOf('People who have played', contacts));
  const pnlNote = pnlHint;
  // each panel loads on its own, so one missing permission does not blank the rest
  if (has('prices') && (u.role === 'owner' || (u.permissions || []).includes('manage_grounds'))) { const tb = h('div', { class: 'box' }); body.append(tb); loadTimings(tb); }
  if (has('people') && (u.role === 'owner' || (u.permissions || []).includes('manage_grounds'))) { const pb = h('div', { class: 'box', style: 'margin-top:24px' }); body.append(pb); loadPeople(pb); }
  if (has('overview')) api(`/api/accounting/reports/pnl?month=${todayIst().slice(0, 7)}`).then((p) => {
    const set = (i, v) => { const b = $$('.kpi b', kpis)[i]; b.textContent = inr(v); if (v < 0) b.parentNode.classList.add('bad'); };
    set(1, p.revenue.totalPaise); set(2, p.netProfitPaise);
    pnlNote.textContent = `Profit and Loss for ${niceDate(p.range.from)} to ${niceDate(p.range.to)}. ${p.uncategorised.count ? p.uncategorised.count + ' bank transactions still need a category.' : ''}`;
  }).catch((e) => { pnlNote.textContent = e.status === 403 ? 'Your role does not include the reports.' : e.message; });
  const loadApprovals = () => api('/api/staff/bookings?approval=pending&limit=50').then((r) => {
    clear(approvals);
    if (!r.items.length) approvals.append(h('div', { class: 'empty' }, 'Nothing is waiting. New paid bookings appear here.'));
    for (const b of r.items.slice().sort((x, y) => x.startAt - y.startAt)) {
      const act = h('span', { class: 'acts' },
        h('button', { class: 'btn primary sm', type: 'button', onclick: async (e) => { e.target.disabled = true; try { await api(`/api/staff/bookings/${encodeURIComponent(b.id)}/approve`, { method: 'POST', body: {} }); toast('Approved. The customer has been told.'); loadApprovals(); } catch (er) { toast(er.message, true); e.target.disabled = false; } } }, 'Approve'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openStaffCancel(b, loadApprovals) }, 'Decline…'));
      approvals.append(h('div', { class: 'li apr' }, h('span', {}, `${niceDate(b.date)}, ${hhmm(b.startAt)} – ${hhmm(b.endAt)}  ·  ${b.groundName}  ·  ${b.customerName}${b.formatLabel ? '  ·  ' + b.formatLabel : ''}  ·  deposit ${inr(b.paidPaise)} of ${inr(b.totalPaise)}`), act));
    }
  }).catch((e) => { clear(approvals); approvals.append(h('div', { class: 'empty' }, e.status === 403 ? 'Your role does not include bookings.' : e.message)); });
  if (has('approvals')) loadApprovals();
  if (has('overview')) {
    const ms = []; { const [y, m] = todayIst().split('-').map(Number); for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); ms.push(d.toISOString().slice(0, 7)); } }
    Promise.all(ms.map((m) => api('/api/accounting/reports/pnl?month=' + m).then((p) => ({ m, rev: p.revenue.totalPaise, exp: p.expenses.totalPaise })).catch(() => null))).then((rows) => {
      clear(chartBody);
      const ok = rows.filter(Boolean); if (!ok.length) { chartBody.append(h('div', { class: 'empty' }, 'The reports are not available to your role.')); return; }
      const max = Math.max(1, ...ok.flatMap((r) => [r.rev, r.exp]));
      chartBody.append(h('div', { class: 'dleg' }, h('span', {}, h('i', { style: 'background:var(--gold)' }), 'Revenue'), h('span', {}, h('i', { style: 'border:1px solid var(--gold-deep)' }), 'Expenses')),
        h('div', { class: 'dchart' }, rows.map((r) => h('div', { class: 'col' }, h('i', { class: 'rev', style: `height:${r ? Math.max(1, r.rev / max * 100) : 0}%` }), h('i', { class: 'exp', style: `height:${r ? Math.max(1, r.exp / max * 100) : 0}%` })))),
        h('div', { class: 'dlabels' }, ms.map((m) => h('span', {}, MON[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(2, 4)))));
    });
  }
  if (has('overview')) api('/api/staff/today').then((t) => {
    clear(today);
    { const kb = $$('.kpi b', kpis); if (kb.length > 3) { kb[0].textContent = String(t.bookings.length); kb[3].textContent = inr(t.bookings.reduce((a, b) => a + Math.max(0, b.balancePaise || 0), 0)); } }
    if (!t.bookings.length) today.append(h('div', { class: 'empty' }, 'No sessions today.'));
    for (const b of t.bookings) today.append(h('div', { class: 'li' }, h('span', {}, `${hhmm(b.startAt)} – ${hhmm(b.endAt)}  ·  ${b.groundName}  ·  ${b.customerName}`), h('span', { class: 'acts' }, h('b', {}, b.approval === 'pending' && b.status === 'confirmed' ? 'Pending approval' : b.balancePaise > 0 ? `${inr(b.balancePaise)} to collect` : (STATUS[b.status] || [0, b.status])[1]), b.paidPaise > 0 && b.startAt > Date.now() && (b.status === 'confirmed' || b.status === 'held') ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openStaffCancel(b, () => renderDeskAgain()) }, 'Cancel…') : null)));
    if (t.awaitingVerification) today.append(h('div', { class: 'li' }, h('span', {}, 'UPI payments waiting for you to verify'), h('b', {}, t.awaitingVerification)));
    if (t.needsReview) today.append(h('div', { class: 'li' }, h('span', {}, 'Bookings flagged for review'), h('b', {}, t.needsReview)));
  }).catch((e) => { clear(today); today.append(h('div', { class: 'empty' }, e.message)); });
  if (has('people')) api('/api/staff/contacts?limit=1').then((c) => {
    clear(contacts);
    const s = c.summary;
    contacts.append(h('div', { class: 'li' }, h('span', {}, 'Played at your grounds'), h('b', {}, s.total)),
      h('div', { class: 'li' }, h('span', {}, 'Can be emailed'), h('b', {}, s.reachableEmail)),
      h('div', { class: 'li' }, h('span', {}, 'Can be sent WhatsApp'), h('b', {}, s.reachableWhatsapp)),
      h('div', { class: 'li' }, h('span', {}, 'Can be texted'), h('b', {}, s.reachableSms)));
  }).catch((e) => { clear(contacts); contacts.append(h('div', { class: 'empty' }, e.status === 403 ? 'Your role does not include Contacts.' : e.message)); });
}

/** Opening hours and slot length for each ground. The server refuses a new slot length while future bookings exist. */
/** The Daji price list, ready to load into the editor (nothing is saved until the owner presses Save). */
const DAJI_PRICES = {
  closedDays: [1], slotMinutes: 60, maxSlots: 8, ratesNote: 'For custom days and reservations please call.',
  rates: [
    { label: 'Evening hours', ball: 'leather', days: [2, 3, 4, 5, 6, 0], from: '19:00', to: '27:00', mode: 'hourly', price: 3500 },
    { label: 'Morning session', ball: 'leather', days: [2, 3, 4, 5], from: '07:00', to: '10:00', mode: 'fixed', price: 4000 },
    { label: 'Day session', ball: 'leather', days: [2, 3, 4, 5], from: '10:00', to: '18:00', mode: 'fixed', price: 6000 },
    { label: 'Weekend day', ball: 'leather', days: [6, 0], from: '07:00', to: '19:00', mode: 'fixed', price: 15000 },
    { label: 'Evening hours', ball: 'tennis', days: [2, 3, 4, 5, 6, 0], from: '19:00', to: '27:00', mode: 'hourly', price: 3500 },
    { label: 'Morning session', ball: 'tennis', days: [2, 3, 4, 5], from: '07:00', to: '10:00', mode: 'fixed', price: 5000 },
    { label: 'Two-day tournament (Sat + Sun)', ball: 'tennis', days: [6], from: '07:00', to: '23:00', mode: 'fixed', price: 151000, bundleDays: 2 },
    { label: 'Saturday tournament', ball: 'tennis', days: [6], from: '07:00', to: '19:00', mode: 'fixed', price: 100000 },
    { label: 'Sunday tournament', ball: 'tennis', days: [0], from: '07:00', to: '23:00', mode: 'fixed', price: 90000 },
    { label: 'Practice hours', ball: 'practice', days: [2, 3, 4, 5, 6, 0], from: '07:00', to: '19:00', mode: 'hourly', price: 600 },
  ],
};

/** Prices and timings: one card per ground, for owners and for the super admin. */
async function loadTimings(box) {
  box.append(h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Prices and timings'), h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'Set what each ball costs, on which days and at what times. Customers see the changes as soon as you save.'));
  const list = h('div', { style: 'display:grid;gap:22px' }, h('div', { class: 'skeleton' }, 'Loading…')); box.append(list);
  let res;
  try { res = await api('/api/staff/grounds'); } catch (e) { clear(list); list.append(h('div', { class: 'empty' }, e.message)); return; }
  clear(list);
  const t30 = (from, to) => { const o = []; for (let m = from; m <= to; m += 30) o.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`); return o; };
  const startOpts = t30(0, 23 * 60 + 30), endOpts = t30(30, 27 * 60);
  const label12 = (t) => (Number(t.slice(0, 2)) >= 24 ? `${niceHour(t)} (next day)` : niceHour(t));
  const sel = (name, options, value) => h('select', { name }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  for (const g of res.items) {
    const rows = (g.rates || []).map((r) => ({ id: r.id, label: r.label, ball: r.ball, days: [...r.days], from: r.from, to: r.to, mode: r.mode, price: String(r.pricePaise / 100), bundle: r.bundleDays || 1 }));
    const closed = new Set(g.closedDays || []);
    const msg = h('div', { class: 'fe', style: 'min-height:18px' });
    const glance = h('div', { class: 'glance' });
    const drawGlance = () => {
      clear(glance);
      const tbl = h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Leather ball'), h('th', {}, 'Tennis ball'), ...(rows.some((r) => r.ball === 'practice') ? [h('th', {}, 'Practice')] : []))));
      const body = h('tbody', {});
      for (const d of ORDER) {
        const cell = (ball) => {
          if (closed.has(d)) return h('td', { class: 'cl' }, 'Closed');
          const rs = rows.filter((r) => r.ball === ball && r.days.includes(d)).sort((a, b) => a.from.localeCompare(b.from));
          return h('td', {}, rs.length ? rs.map((r) => h('div', {}, `${niceHour(r.from)}–${niceHour(r.to)} `, h('b', {}, r.price ? `₹${Number(r.price).toLocaleString('en-IN')}${r.mode === 'hourly' ? '/hr' : ''}` : '₹?'))) : '—');
        };
        body.append(h('tr', {}, h('th', {}, DAY_NAMES[d]), cell('leather'), cell('tennis'), ...(rows.some((r) => r.ball === 'practice') ? [cell('practice')] : [])));
      }
      tbl.append(body); glance.append(h('div', { class: 'eyebrow', style: 'margin:0 0 6px' }, 'The week at a glance'), tbl);
    };
    const chip = (arr, v, text, after) => { const b = h('button', { type: 'button', class: 'tg' + (arr.includes(v) ? ' on' : ''), 'aria-pressed': String(arr.includes(v)), onclick: () => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); b.classList.toggle('on', i < 0); b.setAttribute('aria-pressed', String(i < 0)); after(); } }, text); return b; };
    const closedBox = h('div', { class: 'tgs' }, ORDER.map((d) => { const b = h('button', { type: 'button', class: 'tg' + (closed.has(d) ? ' on' : ''), 'aria-pressed': String(closed.has(d)), onclick: () => { if (closed.has(d)) closed.delete(d); else closed.add(d); b.classList.toggle('on', closed.has(d)); b.setAttribute('aria-pressed', String(closed.has(d))); drawGlance(); } }, DAY_NAMES[d]); return b; }));
    const sections = { leather: h('div', { class: 'ratedit' }), tennis: h('div', { class: 'ratedit' }), practice: h('div', { class: 'ratedit' }) };
    const drawRows = () => {
      for (const ball of ['leather', 'tennis', 'practice']) {
        const box2 = clear(sections[ball]);
        rows.forEach((r, i) => {
          if (r.ball !== ball) return;
          const name = h('input', { value: r.label, placeholder: 'e.g. Day session', maxlength: '40', 'aria-label': 'Name', oninput: (e) => { r.label = e.target.value; } });
          const mode = sel('mode', [['fixed', 'Fixed session (whole time slot)'], ['hourly', 'By the hour (customer picks hours)']], r.mode); mode.addEventListener('change', () => { r.mode = mode.value; if (r.mode === 'hourly') r.bundle = 1; drawRows(); drawGlance(); });
          const price = h('input', { value: r.price, inputmode: 'numeric', placeholder: '0', style: 'width:110px', 'aria-label': 'Price in rupees', oninput: (e) => { r.price = e.target.value.replace(/[^\d.]/g, ''); drawGlance(); } });
          const from = sel('from', startOpts.map((t) => [t, label12(t)]), r.from); from.addEventListener('change', () => { r.from = from.value; drawGlance(); });
          const to = sel('to', endOpts.map((t) => [t, label12(t)]), r.to); to.addEventListener('change', () => { r.to = to.value; drawGlance(); });
          const quick = (text, days) => h('button', { type: 'button', class: 'tg quick', onclick: () => { r.days.splice(0, r.days.length, ...days); drawRows(); drawGlance(); } }, text);
          box2.append(h('div', { class: 'rateline' },
            h('div', { class: 'rl-top' }, name, mode, h('label', { class: 'inl' }, h('span', {}, '₹'), price, h('span', { class: 'hint' }, r.mode === 'hourly' ? 'for each hour' : 'for the whole session'))),
            h('div', { class: 'rl-days' }, h('span', { class: 'lbl' }, 'Days'), h('div', { class: 'tgs' }, ORDER.map((d) => chip(r.days, d, DAY_NAMES[d], drawGlance))), quick('Tue–Fri', [2, 3, 4, 5]), quick('Sat–Sun', [6, 0]), quick('Every day', [0, 1, 2, 3, 4, 5, 6])),
            h('div', { class: 'rl-time' }, h('span', { class: 'lbl' }, 'Time'), from, h('span', {}, 'to'), to,
              r.mode === 'fixed' ? h('label', { class: 'inl' }, h('span', {}, 'Covers'), (() => { const b = sel('bundle', [1, 2, 3].map((n) => [n, n === 1 ? 'that day' : `${n} days in a row`]), r.bundle); b.addEventListener('change', () => { r.bundle = Number(b.value); }); return b; })()) : null,
              h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { rows.splice(i, 1); drawRows(); drawGlance(); } }, 'Remove'))));
        });
        box2.append(h('button', { class: 'btn outline sm', type: 'button', onclick: () => { rows.push({ label: '', ball, days: [2, 3, 4, 5], from: '10:00', to: '18:00', mode: 'fixed', price: '', bundle: 1 }); drawRows(); drawGlance(); } }, `+ Add a ${BALL_NAMES[ball].toLowerCase()} price`));
      }
    };
    // basic settings (the hours used by grounds that have no price list, and the slot length)
    const openOpts = startOpts.slice(0, 48).map((t) => [t, label12(t)]), closeOpts = endOpts.map((t) => [t, label12(t)]);
    const open = sel('openTime', openOpts, g.openTime), close = sel('closeTime', closeOpts, g.closeTime);
    const wOpen = sel('winterOpenTime', [['', 'Same as summer'], ...openOpts], g.winterOpenTime || ''), wClose = sel('winterCloseTime', closeOpts, g.winterCloseTime || g.closeTime);
    const len = sel('slotMinutes', [[30, '30 minutes'], [60, '1 hour'], [90, '1 hour 30'], [120, '2 hours']].concat([30, 60, 90, 120].includes(g.slotMinutes) ? [] : [[g.slotMinutes, `${g.slotMinutes} minutes`]]), g.slotMinutes);
    const eve = sel('eveningFrom', t30(12 * 60, 23 * 60).map((t) => [t, label12(t)]), g.eveningFrom);
    const maxs = sel('maxSlots', [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 24].map((n) => [n, String(n)]), g.maxSlots);
    const note = h('textarea', { rows: '2', maxlength: '300', placeholder: 'e.g. For custom days and reservations please call.', style: 'width:100%' }, g.ratesNote || '');
    const preset = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => {
      rows.length = 0; rows.push(...DAJI_PRICES.rates.map((r) => ({ label: r.label, ball: r.ball, days: [...r.days], from: r.from, to: r.to, mode: r.mode, price: String(r.price), bundle: r.bundleDays || 1 })));
      closed.clear(); DAJI_PRICES.closedDays.forEach((d) => closed.add(d)); closedBox.querySelectorAll('button').forEach((b, k) => { const on = closed.has(ORDER[k]); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      len.value = String(DAJI_PRICES.slotMinutes); maxs.value = String(DAJI_PRICES.maxSlots); note.value = DAJI_PRICES.ratesNote;
      drawRows(); drawGlance(); msg.style.color = ''; msg.textContent = 'The Daji price list is loaded. Check it, then press Save.';
    } }, 'Load the Daji price list');
    const save = h('button', { class: 'btn primary sm', type: 'button', onclick: async () => {
      save.disabled = true; msg.textContent = ''; msg.style.color = '';
      try {
        for (const r of rows) { if (!r.label.trim()) throw new Error('Give every price a name.'); if (!r.days.length) throw new Error(`"${r.label}": choose at least one day.`); if (r.price === '' || isNaN(Number(r.price))) throw new Error(`"${r.label}": enter a price.`); }
        const body = { openTime: open.value, closeTime: close.value, winterOpenTime: wOpen.value || null, winterCloseTime: wOpen.value ? wClose.value : null, slotMinutes: Number(len.value), eveningFrom: eve.value, maxSlots: Number(maxs.value), closedDays: [...closed].sort(), ratesNote: note.value.trim(),
          rates: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), label: r.label.trim(), ball: r.ball, days: r.days, from: r.from, to: r.to, mode: r.mode, pricePaise: Math.round(Number(r.price) * 100), ...(r.mode === 'fixed' && r.bundle > 1 ? { bundleDays: r.bundle } : {}) })) };
        const saved = await api(`/api/staff/grounds/${encodeURIComponent(g.id)}`, { method: 'PATCH', body });
        toast(`${g.name}: saved.`);
        const gi = state.grounds.findIndex((x) => x.id === g.id); if (gi >= 0) Object.assign(state.grounds[gi], saved);
        if (state.ground && state.ground.id === g.id) { Object.assign(state.ground, saved); state.win = null; state.hr = null; }
        msg.style.color = 'var(--ok,#6fbf8b)'; msg.textContent = 'Saved. Customers see the new prices now.';
      } catch (e) { const f = fieldErrors(e); msg.textContent = Object.keys(f).length ? Object.entries(f).map(([k, m]) => `${k}: ${m}`).join('  ·  ') : e.message; }
      save.disabled = false;
    } }, 'Save prices and timings');
    drawRows(); drawGlance();
    list.append(h('div', { class: 'pricecard' },
      h('h4', { style: 'font-family:var(--font-display);font-size:20px;letter-spacing:.05em;text-transform:uppercase;margin:0 0 4px' }, g.name),
      g.ownerName ? h('div', { class: 'hint', style: 'margin:0 0 10px' }, `Owner: ${g.ownerName}`) : null,
      h('div', { class: 'eyebrow', style: 'margin:12px 0 6px' }, 'Days the ground is closed'), h('p', { class: 'hint', style: 'margin:0 0 8px' }, 'Tap a day to close it, for example Monday for maintenance. Nothing can be booked on a closed day.'), closedBox,
      h('div', { class: 'eyebrow', style: 'margin:16px 0 6px' }, 'Leather ball prices'), sections.leather,
      h('div', { class: 'eyebrow', style: 'margin:16px 0 6px' }, 'Tennis ball prices'), sections.tennis,
      h('div', { class: 'eyebrow', style: 'margin:16px 0 6px' }, 'Practice session prices'), h('p', { class: 'hint', style: 'margin:0 0 8px' }, 'Nets and practice, shown as its own tab next to the balls. Usually a by-the-hour price.'), sections.practice,
      h('p', { class: 'hint', style: 'margin:10px 0 0' }, 'A fixed session is booked as one block at one price. A by-the-hour price lets the customer choose how many hours. Times after midnight show as "next day".'),
      glance,
      h('div', { class: 'eyebrow', style: 'margin:16px 0 6px' }, 'Message to customers'), note,
      h('details', { style: 'margin-top:14px' }, h('summary', {}, 'More settings (slot length, opening hours without a price list)'),
        h('div', { class: 'timegrid', style: 'margin-top:12px' }, field('Slot length', len), field('Most hours at once', maxs), field('Summer opens', open), field('Summer closes', close), field('Winter opens (Nov–Feb)', wOpen), field('Winter closes', wClose), field('Evening rate from', eve))),
      h('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:16px' }, save, preset, msg)));
  }
}

/** Admin: find any account and fix its name, phone, email or whether it can sign in. Names always keep their capital letters. */
async function loadPeople(box) {
  box.append(h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'People and accounts'), h('p', { class: 'hint', style: 'margin:0 0 12px' }, 'Search customers, staff and owners. Names are saved with a capital first letter.'));
  const q = h('input', { type: 'search', placeholder: 'Search name, phone or email', 'aria-label': 'Search', style: 'flex:1 1 220px' });
  const role = h('select', { 'aria-label': 'Role' }, [['', 'Everyone'], ['customer', 'Customers'], ['owner', 'Owners'], ['staff', 'Staff'], ['super_admin', 'Admins']].map(([v, l]) => h('option', { value: v }, l)));
  const list = h('div', { style: 'display:grid;gap:10px;margin-top:12px' }), more = h('button', { class: 'btn outline sm', type: 'button', hidden: true }, 'Show more');
  box.append(h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, q, role), list, h('div', { style: 'margin-top:10px' }, more));
  const cap = (el) => el.addEventListener('input', () => { const p = el.selectionStart; el.value = el.value.replace(/(^|[\s'’-])(\p{L})/gu, (_m, a, c) => a + c.toUpperCase()); try { el.setSelectionRange(p, p); } catch { /* ignore */ } });
  let offset = 0, total = 0, timer = null;
  const row = (u) => {
    const first = h('input', { value: u.firstName || '', placeholder: 'First name', 'aria-label': 'First name' }), last = h('input', { value: u.lastName || '', placeholder: 'Last name', 'aria-label': 'Last name' });
    cap(first); cap(last);
    const phone = h('input', { value: u.phone || '', inputmode: 'numeric', placeholder: 'Mobile', 'aria-label': 'Mobile' }), email = h('input', { value: u.email || '', type: 'email', placeholder: 'Email', 'aria-label': 'Email' });
    const on = h('input', { type: 'checkbox', checked: u.active }), msg = h('span', { class: 'hint', style: 'margin:0' });
    const save = h('button', { class: 'btn outline sm', type: 'button', onclick: async () => {
      save.disabled = true; msg.textContent = ''; msg.style.color = '';
      try {
        const body = { firstName: first.value.trim(), lastName: last.value.trim(), active: on.checked, ...(phone.value.trim() ? { phone: phone.value.trim() } : {}), ...(email.value.trim() && email.value.trim() !== (u.email || '') ? { email: email.value.trim() } : {}) };
        if (!body.firstName) delete body.firstName; if (!body.lastName) delete body.lastName;
        const r = await api('/api/admin/users/' + encodeURIComponent(u.id), { method: 'PATCH', body });
        first.value = r.firstName; last.value = r.lastName; msg.textContent = `Saved as ${r.name}.`; msg.style.color = 'var(--ok,#6fbf8b)'; u = r;
      } catch (e) { const f = fieldErrors(e); msg.style.color = ''; msg.textContent = Object.keys(f).length ? Object.entries(f).map(([k, m]) => `${k}: ${m}`).join('  ·  ') : e.message; }
      save.disabled = false;
    } }, 'Save');
    return h('div', { class: 'personrow' }, h('div', { class: 'who' }, h('b', {}, u.name), h('span', { class: 'chip' }, u.role.replace('_', ' '))),
      h('div', { class: 'pfields' }, first, last, phone, email), h('div', { class: 'pact' }, h('label', { class: 'inl' }, on, h('span', {}, 'Can sign in')), save, msg));
  };
  const load = async (reset) => {
    if (reset) { offset = 0; clear(list); }
    try {
      const r = await api(`/api/admin/users?limit=25&offset=${offset}${q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : ''}${role.value ? '&role=' + role.value : ''}`);
      total = r.total; for (const u of r.items) list.append(row(u)); offset += r.items.length; more.hidden = offset >= total;
      if (!total) list.append(h('div', { class: 'empty' }, 'No one found.'));
    } catch (e) { list.append(h('div', { class: 'empty' }, e.message)); }
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(true), 300); }); role.addEventListener('change', () => load(true)); more.addEventListener('click', () => load(false));
  load(true);
}

function askBox(out, opt = {}) {
  const base = opt.base || '/api/staff/ask', exUrl = opt.examples || '/api/staff/ask/examples';
  const q = h('input', { type: 'text', placeholder: opt.placeholder || 'e.g. What was the revenue for the past 37 days?', maxlength: '500', 'aria-label': 'Ask a question' });
  const sugg = h('div', { class: 'sugg' });
  const run = async (text) => {
    if (!text.trim()) return;
    q.value = text; clear(out); out.append(h('div', { class: 'hint' }, 'Looking it up…'));
    try {
      const r = await api(base, { method: 'POST', body: { question: text } });
      clear(out);
      out.append(h('div', { class: 'answer' }, h('p', {}, r.answer), r.understood ? h('div', { class: 'why' }, r.understood + (r.source === 'claude' ? (r.verified ? '' : '  ·  Not fully verified') : '')) : null));
      if (r.details && r.details.length) out.append(h('div', { class: 'list' }, r.details.map((d) => h('div', { class: 'li' }, h('span', {}, d.label), h('b', {}, d.text)))));
      if (r.open === 'book') out.append(h('p', { style: 'margin:12px 0 0' }, h('button', { class: 'btn outline sm', type: 'button', onclick: () => { location.hash = ''; show('home'); setTimeout(() => $('#book').scrollIntoView({ behavior: 'smooth' }), 50); } }, 'Open the booking panel')));
      for (const n of r.notes || []) out.append(h('p', { class: 'hint', style: 'margin:10px 0 0' }, n));
      if (r.suggestions && r.suggestions.length) out.append(h('div', { class: 'sugg' }, r.suggestions.map((s) => h('button', { type: 'button', onclick: () => run(s) }, s))));
    } catch (e) { clear(out); out.append(h('p', { class: 'hint err' }, e.message)); }
  };
  const form = h('form', { class: 'ask', onsubmit: (e) => { e.preventDefault(); run(q.value); } }, q, h('button', { class: 'btn primary', type: 'submit' }, 'Ask'));
  api(exUrl).then((x) => { for (const ex of (x.items || []).slice(0, 5)) sugg.append(h('button', { type: 'button', onclick: () => run(ex) }, ex)); }).catch(() => {});
  return h('div', {}, form, sugg);
}

function siteEditor(s) {
  const ig = h('input', { name: 'instagramUrl', type: 'url', placeholder: 'https://www.instagram.com/your_page/', value: s.instagramUrl || '' });
  const gal = h('textarea', { name: 'galleryImages', placeholder: 'One photo link per line, each starting with https://', style: 'height:140px' }, (s.galleryImages || []).join('\n'));
  const msg = h('div', { class: 'fe' });
  const save = h('button', { class: 'btn outline sm', type: 'button', onclick: async () => {
    save.disabled = true; msg.textContent = '';
    try {
      const list = gal.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      await api('/api/admin/settings', { method: 'PUT', body: { instagramUrl: ig.value.trim(), galleryImages: list, academyImages: academyList.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) } });
      state.config.instagramUrl = ig.value.trim() || null; state.config.gallery = list; state.config.academyGallery = academyList.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); fillGallery(); fillAcademyPhotos();
      toast('Website updated.');
    } catch (e) { const f = fieldErrors(e); msg.textContent = Object.keys(f).length ? Object.entries(f).map(([k, m]) => `${k}: ${m}`).join('  ·  ') : e.message; }
    save.disabled = false;
  } }, 'Save website details');
  const academyList = h('textarea', { name: 'academyImages', placeholder: 'Academy photos: one per line', style: 'height:90px' }, (s.academyImages || []).join('\n'));
  const uploader = (kind, area) => {
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true });
    return h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 16px' }, file, h('button', { class: 'btn outline sm', type: 'button', onclick: async (e) => {
      const btn = e.currentTarget; if (!file.files.length) { toast('Choose one or more photos first', true); return; }
      btn.disabled = true;
      try { for (const f of file.files) { const r = await apiFile(`/api/media?kind=${kind}&filename=${encodeURIComponent(f.name)}`, f); area.value = (area.value.trim() ? area.value.trim() + '\n' : '') + r.url; } file.value = ''; toast('Uploaded. Press Save to publish them.'); }
      catch (er) { toast(er.message, true); }
      btn.disabled = false;
    } }, 'Upload'));
  };
  return h('div', {}, field('Instagram page', ig), field('Gallery photos (links or uploads)', gal), uploader('gallery', gal), field('Academy photos', academyList), uploader('academy', academyList), h('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap' }, save, msg));
}

/** True when online booking is switched off on that day for what the customer is looking at (practice sessions have their own list). */
const shutDay = (d) => ((state.config.closedDates || {})[state.ball === 'practice' ? 'practice' : 'ground'] || []).includes(d);

/** A month calendar where each day can be switched off or on for online booking, for the whole place at once or for ground, practice or academy alone. */
function closureCalendar(s) {
  const SC = [['all', 'Everything'], ['ground', 'Ground'], ['practice', 'Practice'], ['academy', 'Academy']];
  const wrap = h('div', { style: 'margin-bottom:28px' }), grid = h('div', { class: 'cal' }), label = h('b', {}), msg = h('span', { class: 'hint' });
  let month = (s.bookingsOpenFrom && s.bookingsOpenFrom > todayIst() ? s.bookingsOpenFrom : todayIst()).slice(0, 7), scope = 'all';
  let closed = { ground: new Set(), practice: new Set(), academy: new Set(), ...Object.fromEntries(Object.entries(state.config.closedDates || {}).map(([k, v]) => [k, new Set(v)])) };
  const names = () => (scope === 'all' ? ['ground', 'practice', 'academy'] : [scope]);
  const setDays = async (dates, val, reason) => {
    msg.textContent = '';
    try {
      const r = await api('/api/admin/closed-dates', { method: 'POST', body: { dates, closed: val, scopes: names(), reason } });
      closed = { ground: new Set(), practice: new Set(), academy: new Set() };
      for (const c of r.items) closed[c.scope].add(c.date);
      state.config.closedDates = { ground: [...closed.ground].sort(), practice: [...closed.practice].sort(), academy: [...closed.academy].sort() };
      draw();
    } catch (e) { msg.textContent = e.message; }
  };
  /** none / some / all of the chosen scopes are closed on that day */
  const level = (date) => { const n = names().filter((k) => closed[k].has(date)).length; return n === 0 ? 'none' : n === names().length ? 'all' : 'some'; };
  const picker = h('div', { class: 'chips2', style: 'margin:6px 0 10px' });
  function drawPicker() { clear(picker); for (const [id, t] of SC) picker.append(h('button', { type: 'button', class: 'chip2' + (id === scope ? ' on' : ''), onclick: () => { scope = id; drawPicker(); draw(); } }, t)); }
  function draw() {
    clear(grid);
    const [y, m] = month.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7;
    label.textContent = `${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`;
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) grid.append(h('span', { class: 'cal-h' }, d));
    for (let i = 0; i < lead; i++) grid.append(h('span'));
    for (let day = 1; day <= days; day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const outside = date < todayIst() || (s.bookingsOpenFrom && date < s.bookingsOpenFrom) || (s.bookingsCloseFrom && date >= s.bookingsCloseFrom);
      const lv = level(date), shutNow = lv === 'all';
      const tip = outside ? 'Outside the booking window' : lv === 'some' ? 'Partly closed (' + ['ground', 'practice', 'academy'].filter((k) => closed[k].has(date)).join(', ') + '). Click to close the rest' : shutNow ? 'Closed. Click to open' : 'Open. Click to close';
      grid.append(h('button', { type: 'button', class: 'cal-d' + (outside ? ' out' : lv === 'all' ? ' off' : lv === 'some' ? ' part' : ' on'), disabled: outside ? true : null, title: tip, onclick: () => setDays([date], !shutNow) }, String(day)));
    }
  }
  const step = (n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); month = d.toISOString().slice(0, 7); draw(); };
  const a = h('input', { type: 'date' }), b = h('input', { type: 'date' }), why = h('input', { type: 'text', maxlength: '100', placeholder: 'Reason (optional)' });
  const range = (val) => { if (!a.value || !b.value || b.value < a.value) { msg.textContent = 'Choose a start and an end day.'; return; } const out = []; for (let d = a.value; d <= b.value && out.length < 400; d = addDays(d, 1)) out.push(d); setDays(out, val, why.value.trim() || undefined); };
  const word = () => (scope === 'all' ? 'everything' : scope);
  wrap.append(h('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Switch days on or off'),
    h('p', { class: 'hint' }, 'Choose what to switch, then click a day to close it for online booking and again to open it. "Everything" closes the ground, practice sessions and academy enquiries together. Greyed days are outside the booking window above. Staff can still add bookings on closed days.'),
    picker,
    h('div', { style: 'display:flex;gap:12px;align-items:center;margin:8px 0' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => step(-1) }, '‹'), label, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => step(1) }, '›')),
    grid, h('div', { class: 'hint', style: 'margin:8px 0' }, h('span', { class: 'cal-key on' }), ' Open   ', h('span', { class: 'cal-key part' }), ' Partly closed   ', h('span', { class: 'cal-key off' }), ' Closed   ', h('span', { class: 'cal-key out' }), ' Outside the window'),
    h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, a, h('span', {}, 'to'), b, why, h('button', { class: 'btn outline sm', type: 'button', onclick: () => range(true) }, 'Close these days'), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => range(false) }, 'Open these days')), msg);
  drawPicker(); draw();
  return wrap;
}

async function loadAdminDesk(body) {
  const box = h('div', { class: 'box' }, h('div', { class: 'skeleton' }, 'Loading…'));
  body.append(box);
  try {
    const [s, bk] = await Promise.all([api('/api/admin/settings'), api('/api/admin/backups')]);
    clear(box);
    const sw = h('button', { class: 'btn outline sm', type: 'button', onclick: async () => { try { await api('/api/admin/settings', { method: 'PUT', body: { razorpayEnabled: !s.razorpayEnabled } }); toast(`Online payments are now ${!s.razorpayEnabled ? 'ON' : 'OFF'}.`); loadDesk(); } catch (e) { toast(e.message, true); } } }, s.razorpayEnabled ? 'Turn Razorpay OFF' : 'Turn Razorpay ON');
    box.append(
      h('div', { class: 'eyebrow', style: 'margin-bottom:14px' }, 'Platform'),
      h('div', { class: 'list' },
        h('div', { class: 'li' }, h('span', {}, 'Razorpay (online payments)'), h('b', {}, s.razorpayEnabled ? 'ON' : 'OFF  ·  direct UPI with staff verification')),
        h('div', { class: 'li' }, h('span', {}, 'Contact person'), h('b', {}, `${s.contactName}  ·  ${formatPhone(s.contactPhone)}`)),
        h('div', { class: 'li' }, h('span', {}, 'Email'), h('b', {}, s.contactEmail)),
        h('div', { class: 'li' }, h('span', {}, 'MP13 Academy'), h('b', {}, `${s.academyName}  ·  ${s.academyBrand}`))),
      h('div', { style: 'margin:16px 0 18px' }, sw),
      h('div', { class: 'eyebrow', style: 'margin-bottom:10px' }, 'Colour theme'),
      h('div', { style: 'margin:0 0 28px' }, h('div', { class: 'dthemes', style: 'margin-left:0', role: 'group', 'aria-label': 'Colour theme' }, THEMES.map(([id, name, bg, ac]) => h('button', { type: 'button', title: name, 'aria-label': name, 'data-theme-id': id, style: `--sw:${ac};--sw-in:${bg}`, class: document.documentElement.getAttribute('data-theme') === id ? 'on' : '', onclick: () => { applyTheme(id, true); $$('.dthemes button').forEach((b) => b.classList.toggle('on', b.dataset.themeId === id)); } }))), h('p', { class: 'hint', style: 'margin:10px 0 0' }, 'Changes the colours on this device only.')),
      h('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'When customers can book'),
      (() => {
        const row = (label, key, value, openText, clearText) => {
          const d = h('input', { type: 'date', value: value || '' }), msg = h('span', { class: 'hint' });
          const save = h('button', { class: 'btn outline sm', type: 'button', onclick: async () => { try { await api('/api/admin/settings', { method: 'PUT', body: { [key]: d.value } }); msg.textContent = d.value ? openText(d.value) : clearText; } catch (e) { msg.textContent = e.message; } } }, 'Save');
          return h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px' }, h('span', { style: 'min-width:170px' }, label), d, save, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { d.value = ''; save.click(); } }, 'Clear'), msg);
        };
        return h('div', { style: 'margin-bottom:28px' },
          row('Bookings open from', 'bookingsOpenFrom', s.bookingsOpenFrom, (v) => 'Saved. Customers can book from ' + niceDate(v) + '.', 'Saved. Bookings are open now.'),
          row('Bookings closed from', 'bookingsCloseFrom', s.bookingsCloseFrom, (v) => 'Saved. Customers cannot book on or after ' + niceDate(v) + ' until you clear this.', 'Saved. No closing day: bookings are open as far ahead as allowed.'));
      })(),
      closureCalendar(s),
      h('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Auto-debit'),
      h('p', { class: 'hint' }, 'Lets customers approve their bank once (UPI AutoPay) so the balance of each booking is charged automatically before it starts. Needs Recurring Payments enabled on the Razorpay account. Try it in test mode first.'),
      (() => {
        const hrs = h('input', { type: 'number', min: 1, max: 168, value: s.autoDebitHoursBefore, style: 'width:5rem' }), msg = h('span', { class: 'hint' });
        const put = async (patch, text) => { try { await api('/api/admin/settings', { method: 'PUT', body: patch }); msg.textContent = text; if ('autoDebitEnabled' in patch) loadDesk(); } catch (e) { msg.textContent = e.message; } };
        return h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:28px' },
          h('b', {}, s.autoDebitEnabled ? 'ON' : 'OFF'),
          h('button', { class: 'btn outline sm', type: 'button', onclick: () => put({ autoDebitEnabled: !s.autoDebitEnabled }, '') }, s.autoDebitEnabled ? 'Turn auto-debit OFF' : 'Turn auto-debit ON'),
          h('span', {}, 'Charge'), hrs, h('span', {}, 'hours before the start'),
          h('button', { class: 'btn outline sm', type: 'button', onclick: () => put({ autoDebitHoursBefore: Number(hrs.value) }, 'Saved.') }, 'Save'), msg);
      })(),
      h('div', { class: 'eyebrow', style: 'margin-bottom:14px' }, 'Backups'),
      h('p', { class: 'hint' }, bk.enabled ? `A snapshot is taken every day at ${bk.at} India time; the newest ${bk.keep} are kept.` : 'Daily backups are off on this server (they are on by default on a real domain).'),
      h('div', { class: 'list' }, bk.items.slice(0, 6).map((i) => h('div', { class: 'li' }, h('span', {}, `${i.name.replace('_', '  ')}  ·  ${i.reason}`), h('b', {}, `${(i.dbBytes / 1024).toFixed(0)} KB · ${i.integrity}`)))),
      h('div', { class: 'eyebrow', style: 'margin:28px 0 8px' }, 'Website: gallery and Instagram'),
      siteEditor(s),
      h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn outline sm', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { await api('/api/admin/backups', { method: 'POST', body: {} }); toast('Backup taken.'); loadDesk(); } catch (er) { toast(er.message, true); e.currentTarget.disabled = false; } } }, 'Take a backup now')));
  } catch (e) { clear(box); box.append(h('div', { class: 'empty' }, e.message)); }
}

// ------------------------------------------------------------------ navigation

function show(name) {
  for (const v of ['home', 'bookings', 'desk', 'login', 'platform', 'academy']) $('#view-' + v).classList.toggle('on', v === name);
  document.documentElement.classList.toggle('in-desk', name === 'desk');
}
/** Every desk screen has its own address: #desk/<tab> and #desk/<tab>/<page>, so the back button and a bookmark both work. */
const DESK_HASH = /^#desk(?:\/([\w-]+)(?:\/([\w-]+))?)?$/;
function deskNav(tab, sub, quiet) {
  const hh = '#desk/' + tab + (sub ? '/' + sub : '');
  if (location.hash === hh) return;
  try { history[quiet ? 'replaceState' : 'pushState'](null, '', hh); } catch { location.hash = hh; }
}
function route() {
  const hash = location.hash;
  let v = 'home';
  // staff and owners now work in the new admin desk
  if ((DESK_HASH.test(hash) || hash === '#platform') && state.user && state.user.role !== 'customer') { location.replace('desk.html' + (hash === '#platform' ? '#/platform' : '')); return; }
  if (hash === '#bookings' && state.user && state.user.role === 'customer') v = 'bookings';
  else if (DESK_HASH.test(hash) && state.user && state.user.role !== 'customer') { v = 'desk'; const m = DESK_HASH.exec(hash); if (m[1]) state.deskTab = m[1]; state.deskSub = m[2] || null; }
  else if ((hash === '#bookings' || DESK_HASH.test(hash)) && !state.user) { openAuth({ note: 'Sign in to see this page.', after: () => { location.hash = hash; route(); } }); return; }
  else if (hash === '#platform') v = 'platform';
  else if (hash === '#academy' || (!hash && document.documentElement.getAttribute('data-embed') === 'academy')) v = 'academy';
  else if (hash === '#login' && !state.user) { if (!$('#login-body').firstChild) openAuth(); v = 'login'; }
  show(v);
  if (v === 'bookings') loadBookings();
  if (v === 'desk') loadDesk();
  if (v !== 'home') window.scrollTo(0, 0);
}
function goHome(e) { if (e) e.preventDefault(); location.hash = ''; history.replaceState(null, '', location.pathname + location.search); show('home'); window.scrollTo(0, 0); }
function jump(id) {
  show('home');
  if (['#bookings', '#platform', '#academy'].includes(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.addEventListener('click', (e) => {
  const bn = e.target.closest('[data-book]');
  if (bn && !state.user) { e.preventDefault(); openAuth({ note: 'Sign in or create an account to book.', after: () => jump('book') }); return; }
  const j = e.target.closest('[data-jump]'); if (j) { e.preventDefault(); jump(j.dataset.jump); return; }
  const hm = e.target.closest('[data-home]'); if (hm) goHome(e);
});
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ start

async function start() {
  try {
    const [config, gs] = await Promise.all([api('/api/config'), api('/api/grounds')]);
    state.config = config; state.grounds = gs.items;
  } catch (e) {
    $('#p-name').textContent = 'The server is not reachable';
    $('#p-sub').textContent = e.message;
    $('#grounds-list').textContent = '';
    return;
  }
  if (state.token) {
    try { state.user = (await api('/api/me', { keepToken: true })).user || null; if (!state.user) throw 0; }
    catch { state.token = null; state.user = null; store.set('daji.token', null); }
    if (state.user && state.user.role === 'customer') await loadCredit();
  }
  renderAuth();
  fillStatic();
  if (state.grounds.length) pickGround(state.grounds[0].id);
  else { $('#p-name').textContent = 'No grounds yet'; $('#p-hold').hidden = true; }
  route();
}
start();
// ---- the customer's own dashboard: spend, history, and a question box that answers from their own bookings.
async function renderMyDash(el) {
  el.append(h('div', { class: 'skeleton' }, 'Loading your summary…'));
  let d;
  try { d = await api('/api/my/dashboard'); } catch (e) { clear(el); el.append(h('p', { class: 'hint err' }, e.message)); return; }
  clear(el);
  const kpi = (label, value, small) => h('div', { class: 'kpi' }, h('span', {}, label), h('b', {}, value), small ? h('small', {}, small) : null);
  el.append(h('div', { class: 'kpis dash' },
    kpi('Spent at the ground', inr(d.spentPaise), d.firstPlayed ? `since ${d.firstPlayed}` : 'nothing yet'),
    kpi('Sessions played', String(d.sessions), `${d.slots} ${d.slots === 1 ? 'slot' : 'slots'}`),
    kpi('Paid ahead', inr(d.paidAheadPaise), `${d.upcoming} upcoming`),
  ));
  if (d.sessions || d.cancelled || d.noShows) {
    const max = Math.max(1, ...d.byMonth.map((m) => m.spentPaise));
    el.append(h('div', { class: 'box', style: 'margin-bottom:24px' },
      h('div', { class: 'eyebrow', style: 'margin-bottom:16px' }, 'Spend by month, last 12 months'),
      h('div', { class: 'mbars' }, d.byMonth.map((m) => h('div', { class: 'mb', title: `${MON[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}: ${inr(m.spentPaise)}, ${m.sessions} ${m.sessions === 1 ? 'session' : 'sessions'}` },
        h('i', { style: `height:${Math.max(m.spentPaise ? 6 : 2, Math.round((m.spentPaise / max) * 100))}%` }), h('span', {}, MON[Number(m.month.slice(5)) - 1])))),
      d.byGround.length ? h('div', { class: 'list', style: 'margin-top:20px' }, d.byGround.map((g) => h('div', { class: 'li' }, h('span', {}, `${g.groundName}  ·  ${g.sessions} ${g.sessions === 1 ? 'session' : 'sessions'}${g.lastPlayed ? `, last ${g.lastPlayed}` : ''}`), h('b', {}, inr(g.spentPaise))))) : null,
      d.cancelled || d.noShows ? h('p', { class: 'hint', style: 'margin:14px 0 0' }, `${d.cancelled} cancelled and ${d.noShows} missed. Only money that stayed with the ground counts as spent; refunds and credit given back do not.`) : null,
      d.creditPaise > 0 ? h('p', { class: 'hint', style: 'margin:6px 0 0' }, `Account credit available: ${inr(d.creditPaise)}.`) : null));
  }
  const out = h('div');
  el.append(h('div', { class: 'box', style: 'margin-bottom:28px' }, h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Ask about your bookings'),
    askBox(out, { base: '/api/ask', examples: '/api/ask/examples', placeholder: 'e.g. When is my next booking?' }), out));
  el.append(h('div', { class: 'eyebrow', style: 'margin:8px 0 14px' }, 'Your bookings'));
}

})();


// Phone menu: the section links live behind a button below 1020px.
(function () {
  const btn = document.getElementById('menu-btn');
  if (!btn) return;
  const nav = btn.closest('nav');
  const set = (open) => { nav.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', () => set(!nav.classList.contains('open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('.links a, .links button')) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
})();

// Opening animation: the intro video plays the moment the site opens, then the logo shrinks and settles into the top bar.
(function splash() {
  // Opening animation (intro.js): short phrases, a 3D phone showing the booking screen, then the logo. It follows the colour theme.
  const box = document.getElementById('splash'), skip = document.getElementById('splash-skip');
  const root = document.documentElement;
  if (!box) { root.classList.remove('splash-on'); return; }
  let seen = false;
  try { seen = sessionStorage.getItem('daji.splash') === '1'; } catch { /* private mode: just play */ }
  const framed = window.parent !== window || /[?&]embed=/.test(location.search);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (seen || framed || reduce || (location.hash && location.hash !== '#top') || !box.animate || !window.DajiIntro) { root.classList.remove('splash-on'); box.remove(); return; }
  root.classList.add('splash-on'); box.hidden = false; window.scrollTo(0, 0);
  if (skip) skip.hidden = true; // the intro has its own Skip
  const dark = typeof isDarkTheme === 'function' ? isDarkTheme() : true;
  box.classList.toggle('light', !dark);
  let done = false;
  const end = () => {
    if (done) return; done = true;
    try { sessionStorage.setItem('daji.splash', '1'); } catch { /* ignore */ }
    root.classList.add('splash-reveal'); box.classList.add('out');
    setTimeout(() => { root.classList.remove('splash-on', 'splash-reveal'); box.remove(); }, 700);
  };
  try { window.DajiIntro.play(box, { dark, logo: dark ? 'assets/logo.svg' : 'assets/logo-brass.svg', onDone: end }); } catch { end(); }
  setTimeout(end, 14000);
})();

document.addEventListener('DOMContentLoaded', () => { try { syncThemeIcon(); } catch { /* ignore */ } });
