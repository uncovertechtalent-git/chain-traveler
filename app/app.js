import { Timetable, fmt, dur, INF } from './engine.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toMin = v => { const [h, m] = (v || '06:00').split(':').map(Number); return h * 60 + m; };

const DEFAULTS = { date: '', src: '', dst: '', via: '', t0: '06:00', stay: 180, tr: 4 };
let tt, state, lastPlan = null, reachCache = null;

function loadState() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ct-state') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveState() { try { localStorage.setItem('ct-state', JSON.stringify(state)); } catch { /* storage unavailable */ } }

async function loadGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' ' + res.status);
  let buf = await res.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return buf;
}

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

let pSrc, pDst, pVia, pDep;

function currentInputs() {
  return {
    day: +$('#date').value, src: pSrc.get(), dst: pDst.get(), via: pVia.get(),
    t0: toMin($('#t0').value), stay: Math.max(0, +$('#stay').value || 0), tr: Math.max(0, +$('#tr').value || 0),
  };
}

function persist() {
  state.date = tt.dateOf(+$('#date').value);
  state.src = $('#src').value; state.dst = $('#dst').value; state.via = $('#via').value;
  state.t0 = $('#t0').value; state.stay = +$('#stay').value; state.tr = +$('#tr').value;
  saveState();
}

// ---- chain ----
function runPlan() {
  const q = currentInputs();
  const out = $('#pane-chain');
  persist();
  if (q.src < 0 || q.dst < 0) {
    const started = $('#src').value.trim() || $('#dst').value.trim();
    out.innerHTML = started
      ? '<div class="err">Pick a start and a target station from the suggestions.</div>'
      : '<p class="note">Pick a start and a target station to chain the next regional trains between them.</p>';
    lastPlan = null;
    return;
  }
  const res = tt.plan({ day: q.day, src: q.src, dst: q.dst, t0: q.t0, via: q.via, stayMin: q.stay, minTransfer: q.tr });
  lastPlan = { res, q };
  reachCache = null;
  if (res.error) { out.innerHTML = `<div class="err">${esc(res.error)}</div>`; if (!$('#pane-reach').hidden) drawReach(); return; }
  out.innerHTML = renderChain(res, q);
  if (!$('#pane-reach').hidden) drawReach();
}

const hm = m => fmt(((m % 1440) + 1440) % 1440);
const dayName = (day, m) => new Date(tt.dateOf(day + Math.floor(m / 1440)) + 'T12:00:00Z')
  .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function renderChain(res, q) {
  const legs = res.legs, first = legs[0], last = legs[legs.length - 1];
  const rides = legs.filter(l => !l.walk).length;
  const changes = Math.max(0, rides - 1 - res.stays.length);
  const day0 = Math.floor(first.dep / 1440);
  let h = '';
  if (day0 > 0) h += `<div class="err">No usable train from ${esc(tt.names[q.src])} on ${esc(dayName(q.day, 0))} after ${hm(q.t0)}. The first chain leaves on ${esc(dayName(q.day, first.dep))}.</div>`;
  const arrDay = Math.floor(last.arr / 1440) > day0 ? ` (${dayName(q.day, last.arr)})` : '';
  h += `<div class="sum"><div><b>${hm(first.dep)} to ${hm(last.arr)}${esc(arrDay)}</b><br><span>${esc(tt.names[q.src])} to ${esc(tt.names[q.dst])}</span></div>
    <div><b>${dur(last.arr - first.dep)}</b><br><span>on the way</span></div>
    <div><b>${changes}</b><br><span>change${changes === 1 ? '' : 's'}${res.stays.length ? ' plus the stop-over' : ''}</span></div></div><ol class="chain">`;
  let curDay = day0;
  if (day0 > 0) h += `<li class="wait">${esc(dayName(q.day, first.dep))}</li>`;
  legs.forEach((l, i) => {
    const ld = Math.floor(l.dep / 1440);
    if (i > 0) {
      const p = legs[i - 1];
      const st = res.stays.find(s => s.station === l.from && p.to === l.from && Math.abs(s.dep - l.dep) < 1);
      if (st) h += `<li class="stay">Stop-over in <b>${esc(tt.names[st.station])}</b>: arrive <span class="t">${hm(st.arr)}</span>, leave <span class="t">${hm(st.dep)}</span> (${dur(st.dep - st.arr)})</li>`;
      else if (!l.walk && !p.walk) { const w = l.dep - p.arr; const tight = w <= q.tr + 2; h += `<li class="wait${tight ? ' tight' : ''}">${w} min at ${esc(tt.names[l.from])}${tight ? ' (tight change)' : ''}</li>`; }
    }
    if (ld !== curDay) { curDay = ld; h += `<li class="wait"><b>${esc(dayName(q.day, l.dep))}</b></li>`; }
    if (l.walk) h += `<li class="leg walk">Walk ${esc(tt.names[l.from])} to ${esc(tt.names[l.to])} <span class="mute">${l.arr - l.dep} min</span></li>`;
    else h += `<li class="leg"><span class="t">${hm(l.dep)}</span> ${esc(tt.names[l.from])} to ${esc(tt.names[l.to])} <span class="line">${esc(l.line)}</span><span class="t">${hm(l.arr)}</span> <span class="mute">towards ${esc(tt.names[l.term])}, ${dur(l.arr - l.dep)}</span></li>`;
  });
  h += '</ol><details open><summary>Next trains at each stop</summary>';
  legs.forEach((l, i) => {
    const nxt = legs.slice(i + 1).find(x => !x.walk);
    if (!nxt) return;
    const dep = tt.departures({ day: q.day, station: nxt.from, t: l.arr + q.tr, limit: 6 });
    h += `<div class="stop"><h3>${esc(tt.names[nxt.from])} <span class="mute">(arrive ${hm(l.arr)})</span></h3><ul>`;
    for (const d of dep) {
      const mine = d.line === nxt.line && Math.abs(d.dep - nxt.dep) < 1;
      h += `<li class="${mine ? 'mine' : ''}"><span class="t">${hm(d.dep)}</span><span class="line">${esc(d.line)}</span> towards ${esc(tt.names[d.term])} <span class="mute">next stop ${esc(tt.names[d.next])}</span></li>`;
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
  const s = pDep.get();
  const out = $('#deplist');
  if (s < 0) { out.innerHTML = '<p class="note">Pick a station.</p>'; return; }
  const day = +$('#date').value, t = toMin($('#dtime').value);
  const deps = tt.departures({ day, station: s, t, limit: 14 });
  out.innerHTML = deps.length
    ? `<table><tr><th>Departs</th><th>Line</th><th>Towards</th><th>Next stop</th></tr>${deps.map(d => `<tr><td class="t">${hm(d.dep)}${d.dep >= 1440 ? ' <span class="mute">' + esc(dayName(day, d.dep)) + '</span>' : ''}</td><td><span class="line">${esc(d.line)}</span></td><td>${esc(tt.names[d.term])}</td><td class="mute">${esc(tt.names[d.next])} ${hm(d.arr)}</td></tr>`).join('')}</table>`
    : '<p class="note">No departures after that time.</p>';
}

// ---- tabs ----
function showTab(name) {
  for (const t of ['chain', 'reach', 'deps']) {
    $('#pane-' + t).hidden = t !== name;
    $('#tab-' + t).setAttribute('aria-selected', t === name ? 'true' : 'false');
  }
  if (name === 'reach') drawReach();
  if (name === 'deps') { if (pDep.get() < 0) pDep.set(pSrc.get()); drawDeps(); }
}

async function start() {
  const status = $('#status');
  try {
    const [meta, buf] = await Promise.all([fetch('data/meta.json').then(r => r.json()), loadGz('data/timetable.bin.gz')]);
    tt = new Timetable(meta, buf);
  } catch (e) {
    status.textContent = 'The timetable could not be loaded: ' + e.message + '. Build it first (see README).';
    return;
  }
  state = loadState();
  const sel = $('#date');
  for (let d = 0; d < tt.nDays; d++) {
    const iso = tt.dateOf(d);
    const label = new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    sel.add(new Option(label, d));
  }
  const today = new Date().toISOString().slice(0, 10);
  const wanted = state.date && tt.dayIndex(state.date) >= 0 && tt.dayIndex(state.date) < tt.nDays ? state.date : (tt.dayIndex(today) >= 0 && tt.dayIndex(today) < tt.nDays ? today : tt.dateOf(0));
  sel.value = tt.dayIndex(wanted);

  pSrc = picker($('#src'), () => runPlan());
  pDst = picker($('#dst'), () => runPlan());
  pVia = picker($('#via'), () => runPlan());
  pDep = picker($('#dstation'), () => drawDeps());
  pSrc.set(tt.find(state.src)); pDst.set(tt.find(state.dst)); pVia.set(state.via ? tt.find(state.via) : -1);
  $('#t0').value = state.t0; $('#stay').value = state.stay; $('#tr').value = state.tr;
  $('#dtime').value = state.t0;

  for (const id of ['date', 't0', 'stay', 'tr']) $('#' + id).addEventListener('change', runPlan);
  $('#via').addEventListener('input', () => { if (!$('#via').value.trim()) runPlan(); });
  $('#plan').onclick = runPlan;
  $('#swap').onclick = () => { const a = pSrc.get(), b = pDst.get(); pSrc.set(b); pDst.set(a); runPlan(); };
  $('#clearvia').onclick = () => { pVia.set(-1); runPlan(); };
  $('#tab-chain').onclick = () => showTab('chain');
  $('#tab-reach').onclick = () => showTab('reach');
  $('#tab-deps').onclick = () => showTab('deps');
  $('#hrs').addEventListener('input', () => { $('#hrs-val').textContent = $('#hrs').value; drawReach(); });
  $('#dtime').addEventListener('change', drawDeps);
  $('#date').addEventListener('change', drawDeps);
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
    pDst.set(p[2]); showTab('chain'); runPlan();
  });

  const f = tt.meta.feed;
  $('#foot').textContent = `Timetable: ${f.publisher}, ${f.license}. ${tt.nStations.toLocaleString('en')} stations, ${tt.nConn.toLocaleString('en')} connections, ${tt.dateOf(0)} to ${tt.dateOf(tt.nDays - 1)}. Planned times only, no delays or engineering works. Check the trip in DB Navigator before you travel.`;
  status.textContent = `Ready: ${tt.nStations.toLocaleString('en')} stations, ${tt.dateOf(0)} to ${tt.dateOf(tt.nDays - 1)}.`;
  $('#app').hidden = false;
  runPlan();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
