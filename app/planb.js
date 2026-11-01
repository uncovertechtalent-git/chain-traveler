// Plan B: I am here, my next train is out, and I still want to get there. The ways on, each set against the plan, with
// the trains an hour that stand behind every leg. Pure functions over a Timetable: no DOM and no clock, so they run
// in Node as they do in the browser.
//
// What the numbers mean, and what they do not: the timetable has planned times only. "Late" is how much later than the
// plan a way arrives if every train on it runs as planned. "Trains an hour" is the structure of the timetable (how
// many runs serve a leg), not a probability: it says how many fallbacks you have if you miss that leg.
import { INF } from './engine.js';

export const GOOD_MIN = 15;    // arriving up to this many minutes after the plan still counts as on plan (green)
export const LATE_MIN = 60;    // up to this many minutes after the plan is late (amber); beyond it, much later (red)

export function bandOf(delta) {
  return delta <= GOOD_MIN ? 'good' : delta <= LATE_MIN ? 'mid' : 'bad';
}
const RANK = { good: 0, mid: 1, bad: 2 };

// Distinct ways from src to dst, leaving at or after t0, earliest arrival first. Each pass asks for the earliest chain
// that leaves after the first train of the previous one, so the ways differ in what they board first. `exclude` is a
// Set of tripKey() values: runs that do not happen.
export function ways(tt, { day, src, dst, t0, exclude = null, minTransfer = 4, window = 180, max = 4 }) {
  if (src < 0 || dst < 0 || src === dst) return [];
  const out = [], seen = new Set();
  let from = t0;
  for (let pass = 0; pass < 24 && out.length < max; pass++) {
    const r = tt.earliestArrival({ day, src, t0: from, minTransfer, target: dst, exclude });
    if (r.arr[dst] >= INF) break;
    const legs = tt.legsTo(r, dst);
    const rides = legs ? legs.filter(l => !l.walk) : [];
    if (!rides.length) break;
    const arr = legs[legs.length - 1].arr;
    if (out.length && arr > out[0].arr + window) break;
    const sig = rides.map(l => tt.tripKey(l.svcDay, l.trip)).join('>');
    if (!seen.has(sig)) { seen.add(sig); out.push({ legs, dep: rides[0].dep, arr }); }
    from = rides[0].dep + 1;
    if (from > t0 + window) break;
  }
  return out;
}

function describe(tt, o, { day, exclude }) {
  const perLeg = o.legs.map(l => (l.walk ? 0 : Math.max(1, tt.callsPerWindow({ day, from: l.from, to: l.to, t: l.dep, exclude }))));
  const rides = o.legs.filter(l => !l.walk);
  let tightest = null;
  o.legs.forEach((l, i) => { if (i > 0 && !l.walk) { const w = l.dep - o.legs[i - 1].arr; tightest = tightest === null ? w : Math.min(tightest, w); } });
  const thinnest = Math.min(...perLeg.filter((n, i) => !o.legs[i].walk));
  return { ...o, changes: Math.max(0, rides.length - 1), tightest, perLeg, thinnest };
}

// Names for what sets a way apart, only where it does tell the ways apart.
function tag(options) {
  options.forEach(o => { o.tags = []; });
  options[0].tags.push('earliest');
  if (options.length < 2) return;
  const fewest = Math.min(...options.map(o => o.changes));
  const fewList = options.filter(o => o.changes === fewest);
  if (fewList.length < options.length) fewList.forEach(o => o.tags.push('fewest'));
  const most = Math.max(...options.map(o => o.thinnest));
  const robust = options.filter(o => o.thinnest === most);
  if (robust.length < options.length) robust.forEach(o => o.tags.push('robust'));
}

// The ways on, against the plan. plannedArr is the arrival the plan promised (minutes after midnight of `day`); without
// it the best way on is the yardstick.
export function plan(tt, { day, src, dst, t0, plannedArr = null, exclude = null, minTransfer = 4, window = 180, max = 4 }) {
  if (src === dst) return { options: [], error: 'You are already at the target.', code: 'alreadyThere' };
  const found = ways(tt, { day, src, dst, t0, exclude, minTransfer, window, max });
  if (!found.length) return { options: [], error: 'No way on to the target from here after that time.', code: 'noWay' };
  const base = plannedArr !== null ? plannedArr : found[0].arr;
  const options = found.map(o => {
    const d = describe(tt, o, { day, exclude });
    const delta = o.arr - base;
    return { ...d, delta, band: bandOf(delta) };
  });
  tag(options);
  return { options, base, baseKind: plannedArr !== null ? 'plan' : 'best', src, dst, t0 };
}

// The network around the journey, for the graph: the stations reachable from src within maxMin minutes and the leg that
// first reaches each (the earliest-arrival tree), with positions. Quiet background: it belongs to no way.
export function contextOf(tt, { day, src, t0, exclude = null, minTransfer = 4, maxMin = 180 }) {
  const edges = tt.reachEdges(tt.earliestArrival({ day, src, t0, minTransfer, exclude }), { maxMin });
  const ids = new Set();
  for (const e of edges) { ids.add(e.from); ids.add(e.to); }
  return {
    nodes: [...ids].map(st => ({ st, name: tt.names[st], lat: tt.lat[st], lon: tt.lon[st], deg: tt.degree[st] })),
    edges: edges.map(e => ({ from: e.from, to: e.to })),
  };
}

// The ways as a graph: stations as nodes, legs as edges. An edge takes the colour of the best way that uses it and the
// most trains an hour of any way that uses it. ghost: the legs of the original plan still ahead, drawn for comparison.
// context: contextOf(), carried along for the drawing.
export function graphOf(tt, result, { ghost = null, context = null } = {}) {
  const nodes = new Map(), edges = new Map();
  const node = s => {
    if (!nodes.has(s)) nodes.set(s, { st: s, name: tt.names[s], lat: tt.lat[s], lon: tt.lon[s], arr: null, rank: 3, src: s === result.src, dst: s === result.dst });
    return nodes.get(s);
  };
  const out = [];
  for (const g of ghost || []) {
    node(g.from); node(g.to);
    const key = 'g' + g.from + '>' + g.to;
    if (!edges.has(key)) edges.set(key, { from: g.from, to: g.to, kind: 'ghost' });
  }
  result.options.forEach((o, idx) => {
    o.legs.forEach((l, i) => {
      const a = node(l.from), b = node(l.to);
      b.arr = b.arr === null ? l.arr : Math.min(b.arr, l.arr);
      a.rank = Math.min(a.rank, RANK[o.band]); b.rank = Math.min(b.rank, RANK[o.band]);
      const key = (l.walk ? 'w' : 'r') + l.from + '>' + l.to;
      let e = edges.get(key);
      if (!e) { e = { from: l.from, to: l.to, kind: l.walk ? 'walk' : 'ride', delta: Infinity, band: 'bad', perHour: 0, ways: [] }; edges.set(key, e); }
      if (o.delta < e.delta) { e.delta = o.delta; e.band = o.band; }
      if (!l.walk) e.perHour = Math.max(e.perHour, o.perLeg[i]);
      e.ways.push(idx);
    });
  });
  for (const e of edges.values()) out.push(e);
  const dstNode = nodes.get(result.dst);
  if (dstNode) { const best = result.options.reduce((m, o) => (o.delta < m.delta ? o : m), result.options[0]); dstNode.delta = best.delta; dstNode.band = best.band; }
  return { nodes: [...nodes.values()], edges: out, src: result.src, dst: result.dst, t0: result.t0, baseKind: result.baseKind, context };
}
