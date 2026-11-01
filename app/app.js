import { Timetable, fmt, INF } from './engine.js';
import { t, th, raw, dur, minutes, num, dayLabel, errText, setLang, initialLang, onLang, applyStatic, LANGS, lang } from './i18n.js';
import { DataStore, gunzip, describeAge } from './data-store.js';
import { MANIFEST_KEYS } from './keys.js';
import { initLive } from './live.js';
import { initNavigate } from './navigate.js';
import { berlinClock, tick as clockStep, atLaunch, onReturn, migrate } from './here.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toMin = v => { const [h, m] = (v || '06:00').split(':').map(Number); return h * 60 + m; };

const DEFAULTS = { date: '', src: '', dst: '', via: '', t0: '06:00', stay: 180, tr: 4 };
let tt, state, store, manifest, uiReady = false, lastCheck = 0, lastPlan = null, reachCache = null, live = null, nav = null;
let fromSource = '';      // where "I am at" came from: 'gps' (the device said so), 'manual' (a station was picked) or ''
let lastLocate = 0;       // when the device was last asked for the position, to keep the silent asks apart

function loadState() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem('ct-state') || 'null'); } catch { raw = null; }
  return migrate(raw, DEFAULTS);
}
function saveState() { try { localStorage.setItem('ct-state', JSON.stringify(state)); } catch { /* storage unavailable */ } }

// ---- station picker ----
function picker(input, onPick) {
  const list = input.parentElement.querySelector('.sugg');
  let items = [], idx = -1;
  const draw = () => {
    list.innerHTML = items.map((s, k) => `<li data-i="${s}" class="${k === idx ? 'on' : ''}">${esc(tt.names[s])}</li>`).join('');
    list.hidden = !items.length;
  };
  const choose = s => {
    input.value = tt.names[s]; input.dataset.st = s; list.hidden = true; items = []; idx = -1;
    onPick && onPick(s);
  };
  input.addEventListener('input', () => { input.dataset.st = ''; items = tt.search(input.value, 8); idx = -1; draw(); });
  input.addEventListener('focus', () => { input.select(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items.length) { choose(items[Math.max(0, idx)]); e.preventDefault(); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  list.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { choose(+li.dataset.i); e.preventDefault(); } });
  list.addEventListener('touchstart', e => { const li = e.target.closest('li'); if (li) { choose(+li.dataset.i); e.preventDefault(); } }, { passive: false });
  return {
    get() { const s = input.dataset.st; if (s !== undefined && s !== '') return +s; return input.value.trim() ? tt.find(input.value.trim()) : -1; },
    set(s) { if (s >= 0) { input.value = tt.names[s]; input.dataset.st = s; } else { input.value = ''; input.dataset.st = ''; } },
  };
}

let pSrc, pDst, pVia;

function currentInputs() {
  return {
    day: +$('#date').value, src: pSrc.get(), dst: pDst.get(), via: pVia.get(),
    t0: toMin($('#t0').value), stay: Math.max(0, +$('#stay').value || 0), tr: Math.max(0, +$('#tr').value || 0),
  };
}

function persist() {
  state.date = tt.dateOf(+$('#date').value);
  state.src = $('#src').value; state.dst = $('#dst').value; state.via = $('#via').value;
  state.now = $('#nowon').checked; state.from = fromSource;
  if (!state.now) state.t0 = $('#t0').value;     // a time that follows the clock is not kept: it would be old at the next visit
  state.stay = +$('#stay').value; state.tr = +$('#tr').value;
  saveState();
}

// ---- where and when: one bar for every tab ----
// What the bar says, for the tabs.
const place = () => ({ src: pSrc.get(), dst: pDst.get(), day: +$('#date').value, t0: toMin($('#t0').value) });

function setDay(iso) {
  const d = tt.dayIndex(iso);
  $('#date').value = d >= 0 && d < tt.nDays ? d : (d < 0 ? 0 : tt.nDays - 1);
}
function setNow(on) { $('#nowon').checked = on; }
// The date and the time of the bar follow the clock of Germany.
function applyClock() {
  const c = berlinClock();
  setDay(c.iso);
  $('#t0').value = c.hm;
}

// Put a place, a day and a time into the bar, for a way chosen somewhere else (a leg of a chain, Navigate, the position of
// the device). now: true makes the date and the time follow the clock; a time given by hand turns that off. Nothing is
// drawn: the caller draws what it wants to show.
function setPlace({ src, dst, day, time, now, from }) {
  if (src !== undefined) pSrc.set(src);
  if (dst !== undefined) pDst.set(dst);
  if (from !== undefined) fromSource = from;
  if (now === true) { setNow(true); applyClock(); }
  else if (now === false) setNow(false);
  if (day !== undefined) $('#date').value = day;
  if (time !== undefined) $('#t0').value = time;
  persist();
}

// Draw the tab that is shown. The chain is worked out for the reach map as well, which draws it over the dots.
function renderTab() {
  if (!tt || !uiReady) return;
  const shown = ['live', 'chain', 'deps', 'reach'].find(n => !$('#pane-' + n).hidden);
  if (shown === 'live') live.run();
  else if (shown === 'chain') runPlan();
  else if (shown === 'deps') drawDeps();
  else if (shown === 'reach') { runPlan(); drawReach(); }
}

// A tick of the clock: when the bar follows it and the minute has moved, the bar moves and the tab is drawn again.
function clockTick() {
  if (!tt || !uiReady) return;
  const next = clockStep({ nowOn: $('#nowon').checked, shown: { iso: tt.dateOf(+$('#date').value), hm: $('#t0').value }, clock: berlinClock() });
  if (!next) return;
  applyClock();
  persist();
  renderTab();
}

async function geoGranted() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch { return false; }
}
// The page is open again after a while: the clock catches up and a position from the device is read again, when the
// device lets that happen without a question.
async function comeBack() {
  clockTick();
  if (!tt || !uiReady || Date.now() - lastLocate < 60000) return;
  if (onReturn({ source: fromSource, granted: await geoGranted() }) === 'locate') { lastLocate = Date.now(); live.locate(true); }
}
// The first build is in. A position from the last visit is old: ask the device again if it lets that happen without a
// question, drop it if it does not, and leave a station somebody picked.
async function launchPlace() {
  const what = atLaunch({ source: state.from, granted: await geoGranted(), hasPlace: pSrc.get() >= 0 });
  if (what === 'keep') return;
  pSrc.set(-1); fromSource = ''; persist(); renderTab();
  if (what === 'locate') { lastLocate = Date.now(); live.locate(true); }
}

// ---- chain ----
function runPlan() {
  const q = currentInputs();
  const out = $('#chainres');
  persist();
  if (q.src < 0 || q.dst < 0) {
    const started = $('#src').value.trim() || $('#dst').value.trim();
    out.innerHTML = started
      ? `<div class="err">${th('chain.pickBoth')}</div>`
      : `<p class="note">${th('chain.intro')}</p>`;
    lastPlan = null;
    return;
  }
  const res = tt.plan({ day: q.day, src: q.src, dst: q.dst, t0: q.t0, via: q.via, stayMin: q.stay, minTransfer: q.tr });
  lastPlan = { res, q };
  reachCache = null;
  if (res.error) { out.innerHTML = `<div class="err">${esc(errText(res))}</div>`; return; }
  out.innerHTML = renderChain(res, q);
}

const hm = m => fmt(((m % 1440) + 1440) % 1440);
const dayName = (day, m) => dayLabel(tt.dateOf(day + Math.floor(m / 1440)));

function renderChain(res, q) {
  const legs = res.legs, first = legs[0], last = legs[legs.length - 1];
  const rides = legs.filter(l => !l.walk).length;
  const changes = Math.max(0, rides - 1 - res.stays.length);
  const day0 = Math.floor(first.dep / 1440);
  let h = '';
  if (day0 > 0) h += `<div class="err">${th('chain.noTrainToday', { from: tt.names[q.src], day: dayName(q.day, 0), time: hm(q.t0), first: dayName(q.day, first.dep) })}</div>`;
  const arrDay = Math.floor(last.arr / 1440) > day0 ? ` (${dayName(q.day, last.arr)})` : '';
  h += `<div class="sum"><div><b>${th('chain.timeRange', { dep: hm(first.dep), arr: hm(last.arr) })}${esc(arrDay)}</b><br><span>${th('leg.fromTo', { from: tt.names[q.src], to: tt.names[q.dst] })}</span></div>
    <div><b>${esc(dur(last.arr - first.dep))}</b><br><span>${th('chain.onTheWay')}</span></div>
    <div><b>${changes}</b><br><span>${th(res.stays.length ? 'chain.changesStop' : 'chain.changes', { n: changes })}</span></div></div><p class="navstart"><button type="button" data-follow>${th('nav.follow')}</button></p><ol class="chain">`;
  let curDay = day0;
  if (day0 > 0) h += `<li class="wait">${esc(dayName(q.day, first.dep))}</li>`;
  legs.forEach((l, i) => {
    const ld = Math.floor(l.dep / 1440);
    if (i > 0) {
      const p = legs[i - 1];
      const st = res.stays.find(s => s.station === l.from && p.to === l.from && Math.abs(s.dep - l.dep) < 1);
      if (st) h += `<li class="stay">${th('chain.stay', { station: raw(`<b>${esc(tt.names[st.station])}</b>`), arr: raw(`<span class="t">${hm(st.arr)}</span>`), dep: raw(`<span class="t">${hm(st.dep)}</span>`), dur: dur(st.dep - st.arr) })}</li>`;
      else if (!l.walk && !p.walk) { const w = l.dep - p.arr; const tight = w <= q.tr + 2; h += `<li class="wait${tight ? ' tight' : ''}">${th(tight ? 'chain.waitTight' : 'chain.wait', { min: minutes(w), station: tt.names[l.from] })}</li>`; }
    }
    if (ld !== curDay) { curDay = ld; h += `<li class="wait"><b>${esc(dayName(q.day, l.dep))}</b></li>`; }
    if (l.walk) h += `<li class="leg walk">${th('chain.walk', { from: tt.names[l.from], to: tt.names[l.to] })} <span class="mute">${esc(minutes(l.arr - l.dep))}</span></li>`;
    else h += `<li class="leg"><span class="t">${hm(l.dep)}</span> ${th('leg.fromTo', { from: tt.names[l.from], to: tt.names[l.to] })} <span class="line">${esc(l.line)}</span><span class="t">${hm(l.arr)}</span> <span class="mute">${th('leg.towards', { term: tt.names[l.term], dur: dur(l.arr - l.dep) })}</span> <button type="button" class="out" data-leg="${i}">${th('btn.out')}</button></li>`;
  });
  h += `</ol><details open><summary>${th('chain.nextTrains')}</summary>`;
  legs.forEach((l, i) => {
    const nxt = legs.slice(i + 1).find(x => !x.walk);
    if (!nxt) return;
    const dep = tt.departures({ day: q.day, station: nxt.from, t: l.arr + q.tr, limit: 6 });
    h += `<div class="stop"><h3>${esc(tt.names[nxt.from])} <span class="mute">${th('chain.arrive', { time: hm(l.arr) })}</span></h3><ul>`;
    for (const d of dep) {
      const mine = d.line === nxt.line && Math.abs(d.dep - nxt.dep) < 1;
      h += `<li class="${mine ? 'mine' : ''}"><span class="t">${hm(d.dep)}</span><span class="line">${esc(d.line)}</span> ${th('dep.towards', { term: tt.names[d.term] })} <span class="mute">${th('dep.nextStop', { stop: tt.names[d.next] })}</span></li>`;
    }
    h += '</ul></div>';
  });
  return h + '</details>';
}

// ---- reach map ----
const GEO = { lon0: 5.8, lon1: 15.1, lat0: 47.2, lat1: 55.1 };
let mapPts = [];
function sizeCanvas(c) {
  const k = Math.cos(51 * Math.PI / 180);
  const w = c.parentElement.clientWidth || 600;
  const h = w * ((GEO.lat1 - GEO.lat0) / ((GEO.lon1 - GEO.lon0) * k));
  const r = window.devicePixelRatio || 1;
  c.width = Math.round(w * r); c.height = Math.round(h * r);
  c.style.height = h + 'px';
  return { w, h, r };
}
const px = (lon, w) => (lon - GEO.lon0) / (GEO.lon1 - GEO.lon0) * w;
const py = (lat, h) => (GEO.lat1 - lat) / (GEO.lat1 - GEO.lat0) * h;

function drawReach() {
  const q = currentInputs();
  const c = $('#map');
  const { w, h, r } = sizeCanvas(c);
  const ctx = c.getContext('2d');
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (q.src < 0) return;
  if (!reachCache || reachCache.key !== [q.day, q.src, q.t0, q.tr].join()) {
    reachCache = { key: [q.day, q.src, q.t0, q.tr].join(), res: tt.earliestArrival({ day: q.day, src: q.src, t0: q.t0, minTransfer: q.tr }) };
  }
  const arr = reachCache.res.arr;
  const maxMin = +$('#hrs').value * 60;
  mapPts = [];
  ctx.fillStyle = 'rgba(128,128,128,.28)';
  for (let i = 0; i < tt.nStations; i++) {
    const x = px(tt.lon[i], w), y = py(tt.lat[i], h);
    const e = arr[i] - q.t0;
    if (arr[i] >= INF || e > maxMin) { ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6); continue; }
    mapPts.push([x, y, i, arr[i]]);
  }
  for (const [x, y, i, a] of mapPts) {
    const f = Math.min(1, (a - q.t0) / maxMin);
    ctx.fillStyle = `hsl(${130 - 130 * f} 70% 45%)`;
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.3); ctx.fill();
  }
  if (lastPlan && lastPlan.res.legs) {
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0b6e4f';
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.beginPath();
    lastPlan.res.legs.forEach((l, k) => {
      const x1 = px(tt.lon[l.from], w), y1 = py(tt.lat[l.from], h), x2 = px(tt.lon[l.to], w), y2 = py(tt.lat[l.to], h);
      if (k === 0) ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    });
    ctx.stroke();
  }
  const sx = px(tt.lon[q.src], w), sy = py(tt.lat[q.src], h);
  ctx.strokeStyle = '#c2410c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 6.3); ctx.stroke();
}

function nearestPt(ev) {
  const c = $('#map'), rect = c.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  let best = null, bd = 14 * 14;
  for (const p of mapPts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = p; } }
  return { p: best, x, y };
}

// ---- departures ----
function drawDeps() {
  const s = pSrc.get();
  const out = $('#deplist');
  if (s < 0) { out.innerHTML = `<p class="note">${th('deps.pick')}</p>`; return; }
  const day = +$('#date').value, t = toMin($('#t0').value);
  const deps = tt.departures({ day, station: s, t, limit: 14 });
  out.innerHTML = deps.length
    ? `<table class="deps"><tr><th class="dt">${th('deps.th.departs')}</th><th class="dl">${th('deps.th.line')}</th><th>${th('deps.th.towards')}</th><th>${th('deps.th.next')}</th></tr>${deps.map(d => `<tr><td class="t">${hm(d.dep)}${d.dep >= 1440 ? ' <span class="mute">' + esc(dayName(day, d.dep)) + '</span>' : ''}</td><td><span class="line">${esc(d.line)}</span></td><td>${esc(tt.names[d.term])}</td><td class="mute">${esc(tt.names[d.next])} ${hm(d.arr)}</td></tr>`).join('')}</table>`
    : `<p class="note">${th('deps.none')}</p>`;
}

// ---- tabs ----
function showTab(name, render = true) {
  for (const t of ['live', 'chain', 'deps', 'reach']) {
    $('#pane-' + t).hidden = t !== name;
    $('#tab-' + t).setAttribute('aria-selected', t === name ? 'true' : 'false');
  }
  if (render) renderTab();
}

// ---- timetable data: load from the device, update in the background ----
const berlinToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const SIX_HOURS = 6 * 3600 * 1000;

// The line under the title: how old the timetable is, and optionally one note (a key of the locale, with params).
let lastAge = { note: '', params: {} };
function showAge(note, params = {}) {
  lastAge = { note: note || '', params };
  const el = $('#dataage');
  const a = describeAge(manifest, berlinToday());
  const base = a.level === 'expired' ? t('age.expired', { last: a.last })
    : a.level === 'soon' ? t('age.soon', { date: manifest.date, last: a.last, left: a.left === 0 ? t('age.lastDay') : t('age.moreDays', { n: a.left }) })
      : t('age.ok', { date: manifest.date, last: a.last });
  el.textContent = note ? `${base} ${t(note, params)}` : base;
  el.dataset.level = a.level;
  el.hidden = false;
}

function renderFoot() {
  if (!tt) return;
  const f = tt.meta.feed;
  $('#foot').textContent = t('foot', { publisher: f.publisher, license: f.license, stations: num(tt.nStations), connections: num(tt.nConn), first: tt.dateOf(0), last: tt.dateOf(tt.nDays - 1) }) + ' ' + t('foot.map');
}

function fillDates(wantedIso) { fillDateSelect($('#date'), wantedIso); }

function fillDateSelect(sel, wantedIso) {
  sel.innerHTML = '';
  for (let d = 0; d < tt.nDays; d++) {
    const iso = tt.dateOf(d);
    sel.add(new Option(dayLabel(iso), d));
  }
  const inWindow = iso => iso && tt.dayIndex(iso) >= 0 && tt.dayIndex(iso) < tt.nDays;
  const today = berlinToday();
  sel.value = tt.dayIndex(inWindow(wantedIso) ? wantedIso : (inWindow(today) ? today : tt.dateOf(0)));
}

// Use a build: the first one at launch, and every update after it. Station numbers differ between builds, so
// the picked stations and the day are carried over by name and date.
function adopt(cur, next) {
  const keep = uiReady
    ? { iso: tt.dateOf(+$('#date').value), src: $('#src').value, dst: $('#dst').value, via: $('#via').value }
    : { iso: state.date, src: state.src, dst: state.dst, via: state.via };
  tt = next;
  manifest = cur.manifest;
  reachCache = null;
  lastPlan = null;
  fillDates(keep.iso);
  const first = !uiReady;
  if (first) initUi();
  pSrc.set(tt.find(keep.src)); pDst.set(tt.find(keep.dst)); pVia.set(keep.via ? tt.find(keep.via) : -1);
  if ($('#nowon').checked) applyClock();
  live.onTimetable();
  nav.resume();
  renderFoot();
  $('#status').hidden = true;
  $('#retry').hidden = true;
  $('#app').hidden = false;
  showAge('');
  renderTab();
  if (first) launchPlace();
}

async function useBuild(cur) {
  adopt(cur, new Timetable(cur.meta, await gunzip(cur.bin)));
}

// On an online launch, and when the device comes back online or the app is reopened after hours: ask the CDN
// whether a newer build exists, and swap it in only after it has been verified (app/data-store.js).
async function checkForUpdate() {
  if (navigator.onLine === false) { if (manifest) showAge('age.offline'); return; }
  lastCheck = Date.now();
  try {
    const r = await store.update();
    if (r.status === 'updated') {
      const cur = await store.load();
      if (cur) { await useBuild(cur); showAge('age.updated'); }
    } else if (manifest) {
      showAge('age.upToDate');
    }
  } catch (e) {
    if (!manifest) {
      $('#status').hidden = false;
      $('#status').textContent = t('status.loadFailed', { message: e.message });
      $('#retry').hidden = false;
    } else {
      showAge('age.checkFailed', { code: e.code || 'error' });
    }
  }
}

function initUi() {
  uiReady = true;
  fromSource = state.from;
  const changedPlace = () => { live.forget(); persist(); renderTab(); };
  pSrc = picker($('#src'), () => { fromSource = 'manual'; changedPlace(); });
  pDst = picker($('#dst'), changedPlace);
  pVia = picker($('#via'), () => renderTab());
  const minTransfer = () => Math.max(0, +$('#tr').value || 0);
  live = initLive({ $, esc, getTt: () => tt, hm, toMin, minTransfer, place, setPlace, onFollow: o => nav.start(o) });
  nav = initNavigate({ $, getTt: () => tt, hm, toMin, today: berlinToday, minTransfer, onWays: a => { showTab('live', false); live.fromState(a); } });
  $('#nowon').checked = state.now;
  if (!state.now) $('#t0').value = state.t0;
  $('#stay').value = state.stay; $('#tr').value = state.tr;

  // a day or a time set by hand is not the clock any more; the box says "Now" again and the bar follows the clock
  for (const id of ['date', 't0']) $('#' + id).addEventListener('change', () => { setNow(false); persist(); renderTab(); });
  for (const id of ['stay', 'tr']) $('#' + id).addEventListener('change', () => { persist(); renderTab(); });
  $('#nowon').addEventListener('change', () => { if ($('#nowon').checked) applyClock(); persist(); renderTab(); });
  // text typed into a station box and left again: the bar means what it says now
  $('#src').addEventListener('change', () => { fromSource = 'manual'; changedPlace(); });
  $('#dst').addEventListener('change', changedPlace);
  $('#via').addEventListener('input', () => { if (!$('#via').value.trim()) renderTab(); });
  $('#plan').onclick = () => renderTab();
  $('#swap').onclick = () => { const a = pSrc.get(), b = pDst.get(); pSrc.set(b); pDst.set(a); fromSource = 'manual'; changedPlace(); };
  $('#clearvia').onclick = () => { pVia.set(-1); renderTab(); };
  for (const n of ['live', 'chain', 'deps', 'reach']) $('#tab-' + n).onclick = () => showTab(n);
  $('#pane-chain').addEventListener('click', ev => {
    if (!lastPlan || !lastPlan.res.legs) return;
    if (ev.target.closest('button[data-follow]')) {
      const legs = lastPlan.res.legs;
      nav.start({ day: lastPlan.q.day, legs, dst: lastPlan.q.dst, plannedArr: legs[legs.length - 1].arr });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const b = ev.target.closest('button.out');
    if (!b) return;
    showTab('live', false);
    live.fromChain(lastPlan, +b.dataset.leg);
  });
  $('#hrs').addEventListener('input', () => { $('#hrs-val').textContent = $('#hrs').value; drawReach(); });
  paintReachLabel();
  setInterval(clockTick, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') comeBack(); });
  window.addEventListener('resize', () => { if (!$('#pane-reach').hidden) drawReach(); });

  const map = $('#map'), tip = $('#tip');
  map.addEventListener('pointermove', ev => {
    const { p, x, y } = nearestPt(ev);
    if (!p) { tip.hidden = true; return; }
    tip.hidden = false; tip.textContent = `${tt.names[p[2]]}, ${hm(p[3])}`;
    tip.style.left = Math.min(x + 12, map.clientWidth - 160) + 'px'; tip.style.top = (y + 12) + 'px';
  });
  map.addEventListener('pointerleave', () => { tip.hidden = true; });
  map.addEventListener('click', ev => {
    const { p } = nearestPt(ev);
    if (!p) return;
    pDst.set(p[2]); live.forget(); persist(); showTab('chain');
  });
}

// The language switch. The select lists every language by its own name; the choice is kept on the device.
function buildLangSelect() {
  const sel = $('#lang');
  for (const [c, name] of LANGS) sel.add(new Option(name, c));
  sel.onchange = () => setLang(sel.value);
}

function paintReachLabel() {
  $('#reach-label').innerHTML = th('reach.within', { hours: raw(`<b id="hrs-val">${esc($('#hrs').value)}</b>`) });
}

// A language was chosen: everything that holds words is drawn again; the stations, the date and the plan stay.
function refreshLanguage() {
  $('#lang').value = lang();
  paintReachLabel();
  if (!tt || !uiReady) return;
  fillDates(tt.dateOf(+$('#date').value));
  live.refresh();
  nav.refresh();
  renderFoot();
  if (manifest) showAge(lastAge.note, lastAge.params);
  runPlan();
  if (!$('#pane-deps').hidden) drawDeps();
  if (!$('#pane-reach').hidden) drawReach();
}

async function start() {
  const status = $('#status');
  state = loadState();
  buildLangSelect();
  onLang(refreshLanguage);
  await setLang(initialLang(), { save: false });
  status.textContent = t('status.loading');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!('caches' in self) || !(crypto && crypto.subtle)) {
    status.textContent = t('status.noCache');
    return;
  }
  store = new DataStore({ caches: self.caches, fetch: (u, i) => fetch(u, i), subtle: crypto.subtle, base: new URL('./', location.href).href, keys: MANIFEST_KEYS });
  $('#retry').onclick = () => { status.textContent = t('status.loading'); $('#retry').hidden = true; checkForUpdate(); };
  window.addEventListener('online', checkForUpdate);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > SIX_HOURS) checkForUpdate(); });

  let cur = null;
  try { cur = await store.load(); } catch (e) { status.textContent = t('status.readFailed', { message: e.message }); }
  if (cur) await useBuild(cur);
  else status.textContent = t('status.first');
  await checkForUpdate();
}

start();
