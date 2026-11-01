// Navigate: follow a chain by the clock and, if you allow it, by position, and recalculate when the plan breaks. GPS on
// the trains the Deutschlandticket allows. A car GPS knows where you are and says "recalculating" when you leave the
// route; here the route is a set of timed connections, so "leaving the route" is a train you did not catch, or a station
// you are not at when the train leaves.
//
// The logic (where, assess, replan, tripOf) is pure and runs in Node; initNavigate() is the card on the page. Time is in
// minutes after midnight of the chain's first day, as everywhere in the app, and may pass 1440.
import { plan, graphOf } from './planb.js';
import { svgOf } from './graph.js';
import { zoomView, showMap } from './zoomview.js';
import { t, th, dur, dist, dayLabel } from './i18n.js';

export const MISSED_AFTER = 2;        // minutes after departure at the boarding station before the position says "missed"
export const NEAR_KM = 0.6;           // within this distance of a station you are at it
export const ELSEWHERE_KM = 1.0;      // farther than this from the boarding station, shortly before the train leaves: not there
export const ELSEWHERE_WITHIN = 20;   // "shortly before": minutes
export const POSITION_MAX_AGE = 3 * 60 * 1000;   // a position older than this (ms) is not used

export const legKey = l => `${l.from}>${l.to}@${l.dep}`;

// Where you are in the chain at `now`: the first leg that has not ended. before: the first train has not left and no leg
// has begun; waiting: at the station of a later leg, before it leaves; riding and walking: on the leg; done: past the end.
export function where(legs, now) {
  const i = legs.findIndex(l => l.arr > now);
  if (i < 0) return { phase: 'done', i: legs.length - 1, leg: legs[legs.length - 1] };
  const leg = legs[i];
  if (now < leg.dep) return { phase: i === 0 ? 'before' : 'waiting', i, leg, inMin: leg.dep - now };
  return { phase: leg.walk ? 'walking' : 'riding', i, leg, inMin: leg.arr - now };
}

// What the clock and what you said and, if you allow it, where you are say about the plan: no alert, or
//   missed    the train of this leg has gone without you (you said so, or you are still at its station after it left)
//   elsewhere you are not at the station you should board at, and the train leaves soon
// confirmed: { <legKey>: 'on' | 'missed' }. here: { station, distTo(station) } from a recent position, or null.
export function assess({ legs, now, confirmed = {}, here = null }) {
  const w = where(legs, now);
  if (w.phase === 'done' || w.leg.walk) return { w, alert: null };
  const leg = w.leg, said = confirmed[legKey(leg)];
  if (said === 'missed') return { w, alert: { kind: 'missed', why: 'said' } };
  if (w.phase === 'riding') {
    if (said !== 'on' && here && here.station === leg.from && here.distTo(leg.from) <= NEAR_KM && now >= leg.dep + MISSED_AFTER) {
      return { w, alert: { kind: 'missed', why: 'position' } };
    }
    return { w, alert: null };
  }
  if (here && w.inMin <= ELSEWHERE_WITHIN && here.station !== null && here.station !== leg.from && here.distTo(leg.from) > ELSEWHERE_KM) {
    return { w, alert: { kind: 'elsewhere', station: here.station } };
  }
  return { w, alert: null };
}

// The run behind a leg that came back from storage (it kept names and times, not trip numbers): the tripKey of the
// departure of `line` at `dep` from `station`, or null.
export function tripOf(tt, day, station, dep, line) {
  const d = tt.departures({ day, station, t: dep, limit: 12 }).find(x => x.dep === dep && x.line === line);
  return d ? tt.tripKey(d.svcDay, d.trip) : null;
}

// A new way on from `src` at `now`, against the plan you first had. nav: { day, dst, plannedArr, out: Set of tripKeys }.
// missedKey: a run that did not happen for you, added to nav.out for good. Returns { option, options } or { error, code }.
export function replan(tt, nav, { now, src, missedKey = null, minTransfer = 4 }) {
  if (missedKey !== null) nav.out.add(missedKey);
  const r = plan(tt, { day: nav.day, src, dst: nav.dst, t0: now, plannedArr: nav.plannedArr, exclude: nav.out, minTransfer });
  if (r.error) return { error: r.error, code: r.code };
  return { option: r.options[0], options: r.options, base: r.base };
}

// Where to draw you on the map: the position the device gave, else where the clock puts you: at the station you wait at,
// on the line between the two stations of the leg you ride (by the fraction of its time gone), at the end when done.
export function positionOf(tt, legs, now, here = null) {
  if (here && Number.isFinite(here.lat) && Number.isFinite(here.lon)) return { lat: here.lat, lon: here.lon, source: 'device' };
  const w = where(legs, now);
  const at = s => ({ lat: tt.lat[s], lon: tt.lon[s] });
  if (w.phase === 'done') return { ...at(legs[legs.length - 1].to), source: 'clock' };
  if (w.phase === 'before' || w.phase === 'waiting') return { ...at(w.leg.from), source: 'clock' };
  const f = Math.min(1, Math.max(0, (now - w.leg.dep) / Math.max(1, w.leg.arr - w.leg.dep)));
  const a = at(w.leg.from), b = at(w.leg.to);
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, source: 'clock' };
}

// The ways around the route: if the next train you have not boarded is out, from the station you would board it at, at
// the minute you would be there, against the plan you first had. null when there is no train ahead to be out.
export function whatIf(tt, nav, now, minTransfer = 4) {
  const w = where(nav.legs, now);
  if (w.phase === 'done') return null;
  const from = w.phase === 'riding' || w.phase === 'walking' ? w.i + 1 : w.i;
  const next = nav.legs.slice(from).find(l => !l.walk);
  if (!next) return null;
  const k = nav.legs.indexOf(next);
  const t0 = Math.max(now, k > 0 ? nav.legs[k - 1].arr : now);
  const key = next.trip !== undefined ? tt.tripKey(next.svcDay, next.trip) : tripOf(tt, nav.day, next.from, next.dep, next.line);
  const exclude = new Set(nav.out);
  if (key !== null) exclude.add(key);
  const result = plan(tt, { day: nav.day, src: next.from, dst: nav.dst, t0, plannedArr: nav.plannedArr, exclude, minTransfer });
  return { result, src: next.from, t0, next };
}

// ---- storage: names and times, because station and trip numbers change with the timetable
export function toStored(tt, nav) {
  const name = s => tt.names[s];
  return {
    v: 1, dayIso: tt.dateOf(nav.day), dst: name(nav.dst), plannedArr: nav.plannedArr, recalcs: nav.recalcs,
    legs: nav.legs.map(l => ({ walk: !!l.walk, from: name(l.from), to: name(l.to), dep: l.dep, arr: l.arr, line: l.line || '', term: l.term !== undefined ? name(l.term) : '' })),
    out: nav.outNamed || [],
  };
}

export function fromStored(tt, o) {
  if (!o || o.v !== 1 || !Array.isArray(o.legs) || !o.legs.length) return null;
  const day = tt.dayIndex(o.dayIso);
  if (day < 0 || day >= tt.nDays) return null;
  const id = n => tt.find(n);
  const dst = id(o.dst);
  if (dst < 0) return null;
  const legs = [];
  for (const l of o.legs) {
    const from = id(l.from), to = id(l.to);
    if (from < 0 || to < 0) return null;
    const term = l.term ? id(l.term) : to;
    legs.push({ walk: !!l.walk, from, to, dep: l.dep, arr: l.arr, line: l.line, term: term < 0 ? to : term });
  }
  const out = new Set();
  for (const m of o.out || []) {
    const station = id(m.from);
    const k = station < 0 ? null : tripOf(tt, day, station, m.dep, m.line);
    if (k !== null) out.add(k);
  }
  return { day, dst, legs, plannedArr: o.plannedArr, out, outNamed: o.out || [], confirmed: {}, recalcs: o.recalcs || 0 };
}

// ---- the card
const STORE = 'ct-nav';

export function initNavigate({ $, getTt, hm, toMin, today, minTransfer, onWays }) {
  const card = $('#navcard'), wrap = $('#navwrap');
  // The card is written again whenever its words change; the graph keeps a place of its own between the two halves, so a
  // finger that is moving the map is not cut off by the clock ticking.
  const topEl = document.createElement('div'), pane = document.createElement('div'), bottomEl = document.createElement('div');
  pane.className = 'navgraph';
  pane.setAttribute('aria-live', 'off');
  card.append(topEl, pane, bottomEl);
  const zoom = zoomView();
  let nav = null;            // the chain being followed
  let banner = null;         // { key, params } the last thing the app did by itself
  let here = null;           // { station, km, distTo, at } from the last position
  let watch = null;          // watchPosition id while tracking
  let tracking = false, trackNote = null;
  let timer = null, lastTop = '', lastBottom = '';
  let shown = { key: '', what: null };   // the ways around the route, worked out at most every few minutes

  const save = () => { try { if (nav) localStorage.setItem(STORE, JSON.stringify(toStored(getTt(), nav))); else localStorage.removeItem(STORE); } catch { /* storage unavailable */ } };

  // Now, in minutes after midnight of the chain's first day. The test clock is a time of that day.
  function now() {
    const tt = getTt(), pretend = $('#nclock').value;
    if (pretend) return toMin(pretend);
    const idx = tt.dayIndex(today());
    if (idx < 0) return null;
    const hmNow = new Date().toLocaleTimeString('sv-SE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
    const n = (idx - nav.day) * 1440 + toMin(hmNow);
    // A chain on another day is not being travelled: before it starts by more than a day, or finished more than three hours ago.
    return n < -1440 || n > nav.legs[nav.legs.length - 1].arr + 180 ? null : n;
  }

  function say(key, params = {}) { banner = { key, params }; }

  function recalculate(tt, n, src, missed, fromIndex) {
    nav.previous = nav.legs.slice(fromIndex).filter(l => !l.walk).map(l => ({ from: l.from, to: l.to }));
    const missedKey = missed ? (missed.trip !== undefined ? tt.tripKey(missed.svcDay, missed.trip) : tripOf(tt, nav.day, missed.from, missed.dep, missed.line)) : null;
    if (missed && missedKey !== null) nav.outNamed = [...(nav.outNamed || []), { from: tt.names[missed.from], dep: missed.dep, line: missed.line }];
    const r = replan(tt, nav, { now: n, src, missedKey, minTransfer: minTransfer() });
    if (r.error) { say('nav.noWay'); return false; }
    nav.legs = r.option.legs;
    nav.confirmed = {};
    nav.recalcs++;
    return r;
  }

  function tick() {
    const tt = getTt();
    if (!nav || !tt) return;
    const n = now();
    if (n === null) { render(); return; }
    const fresh = here && Date.now() - here.at <= POSITION_MAX_AGE ? here : null;
    const a = assess({ legs: nav.legs, now: n, confirmed: nav.confirmed, here: fresh });
    if (a.alert) {
      const leg = a.w.leg;
      const src = a.alert.kind === 'elsewhere' ? a.alert.station : leg.from;
      const old = { line: leg.line, dep: leg.dep, from: leg.from, expected: leg.from };
      const r = recalculate(tt, n, src, a.alert.kind === 'missed' ? leg : null, a.w.i);
      if (r) {
        const arr = r.option.arr;
        say(a.alert.kind === 'missed' ? 'nav.recalc.missed' : 'nav.recalc.elsewhere', {
          line: old.line, dep: hm(old.dep), station: tt.names[src], expected: tt.names[old.expected], arr: hm(arr), delta: dur(Math.abs(r.option.delta)), later: r.option.delta > 0 ? 1 : 0,
        });
        save();
      }
    }
    render();
  }

  // The graph: your route bold, the ways if the next train is out coloured by how much later they arrive, the plan before
  // the last recalculation dotted, and you; over the map unless it is switched off. Redrawn at every tick (you move); the
  // ways are worked out every few minutes. Returns the note under it.
  function paintGraph(tt, n, fresh) {
    const w = where(nav.legs, n);
    const next = nav.legs.slice(w.phase === 'riding' || w.phase === 'walking' ? w.i + 1 : w.i).find(l => !l.walk);
    const key = [nav.day, nav.recalcs, nav.out.size, next ? legKey(next) : 'none', Math.floor(n / 3)].join('|');
    if (shown.key !== key) shown = { key, what: whatIf(tt, nav, n, minTransfer()) };
    const what = shown.what;
    const result = what && !what.result.error ? what.result : { options: [], src: nav.legs[0].from, dst: nav.dst, t0: n, baseKind: 'plan' };
    const active = nav.legs.slice(w.i).filter(l => !l.walk);
    const mePos = positionOf(tt, nav.legs, n, fresh);
    const model = graphOf(tt, result, { ghost: nav.previous, active, me: { lat: mePos.lat, lon: mePos.lon, label: t('nav.here') } });
    const width = Math.max(300, Math.min(720, card.clientWidth || 720));
    const height = Math.round(width * (width < 500 ? 0.95 : 0.6)), label = t('nav.graph'), min = t('unit.min');
    zoom.show({ width, height, draw: view => svgOf(model, { width, height, label, min, basemap: showMap(), view }) });
    if (zoom.el.parentNode !== pane) pane.append(zoom.el);
    return `<p class="note">${th('nav.legendRoute')}${nav.previous ? ` ${th('nav.legendOld')}` : ''}</p>`;
  }

  function legLine(tt, l) {
    return l.walk
      ? th('chain.walk', { from: tt.names[l.from], to: tt.names[l.to] })
      : th('nav.train', { line: l.line, from: tt.names[l.from], to: tt.names[l.to] });
  }

  function render() {
    const tt = getTt();
    if (!nav || !tt) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const n = now();
    const fresh = here && Date.now() - here.at <= POSITION_MAX_AGE ? here : null;
    const last = nav.legs[nav.legs.length - 1];
    const chainDay = dayLabel(tt.dateOf(nav.day));
    let top = `<div class="navhead"><b>${th('nav.title')}</b> <span class="mute">${th('nav.to', { station: tt.names[nav.dst] })}</span> <button type="button" class="mini-btn" data-nav="stop">${th('nav.stop')}</button></div>`;
    if (banner) {
      const p = banner.params;
      top += `<div class="err navbanner">${th(banner.key, banner.params)}${banner.key === 'nav.recalc.missed' || banner.key === 'nav.recalc.elsewhere' ? ` ${th(p.later ? 'nav.later' : 'nav.onPlan', { delta: p.delta })}` : ''}</div>`;
    }
    let bottom = '';
    pane.hidden = n === null;
    if (n === null) {
      top += `<p class="note">${th('nav.outside', { day: chainDay })}</p>`;
    } else {
      const w = where(nav.legs, n);
      const l = w.leg;
      const key = legKey(l);
      let main = '';
      if (w.phase === 'done') main = th('nav.done', { station: tt.names[last.to] });
      else if (w.phase === 'before') main = th('nav.before', { dep: hm(l.dep), inMin: dur(w.inMin), leg: legLine(tt, l) });
      else if (w.phase === 'waiting') main = th('nav.waiting', { station: tt.names[l.from], dep: hm(l.dep), inMin: dur(w.inMin), leg: legLine(tt, l) });
      else if (w.phase === 'riding') main = th('nav.riding', { line: l.line, to: tt.names[l.to], arr: hm(l.arr), inMin: dur(w.inMin) });
      else main = th('nav.walking', { to: tt.names[l.to], inMin: dur(w.inMin) });
      top += `<p class="navnow">${main}</p>`;
      bottom += paintGraph(tt, n, fresh);
      const next = nav.legs[w.i + 1];
      if (w.phase !== 'done' && next) bottom += `<p class="note">${th('nav.then', { leg: legLine(tt, next), dep: hm(next.dep) })}</p>`;
      bottom += `<p class="note">${th('nav.arriving', { arr: hm(last.arr), plan: hm(nav.plannedArr) })}${last.arr > nav.plannedArr ? ` ${th('nav.later', { delta: dur(last.arr - nav.plannedArr) })}` : ''}${nav.recalcs ? ` ${th('nav.recalcs', { n: nav.recalcs })}` : ''}</p>`;
      if (w.phase !== 'done' && !l.walk) {
        bottom += '<div class="navbtns">';
        if (nav.confirmed[key] !== 'on') bottom += `<button type="button" data-nav="on">${th('nav.onBoard')}</button>`;
        bottom += `<button type="button" data-nav="missed">${th('nav.missed')}</button>`;
        bottom += '</div>';
      }
    }
    bottom += `<div class="navbtns"><button type="button" data-nav="track">${th(tracking ? 'nav.untrack' : 'nav.track')}</button> <button type="button" data-nav="ways">${th('nav.ways')}</button></div>`;
    bottom += `<p class="note">${trackNote ? th(trackNote.key, trackNote.params) : th('nav.privacy')}</p>`;
    if (top !== lastTop) { topEl.innerHTML = top; lastTop = top; }
    if (bottom !== lastBottom) { bottomEl.innerHTML = bottom; lastBottom = bottom; }
  }

  function onPosition(pos) {
    const tt = getTt();
    if (!tt) return;
    const { latitude: lat, longitude: lon } = pos.coords;
    const near = tt.nearby({ lat, lon, limit: 1, maxKm: 5 })[0] || null;
    const rad = Math.PI / 180;
    const distTo = s => 12742 * Math.asin(Math.sqrt(Math.sin((tt.lat[s] - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(tt.lat[s] * rad) * Math.sin((tt.lon[s] - lon) * rad / 2) ** 2));
    here = { station: near ? near.station : null, km: near ? near.km : null, distTo, at: Date.now(), lat, lon };
    trackNote = near ? { key: 'nav.near', params: { station: tt.names[near.station], dist: dist(near.km) } } : { key: 'nav.nowhere', params: {} };
    tick();
  }

  const FAILS = { 1: 'loc.denied', 2: 'loc.unavailable', 3: 'loc.timeout' };
  function startTracking() {
    if (!navigator.geolocation) { trackNote = { key: 'loc.unsupported', params: {} }; render(); return; }
    tracking = true;
    trackNote = { key: 'loc.looking', params: {} };
    watch = navigator.geolocation.watchPosition(onPosition, err => {
      tracking = false; watch = null;
      trackNote = { key: FAILS[err && err.code] || FAILS[2], params: {} };
      render();
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    render();
  }
  function stopTracking() {
    if (watch !== null && navigator.geolocation) navigator.geolocation.clearWatch(watch);
    watch = null; tracking = false; here = null; trackNote = null;
  }

  card.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-nav]');
    if (!b || !nav) return;
    const n = now(), what = b.dataset.nav;
    if (what === 'stop') { api.stop(); return; }
    if (what === 'track') { if (tracking) stopTracking(); else startTracking(); render(); return; }
    if (what === 'ways') {
      const w = n === null ? null : where(nav.legs, n);
      const src = w && w.leg && w.phase !== 'done' ? w.leg.from : nav.legs[nav.legs.length - 1].to;
      onWays({ day: nav.day, src, dst: nav.dst, t0: n === null ? nav.legs[0].dep : n, plannedArr: nav.plannedArr, out: nav.out });
      return;
    }
    if (n === null) return;
    const w = where(nav.legs, n);
    if (w.phase === 'done') return;
    nav.confirmed[legKey(w.leg)] = what === 'on' ? 'on' : 'missed';
    banner = null;
    tick();
  });
  $('#nclock').addEventListener('input', () => tick());

  const api = {
    // Follow these legs. plannedArr: the arrival you planned (the yardstick for every recalculation).
    start({ day, legs, dst, plannedArr, out = new Set() }) {
      nav = { day, legs, dst, plannedArr, out: new Set(out), outNamed: [], confirmed: {}, recalcs: 0, previous: null };
      shown = { key: '', what: null };
      banner = null;
      zoom.reset();
      save();
      if (!timer) timer = setInterval(tick, 15000);
      tick();
    },
    stop() {
      stopTracking();
      nav = null; banner = null; lastTop = lastBottom = '';
      if (timer) { clearInterval(timer); timer = null; }
      save();
      wrap.hidden = true; topEl.innerHTML = ''; bottomEl.innerHTML = ''; zoom.drop(); pane.textContent = '';
    },
    // At launch and after a new timetable: take up a chain that was being followed.
    resume() {
      const tt = getTt();
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { stored = null; }
      const again = tt ? fromStored(tt, stored) : null;
      if (!again) { if (nav) api.stop(); return; }
      nav = again;
      if (!timer) timer = setInterval(tick, 15000);
      tick();
    },
    // The language changed.
    refresh() { lastTop = lastBottom = ''; render(); },
    active: () => nav !== null,
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  return api;
}
