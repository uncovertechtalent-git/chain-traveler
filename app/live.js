// The Plan B tab: "my train is out, where do I go from here". Reads its own inputs, asks app/planb.js for the ways on,
// and draws them (app/graph.js) next to a list. The page helpers come from app.js through initLive().
import { t, th, raw, dur, minutes, dist, errText } from './i18n.js';
import { plan, graphOf, GOOD_MIN, LATE_MIN } from './planb.js';
import { svgOf } from './graph.js';

export function initLive({ $, esc, picker, getTt, hm, toMin, today, fillDateSelect, minTransfer }) {
  const pSrc = picker($('#lsrc'), () => { forget(); run(); });
  const pDst = picker($('#ldst'), () => { forget(); run(); });
  let out = new Set();     // runs marked as out (engine tripKey values)
  let ghost = null;        // the legs of the original plan still ahead, when we came from the chain view
  let dayIso = '';         // the chosen date, kept as a date because day numbers change with the timetable
  let drawnWidth = 0;      // the width the graph was last drawn at

  const forget = () => { out = new Set(); ghost = null; };
  // A time of day, with +1 after midnight of the chosen date, so a train on the next day is not read as one today.
  const at = m => hm(m) + (m >= 1440 ? ` +${Math.floor(m / 1440)}` : '');
  const nowHm = () => new Date().toLocaleTimeString('sv-SE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });

  // What the chip says. Against a plan: on plan, early, late, much later. Without one: the best way and how far the others trail it.
  function chipText(o, baseKind) {
    if (baseKind === 'best') return o.delta <= 0 ? t('chip.best') : t('chip.best.' + o.band, { dur: dur(o.delta) });
    if (o.delta < 0) return t('chip.plan.early', { dur: dur(-o.delta) });
    if (o.delta === 0) return t('chip.plan.exact');
    return t('chip.plan.' + o.band, { dur: dur(o.delta) });
  }

  function legLines(tt, o) {
    return '<ol class="mini">' + o.legs.map((l, i) => (l.walk
      ? `<li class="walk">${th('chain.walk', { from: tt.names[l.from], to: tt.names[l.to] })} <span class="mute">${minutes(l.arr - l.dep)}</span></li>`
      : `<li><span class="t">${at(l.dep)}</span> ${th('leg.fromTo', { from: tt.names[l.from], to: tt.names[l.to] })} <span class="line">${esc(l.line)}</span><span class="t">${at(l.arr)}</span> <span class="mute">${esc(t('unit.perHour', { n: o.perLeg[i] }))}</span></li>`)).join('') + '</ol>';
  }

  function optionHtml(tt, o, baseKind) {
    const meta = [t('opt.leave', { time: at(o.dep) }), t('opt.changes', { n: o.changes })];
    if (o.tightest !== null) meta.push(t('opt.tightest', { min: minutes(o.tightest) }));
    meta.push(t('opt.thinnest', { n: o.thinnest }));
    return `<li class="opt ${o.band}"><div class="head"><b class="t">${at(o.arr)}</b> ${th('opt.arrive')} <span class="chip ${o.band}">${esc(chipText(o, baseKind))}</span>${o.tags.map(g => ` <span class="tag">${th('tag.' + g)}</span>`).join('')}</div><div class="mute">${esc(meta.join(' · '))}</div>${legLines(tt, o)}</li>`;
  }

  const legend = baseKind => `<p class="legend2"><span class="chip good">${th('legend.green')}</span> ${th('legend.good', { n: GOOD_MIN, base: t(baseKind === 'plan' ? 'legend.basePlan' : 'legend.baseBest') })} <span class="chip mid">${th('legend.amber')}</span> ${th('legend.mid', { n: LATE_MIN })} <span class="chip bad">${th('legend.red')}</span> ${th('legend.bad')} ${th('legend.thick')}${baseKind === 'plan' ? ` ${th('legend.dotted')}` : ''}</p>`;

  function run() {
    const tt = getTt();
    const src = pSrc.get(), dst = pDst.get();
    const deps = $('#ldeps'), res = $('#lres');
    if (!tt || src < 0 || dst < 0) {
      deps.innerHTML = '';
      res.innerHTML = `<p class="note">${th('live.say')}</p>`;
      return;
    }
    const day = +$('#ldate').value, t0 = toMin($('#lt0').value);
    dayIso = tt.dateOf(day);
    let planned = null;
    if ($('#lplan').value) { planned = toMin($('#lplan').value); if (planned < t0) planned += 1440; }

    const list = tt.departures({ day, station: src, t: t0, limit: 8 });
    const listed = new Set(list.map(d => tt.tripKey(d.svcDay, d.trip)));
    const unlisted = [...out].filter(k => !listed.has(k)).length;
    deps.innerHTML = list.length
      ? `<h3>${th('live.depsTitle', { station: tt.names[src], time: hm(t0) })}</h3>${list[0].dep >= 1440 ? `<div class="err">${th('live.noMoreToday', { station: tt.names[src], time: hm(t0) })}</div>` : ''}<p class="note">${th('live.tick')}${unlisted ? ` ${th('live.unlisted', { n: unlisted })}` : ''}</p><ul class="outs">${list.map(d => {
        const k = tt.tripKey(d.svcDay, d.trip);
        return `<li><label class="outl"><input type="checkbox" data-k="${k}"${out.has(k) ? ' checked' : ''}> <span class="t">${at(d.dep)}</span> <span class="line">${esc(d.line)}</span> ${th('dep.towards', { term: tt.names[d.term] })}</label></li>`;
      }).join('')}</ul>`
      : '';

    const result = plan(tt, { day, src, dst, t0, plannedArr: planned, exclude: out, minTransfer: minTransfer() });
    if (result.error) { res.innerHTML = `<div class="err">${esc(errText(result))}</div>`; return; }
    const first = result.options[0];
    const lead = result.baseKind === 'plan'
      ? t('live.leadPlan', { plan: at(result.base), best: at(first.arr), later: first.delta > 0 ? t('live.later', { dur: dur(first.delta) }) : '' })
      : t('live.leadBest', { best: at(first.arr) });
    const model = graphOf(tt, result, { ghost });
    // The graph is drawn at the width it is shown at, so its text keeps its size on a phone; the box is taller there.
    drawnWidth = Math.max(300, Math.min(720, res.clientWidth || 720));
    const svg = svgOf(model, { width: drawnWidth, height: Math.round(drawnWidth * (drawnWidth < 500 ? 1.15 : 0.72)), label: t('graph.label', { from: tt.names[src], to: tt.names[dst] }), min: t('unit.min') });
    res.innerHTML = `<p class="lead2">${esc(lead)}</p>${svg}${legend(result.baseKind)}<ol class="opts">${result.options.map(o => optionHtml(tt, o, result.baseKind)).join('')}</ol>`;
  }

  // "Use my location": one position reading from the device (no tracking, nothing stored, nothing sent), the nearest
  // stations that have trains, and the nearest filled in as "I am at", with the date and time set to now.
  const where = $('#lwhere'), locateBtn = $('#llocate');
  const say = html => { where.innerHTML = html; };
  const choose = s => { forget(); pSrc.set(s); run(); };
  const FAILS = { 1: 'loc.denied', 2: 'loc.unavailable', 3: 'loc.timeout' };

  function located(pos) {
    locateBtn.disabled = false;
    const tt = getTt();    // read now: the timetable may have been replaced while the device was thinking
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    const near = tt.nearby({ lat, lon, limit: 4, maxKm: 40 });
    if (!near.length) { say(th('loc.none')); return; }
    fillDateSelect($('#ldate'), today());
    $('#lt0').value = nowHm();
    choose(near[0].station);
    const rough = accuracy > 1500 ? ` ${th('loc.rough', { km: Math.round(accuracy / 1000) })}` : '';
    const others = near.slice(1).map(x => `<button type="button" class="near" data-st="${x.station}">${esc(tt.names[x.station])}, ${esc(dist(x.km))}</button>`).join(' ');
    say(`${th('loc.near', { station: raw(`<b>${esc(tt.names[near[0].station])}</b>`), dist: dist(near[0].km) })}${rough} ${th('loc.private')}${others ? ` ${th('loc.notHere')} ${others}` : ''}`);
  }

  function locate() {
    if (!getTt()) return;
    if (!navigator.geolocation) { say(th('loc.unsupported')); return; }
    locateBtn.disabled = true;
    say(th('loc.looking'));
    navigator.geolocation.getCurrentPosition(located, err => {
      locateBtn.disabled = false;
      say(th(FAILS[err && err.code] || FAILS[2]));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  locateBtn.addEventListener('click', locate);
  where.addEventListener('click', ev => {
    const b = ev.target.closest('button.near');
    if (b) { choose(+b.dataset.st); say(''); }
  });

  $('#ldeps').addEventListener('change', ev => {
    const box = ev.target.closest('input[type=checkbox]');
    if (!box) return;
    const k = +box.dataset.k;
    if (box.checked) out.add(k); else out.delete(k);
    run();
  });
  for (const id of ['ldate', 'lt0', 'lplan']) $('#' + id).addEventListener('change', run);
  window.addEventListener('resize', () => { if (!$('#pane-live').hidden && Math.abs(($('#lres').clientWidth || 0) - drawnWidth) > 40) run(); });

  return {
    // The tab opens: fill what is empty from the chain form, the date from today, the time from the clock.
    open(mainSrc, mainDst) {
      const tt = getTt();
      if (!$('#ldate').options.length) fillDateSelect($('#ldate'), today());
      if (!$('#lt0').value) $('#lt0').value = nowHm();
      if (pSrc.get() < 0 && mainSrc >= 0) pSrc.set(mainSrc);
      if (pDst.get() < 0 && mainDst >= 0) pDst.set(mainDst);
      if (tt) run();
    },
    // From the chain view: this leg's train is out. We stand at its boarding station at its departure time.
    fromChain(lastPlan, i) {
      const tt = getTt(), { res, q } = lastPlan, leg = res.legs[i], last = res.legs[res.legs.length - 1];
      const shift = Math.floor(leg.dep / 1440);
      forget();
      fillDateSelect($('#ldate'), tt.dateOf(Math.min(tt.nDays - 1, q.day + shift)));
      $('#lt0').value = hm(leg.dep);
      $('#lplan').value = hm(last.arr);
      pSrc.set(leg.from); pDst.set(q.dst);
      out.add(tt.tripKey(leg.svcDay, leg.trip));
      ghost = res.legs.slice(i).filter(l => !l.walk).map(l => ({ from: l.from, to: l.to }));
      run();
    },
    // The language changed: draw everything again in it. The marked trains, the plan and the stations stay.
    refresh() {
      say('');
      if ($('#ldate').options.length) fillDateSelect($('#ldate'), dayIso);
      if (getTt()) run();
    },
    // A new timetable replaced the old one: station numbers changed, so look the names up again.
    onTimetable() {
      const tt = getTt();
      forget();
      say('');    // the candidate buttons carry station numbers of the old timetable
      if ($('#ldate').options.length) fillDateSelect($('#ldate'), dayIso);
      pSrc.set($('#lsrc').value ? tt.find($('#lsrc').value) : -1);
      pDst.set($('#ldst').value ? tt.find($('#ldst').value) : -1);
      if (!$('#pane-live').hidden) run();
    },
  };
}
