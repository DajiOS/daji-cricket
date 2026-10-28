// The white-label booking page (book.html). It shows one business only: the one in the address (/b/<slug>), or the one whose own
// web address this is. Customers see free slots and send a booking request; the business confirms it from its desk. No payment is
// taken here, so no money can reach the wrong business's account.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const m = /^\/b\/([a-z0-9-]{1,40})\/?$/.exec(location.pathname);
  const q = m ? `business=${encodeURIComponent(m[1])}` : '';
  const withQ = (path) => (q ? path + (path.includes('?') ? '&' : '?') + q : path);
  const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  async function api(path, opts = {}) {
    let res;
    try { res = await fetch(withQ(path), { headers: { accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) }, method: opts.method || 'GET', body: opts.body ? JSON.stringify(opts.body) : undefined }); }
    catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
    const data = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error((data && data.error && data.error.message) || 'Something went wrong. Please try again.'); e.status = res.status; throw e; }
    return data;
  }

  let grounds = [], chosen = null;

  async function start() {
    let brand;
    try { brand = await api('/api/site-brand'); } catch (e) { $('name').textContent = 'Booking'; $('none').hidden = false; if (e.status !== 404) $('none').querySelector('p').textContent = e.message; return; }
    const b = brand.business;
    if (!b) { $('name').textContent = 'Booking'; $('none').hidden = false; return; }
    document.title = `Book a slot · ${b.name}`;
    $('name').textContent = b.name;
    if (b.logoUrl) { const img = $('logo'); img.src = b.logoUrl; img.alt = b.name; img.hidden = false; $('name').hidden = true; }
    $('by').textContent = `${b.name} · Software by ${brand.softwareOwner}`;
    try { grounds = (await api('/api/grounds')).items || []; } catch (e) { $('soon').hidden = false; $('soon-text').textContent = e.message; return; }
    if (!grounds.length) { $('soon').hidden = false; if (b.contactPhone) $('soon-text').textContent = `The ground is still being set up here. Call ${b.contactPhone} to book.`; return; }
    const sel = $('ground');
    for (const g of grounds) { const o = document.createElement('option'); o.value = g.id; o.textContent = g.area ? `${g.name}, ${g.area}` : g.name; sel.append(o); }
    const d = $('date'); d.min = istToday(); d.value = istToday();
    sel.addEventListener('change', loadSlots); d.addEventListener('change', loadSlots);
    $('pick').hidden = false;
    loadSlots();
  }

  async function loadSlots() {
    const box = $('slots'), note = $('slots-note');
    box.replaceChildren(); chosen = null; $('ask').hidden = true;
    const gid = $('ground').value, date = $('date').value;
    if (!gid || !date) { note.textContent = 'Pick a ground and a date.'; return; }
    note.textContent = 'Loading free times…';
    let a;
    try { a = await api(`/api/grounds/${encodeURIComponent(gid)}/availability?date=${encodeURIComponent(date)}`); } catch (e) { note.textContent = e.message; return; }
    if (a.closed) { note.textContent = 'The ground is closed on this day. Please pick another day.'; return; }
    const free = a.slots.filter((s) => s.state === 'available');
    note.textContent = free.length ? `${free.length} free ${free.length === 1 ? 'time' : 'times'}. Pick one.` : 'No free times on this day. Please pick another day.';
    for (const s of a.slots) {
      if (s.state === 'past') continue;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'slot'; btn.setAttribute('aria-pressed', 'false');
      btn.disabled = s.state !== 'available';
      btn.textContent = s.time;
      const small = document.createElement('small');
      small.textContent = s.state !== 'available' ? 'Taken' : typeof s.pricePaise === 'number' ? rupees(s.pricePaise) : 'Free';
      btn.append(small);
      btn.setAttribute('aria-label', `${s.time}, ${small.textContent}`);
      btn.addEventListener('click', () => pick(s, btn));
      box.append(btn);
    }
  }

  function pick(s, btn) {
    for (const b of $('slots').querySelectorAll('.slot')) b.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-pressed', 'true');
    const g = grounds.find((x) => x.id === $('ground').value);
    chosen = { groundId: g.id, ground: g.name, date: $('date').value, time: s.time };
    $('ask-what').textContent = `${g.name} on ${new Date(chosen.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} at ${s.time}. The ground confirms it with you; nothing is paid here.`;
    $('msg').textContent = ''; $('msg').className = 'msg';
    $('ask').hidden = false;
    $('who').focus();
  }

  $('ask').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!chosen) return;
    const msg = $('msg'), send = $('send');
    const name = $('who').value.trim(), phone = $('phone').value.trim();
    if (name.length < 2) { msg.className = 'msg bad'; msg.textContent = 'Please type your name.'; $('who').focus(); return; }
    if (!/^(\+?91|0)?[6-9]\d{9}$/.test(phone.replace(/[\s()-]/g, ''))) { msg.className = 'msg bad'; msg.textContent = 'Please type a 10-digit mobile number.'; $('phone').focus(); return; }
    send.disabled = true; msg.className = 'msg'; msg.textContent = 'Sending…';
    const note = $('note').value.trim();
    try {
      await api('/api/enquiries', { method: 'POST', headers: { 'idempotency-key': `book-${chosen.groundId}-${chosen.date}-${chosen.time}-${phone}`.replace(/[^\w-]/g, '').slice(0, 100) }, body: {
        groundId: chosen.groundId, kind: 'ground', name, phone, preferredDate: chosen.date, preferredTime: chosen.time, preferredSlots: 1,
        message: `Please book ${chosen.ground} on ${chosen.date} at ${chosen.time}.${note ? ' ' + note : ''}`,
      } });
      msg.className = 'msg good'; msg.textContent = 'Request sent. The ground will call or message you to confirm.';
      $('note').value = '';
    } catch (err) { msg.className = 'msg bad'; msg.textContent = err.message; }
    send.disabled = false;
  });

  // ---- team sign-in (#login): the desk sends people here when they need to sign in on this business's own address
  const showSignin = () => { const on = location.hash === '#login'; $('signin').hidden = !on; if (on) $('si-id').focus(); };
  addEventListener('hashchange', showSignin);
  $('signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('si-msg'), go = $('si-go');
    const identifier = $('si-id').value.trim(), password = $('si-pw').value, code = $('si-code').value.trim();
    if (!identifier || !password) { msg.className = 'msg bad'; msg.textContent = 'Type your email or mobile number and your password.'; return; }
    go.disabled = true; msg.className = 'msg'; msg.textContent = 'Signing in…';
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password, ...(code ? { code } : {}) }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        const c = d && d.error && d.error.code;
        if (c === 'MFA_REQUIRED') { $('si-code-row').hidden = false; $('si-code').focus(); }
        throw new Error((d && d.error && d.error.message) || 'Could not sign in. Try again.');
      }
      if (!d.user || d.user.role === 'customer') throw new Error('This sign-in is for the ground\'s owner and team.');
      try { localStorage.setItem('daji.token', d.token); } catch { throw new Error('This browser is blocking storage, so you cannot stay signed in. Allow site data and try again.'); }
      location.href = '/desk.html';
    } catch (err) { msg.className = 'msg bad'; msg.textContent = err.message; }
    go.disabled = false;
  });
  showSignin();

  start();
})();
