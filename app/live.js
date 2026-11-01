// The Plan B tab: "my train is out, where do I go from here". Reads where you are, where you go, the day and the time from
// the bar that every tab shares (place() and setPlace() from app.js), asks app/planb.js for the ways on, and draws them
// (app/graph.js) next to a list.
import { t, th, raw, dur, minutes, dist, errText } from './i18n.js';
import { plan, graphOf, contextOf, GOOD_MIN, LATE_MIN } from './planb.js';
import { svgOf } from './graph.js';
import { zoomView, showMap } from './zoomview.js';

export function initLive({ $, esc, getTt, hm, toMin, minTransfer, place, setPlace, onFollow }) {
  let out = new Set();     // runs marked as out (engine tripKey values)
  let ghost = null;        // the legs of the original plan still ahead, when we came from the chain view
  let plannedClock = null; // the arrival that plan promised, as a time of day in minutes; none unless we came from a chain or Navigate
  let drawnWidth = 0;      // the width the graph was last drawn at
  let lastRun = null;      // what the ways on were asked for and found, for "Follow this way"
  let contextRun = 0;      // counts runs, so a network that arrives for a replaced run is dropped
  let known = { tt: null, key: '', context: null };   // the last network around you, for a redraw with the same inputs

  const zoom = zoomView();   // the graph, which keeps its place and its zoom while the ways are drawn again
  const forget = () => { out = new Set(); ghost = null; plannedClock = null; zoom.reset(); };
  // A time of day, with +1 after midnight of the chosen date, so a train on the next day is not read as one today.
  const at = m => hm(m) + (m >= 1440 ? ` +${Math.floor(m / 1440)}` : '');
  // Replace what an element shows only when the text of it changed: a minute that changes nothing leaves the page, the
  // scroll position and a tap in progress alone.
  const shownHtml = new WeakMap();
  const setHtml = (el, html) => { if (shownHtml.get(el) === html && el.isConnected) return false; el.innerHTML = html; shownHtml.set(el, html); return true; };

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

  function optionHtml(tt, o, baseKind, idx) {
    const meta = [t('opt.leave', { time: at(o.dep) }), t('opt.changes', { n: o.changes })];
    if (o.tightest !== null) meta.push(t('opt.tightest', { min: minutes(o.tightest) }));
    meta.push(t('opt.thinnest', { n: o.thinnest }));
    return `<li class="opt ${o.band}"><div class="head"><b class="t">${at(o.arr)}</b> ${th('opt.arrive')} <span class="chip ${o.band}">${esc(chipText(o, baseKind))}</span>${o.tags.map(g => ` <span class="tag">${th('tag.' + g)}</span>`).join('')}</div><div class="mute">${esc(meta.join(' · '))}</div>${legLines(tt, o)}<button type="button" class="follow" data-way="${idx}">${th('nav.followWay')}</button></li>`;
  }

  const legend = (baseKind, withContext) => `<p class="legend2"><span class="chip good">${th('legend.green')}</span> ${th('legend.good', { n: GOOD_MIN, base: t(baseKind === 'plan' ? 'legend.basePlan' : 'legend.baseBest') })} <span class="chip mid">${th('legend.amber')}</span> ${th('legend.mid', { n: LATE_MIN })} <span class="chip bad">${th('legend.red')}</span> ${th('legend.bad')} ${th('legend.thick')}${baseKind === 'plan' ? ` ${th('legend.dotted')}` : ''}${withContext ? ` ${th('legend.context')}` : ''}</p>`;

  function run() {
    contextRun++;    // whatever network was on its way belongs to the run before this one
    const tt = getTt();
    const { src, dst, day, t0 } = place();
    const deps = $('#ldeps'), res = $('#lres');
    $('#pane-live .lead').hidden = !!tt && src >= 0 && dst >= 0;    // the introduction is for the empty page: with a place and a target the ways are what the page is for
    if (!tt || src < 0 || dst < 0) {
      setHtml(deps, '');
      setHtml(res, `<p class="note">${th('live.say')}</p>`);
      return;
    }
    let planned = null;
    if (plannedClock !== null) { planned = plannedClock; if (planned < t0) planned += 1440; }

    const list = tt.departures({ day, station: src, t: t0, limit: 8 });
    const listed = new Set(list.map(d => tt.tripKey(d.svcDay, d.trip)));
    const unlisted = [...out].filter(k => !listed.has(k)).length;
    setHtml(deps, list.length
      ? `<h3>${th('live.depsTitle', { station: tt.names[src], time: hm(t0) })}</h3>${list[0].dep >= 1440 ? `<div class="err">${th('live.noMoreToday', { station: tt.names[src], time: hm(t0) })}</div>` : ''}<p class="note">${th('live.tick')}${unlisted ? ` ${th('live.unlisted', { n: unlisted })}` : ''}</p><ul class="outs">${list.map(d => {
        const k = tt.tripKey(d.svcDay, d.trip);
        return `<li><label class="outl"><input type="checkbox" data-k="${k}"${out.has(k) ? ' checked' : ''}> <span class="t">${at(d.dep)}</span> <span class="line">${esc(d.line)}</span> ${th('dep.towards', { term: tt.names[d.term] })}</label></li>`;
      }).join('')}</ul>`
      : '');

    const result = plan(tt, { day, src, dst, t0, plannedArr: planned, exclude: out, minTransfer: minTransfer() });
    if (result.error) { setHtml(res, `<div class="err">${esc(errText(result))}</div>`); return; }
    const first = result.options[0];
    const lead = result.baseKind === 'plan'
      ? t('live.leadPlan', { plan: at(result.base), best: at(first.arr), later: first.delta > 0 ? t('live.later', { dur: dur(first.delta) }) : '' })
      : t('live.leadBest', { best: at(first.arr) });
    // The graph is drawn at the width it is shown at, so its text keeps its size on a phone; the box is taller there.
    drawnWidth = Math.max(300, Math.min(720, res.clientWidth || 720));
    const paint = context => {
      const model = graphOf(tt, result, { ghost, context });
      const width = drawnWidth, height = Math.round(width * (width < 500 ? 1.15 : 0.72));
      const label = t('graph.label', { from: tt.names[src], to: tt.names[dst] }), min = t('unit.min');
      const html = `<p class="lead2">${esc(lead)}</p><div class="zslot"></div>${legend(result.baseKind, !!context && context.nodes.length > 0)}<ol class="opts">${result.options.map((o, i) => optionHtml(tt, o, result.baseKind, i)).join('')}</ol>`;
      const fresh = setHtml(res, html);
      zoom.show({ width, height, draw: view => svgOf(model, { width, height, label, min, basemap: showMap(), view }) });
      if (fresh) res.querySelector('.zslot').replaceWith(zoom.el);
    };
    // The network around you, as quiet background: where else you could get to, as far as the way on takes and a bit
    // more. It needs a scan of its own, so the ways are drawn first and the network follows; a run that was replaced
    // meanwhile (another tick, another language) is dropped, and the last network is kept for a redraw.
    const ask = { day, src, t0, exclude: out, minTransfer: minTransfer(), maxMin: Math.min(300, Math.max(90, first.arr - t0 + 30)) };
    const key = [ask.day, ask.src, ask.t0, ask.minTransfer, ask.maxMin, [...out].sort().join(',')].join('|');
    lastRun = { day, dst, base: result.base, options: result.options, out };
    const mine = contextRun;
    if (known.tt === tt && known.key === key) { paint(known.context); return; }
    paint(null);
    setTimeout(() => {
      if (mine !== contextRun) return;
      known = { tt, key, context: contextOf(tt, ask) };
      paint(known.context);
    }, 20);
  }

  // "Use my location": one position reading from the device (no tracking, nothing stored, nothing sent), the nearest
  // stations that have trains, and the nearest filled in as "I am at", with the date and time following the clock. The
  // reading can also be asked for again without a word (silent), when the device allowed it already and the page is shown
  // again: an "I am at" that came from the position is not left to go stale.
  const where = $('#lwhere'), locateBtn = $('#llocate');
  const say = html => { where.innerHTML = html; };
  const choose = s => { forget(); setPlace({ src: s, from: 'gps' }); run(); };
  const FAILS = { 1: 'loc.denied', 2: 'loc.unavailable', 3: 'loc.timeout' };

  function located(pos, silent) {
    locateBtn.disabled = false;
    const tt = getTt();    // read now: the timetable may have been replaced while the device was thinking
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    const near = tt.nearby({ lat, lon, limit: 4, maxKm: 40 });
    if (!near.length) { if (!silent) say(th('loc.none')); return; }
    forget();
    setPlace({ src: near[0].station, now: true, from: 'gps' });
    run();
    const rough = accuracy > 1500 ? ` ${th('loc.rough', { km: Math.round(accuracy / 1000) })}` : '';
    const others = near.slice(1).map(x => `<button type="button" class="near" data-st="${x.station}">${esc(tt.names[x.station])}, ${esc(dist(x.km))}</button>`).join(' ');
    say(`${th('loc.near', { station: raw(`<b>${esc(tt.names[near[0].station])}</b>`), dist: dist(near[0].km) })}${rough} ${th('loc.private')}${others ? ` ${th('loc.notHere')} ${others}` : ''}`);
  }

  function locate(silent = false) {
    if (!getTt()) return;
    if (!navigator.geolocation) { if (!silent) say(th('loc.unsupported')); return; }
    locateBtn.disabled = true;
    if (!silent) say(th('loc.looking'));
    navigator.geolocation.getCurrentPosition(pos => located(pos, silent), err => {
      locateBtn.disabled = false;
      if (!silent) say(th(FAILS[err && err.code] || FAILS[2]));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  locateBtn.addEventListener('click', () => locate());
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
  window.addEventListener('resize', () => { if (!$('#pane-live').hidden && Math.abs(($('#lres').clientWidth || 0) - drawnWidth) > 40) run(); });

  $('#lres').addEventListener('click', ev => {
    const b = ev.target.closest('button.follow');
    if (!b || !lastRun || !onFollow) return;
    const o = lastRun.options[+b.dataset.way];
    if (!o) return;
    onFollow({ day: lastRun.day, legs: o.legs, dst: lastRun.dst, plannedArr: lastRun.base, out: lastRun.out });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  return {
    run,
    // Another start or target: the trains marked out, the plan we had and the zoom belonged to the old ones.
    forget,
    // The position again, with no word said unless it is asked for (silent: false).
    locate,
    // From the chain view: this leg's train is out. We stand at its boarding station at its departure time.
    fromChain(lastPlan, i) {
      const tt = getTt(), { res, q } = lastPlan, leg = res.legs[i], last = res.legs[res.legs.length - 1];
      const shift = Math.floor(leg.dep / 1440);
      forget();
      setPlace({ src: leg.from, dst: q.dst, day: Math.min(tt.nDays - 1, q.day + shift), time: hm(leg.dep), now: false, from: 'manual' });
      plannedClock = ((last.arr % 1440) + 1440) % 1440;
      out.add(tt.tripKey(leg.svcDay, leg.trip));
      ghost = res.legs.slice(i).filter(l => !l.walk).map(l => ({ from: l.from, to: l.to }));
      run();
    },
    // From Navigate: the ways on from here, now, against the plan you are following.
    fromState({ day, src, dst, t0, plannedArr, out: outKeys }) {
      const tt = getTt();
      forget();
      setPlace({ src, dst, day: Math.min(tt.nDays - 1, day + Math.floor(t0 / 1440)), time: hm(t0), now: false, from: 'manual' });
      plannedClock = ((plannedArr % 1440) + 1440) % 1440;
      for (const k of outKeys) out.add(k);
      run();
    },
    // The language changed: draw everything again in it. The marked trains, the plan and the stations stay.
    refresh() {
      say('');
      shownHtml.delete($('#lres')); shownHtml.delete($('#ldeps'));
      if (getTt()) run();
    },
    // A new timetable replaced the old one: station numbers changed (the page looks the stations up again by name), so
    // what was marked out and the buttons of the candidates are forgotten.
    onTimetable() {
      forget();
      say('');    // the candidate buttons carry station numbers of the old timetable
    },
  };
}
