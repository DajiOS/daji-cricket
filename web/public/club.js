// Daji Cricket Ground: academy, match-day scoring, live scores, the parents' view and the page for other ground owners.
// Plain JavaScript; loaded after app.js, which shares its helpers on window.DAJI. Everything is built with h() (no innerHTML).
(() => {
'use strict';
const D = window.DAJI;
if (!D) return;
const { h, clear, $, api, toast, openModal, closeModal, niceDate, todayIst, state, formatPhone } = D;

const btn = (label, fn, cls = 'outline sm') => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, label);
const fail = (e) => toast((e && e.message) || 'Something went wrong', true);
const box = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('div', { class: 'hint', style: 'margin:6px 0 0' }, hint) : null);
const sel = (opts, value, attrs = {}) => { const s = h('select', attrs); for (const [v, l] of opts) s.append(h('option', { value: v, selected: v === value ? true : null }, l)); return s; };
const section = (title, ...kids) => h('div', { class: 'box bk-box' }, title ? h('div', { class: 'eyebrow', style: 'margin-bottom:16px' }, title) : null, ...kids);
const bar = (...kids) => h('div', { class: 'bar' }, ...kids);
const monthNow = () => todayIst().slice(0, 7);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
async function load(pane, fn) {
  clear(pane).append(h('div', { class: 'skeleton' }, 'Loading…'));
  try { const out = await fn(); clear(pane); return out; } catch (e) { clear(pane).append(h('div', { class: 'empty' }, e.status === 403 ? 'Your role does not include this.' : e.message)); return null; }
}
const stars = (n) => '●'.repeat(n) + '○'.repeat(5 - n);
function tbl(heads, rows, nums = [], empty = 'Nothing here yet.') {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  const cell = (c, i, tag) => h(tag, { class: nums.includes(i) ? 'n' : null }, c);
  return h('div', { class: 'tblwrap' }, h('table', { class: 'dt' }, h('thead', {}, h('tr', {}, heads.map((x, i) => cell(x, i, 'th')))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => cell(c, i, 'td')))))));
}

// ================================================================== academy (staff)

function renderAcademy(pane) {
  const nav = h('div', { class: 'tabs subbar' }), view = h('div', { style: 'margin-top:22px' });
  const items = [['students', 'Students', students], ['attendance', 'Attendance', attendance], ['fees', 'Fees', fees], ['skills', 'Skills', skills], ['coaches', 'Coaches', coaches]];
  const open = (id, quiet) => { const it = items.find((x) => x[0] === id) || items[0]; state.acTab = it[0]; D.deskSub('academy', it[0], quiet); for (const b of nav.children) b.classList.toggle('on', b.dataset.id === it[0]); clear(view); it[2](view); };
  for (const it of items) nav.append(h('button', { class: 'tab', type: 'button', 'data-id': it[0], onclick: () => open(it[0]) }, it[1]));
  pane.append(nav, view); open(state.acTab || 'students', true);
}

// ---- fees and the coach's share. The percentage is blank until the owner records the agreed terms.
const rs = (p) => D.inr ? D.inr(p) : '₹' + (p / 100).toLocaleString('en-IN');
function fees(view) {
  const pane = h('div'); view.append(pane);
  const month = h('input', { type: 'month', value: monthNow() }), list = h('div'), stmt = h('div');
  const chip = (st) => h('span', { class: 'chip' + (st === 'paid' ? ' ok' : st === 'overdue' ? ' bad' : '') }, { paid: 'Paid', part: 'Part paid', unpaid: 'Due', overdue: 'Overdue' }[st]);
  const run = async () => {
    const r = await load(list, () => api('/api/staff/academy/fees?month=' + month.value));
    if (r) list.append(h('p', { class: 'hint' }, `Billed ${rs(r.billedPaise)}  ·  collected ${rs(r.collectedPaise)}  ·  outstanding ${rs(r.outstandingPaise)}`),
      tbl(['Student', 'Batch', 'Fee', 'Paid', 'Status', ''], r.items.map((f) => [f.studentName, f.batch || '', rs(f.amountPaise), rs(f.paidPaise), chip(f.status), f.duePaise > 0 ? btn('Record payment', () => payDialog(f), 'ghost sm') : '']), [2, 3], 'No fees raised for this month. Use "Raise fees".'));
    const t = await load(stmt, () => api('/api/staff/academy/share/statement?month=' + month.value));
    if (t) stmt.append(h('p', {}, `Collected in ${monthName(month.value)}: `, h('b', {}, rs(t.collectedPaise))),
      t.coachSharePaise == null ? h('p', { class: 'hint' }, 'Share terms not set yet, so no split is shown.') : h('p', {}, `${t.share.partyName} (${t.share.percent}%): `, h('b', {}, rs(t.coachSharePaise)), `   ·   academy keeps ${rs(t.academyKeepsPaise)}`),
      btn('Set share terms', () => shareDialog(t.share), 'outline sm'));
  };
  const raise = () => {
    const amt = h('input', { type: 'number', min: '1', step: '1', placeholder: 'Monthly fee in rupees' }), due = h('input', { type: 'date', value: month.value + '-10' });
    openModal(h('div', {}, h('h3', {}, 'Raise fees for ' + monthName(month.value)), box('Fee per student (₹)', amt), box('Due date', due),
      btn('Raise fees', async () => { try { const r = await api('/api/staff/academy/fees', { method: 'POST', body: { month: month.value, amountPaise: Math.round(Number(amt.value) * 100), dueOn: due.value } }); closeModal(); toast(`${r.created} fee(s) raised.`); run(); } catch (e) { fail(e); } }, 'primary')));
  };
  const payDialog = (f) => {
    const amt = h('input', { type: 'number', min: '1', step: '1', value: String(f.duePaise / 100) }), mode = sel([['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank transfer'], ['cheque', 'Cheque'], ['card', 'Card']], 'upi'), on = h('input', { type: 'date', value: todayIst() });
    openModal(h('div', {}, h('h3', {}, `Payment from ${f.studentName}`), box('Amount (₹)', amt), box('How paid', mode), box('Received on', on),
      btn('Save', async () => { try { await api(`/api/staff/academy/fees/${f.id}/payments`, { method: 'POST', body: { amountPaise: Math.round(Number(amt.value) * 100), mode: mode.value, receivedOn: on.value } }); closeModal(); toast('Payment recorded.'); run(); } catch (e) { fail(e); } }, 'primary')));
  };
  const shareDialog = (sh) => {
    const who = h('input', { value: sh.partyName, maxlength: '80' }), pct = h('input', { type: 'number', min: '0', max: '100', step: '0.5', value: sh.percent == null ? '' : String(sh.percent), placeholder: 'Leave blank until agreed' });
    openModal(h('div', {}, h('h3', {}, 'Coach share of student fees'), h('p', { class: 'hint' }, 'Enter the percentage only once it has been agreed. Only the owner can change this.'), box('Paid to', who), box('Percent of fees collected', pct),
      btn('Save', async () => { try { await api('/api/staff/academy/share', { method: 'PUT', body: { partyName: who.value, percent: pct.value === '' ? null : Number(pct.value) } }); closeModal(); toast('Saved.'); run(); } catch (e) { fail(e); } }, 'primary')));
  };
  month.addEventListener('change', run);
  pane.append(section('Student fees', bar(box('Month', month), h('div', { class: 'dls' }, btn('Raise fees', raise, 'primary sm'))), list), section('Coach share', stmt));
  run();
}

function coaches(view) {
  const pane = h('div'); view.append(pane);
  const list = h('div');
  let rows = [];
  const draw = () => {
    clear(list);
    if (!rows.length) list.append(h('div', { class: 'empty' }, 'No coaches yet. Add the first one.'));
    rows.forEach((c, i) => {
      const sp = (c.name || '').trim().split(/\s+/), first = h('input', { value: sp.length > 1 ? sp.slice(0, -1).join(' ') : sp[0] || '', maxlength: '40', placeholder: 'First name' }), last = h('input', { value: sp.length > 1 ? sp[sp.length - 1] : '', maxlength: '40', placeholder: 'Last name' }), title = h('input', { value: c.title, maxlength: '80', placeholder: 'e.g. Head coach, BCCI Level 2' });
      const bio = h('textarea', { maxlength: '400', placeholder: 'A line or two about experience' }, c.bio);
      const photo = h('input', { value: c.photo, placeholder: 'Photo link, or upload below' });
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
      const joinName = () => { c.name = `${first.value.trim()} ${last.value.trim()}`.trim(); }; first.addEventListener('input', joinName); last.addEventListener('input', joinName); title.addEventListener('input', () => { c.title = title.value; });
      bio.addEventListener('input', () => { c.bio = bio.value; }); photo.addEventListener('input', () => { c.photo = photo.value; });
      file.addEventListener('change', async () => {
        const f = file.files[0]; if (!f) return;
        try { const r = await D.apiFile(`/api/media?kind=academy&filename=${encodeURIComponent(f.name)}`, f); c.photo = r.url; photo.value = r.url; toast('Uploaded. Press Save to publish.'); } catch (e) { fail(e); }
      });
      list.append(h('div', { class: 'box', style: 'margin-bottom:14px' }, box('First name', first), box('Last name', last), box('Title', title), box('About', bio), box('Photo', photo), file,
        h('div', { class: 'dls', style: 'margin-top:10px' }, btn('Up', () => { if (i) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); } }, 'ghost sm'), btn('Down', () => { if (i < rows.length - 1) { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); } }, 'ghost sm'), btn('Remove', () => { rows.splice(i, 1); draw(); }, 'ghost sm'))));
    });
  };
  const save = async () => {
    const items = rows.map((c) => ({ name: c.name.trim(), title: c.title.trim(), bio: c.bio.trim(), photo: c.photo.trim() }));
    try { const r = await api('/api/staff/academy/coaches', { method: 'PUT', body: { items } }); rows = r.items.map((c) => ({ ...c })); if (state.config.academy) state.config.academy.coaches = r.items; D.refreshCoaches && D.refreshCoaches(); draw(); toast('Saved'); } catch (e) { fail(e); }
  };
  pane.append(section('Coaching staff', h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'Shown on the MP13 Academy page. Up to 12 coaches.'), list,
    h('div', { class: 'dls' }, btn('Add a coach', () => { if (rows.length >= 12) return toast('Up to 12 coaches', true); rows.push({ name: '', title: '', bio: '', photo: '' }); draw(); }, 'outline sm'), btn('Save', save, 'primary sm'))));
  load(list, () => api('/api/staff/academy/coaches')).then((r) => { if (r) { rows = r.items.map((c) => ({ ...c })); draw(); } });
}

function students(view) {
  const pane = h('div'); view.append(pane);
  const q = h('input', { type: 'search', placeholder: 'Search by name' }), status = sel([['active', 'Active'], ['left', 'Left'], ['', 'All']], 'active');
  const list = h('div');
  const run = async () => {
    const r = await load(list, () => api(`/api/staff/academy/students?status=${status.value}&q=${encodeURIComponent(q.value.trim())}`));
    if (!r) return;
    list.append(tbl(['Student', 'Batch', 'Parent', 'Parent app', ''], r.items.map((s) => [h('span', {}, s.name, s.status === 'left' ? h('span', { class: 'chip', style: 'margin-left:8px' }, 'Left') : null), s.batch || '', `${s.guardianName}${s.guardianPhone ? '  ·  ' + formatPhone(s.guardianPhone) : ''}`,
      s.linked ? h('span', { class: 'chip ok' }, 'Linked') : h('span', { class: 'chip' }, 'Not linked'),
      h('span', { class: 'acts' }, btn('Progress', () => progressDialog(s), 'ghost sm'), btn('Parent', () => parentDialog(s, run), 'ghost sm'), btn('Edit', () => studentDialog(s, run), 'ghost sm'))]), [], 'No students yet. Add the first one.'));
  };
  q.addEventListener('input', () => { clearTimeout(students.t); students.t = setTimeout(run, 250); }); status.addEventListener('change', run);
  pane.append(section('Students', bar(box('Search', q), box('Show', status), h('div', { class: 'dls' }, btn('Add a student', () => studentDialog(null, run), 'primary sm'))), list));
  run();
}

function studentDialog(s, done) {
  const err = h('div', { class: 'fe' }), v = s || {};
  const name = h('input', { value: v.name || '' }), born = h('input', { type: 'date', value: v.bornOn || '' }), batch = h('input', { value: v.batch || '', placeholder: 'U-14 weekday' });
  const gname = h('input', { value: v.guardianName || '' }), gphone = h('input', { value: v.guardianPhone || '', inputmode: 'tel' }), gemail = h('input', { type: 'email', value: v.guardianEmail || '' }), notes = h('textarea', {}, v.notes || '');
  const photo = h('input', { type: 'checkbox', checked: v.photoConsent ? true : null }), video = h('input', { type: 'checkbox', checked: v.videoConsent ? true : null });
  const st = sel([['active', 'Active'], ['left', 'Left MP13 Academy']], v.status || 'active');
  openModal([h('h3', {}, s ? 'Edit student' : 'Add a student'), h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const body = { name: name.value.trim(), bornOn: born.value || undefined, batch: batch.value.trim() || undefined, guardianName: gname.value.trim(), guardianPhone: gphone.value.trim() || undefined, guardianEmail: gemail.value.trim() || undefined, notes: notes.value.trim() || undefined, photoConsent: photo.checked, videoConsent: video.checked };
    if (s) body.status = st.value;
    try { await api(s ? '/api/staff/academy/students/' + s.id : '/api/staff/academy/students', { method: s ? 'PATCH' : 'POST', body }); closeModal(); toast('Saved'); done(); } catch (er) { err.textContent = er.message + (er.details && er.details.fields ? ' ' + er.details.fields.map((f) => f.message).join('. ') : ''); }
  } }, box('Name', name), box('Date of birth', born), box('Batch', batch), box('Parent or guardian', gname), box('Parent phone', gphone), box('Parent email', gemail, 'Used only to let the parent see their child’s progress cards, after you link them.'), box('Notes', notes),
    h('label', { class: 'check' }, photo, h('span', {}, 'Parent agrees to photos of the child being used')), h('label', { class: 'check' }, video, h('span', {}, 'Parent agrees to match video that shows the child being shared')), s ? box('Status', st) : null, err, h('button', { class: 'btn primary block', type: 'submit' }, 'Save'))]);
}

function parentDialog(s, done) {
  const email = h('input', { type: 'email', value: s.guardianEmail || '', placeholder: 'parent@example.com' }), err = h('div', { class: 'fe' });
  openModal([h('h3', {}, `Parent app for ${s.name}`), h('p', { class: 'hint' }, s.linked ? 'This child is linked to a parent account. The parent sees only the progress cards you publish.' : 'Link the child to the parent’s account on this website. They must have created an account with this email. You confirm the link, so someone else cannot claim a child just by using the same email.'),
    h('form', { onsubmit: async (e) => { e.preventDefault(); err.textContent = ''; try { await api(`/api/staff/academy/students/${s.id}/link-guardian`, { method: 'POST', body: { email: email.value.trim() } }); closeModal(); toast('Linked'); done(); } catch (er) { err.textContent = er.message; } } }, box('Parent’s account email', email), err, h('button', { class: 'btn primary block', type: 'submit' }, s.linked ? 'Link to a different account' : 'Link account')),
    s.linked ? btn('Unlink', async () => { try { await api(`/api/staff/academy/students/${s.id}/unlink-guardian`, { method: 'POST', body: {} }); closeModal(); toast('Unlinked'); done(); } catch (er) { fail(er); } }, 'outline sm') : null,
    studentLogin(s, done)]);
}

// A student of 16 or over can have a login of their own, which opens the same dashboard as a parent's.
function studentLogin(s, done) {
  const age = s.bornOn ? Math.floor((Date.now() - new Date(s.bornOn).getTime()) / 31557600000) : null;
  const wrap = h('div', { style: 'border-top:1px solid var(--line);margin-top:22px;padding-top:18px' }, h('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Student’s own login'));
  if (age === null) { wrap.append(h('p', { class: 'hint' }, 'Add a date of birth to the student first. From the age of 16 a student can have a login of their own.')); return wrap; }
  if (age < 16) { wrap.append(h('p', { class: 'hint' }, `${s.name} is under 16, so progress is seen through the parent’s account only.`)); return wrap; }
  const email = h('input', { type: 'email', placeholder: 'student@example.com' }), err = h('div', { class: 'fe' });
  wrap.append(h('p', { class: 'hint' }, s.selfLinked ? `${s.name} has a login. They see their own attendance and the progress cards you publish.` : `${s.name} is 16 or over and can have a login of their own. They must first create an account on the website.`),
    h('form', { onsubmit: async (e) => { e.preventDefault(); err.textContent = ''; try { await api(`/api/staff/academy/students/${s.id}/link-student`, { method: 'POST', body: { email: email.value.trim() } }); closeModal(); toast('Student login linked'); done(); } catch (er) { err.textContent = er.message; } } }, box('Student’s account email', email), err, h('button', { class: 'btn outline sm', type: 'submit' }, s.selfLinked ? 'Link a different account' : 'Link student login')));
  if (s.selfLinked) wrap.append(btn('Remove student login', async () => { try { await api(`/api/staff/academy/students/${s.id}/unlink-student`, { method: 'POST', body: {} }); closeModal(); toast('Removed'); done(); } catch (er) { fail(er); } }, 'outline sm'));
  return wrap;
}

async function progressDialog(s) {
  let sk, cards;
  try { const r = await api(`/api/staff/academy/students/${s.id}/progress`); sk = r.skills; cards = r.items; } catch (e) { fail(e); return; }
  const month = h('input', { type: 'month', value: monthNow() }), form = h('div'), err = h('div', { class: 'fe' }), info = h('p', { class: 'hint' });
  const draw = () => {
    const c = cards.find((x) => x.month === month.value);
    clear(form); err.textContent = '';
    const rating = {}; for (const k of sk) rating[k] = String(c ? (c.ratings.find((r) => r.skill === k) || {}).rating || 3 : 3);
    const selects = sk.map((k) => { const x = sel([['1', '1  Needs work'], ['2', '2'], ['3', '3  Good'], ['4', '4'], ['5', '5  Excellent']], rating[k]); x.dataset.skill = k; return box(k, x); });
    const comment = h('textarea', { placeholder: 'A few kind, specific words for the parent' }, (c && c.comment) || '');
    info.textContent = c ? (c.published ? `Published to the parent. Attendance: ${c.attendance.present} of ${c.attendance.sessions} sessions.` : 'Saved, not yet visible to the parent.') : 'No card for this month yet.';
    const save = async () => { const ratings = {}; for (const x of form.querySelectorAll('select')) ratings[x.dataset.skill] = Number(x.value); try { const n = await api(`/api/staff/academy/students/${s.id}/progress/${month.value}`, { method: 'PUT', body: { ratings, comment: comment.value.trim() || undefined } }); cards = cards.filter((x) => x.month !== n.month).concat(n); toast('Saved'); draw(); } catch (er) { err.textContent = er.message; } };
    form.append(...selects, box('Comment', comment), err, h('div', { class: 'bar' }, btn('Save card', save, 'primary sm'),
      c ? btn(c.published ? 'Hide from parent' : 'Publish to parent', async () => { try { const n = await api(`/api/staff/academy/students/${s.id}/progress/${month.value}/publish`, { method: 'POST', body: { published: !c.published } }); cards = cards.filter((x) => x.month !== n.month).concat(n); toast(n.published ? 'Published' : 'Hidden'); draw(); } catch (er) { fail(er); } }, 'outline sm') : null));
  };
  month.addEventListener('change', draw);
  openModal([h('h3', {}, `Progress card: ${s.name}`), box('Month', month), info, form], { wide: true });
  draw();
}

function attendance(view) {
  const date = h('input', { type: 'date', value: todayIst(), max: todayIst() }), list = h('div'); let rows = [], redraw = () => {};
  const run = async () => {
    const r = await load(list, async () => { const [a, st] = await Promise.all([api('/api/staff/academy/attendance?date=' + date.value), api('/api/staff/academy/students?status=active')]); return { a: a.items, st: st.items }; });
    if (!r) return;
    const prior = new Map(r.a.map((x) => [x.studentId, x.present]));
    rows = r.st.map((s) => ({ s, present: prior.has(s.id) ? prior.get(s.id) : null }));
    const draw = redraw = () => { clear(list); if (!rows.length) { list.append(h('div', { class: 'empty' }, 'No active students.')); return; }
      for (const r2 of rows) list.append(h('div', { class: 'li file' }, h('span', {}, r2.s.name, r2.s.batch ? h('small', { class: 'sub' }, '  ' + r2.s.batch) : null),
        h('span', { class: 'acts' }, btn('Present', () => { r2.present = true; draw(); }, r2.present === true ? 'primary sm' : 'ghost sm'), btn('Absent', () => { r2.present = false; draw(); }, r2.present === false ? 'primary sm' : 'ghost sm'))));
      list.append(h('div', { style: 'margin-top:16px' }, btn('Save attendance', async () => { const marks = rows.filter((x) => x.present !== null).map((x) => ({ studentId: x.s.id, present: x.present })); if (!marks.length) { toast('Mark at least one student', true); return; }
        try { const x = await api('/api/staff/academy/attendance', { method: 'POST', body: { date: date.value, marks } }); toast(`Saved for ${x.saved} students`); } catch (er) { fail(er); } }, 'primary sm'))); };
    draw();
  };
  date.addEventListener('change', run);
  view.append(section('Attendance', bar(box('Day', date), h('div', { class: 'dls' }, btn('Everyone present', () => { for (const r of rows) r.present = true; redraw(); }, 'ghost sm'))), list));
  run();
}

function skills(view) {
  const pane = h('div'); view.append(pane);
  load(pane, () => api('/api/staff/academy/skills')).then((r) => {
    if (!r) return;
    const inputs = r.skills.map((x) => h('input', { value: x, maxlength: 30 })), err = h('div', { class: 'fe' });
    pane.append(section('Skills on the progress card', h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'Five things you rate each child on every month. Rename them to match how your coaches talk.'),
      ...inputs.map((i, n) => box(`Skill ${n + 1}`, i)), err, btn('Save skills', async () => { try { await api('/api/staff/academy/skills', { method: 'PUT', body: { skills: inputs.map((i) => i.value.trim()) } }); toast('Saved'); } catch (e) { err.textContent = e.message; } }, 'primary sm')));
  });
}

// ================================================================== match day (staff scoring)

const EXTRAS = [['', 'No extra'], ['wide', 'Wide'], ['noball', 'No ball'], ['bye', 'Bye'], ['legbye', 'Leg bye']];
const OUTS = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired'];

function renderMatches(pane) {
  const list = h('div');
  const run = async () => {
    const r = await load(list, () => api('/api/staff/matches'));
    if (!r) return;
    list.append(tbl(['Match', 'Overs', 'Status', 'Visible', ''], r.items.map((m) => [`${m.title}: ${m.teamA} v ${m.teamB}`, m.overs, m.result || m.status, m.isPublic ? 'Public' : 'Private', h('span', { class: 'acts' }, btn('Score', () => scorer(m.id, run), 'primary sm'), btn('Settings', () => matchDialog(m, run), 'ghost sm'))]), [1], 'No matches yet.'));
  };
  pane.append(section('Matches', h('p', { class: 'hint', style: 'margin:0 0 14px' }, 'Create a match, score it ball by ball from your phone, and the public live page updates by itself. Add a YouTube live link and viewers can watch from the same page.'), bar(btn('New match', () => matchDialog(null, run), 'primary sm')), list));
  run();
}

function matchDialog(m, done) {
  const v = m || {}, err = h('div', { class: 'fe' });
  const title = h('input', { value: v.title || '', placeholder: 'Sunday friendly' }), a = h('input', { value: v.teamA || '' }), b = h('input', { value: v.teamB || '' }), overs = h('input', { type: 'number', min: 1, max: 50, value: v.overs || 10 }), pl = h('input', { type: 'number', min: 2, max: 11, value: v.playersPerSide || 11 });
  const first = sel([['a', 'Team A bats first'], ['b', 'Team B bats first']], v.battingFirst || 'a'), yt = h('input', { placeholder: 'https://www.youtube.com/watch?v=…', value: v.youtubeId ? `https://youtu.be/${v.youtubeId}` : '' });
  const pub = h('input', { type: 'checkbox', checked: v.isPublic === false ? null : true });
  openModal([h('h3', {}, m ? 'Match settings' : 'New match'), h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const body = m ? { title: title.value.trim(), youtubeUrl: yt.value.trim() || null, isPublic: pub.checked } : { title: title.value.trim(), teamA: a.value.trim(), teamB: b.value.trim(), overs: Number(overs.value), playersPerSide: Number(pl.value), battingFirst: first.value, youtubeUrl: yt.value.trim() || undefined, isPublic: pub.checked };
    try { await api(m ? '/api/staff/matches/' + m.id : '/api/staff/matches', { method: m ? 'PATCH' : 'POST', body }); closeModal(); toast('Saved'); done(); } catch (er) { err.textContent = er.message + (er.details && er.details.fields ? ' ' + er.details.fields.map((f) => f.message).join('. ') : ''); }
  } }, box('Title', title), m ? null : [box('Team A', a), box('Team B', b), box('Overs per side', overs), box('Players per side', pl), box('Who bats first', first)], box('YouTube live or video link (optional)', yt), h('label', { class: 'check' }, pub, h('span', {}, 'Show on the public live scores page')), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Save'))]);
}

async function scorer(id, back) {
  const pane = $('#dk-body').lastChild; // the desk pane
  const root = h('div'); clear(pane).append(root);
  let sc, innings = 1;
  const names = new Set();
  const draw = () => {
    clear(root);
    const m = sc.match;
    const inn = sc.innings.find((i) => i.number === innings) || sc.innings[0];
    root.append(h('div', { class: 'bar' }, btn('← All matches', () => { clear(pane); renderMatches(pane); }, 'ghost sm'), h('b', { class: 'big' }, `${m.teamA} v ${m.teamB}`), h('span', { class: 'chip' }, m.result || m.status)));
    root.append(scoreboard(sc, true));
    if (m.status === 'completed') { root.append(section('', h('p', { class: 'hint', style: 'margin:0' }, 'The match is finished. Undo the last ball to reopen it.'), btn('Undo last ball', () => undo(), 'outline sm'))); return; }
    const ins = sel(sc.innings[0] && sc.innings[0].closed ? [['1', 'First innings'], ['2', 'Second innings']] : [['1', 'First innings']], String(innings)); ins.addEventListener('change', () => { innings = Number(ins.value); draw(); });
    const batter = h('input', { placeholder: 'On strike', list: 'names', value: scorer.batter || '' }), bowler = h('input', { placeholder: 'Bowler', list: 'names', value: scorer.bowler || '' });
    const dl = h('datalist', { id: 'names' }, [...names].map((n) => h('option', { value: n })));
    const extra = sel(EXTRAS, ''), wk = h('input', { type: 'checkbox' }), wkind = sel(OUTS.map((x) => [x, x]), 'bowled'), out = h('input', { placeholder: 'Who is out (if not the striker)', list: 'names' }), err = h('div', { class: 'fe' });
    const send = async (runs) => {
      err.textContent = ''; if (!batter.value.trim() || !bowler.value.trim()) { err.textContent = 'Say who is batting and who is bowling.'; return; }
      const body = { innings, batter: batter.value.trim(), bowler: bowler.value.trim(), runsBat: runs };
      if (extra.value) { body.extraType = extra.value; if (extra.value === 'bye' || extra.value === 'legbye') { body.runsBat = 0; body.extraRuns = runs || 1; } else if (extra.value === 'wide') { body.runsBat = 0; body.extraRuns = Math.max(1, runs); } }
      if (wk.checked) { body.wicket = true; body.wicketKind = wkind.value; if (out.value.trim()) body.outPlayer = out.value.trim(); }
      try { sc = await api(`/api/staff/matches/${id}/balls`, { method: 'POST', body }); scorer.batter = batter.value.trim(); scorer.bowler = bowler.value.trim(); names.add(scorer.batter); names.add(scorer.bowler); draw(); } catch (e) { err.textContent = e.message; }
    };
    root.append(section('Score a ball', bar(box('Innings', ins), box('Batter', batter), box('Bowler', bowler)), dl,
      h('div', { class: 'runs' }, [0, 1, 2, 3, 4, 6].map((r) => h('button', { class: 'btn ' + (r >= 4 ? 'primary' : 'outline'), type: 'button', onclick: () => send(r) }, String(r)))),
      bar(box('Extra', extra, 'For a wide or no ball, the run buttons add runs on top of the automatic one.'), h('label', { class: 'check', style: 'margin:0' }, wk, h('span', {}, 'Wicket')), box('How', wkind), box('Who', out)),
      err, bar(btn('Undo last ball', () => undo(), 'ghost sm'))));
  };
  const undo = async () => { try { sc = await api(`/api/staff/matches/${id}/undo`, { method: 'POST', body: { innings: sc.innings[1] && sc.innings[1].recent.length ? 2 : 1 } }); draw(); } catch (e) { fail(e); } };
  try { sc = await api('/api/staff/matches/' + id); innings = sc.innings[0] && sc.innings[0].closed ? 2 : 1; for (const i of sc.innings) { for (const x of i.batting) names.add(x.name); for (const x of i.bowling) names.add(x.name); } draw(); }
  catch (e) { root.append(h('div', { class: 'empty' }, e.message)); }
}

// The scoreboard used by staff and by the public page.
function scoreboard(sc, staff) {
  const m = sc.match;
  const wrap = h('div', { class: 'scoreboard' });
  for (const i of sc.innings) {
    wrap.append(h('div', { class: 'inn' },
      h('div', { class: 'sc-head' }, h('b', {}, i.team), h('span', { class: 'big' }, `${i.runs}/${i.wickets}`), h('span', { class: 'sub' }, `${i.overs} overs` + (i.runRate !== null ? `  ·  RR ${i.runRate}` : '') + (i.target ? `  ·  Target ${i.target}` : ''))),
      i.recent.length ? h('div', { class: 'balls' }, i.recent.map((b) => h('i', { class: /^W/.test(b) ? 'w' : /^[46]$/.test(b) ? 'f' : null }, b))) : null,
      tbl(['Batter', 'R', 'B', '4s', '6s'], i.batting.map((b) => [h('span', {}, b.name, b.out ? h('small', { class: 'sub' }, '  ' + b.out) : h('small', { class: 'sub' }, '  not out')), b.runs, b.balls, b.fours, b.sixes]), [1, 2, 3, 4], 'No balls yet.'),
      i.bowling.length ? tbl(['Bowler', 'O', 'R', 'W', 'Econ'], i.bowling.map((b) => [b.name, b.overs, b.runs, b.wickets, b.economy ?? '']), [1, 2, 3, 4]) : null,
      h('p', { class: 'hint' }, `Extras ${i.extras.total} (wides ${i.extras.wides}, no balls ${i.extras.noBalls}, byes ${i.extras.byes}, leg byes ${i.extras.legByes})`)));
  }
  if (!sc.innings.length) wrap.append(h('div', { class: 'empty' }, 'The match has not started.'));
  return staff ? section('Scorecard', wrap) : wrap;
}

// ================================================================== public live scores

async function fillLive() {
  const sec = $('#live'); if (!sec) return;
  try {
    const r = await api('/api/matches');
    if (!r.items.length) return;
    sec.hidden = false; const nav = $('#nav-live'); if (nav) nav.hidden = false;
    const list = clear($('#live-list'));
    for (const m of r.items.slice(0, 6)) list.append(h('button', { class: 'livecard', type: 'button', onclick: () => openLive(m.id) },
      h('span', { class: 'chip ' + (m.status === 'live' ? 'bad' : '') }, m.status === 'live' ? '● Live' : 'Final'), h('b', {}, `${m.teamA} v ${m.teamB}`), h('span', { class: 'sub' }, m.title), h('span', { class: 'sum' }, m.summary || 'Not started'), m.result ? h('span', { class: 'res' }, m.result) : null));
  } catch { /* the live section simply stays hidden */ }
}
async function openLive(id) {
  let timer = 0;
  const body = h('div', { class: 'live-body' }, h('div', { class: 'skeleton' }, 'Loading…'));
  openModal([body], { wide: true, onClose: () => clearInterval(timer) });
  const paint = async () => {
    try {
      const sc = await api('/api/matches/' + id);
      const m = sc.match;
      const yt = m.youtubeId ? h('a', { class: 'btn outline sm', href: 'https://www.youtube.com/watch?v=' + m.youtubeId, target: '_blank', rel: 'noopener', style: 'margin:6px 0 22px' }, 'Watch on YouTube') : null;
      const video = m.youtubeId ? (window.DAJI_PREVIEW ? yt : h('div', {}, h('div', { class: 'video' }, h('iframe', { src: m.embedUrl, title: 'Match video', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' })), yt)) : null;
      clear(body).append(h('div', { class: 'eyebrow' }, m.status === 'live' ? '● Live' : 'Match'), h('h3', { class: 'big' }, `${m.teamA} v ${m.teamB}`), h('p', { class: 'hint' }, m.title + (m.result ? `. ${m.result}` : '')), video, scoreboard(sc, false));
      if (m.status !== 'live') clearInterval(timer);
    } catch (e) { clear(body).append(h('div', { class: 'empty' }, e.message)); clearInterval(timer); }
  };
  await paint(); timer = setInterval(paint, 15000);
}

// ================================================================== parents: My children

D.registerBookingsExtra((ex) => {
  api('/api/me/children').then((r) => {
    const kids = r.items;
    if (!kids.length) return;
    const onlySelf = kids.every((x) => x.relation === 'self');
    const word = onlySelf ? 'My progress' : kids.length > 1 ? 'My children' : 'My child';
    const ground = [$('#bk-dash'), $('#bk-list')];
    const tabs = $('#bk-tabs'); clear(tabs);
    const pane = h('div'); ex.append(pane);
    const KEY = 'daji.bkview';
    const remembered = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    let child = kids[0].id;
    const card = (c) => {
      const box = h('div', { class: 'box bk-box' }, h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, c.academy), h('h4', { class: 'big' }, c.name), h('p', { class: 'hint' }, [c.relation === 'self' ? 'Your own login' : null, c.batch, c.attendance.sessions ? `Attended ${c.attendance.present} of ${c.attendance.sessions} sessions (${c.attendance.percent}%)` : null].filter(Boolean).join('  ·  ')));
      if (!c.cards.length) box.append(h('p', { class: 'hint' }, 'No progress card published yet. Your coach publishes one each month.'));
      for (const p of c.cards) box.append(h('div', { class: 'pcard' }, h('b', {}, monthName(p.month)), h('div', { class: 'rows list' }, p.ratings.map((x) => h('div', { class: 'li' }, h('span', {}, x.skill), h('b', { class: 'dots', title: `${x.rating} out of 5` }, stars(x.rating))))), p.comment ? h('p', { class: 'answer', style: 'margin:12px 0 0' }, p.comment) : null));
      return box;
    };
    const drawAcademy = () => {
      clear(pane);
      pane.append(h('div', { class: 'eyebrow', style: 'margin:0 0 14px' }, `MP13 Academy  ·  ${word}`));
      if (kids.length > 1) pane.append(h('div', { class: 'tabs', style: 'margin:0 0 20px' }, kids.map((k) => h('button', { type: 'button', class: 'tab' + (k.id === child ? ' on' : ''), onclick: () => { child = k.id; drawAcademy(); } }, k.name.split(' ')[0]))));
      pane.append(card(kids.find((k) => k.id === child) || kids[0]));
    };
    const show = (v) => {
      try { localStorage.setItem(KEY, v); } catch { /* storage can be blocked */ }
      for (const el of ground) if (el) el.hidden = v !== 'ground';
      pane.hidden = v !== 'academy';
      for (const b of tabs.children) b.classList.toggle('on', b.dataset.v === v);
      if (v === 'academy') drawAcademy();
    };
    tabs.append(h('button', { type: 'button', class: 'tab', 'data-v': 'ground', onclick: () => show('ground') }, 'Ground'), h('button', { type: 'button', class: 'tab', 'data-v': 'academy', onclick: () => show('academy') }, 'Academy'));
    show(remembered === 'academy' ? 'academy' : 'ground');
  }).catch(() => { /* not a parent, or the academy is off: nothing to show */ });
});

// ================================================================== the page for other ground owners

const FEATURES = [
  ['Online booking and payment', 'Customers pick a slot, pay by card or UPI, and the slot is theirs. Holds expire by themselves. You set slot length, hours and prices per ground.'],
  ['Books that balance', 'Revenue, expenses, balance sheet, trial balance and month-end sign-off. Import bank statements, match UPI deposits to bookings automatically, attach receipts, export to PDF, Excel and CSV.'],
  ['Academy and parents', 'Student list, attendance, monthly progress cards on skills you choose, and a parent view that shows only the cards you publish.'],
  ['Match-day scoring', 'Score ball by ball from a phone. A public live page, scorecards, and your YouTube live stream beside the score.'],
  ['Staff with the right access', 'Give a coach, a front desk or an accountant only what they need. Two-step sign-in for owners and staff. Every change is recorded.'],
  ['Your data stays yours', 'Each owner’s grounds, customers and books are kept apart from every other owner. Daily backups, and your records can be exported at any time.'],
];

function platformPage() {
  const feat = $('#plat-feat'); if (!feat) return;
  for (const [t, d] of FEATURES) feat.append(h('div', { class: 'box' }, h('h5', { class: 'eyebrow', style: 'margin-bottom:12px' }, t), h('p', { class: 'hint', style: 'margin:0;font-size:15px;line-height:1.6' }, d)));
  const f = $('#plat-f'); const errs = {};
  const inp = (name, label, attrs = {}) => { const i = h('input', { name, ...attrs }); errs[name] = h('div', { class: 'fe' }); return h('label', { class: 'field' }, h('span', {}, label), i, errs[name]); };
  const msg = h('textarea', { name: 'message', placeholder: 'How many grounds, what you use today, what you would like to fix' });
  const trap = h('input', { name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', style: 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0' });
  const done = h('div', { class: 'answer', hidden: true }, h('p', {}, 'Thank you. We have your details and will call you soon.'));
  const status = h('div', { class: 'fe formerr', 'aria-live': 'assertive' });
  f.append(h('div', { class: 'two' }, h('div', {}, inp('firstName', 'First name', { autocomplete: 'given-name', required: true }), inp('lastName', 'Last name', { autocomplete: 'family-name' }), inp('business', 'Ground or business name', { required: true }), inp('city', 'City')),
    h('div', {}, inp('phone', 'Phone', { inputmode: 'tel', autocomplete: 'tel', required: true }), inp('email', 'Email', { type: 'email', autocomplete: 'email', required: true }), inp('grounds', 'Number of grounds', { type: 'number', min: 1, max: 500 }))),
    h('label', { class: 'field' }, h('span', {}, 'Anything else'), msg), trap, status, h('button', { class: 'btn primary', type: 'submit' }, 'Send'), done);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!D.formCheck(f, status, errs)) return;
    const send = f.querySelector('button[type=submit]'); D.formClear(f, status, errs); D.busyBtn(send, true, 'Sending…');
    const g = (n) => f.elements[n].value.trim();
    const body = { name: `${g('firstName')} ${g('lastName')}`.trim(), business: g('business'), city: g('city') || undefined, phone: g('phone'), email: g('email'), grounds: g('grounds') ? Number(g('grounds')) : undefined, message: g('message') || undefined, website: g('website') || undefined };
    try { await api('/api/platform/leads', { method: 'POST', body }); D.busyBtn(send, false); f.querySelectorAll('input,textarea,button').forEach((x) => { x.disabled = true; }); done.hidden = false; }
    catch (er) { D.busyBtn(send, false); D.formFail(f, status, er, errs); }
  });
  const cta = $('#plat-cta'); if (cta) cta.addEventListener('click', () => $('#plat-form').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// super admin: who has asked for access
D.registerAdminPanel(() => {
  const wrap = h('div', { class: 'box', style: 'margin-top:24px' }, h('div', { class: 'eyebrow', style: 'margin-bottom:12px' }, 'Requests from ground owners'));
  const list = h('div'); wrap.append(list);
  const run = async () => {
    const r = await load(list, () => api('/api/admin/leads'));
    if (!r) return;
    list.append(tbl(['Who', 'Contact', 'Grounds', 'Status', ''], r.items.map((l) => [h('span', {}, l.business, h('small', { class: 'sub' }, `  ${l.name}${l.city ? ', ' + l.city : ''}`)), `${formatPhone(l.phone)}  ·  ${l.email}`, l.grounds || '',
      sel([['new', 'New'], ['contacted', 'Contacted'], ['demo', 'Demo booked'], ['won', 'Won'], ['lost', 'Lost']], l.status, { class: 'inl', onchange: async (e) => { try { await api('/api/admin/leads/' + l.id, { method: 'PATCH', body: { status: e.target.value } }); toast('Saved'); } catch (er) { fail(er); } } }),
      l.message ? btn('Message', () => openModal([h('h3', {}, l.business), h('p', { class: 'hint' }, l.message)]), 'ghost sm') : '']), [2], 'No requests yet.'));
  };
  run();
  return wrap;
});

// ================================================================== register

D.registerDeskTab({ id: 'academy', label: 'MP13 Academy', perm: 'manage_academy', render: renderAcademy });
D.registerDeskTab({ id: 'matches', label: 'Matches', perm: 'manage_matches', render: renderMatches });
platformPage();
// the live section loads once the page has started
setTimeout(fillLive, 0);
})();
