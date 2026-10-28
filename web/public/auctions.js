// Daji Cricket Ground: auction tournaments for customers (server/src/auction.ts).
// A customer hosts a tournament whose teams are picked at a live player auction; players sign up with their own profile;
// team owners bid in points from their own phone or the host bids for them; the host brings the hammer down.
// The purse and bids are points, never money. Plain JavaScript on window.DAJI, built with h() (no innerHTML).
(() => {
'use strict';
const D = window.DAJI;
if (!D) return;
const { h, clear, $, api, toast, openModal, closeModal, niceDate, todayIst, addDays, state, field, input } = D;

const rs = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pts = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-IN') + ' pts');
const btn = (label, fn, cls = 'outline sm', attrs = {}) => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn, ...attrs }, label);
const fail = (e) => toast((e && e.message) || 'Something went wrong', true);
const section = (title, ...kids) => h('div', { class: 'box bk-box' }, title ? h('div', { class: 'eyebrow' }, title) : null, ...kids);
const sel = (name, opts, value) => { const s = h('select', { name }); for (const [v, l] of opts) s.append(h('option', { value: v, selected: v === value ? true : null }, l)); return s; };
const chip = (text, kind) => h('span', { class: 'chip' + (kind ? ' ' + kind : '') }, text);
const key = () => 'au-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const post = (path, body, idem) => api(path, { method: 'POST', body: body || {}, headers: idem ? { 'Idempotency-Key': key() } : undefined });
const ai = () => D.aiLabel();
const ROLE_OPTS = [['batter', 'Batter'], ['bowler', 'Bowler'], ['all_rounder', 'All-rounder'], ['wicket_keeper', 'Wicket keeper']];
const FORMAT_OPTS = [['round_robin', 'Round robin'], ['knockout', 'Knockout'], ['league_knockout', 'League then knockout'], ['other', 'Other']];

let timer = null, cur = null, version = 0;
const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
const root = () => $('#au-root');

// ------------------------------------------------------------------ the list

async function renderList() {
  stop(); cur = null;
  const el = clear(root());
  el.append(h('div', { class: 'skeleton' }, 'Loading…'));
  let d;
  try { d = await api('/api/auctions'); } catch (e) { clear(el).append(h('p', { class: 'hint err' }, e.message)); return; }
  clear(el);
  el.append(h('div', { class: 'head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Auction tournaments'), h('h2', { class: 'display' }, 'Pick your ', h('em', {}, 'squad.'))),
    h('p', {}, 'Host a tournament where teams are picked at a player auction, or sign up as a player with your profile. Purses and bids are points, not money.')));
  el.append(h('p', { style: 'margin:0 0 24px' }, btn('Host a tournament', () => hostForm(d), 'gold')));
  const card = (a) => h('a', { class: 'box bk-box', href: '#auctions/' + a.id, style: 'display:block;text-decoration:none;color:inherit' },
    h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap' }, h('b', { style: 'font-size:18px' }, a.name), chip(a.statusText, a.hidden ? 'bad' : a.status === 'live' ? 'ok' : '')),
    h('p', { class: 'hint', style: 'margin:8px 0 0' }, `${niceDate(a.startDate)} to ${niceDate(a.endDate)}${a.groundName ? ' · ' + a.groundName : ''} · hosted by ${a.hostName}`),
    h('p', { class: 'hint', style: 'margin:4px 0 0' }, a.mode === 'teams' ? `Teams enter directly · ${a.teams} teams${a.youHost ? ' · you host this' : ''}` : `Player auction · ${a.teams} teams · ${a.players} players signed up · ${a.sold} picked${a.youPlay ? ' · you are signed up' : ''}${a.youHost ? ' · you host this' : ''}`));
  const group = (title, list, empty) => { el.append(h('div', { class: 'eyebrow', style: 'margin:24px 0 12px' }, title)); if (!list.length) el.append(h('div', { class: 'empty' }, empty)); else for (const a of list) el.append(card(a)); };
  if (d.hosting.length) group('You host', d.hosting, '');
  const mine = [...d.playing, ...d.teamsYouOwn.filter((a) => !d.playing.some((p) => p.id === a.id))];
  if (mine.length) group('You play or own a team', mine, '');
  group('Open now', d.open.filter((a) => !a.youHost), 'No auction tournaments are open right now. Host one!');
}

function hostForm(d) {
  const f = h('form', { novalidate: true });
  const name = input('name', 'text', { maxlength: '100', required: true, placeholder: 'Gully Premier League' });
  const ground = sel('groundId', d.grounds.map((g) => [g.id, g.name]), d.grounds[0] && d.grounds[0].id);
  const start = input('startDate', 'date', { value: addDays(todayIst(), 14), min: todayIst() });
  const end = input('endDate', 'date', { value: addDays(todayIst(), 15), min: todayIst() });
  const overs = input('overs', 'number', { value: '10', min: '1', max: '50' });
  const format = sel('format', FORMAT_OPTS, 'round_robin');
  const mode = sel('mode', [['auction', 'Teams are picked at a player auction'], ['teams', 'Teams enter directly']], 'auction');
  const err = h('div', { class: 'hint err' });
  const save = h('button', { class: 'btn gold', type: 'submit' }, 'Create and open sign-up');
  f.append(field('How teams are made', mode), field('Tournament name', name), field('Ground', ground), h('div', { class: 'two' }, field('Starts', start), field('Ends', end)), h('div', { class: 'two' }, field('Overs a side', overs), field('Format', format)),
    h('div', { class: 'eyebrow', style: 'margin:18px 0 8px' }, 'Starting rules for an auction'), h('ol', { class: 'hint', style: 'margin:0 0 8px;padding-left:18px' }, d.defaultsInWords.map((t) => h('li', {}, t))),
    h('p', { class: 'hint' }, `You can change any rule before the bidding starts, on the form or by asking ${ai()}. Book the ground for match days on the Book page as usual.`),
    d.depositPaise ? h('p', { class: 'hint', style: 'font-weight:600' }, `To host, you put down a refundable deposit of ${rs(d.depositPaise)}. Players see your tournament once it is paid (or the ground waives it). It is given back when the tournament ends; the ground keeps it only if the matches are not played at Daji.`) : null, err, save);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; save.disabled = true;
    try {
      const a = await post('/api/auctions', { mode: mode.value, name: name.value.trim(), groundId: ground.value, startDate: start.value, endDate: end.value, overs: Number(overs.value), format: format.value }, true);
      closeModal(); toast(a.auction.depositSettled ? 'Tournament created. It is open now.' : 'Tournament created. Pay the deposit to open it to players.'); location.hash = '#auctions/' + a.auction.id;
    } catch (x) { err.textContent = x.message; save.disabled = false; }
  });
  openModal(h('div', {}, h('h3', { style: 'margin:0 0 14px' }, 'Host an auction tournament'), f));
}

// ------------------------------------------------------------------ one auction

async function renderOne(id, quiet) {
  if (!quiet) { stop(); clear(root()).append(h('div', { class: 'skeleton' }, 'Loading…')); version = 0; }
  let v;
  try { v = await api(`/api/auctions/${id}${quiet && version ? '?since=' + version : ''}`); }
  catch (e) { if (!quiet) clear(root()).append(h('p', { class: 'hint err' }, e.message), h('p', {}, h('a', { href: '#auctions' }, 'Back to auctions'))); schedule(id, 10000); return; }
  if (v.changed !== false) { cur = v; version = v.version; draw(v); }
  schedule(id, cur && cur.auction.status === 'live' ? 2000 : 15000);
}
function schedule(id, ms) {
  stop();
  timer = setTimeout(() => { if (location.hash === '#auctions/' + id && document.visibilityState !== 'hidden') renderOne(id, true); else if (location.hash === '#auctions/' + id) schedule(id, ms); }, ms);
}
const act = async (fn, msg) => { try { const v = await fn(); if (v && v.auction) { cur = v; version = v.version; draw(v); } if (msg) toast(msg); return v; } catch (e) { fail(e); return null; } };

function draw(v) {
  const el = clear(root());
  const a = v.auction, id = a.id, host = v.isHost;
  el.append(h('p', { style: 'margin:0 0 12px' }, h('a', { href: '#auctions' }, '← All tournaments')));
  el.append(h('div', { class: 'head' }, h('div', {}, h('div', { class: 'eyebrow' }, a.mode === 'teams' ? 'Hosted tournament' : 'Auction tournament'), h('h2', { class: 'display' }, a.name)),
    h('p', {}, `${niceDate(a.startDate)} to ${niceDate(a.endDate)}${a.groundName ? ' · ' + a.groundName : ''} · ${v.tournament.overs} overs · hosted by ${a.hostName}`, ' ', chip(a.statusText, a.hidden ? 'bad' : a.status === 'live' ? 'ok' : ''))));
  if (a.hidden && host) el.append(h('div', { class: 'box bk-box', role: 'alert' }, h('b', {}, 'The ground has hidden this auction. '), v.hiddenReason || '', ' Players cannot see it. Call the ground to sort it out.'));
  if (a.status === 'cancelled') el.append(h('div', { class: 'box bk-box', role: 'status' }, h('b', {}, 'Cancelled. '), v.cancelledReason || ''));

  if (host && v.deposit) el.append(depositBox(v));
  if (a.status === 'live') el.append(liveBox(v));
  if (host && !a.hidden) el.append(hostBox(v));
  el.append(rulesBox(v));
  el.append(teamsBox(v));
  if (a.mode === 'auction') el.append(playersBox(v));
  if (a.status === 'completed') el.append(tournamentBox(v));
}

// ---- the bidding
function liveBox(v) {
  const box = section('Live auction');
  const lot = v.lot;
  if (!lot) {
    box.append(h('p', {}, v.morePlayersToCome ? 'Waiting for the host to bring the next player up.' : 'Every player has come up. The host can finish the auction.'));
  } else {
    const p = lot.player;
    const pic = h('span', { class: 'avatar', style: 'width:72px;height:72px;font-size:30px' }, p.avatarUrl ? h('img', { src: (window.DAJI_API || '') + p.avatarUrl, alt: '' }) : p.name[0]);
    const left = h('span', { class: 'chip', 'aria-live': 'polite' });
    const tick = () => { const s = Math.max(0, Math.ceil(((lot.startedAt || Date.now()) + v.rules.bidTimerSeconds * 1000 - Date.now()) / 1000)); left.textContent = s ? `${s}s on the clock` : 'Time is up'; if (s && root().contains(left)) setTimeout(tick, 1000); };
    tick();
    box.append(h('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap' }, pic, h('div', {},
      h('div', { style: 'font-size:22px;font-weight:600' }, p.name), h('div', { class: 'hint' }, [p.roleText, p.batting ? `${p.batting}-hand bat` : null, p.bowling].filter(Boolean).join(' · ')),
      h('div', { class: 'hint' }, `Round ${lot.round}`))),
      h('div', { style: 'margin:16px 0;font-size:20px' }, lot.bidPoints ? h('span', {}, 'Highest bid ', h('b', {}, pts(lot.bidPoints)), ' by ', h('b', {}, lot.bidTeamName)) : h('span', {}, 'No bid yet. Opening bid ', h('b', {}, pts(lot.nextMinimumPoints))), ' ', left));
    const bidFor = (t) => {
      const amt = h('input', { type: 'number', min: String(lot.nextMinimumPoints), step: '1', value: String(lot.nextMinimumPoints), style: 'width:120px', 'aria-label': `Bid for ${t.name} in points` });
      const can = !t.full && t.maxBidPoints >= lot.nextMinimumPoints && lot.bidTeamId !== t.id;
      return h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0' }, h('b', { style: 'min-width:140px' }, t.name), amt,
        btn(`Bid ${pts(lot.nextMinimumPoints)}`, () => act(() => post(`/api/auctions/${v.auction.id}/bid`, { teamId: t.id, points: Number(amt.value) || lot.nextMinimumPoints, lotNo: lot.lotNo }, true)), 'gold sm', can ? {} : { disabled: true }),
        h('span', { class: 'hint' }, t.full ? 'Squad full' : lot.bidTeamId === t.id ? 'Highest bid' : `Up to ${pts(t.maxBidPoints)}`));
    };
    const mine = v.teams.filter((t) => t.ownerIsYou);
    if (v.isHost) { box.append(h('div', { class: 'eyebrow', style: 'margin:8px 0' }, 'Bid for a team')); for (const t of v.teams) box.append(bidFor(t)); }
    else if (mine.length) for (const t of mine) box.append(bidFor(t));
    if (lot.bids.length) box.append(h('div', { class: 'list', style: 'margin-top:12px' }, lot.bids.map((b) => h('div', { class: 'li' }, h('span', {}, b.teamName), h('b', {}, pts(b.points))))));
  }
  if (v.recent.length) box.append(h('div', { class: 'eyebrow', style: 'margin:18px 0 8px' }, 'Latest results'), h('div', { class: 'list' }, v.recent.map((r) => h('div', { class: 'li' }, h('span', {}, r.player), h('b', {}, r.result === 'sold' ? `${r.teamName}, ${pts(r.points)}` : 'Unsold')))));
  return box;
}

// ---- what only the host does
function hostBox(v) {
  const a = v.auction, id = a.id, box = section('Host controls');
  const reasonThen = (title, path, done) => {
    const r = h('input', { type: 'text', maxlength: '200', placeholder: 'Reason' });
    openModal(h('div', {}, h('h3', {}, title), field('Reason', r), h('p', {}, btn(title, async () => { const out = await act(() => post(path, { reason: r.value.trim() })); if (out) { closeModal(); if (done) toast(done); } }, 'gold'))));
  };
  if (a.status === 'registration' && a.mode === 'teams') {
    box.append(h('p', { class: 'hint' }, `${v.teams.length} teams entered. When the entries are in, confirm the teams; they go into the tournament and you can make the fixtures.`),
      h('div', { class: 'bar' }, btn('Confirm the teams', () => { if (confirm('Confirm the teams? Entries close.')) act(() => post(`/api/auctions/${id}/finish`, {}, true), 'Teams confirmed.'); }, 'gold', a.depositSettled ? {} : { disabled: true }),
        btn('Cancel the tournament', () => reasonThen('Cancel the tournament', `/api/auctions/${id}/cancel`, 'Cancelled.'), 'outline sm')));
  } else if (a.status === 'registration') {
    box.append(h('p', { class: 'hint' }, `${a.players} players have signed up for ${v.teams.length} teams. Start the bidding when everyone is in; sign-up and the rules close then.`),
      h('div', { class: 'bar' }, btn('Start the bidding', () => { if (confirm('Start the bidding now? Sign-up and the rules close.')) act(() => post(`/api/auctions/${id}/start`), 'The auction is live.'); }, 'gold'),
        btn('Cancel the tournament', () => reasonThen('Cancel the tournament', `/api/auctions/${id}/cancel`, 'Cancelled. The players were told.'), 'outline sm')));
  } else if (a.status === 'live') {
    const lot = v.lot;
    box.append(h('div', { class: 'bar' },
      lot ? btn(lot.bidPoints ? `Sold to ${lot.bidTeamName} for ${pts(lot.bidPoints)}` : 'Unsold: nobody bid', () => act(() => post(`/api/auctions/${id}/hammer`, {}, true)), 'gold') : btn('Bring the next player up', () => act(() => post(`/api/auctions/${id}/next`)), 'gold', v.morePlayersToCome ? {} : { disabled: true }),
      lot && lot.bidPoints ? btn('Take back the highest bid', () => act(() => post(`/api/auctions/${id}/bid/retract`))) : null,
      !lot ? btn('Undo the last result', () => { if (confirm('Undo the last sale or unsold? That player can come up again.')) act(() => post(`/api/auctions/${id}/undo`, {}, true)); }) : null,
      !lot ? btn('Finish the auction', () => { if (confirm('Finish the auction? The teams go into the tournament and bidding ends.')) act(async () => { const out = await post(`/api/auctions/${id}/finish`, {}, true); if (out.shortTeams && out.shortTeams.length) toast(`Short of players: ${out.shortTeams.map((t) => `${t.name} (${t.squad} of ${t.needed})`).join(', ')}`, true); return out; }, 'Auction finished.'); }) : null,
      btn('Cancel the tournament', () => reasonThen('Cancel the tournament', `/api/auctions/${id}/cancel`, 'Cancelled.'), 'outline sm')));
    if (!lot) {
      const pool = v.players.filter((p) => p.status === 'registered' && p.result !== 'sold');
      if (pool.length) {
        const pick = sel('playerId', pool.map((p) => [p.id, `${p.name} (${p.roleText}${p.result === 'unsold' ? ', unsold' : ''})`]), pool[0].id);
        box.append(h('div', { class: 'bar', style: 'margin-top:10px' }, pick, btn('Bring this player up', () => act(() => post(`/api/auctions/${id}/next`, { playerId: pick.value })))));
      }
    }
  }
  return box;
}

// ---- rules: the form, and changes drafted by Platform AI that the host confirms
function rulesBox(v) {
  const box = section('Rules');
  box.append(h('ol', { style: 'margin:0;padding-left:18px' }, v.rulesInWords.map((t) => h('li', { style: 'margin:4px 0' }, t))));
  if (!v.canEditRules) return box;
  const id = v.auction.id;
  const ask = h('textarea', { rows: '2', maxlength: '600', placeholder: v.auction.mode === 'teams' ? 'For example: up to 6 teams, add rule: every team brings its own ball' : 'For example: purse 20,000 points, squads of 12 to 16, bids go up by 100 after 2,000', style: 'width:100%' });
  const out = h('div', { 'aria-live': 'polite' });
  const draft = async () => {
    clear(out).append(h('div', { class: 'hint' }, 'Drafting…'));
    try {
      const d = await post(`/api/auctions/${id}/rules/draft`, { text: ask.value });
      clear(out);
      if (!d.rules) { out.append(h('p', { class: d.refused ? 'hint err' : 'hint' }, d.message)); return; }
      out.append(h('p', {}, `${ai()} drafted this change. Nothing is saved until you confirm.`),
        h('div', { class: 'list' }, d.changes.map((c) => h('div', { class: 'li' }, h('span', {}, c.label), h('b', {}, `${c.from} → ${c.to}`)))),
        h('div', { class: 'bar', style: 'margin-top:10px' }, btn('Confirm the change', () => act(() => post(`/api/auctions/${id}/rules`, { rules: d.rules, expectVersion: d.rulesVersion, source: 'ai', request: ask.value }), 'Rules changed.'), 'gold sm'), btn('Discard', () => clear(out))));
    } catch (e) { clear(out).append(h('p', { class: 'hint err' }, e.message)); }
  };
  box.append(h('div', { class: 'eyebrow', style: 'margin:18px 0 8px' }, `Change the rules with ${ai()}`), ask, h('div', { class: 'bar', style: 'margin-top:8px' }, btn('Draft the change', draft, 'gold sm'), btn('Edit on the form', () => rulesForm(v))), out);
  return box;
}
function rulesForm(v) {
  const r = v.rules, f = h('form', { novalidate: true }), err = h('div', { class: 'hint err' });
  const num = (k, attrs = {}) => input(k, 'number', { value: r[k] === null ? '' : String(r[k]), min: '0', ...attrs });
  const els = { teamCount: num('teamCount', { min: '2', max: '16' }), squadMin: num('squadMin', { min: '1' }), squadMax: num('squadMax', { min: '1' }), pursePoints: num('pursePoints'), basePoints: num('basePoints'), bidTimerSeconds: num('bidTimerSeconds', { min: '5', max: '300' }), maxPlayers: num('maxPlayers', { placeholder: 'No limit' }) };
  const steps = input('increments', 'text', { value: r.increments.map((i) => `${i.fromPoints}:${i.step}`).join(', ') });
  const unsold = h('input', { type: 'checkbox', checked: r.unsoldRound ? true : null }), reserve = h('input', { type: 'checkbox', checked: r.reserveForSquad ? true : null });
  const order = sel('playerOrder', [['random', 'Random'], ['registration', 'Sign-up order'], ['role', 'By role']], r.playerOrder);
  const closes = input('registrationCloses', 'date', { value: r.registrationCloses || '' });
  const house = h('textarea', { rows: '3', maxlength: '1500', style: 'width:100%' }, r.houseRules);
  const save = h('button', { class: 'btn gold', type: 'submit' }, 'Save the rules');
  // teams entering directly: only the number of teams and the house rules apply; the auction settings stay as they are
  const auctionOnly = h('div', { style: v.auction.mode === 'teams' ? 'display:none' : '' }, h('div', { class: 'two' }, field('Smallest squad', els.squadMin), field('Largest squad', els.squadMax)),
    h('div', { class: 'two' }, field('Base price (points)', els.basePoints), field('Bid clock (seconds)', els.bidTimerSeconds)), field('Bid steps (from points:step, …)', steps),
    h('div', { class: 'two' }, field('Order players come up', order), field('Sign-up closes', closes)), field('Most players who can sign up', els.maxPlayers),
    h('label', { class: 'check' }, unsold, ' Unsold players come back once at the end'), h('label', { class: 'check' }, reserve, ' A team keeps enough points to fill its smallest squad'));
  f.append(h('div', { class: 'two' }, field('Teams', els.teamCount), v.auction.mode === 'teams' ? null : field('Purse per team (points)', els.pursePoints)), auctionOnly, field('House rules', house), err, save);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    const incs = steps.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [a, b] = x.split(':').map((y) => Number(y.replace(/[^\d]/g, ''))); return { fromPoints: a, step: b }; });
    const body = { teamCount: Number(els.teamCount.value), squadMin: Number(els.squadMin.value), squadMax: Number(els.squadMax.value), pursePoints: Number(els.pursePoints.value), basePoints: Number(els.basePoints.value), bidTimerSeconds: Number(els.bidTimerSeconds.value),
      maxPlayers: els.maxPlayers.value ? Number(els.maxPlayers.value) : null, increments: incs, unsoldRound: unsold.checked, reserveForSquad: reserve.checked, playerOrder: order.value, registrationCloses: closes.value || null, houseRules: house.value };
    save.disabled = true;
    try { const out = await post(`/api/auctions/${v.auction.id}/rules`, { rules: body, expectVersion: v.rulesVersion, source: 'form' }); closeModal(); cur = out; version = out.version; draw(out); toast(out.changes.length ? 'Rules saved.' : 'Nothing changed.'); }
    catch (x) { err.textContent = x.message; save.disabled = false; }
  });
  openModal(h('div', {}, h('h3', { style: 'margin:0 0 14px' }, v.auction.mode === 'teams' ? 'Tournament rules' : 'Auction rules'), f), { wide: true });
}

// ---- the hosting deposit (real money, unlike the points): what is due, how to pay, a waiver request, and what was given back
function depositBox(v) {
  const dep = v.deposit, id = v.auction.id, pay = v.depositHowToPay || {};
  const box = section('Hosting deposit');
  if (!dep.requiredPaise) { box.append(h('p', { class: 'hint' }, 'No deposit is needed.')); return box; }
  if (dep.waived) box.append(h('p', {}, 'The ground waived the deposit.'));
  else if (!dep.settled) {
    const due = dep.requiredPaise - dep.collectedPaise;
    box.append(h('p', {}, h('b', {}, `${rs(due)} to pay. `), 'Players see your tournament once it is paid. It is refundable: you get it back when the tournament ends, unless the matches are not played at Daji.'),
      h('p', { class: 'hint' }, `Pay at the ground, or by UPI${pay.upiId ? ` to ${pay.upiId} (${pay.payee})` : ''} and send the reference below. Questions: ${pay.contactName} ${pay.contactPhone}.`));
    if (dep.claimReference) box.append(h('p', { class: 'hint' }, `You sent reference ${dep.claimReference}. The ground will check it.`));
    const ref = input('reference', 'text', { maxlength: '60', placeholder: 'UPI or bank reference' });
    box.append(h('div', { class: 'bar' }, ref, btn('I have paid', () => act(async () => { await post(`/api/auctions/${id}/deposit/paid`, { reference: ref.value.trim() }); return api(`/api/auctions/${id}`); }, 'Sent. The ground will check it.'), 'gold sm')));
    if (dep.waiver && dep.waiver.status === 'pending') box.append(h('p', { class: 'hint' }, 'Your request to waive the deposit is with the ground.'));
    else if (!dep.collectedPaise) {
      if (dep.waiver && dep.waiver.status === 'declined') box.append(h('p', { class: 'hint err' }, `The ground did not waive it: ${dep.waiver.decisionNote || ''}`));
      const why = h('textarea', { rows: '2', maxlength: '500', placeholder: 'Why should the deposit be waived?', style: 'width:100%' });
      box.append(h('details', {}, h('summary', { class: 'hint' }, 'Ask the ground to waive it'), why, h('p', {}, btn('Send the request', () => act(async () => { await post(`/api/auctions/${id}/deposit/waiver`, { reason: why.value.trim() }, true); return api(`/api/auctions/${id}`); }, 'Request sent.')))));
    }
  } else box.append(h('p', {}, `The ground holds ${rs(dep.heldPaise)} of your deposit. You get it back when the tournament ends.`));
  const words = { collect: 'Paid', refund: 'Given back', keep: 'Kept' };
  if (dep.entries.length) box.append(h('div', { class: 'list' }, dep.entries.map((e) => h('div', { class: 'li' }, h('span', {}, `${words[e.kind]} ${niceDate(new Date(e.createdAt + 19800000).toISOString().slice(0, 10))}${e.reason ? ': ' + e.reason : ''}`), h('b', {}, rs(e.amountPaise))))));
  return box;
}

// ---- teams
function teamsBox(v) {
  const box = section(`Teams (${v.teams.length} of ${v.rules.teamCount})`), id = v.auction.id, edit = v.isHost && v.auction.status === 'registration' && !v.auction.hidden;
  if (!v.teams.length) box.append(h('div', { class: 'empty' }, v.isHost ? (v.auction.mode === 'teams' ? 'Add each team that enters, with its captain if you like.' : 'Add the teams and their owners. An owner with a Daji account bids from their own phone; for any other team you bid for them.') : 'The host has not added the teams yet.'));
  for (const t of v.teams) {
    box.append(h('div', { style: 'border-top:1px solid var(--line);padding:12px 0' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap' }, h('b', {}, t.name, t.ownerIsYou ? ' (your team)' : ''), h('span', { class: 'hint' }, `${t.ownerName ? 'Owner ' + t.ownerName + ' · ' : ''}${t.squad} players · ${pts(t.pursePointsLeft)} left`)),
      t.players.length ? h('div', { class: 'hint', style: 'margin-top:4px' }, t.players.map((p) => `${p.name} (${pts(p.points)})`).join(', ')) : null,
      edit ? h('div', { class: 'bar', style: 'margin-top:6px' }, btn('Remove', () => { if (confirm(`Remove ${t.name}?`)) act(() => api(`/api/auctions/${id}/teams/${t.id}`, { method: 'DELETE' })); })) : null));
  }
  if (edit && v.teams.length < v.rules.teamCount) {
    const name = input('name', 'text', { maxlength: '50', placeholder: 'Team name' }), oname = input('ownerName', 'text', { maxlength: '80', placeholder: 'Owner name (optional)' }), ophone = input('ownerPhone', 'tel', { maxlength: '20', placeholder: 'Owner phone, if they have a Daji account' });
    box.append(h('div', { class: 'bar', style: 'margin-top:12px;flex-wrap:wrap' }, name, oname, ophone, btn('Add team', () => act(async () => { const out = await post(`/api/auctions/${id}/teams`, { name: name.value.trim(), ownerName: oname.value.trim() || undefined, ownerPhone: ophone.value.trim() || undefined }); return out; }), 'gold sm')));
  }
  return box;
}

// ---- players
function playersBox(v) {
  const a = v.auction, id = a.id;
  const box = section(`Players (${a.players})`);
  const me = v.players.find((p) => p.isYou && p.status === 'registered');
  if (a.signUpOpen && !me) {
    const role = sel('role', ROLE_OPTS, 'batter'), bat = sel('batting', [['', 'Batting hand'], ['right', 'Right-hand bat'], ['left', 'Left-hand bat']], ''), bowl = input('bowling', 'text', { maxlength: '40', placeholder: 'Bowling, e.g. Off spin' });
    box.append(h('p', { class: 'hint' }, `Sign up with your Daji profile (${state.user.name}). Your name, picture and role are shown to everyone in this auction; your phone and email are not.`),
      h('div', { class: 'bar', style: 'flex-wrap:wrap' }, role, bat, bowl, btn('Sign up as a player', () => act(() => post(`/api/auctions/${id}/join`, { role: role.value, batting: bat.value || undefined, bowling: bowl.value.trim() || undefined }, true), 'You are signed up.'), 'gold sm')));
  } else if (me && a.status === 'registration') box.append(h('p', {}, 'You are signed up as ', h('b', {}, me.roleText), '. ', btn('Leave this auction', () => { if (confirm('Leave this auction?')) act(() => post(`/api/auctions/${id}/leave`), 'You left the auction.'); })));
  else if (me && me.result === 'sold') box.append(h('p', {}, 'You were picked by ', h('b', {}, me.teamName), ' for ', h('b', {}, pts(me.points)), '.'));
  const list = v.players.filter((p) => p.status === 'registered');
  if (!list.length) box.append(h('div', { class: 'empty' }, 'Nobody has signed up yet.'));
  for (const p of list) {
    box.append(h('div', { class: 'li', style: 'display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)' },
      h('span', { class: 'avatar', style: 'width:32px;height:32px;font-size:14px' }, p.avatarUrl ? h('img', { src: (window.DAJI_API || '') + p.avatarUrl, alt: '' }) : p.name[0]),
      h('span', { style: 'flex:1' }, h('b', {}, p.name), p.isYou ? ' (you)' : '', h('span', { class: 'hint' }, ' · ' + [p.roleText, p.batting ? `${p.batting}-hand bat` : null, p.bowling].filter(Boolean).join(' · '))),
      p.result === 'sold' ? chip(`${p.teamName} · ${pts(p.points)}`, 'ok') : p.result === 'unsold' ? chip('Unsold') : null,
      v.isHost && a.status === 'registration' && !a.hidden ? btn('Remove', () => { const r = prompt(`Why are you taking ${p.name} off the auction?`); if (r) act(() => post(`/api/auctions/${id}/players/${p.id}/remove`, { reason: r })); }) : null));
  }
  return box;
}

// ---- after the auction: the tournament
function tournamentBox(v) {
  const box = section('Tournament'), id = v.auction.id;
  box.append(h('div', { class: 'skeleton' }, 'Loading…'));
  api(`/api/auctions/${id}/tournament`).then((t) => {
    clear(box).append(h('div', { class: 'eyebrow' }, 'Tournament'));
    if (!t.fixtures.length) {
      box.append(h('p', { class: 'hint' }, 'No fixtures yet.'));
      if (v.isHost) { const d = input('startDate', 'date', { value: v.tournament.startDate }); box.append(h('div', { class: 'bar' }, d, btn('Make round-robin fixtures', () => act(async () => { const out = await post(`/api/auctions/${id}/fixtures`, { startDate: d.value }); toast(out.note); renderOne(id); return null; }), 'gold sm'))); }
    } else box.append(h('div', { class: 'list' }, t.fixtures.map((f) => h('div', { class: 'li' }, h('span', {}, `Round ${f.round}: ${f.teamA} v ${f.teamB}`), h('b', {}, f.played ? (f.resultText || (f.winner ? `${f.winner} won` : 'Played')) : 'To play')))));
    if (t.table.some((r) => r.played)) box.append(h('div', { class: 'eyebrow', style: 'margin:16px 0 8px' }, 'Points table'), h('div', { class: 'list' }, t.table.map((r) => h('div', { class: 'li' }, h('span', {}, r.team), h('b', {}, `${r.points} pts · ${r.won}W ${r.lost}L`)))));
    box.append(h('p', { class: 'hint', style: 'margin-top:10px' }, 'Book the ground for your match days on the Book page. The ground staff record the results.'));
  }).catch((e) => { clear(box).append(h('p', { class: 'hint err' }, e.message)); });
  return box;
}

D.registerAuctions((id) => { if (id) renderOne(id); else renderList(); });
})();
