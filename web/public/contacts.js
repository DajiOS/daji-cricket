// Daji Cricket Ground: the Contacts screen on the owner desk (people who have played, and messages to them).
// Plain JavaScript; loaded after club.js. Everything is built with h() (no innerHTML).
(() => {
'use strict';
const D = window.DAJI;
if (!D) return;
const { h, clear, api, apiDownload, toast, openModal, closeModal, inr, niceDate, todayIst, addDays } = D;

const btn = (label, fn, cls = 'outline sm') => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, label);
const fail = (e) => toast((e && e.message) || 'Something went wrong', true);
const box = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('div', { class: 'hint', style: 'margin:6px 0 0' }, hint) : null);
const sel = (opts, value) => { const s = h('select'); for (const [v, l] of opts) s.append(h('option', { value: v, selected: v === value ? true : null }, l)); return s; };
const day = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

function renderContacts(pane) {
  let offset = 0; const LIMIT = 50;
  const ctl = { who: sel([['played', 'Have played'], ['booked', 'Played or booked ahead'], ['all', 'Everyone who booked']], 'played'), ground: sel([['', 'All grounds']], ''),
    inactive: sel([['', 'Any time'], [addDays(todayIst(), -30), 'Not played in 30 days'], [addDays(todayIst(), -90), 'Not played in 90 days']], ''),
    min: h('input', { type: 'number', min: '1', placeholder: 'e.g. 3', inputmode: 'numeric' }), q: h('input', { type: 'search', placeholder: 'Name, phone or email' }) };
  const summary = h('div', { class: 'kpis' }), list = h('div');
  const filter = () => { const f = { who: ctl.who.value }; if (ctl.ground.value) f.groundId = ctl.ground.value; if (ctl.inactive.value) f.inactiveSince = ctl.inactive.value; if (Number(ctl.min.value) > 0) f.minTimes = Number(ctl.min.value); if (ctl.q.value.trim()) f.q = ctl.q.value.trim(); return f; };
  const qs = (f) => new URLSearchParams(f).toString();
  const chip = (on, t) => h('span', { class: 'chip ' + (on ? 'ok' : '') }, t);

  const run = async (reset = true) => {
    if (reset) offset = 0;
    clear(list).append(h('div', { class: 'skeleton' }, 'Loading…'));
    try {
      const r = await api(`/api/staff/contacts?${qs(filter())}&limit=${LIMIT}&offset=${offset}`);
      clear(list); clear(summary);
      for (const [l, v] of [['People', r.summary.total], ['Can email', r.summary.reachableEmail], ['Can WhatsApp', r.summary.reachableWhatsapp], ['Can text', r.summary.reachableSms]]) summary.append(h('div', { class: 'kpi' }, h('span', {}, l), h('b', {}, String(v))));
      const rows = r.items.map((c) => h('tr', {}, h('td', {}, c.name, h('small', { class: 'sub' }, ' ' + (c.phone || '') + (c.email ? ' ' + c.email : ''))),
        h('td', { class: 'n' }, String(c.timesPlayed)), h('td', {}, c.lastPastAt ? niceDate(day(c.lastPastAt)) : 'Not yet', c.nextAt ? h('small', { class: 'sub' }, ' Next ' + niceDate(day(c.nextAt))) : null), h('td', { class: 'n' }, inr(c.paidPaise)),
        h('td', {}, ...(c.reachable.email || c.reachable.whatsapp || c.reachable.sms ? [c.reachable.email && chip(true, 'Email'), c.reachable.whatsapp && chip(true, 'WhatsApp'), c.reachable.sms && chip(true, 'SMS')].filter(Boolean) : [h('small', { class: 'sub' }, 'No channel agreed')]))));
      list.append(r.items.length ? h('div', { class: 'tblwrap' }, h('table', { class: 'dt' }, h('thead', {}, h('tr', {}, ['Person', filter().who === 'played' ? 'Times played' : 'Bookings', 'Last played', 'Paid', 'Can reach on'].map((x, i) => h('th', { class: i === 1 || i === 3 ? 'n' : null }, x)))), h('tbody', {}, rows))) : h('div', { class: 'empty' }, 'Nobody matches yet.'),
        h('div', { class: 'bar' }, btn('Previous', () => { offset = Math.max(0, offset - LIMIT); run(false); }, 'ghost sm'), h('span', { class: 'hint' }, `${r.total ? offset + 1 : 0} to ${Math.min(offset + LIMIT, r.total)} of ${r.total}`), btn('Next', () => { if (offset + LIMIT < r.total) { offset += LIMIT; run(false); } }, 'ghost sm')));
    } catch (e) { clear(list).append(h('div', { class: 'empty' }, e.status === 403 ? 'Your role does not include contacts.' : e.message)); }
  };
  let t = 0;
  for (const c of Object.values(ctl)) c.addEventListener(c.type === 'search' || c.type === 'number' ? 'input' : 'change', () => { clearTimeout(t); t = setTimeout(run, 300); });
  api('/api/staff/grounds').then((g) => { for (const x of g.items) ctl.ground.append(h('option', { value: x.id }, x.name)); }).catch(() => {});

  pane.append(h('div', { class: 'box bk-box' }, h('div', { class: 'eyebrow', style: 'margin-bottom:16px' }, 'People who have played'),
    h('div', { class: 'bar' }, box('Show', ctl.who), box('Ground', ctl.ground), box('Activity', ctl.inactive), box('Played at least', ctl.min), box('Search', ctl.q),
      h('div', { class: 'dls' }, btn('Download CSV', () => apiDownload('/api/staff/contacts/export?' + qs(filter()), 'daji-contacts.csv').catch(fail)), btn('Message these people', () => composer(filter(), run), 'primary sm'))),
    summary, list), history());
  run();
}

function history() {
  const out = h('div', { class: 'box bk-box' }, h('div', { class: 'eyebrow', style: 'margin-bottom:16px' }, 'Messages sent'), h('div', { class: 'skeleton' }, 'Loading…'));
  api('/api/staff/broadcasts?limit=10').then((r) => {
    const body = out.lastChild; body.replaceWith(r.items.length ? h('div', { class: 'list' }, r.items.map((b) => h('div', { class: 'li' }, h('span', {}, `${niceDate(day(b.createdAt))} · ${b.channel} · ${(b.subject || b.body).slice(0, 60)}`), h('b', {}, `${b.sent} sent of ${b.queued}`)))) : h('div', { class: 'empty' }, 'Nothing sent yet.'));
  }).catch(() => { out.remove(); });
  return out;
}

async function composer(filter, done) {
  let templates = [];
  try { templates = (await api('/api/staff/broadcast-templates')).items; } catch (e) { fail(e); return; }
  const channel = sel([['whatsapp', 'WhatsApp'], ['email', 'Email'], ['sms', 'Text message']], 'whatsapp');
  const tpl = sel([['', 'Start from a template']].concat(templates.map((x) => [x.id, x.title])), '');
  const subject = h('input', { placeholder: 'Subject (email only)', maxlength: '120' }), body = h('textarea', { rows: '6', placeholder: 'Hi {name}, …', maxlength: '5000' });
  const out = h('div'), err = h('div', { class: 'fe' }); let plan = null;
  tpl.addEventListener('change', () => { const x = templates.find((t) => t.id === tpl.value); if (x) { subject.value = x.subject || ''; body.value = x.body; plan = null; clear(out); } });
  const payload = (extra) => ({ channel: channel.value, subject: channel.value === 'email' ? subject.value : undefined, body: body.value, filter, ...extra });
  const preview = async () => {
    err.textContent = ''; clear(out);
    try {
      plan = await api('/api/staff/broadcasts/preview', { method: 'POST', body: payload({}) });
      out.append(h('div', { class: 'kv' }, h('div', { class: 'row' }, h('span', {}, 'Will reach'), h('b', {}, String(plan.willSend))), h('div', { class: 'row' }, h('span', {}, 'Left out'), h('b', {}, `${plan.skipped.noConsent} no consent, ${plan.skipped.noAddress} no address, ${plan.skipped.disabled} disabled`))),
        h('p', { class: 'hint' }, 'First message as it will read:'), h('pre', { class: 'mono', style: 'white-space:pre-wrap' }, plan.preview.body),
        plan.willSend ? btn(`Send to ${plan.willSend} people`, send, 'primary block') : h('p', { class: 'hint' }, 'Nobody can be reached on this channel for this group.'));
    } catch (e) { err.textContent = e.message; }
  };
  const send = async () => {
    try {
      const r = await api('/api/staff/broadcasts', { method: 'POST', body: payload({ confirmCount: plan.willSend, requestId: 'ui-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) }) });
      closeModal(); toast(`Queued for ${r.broadcast.queued} people. Delivery needs your email, text or WhatsApp provider to be connected.`); done();
    } catch (e) { err.textContent = e.message; }
  };
  for (const c of [channel, subject, body]) c.addEventListener('input', () => { plan = null; clear(out); });
  openModal([h('h3', {}, 'Message these people'), h('p', { class: 'hint' }, 'Only people who said yes to this channel are messaged. Use {name} for their first name. Check the preview before sending.'),
    box('Template', tpl), box('Channel', channel), box('Subject', subject), box('Message', body), err, btn('Preview', preview, 'outline block'), out]);
}

D.registerDeskTab({ id: 'contacts', label: 'Contacts', perm: 'view_customers', render: renderContacts });
})();
