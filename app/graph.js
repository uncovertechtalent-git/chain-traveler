// The Plan B graph as an SVG string: stations at their real positions, legs as lines. Colour says how late a way is
// against the plan, thickness says how many trains an hour serve the leg. Pure string building: no DOM, and no style
// attribute anywhere, so the page keeps to its Content-Security-Policy. Colours and dashes live in style.css.
import { fmt } from './engine.js';

export const WIDTH = 720, HEIGHT = 520;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// "Leipzig Hbf" is "Leipzig", "Leipzig Hbf (tief)" is "Leipzig (tief)": two stations a short walk apart stay two labels.
export const short = name => name.replace(/\s+Hbf(\s*\(tief\))?$/, (m, tief) => (tief ? ' (tief)' : ''));
const ORDER = { bad: 0, mid: 1, good: 2, ghost: 3, active: 4 };   // drawn in this order: the good ways on top of the bad, the plan we had over those, the route being followed over all
const kindOf = e => (e.kind === 'ghost' || e.kind === 'active' ? e.kind : e.band);

// 1 train an hour is a thin line, 4 or more a thick one.
export const widthOf = perHour => +(2 + 1.75 * Math.min(4, Math.max(1, perHour))).toFixed(2);

// Place the stations in the box: longitude shrunk by cos(latitude), north up, scaled to fit, centred. A box that
// would zoom in on a handful of close stations is kept to a minimum size.
export function projector(nodes, { width = WIDTH, height = HEIGHT, padX = 96, padY = 34 } = {}) {
  if (!nodes.length) return () => ({ x: width / 2, y: height / 2 });
  const lat0 = nodes.reduce((s, n) => s + n.lat, 0) / nodes.length;
  const k = Math.cos(lat0 * Math.PI / 180);
  const xs = nodes.map(n => n.lon * k), ys = nodes.map(n => -n.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.4 * k), spanY = Math.max(maxY - minY, 0.4);
  const scale = Math.min((width - 2 * padX) / spanX, (height - 2 * padY) / spanY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return (lat, lon) => ({ x: +(width / 2 + (lon * k - cx) * scale).toFixed(1), y: +(height / 2 + (-lat - cy) * scale).toFixed(1) });
}
export function project(nodes, opts) {
  const at = projector(nodes, opts);
  return nodes.map(n => at(n.lat, n.lon));
}

// The network around the ways, as quiet background: a hairline for the leg that first reaches each station and a dot
// at every station, only inside the box (the viewBox clips the rest). The same projection as the ways, so it lines up.
const CTX_EDGES = 1200;
function contextSvg(context, at, { width, height }, onWays) {
  const pts = new Map(context.nodes.map(n => [n.st, at(n.lat, n.lon)]));
  const near = p => p.x > -30 && p.x < width + 30 && p.y > -30 && p.y < height + 30;
  const inside = p => p.x > 3 && p.x < width - 3 && p.y > 3 && p.y < height - 3;
  let s = '';
  let n = 0;
  for (const e of context.edges) {
    const a = pts.get(e.from), b = pts.get(e.to);
    if (n < CTX_EDGES && (near(a) || near(b))) { s += `<line class="cl" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`; n++; }
  }
  for (const node of context.nodes) {
    const p = pts.get(node.st);
    if (!onWays.has(node.st) && inside(p)) s += `<circle class="cx" cx="${p.x}" cy="${p.y}" r="2"/>`;
  }
  return s;
}

// The busiest context stations inside the box, as label candidates, so the picture names where the network is dense.
// A hub keeps its distance from the stations of the ways (it would only name the same town twice) and from the other
// hubs.
const HUB_GAP = 46;
function hubs(context, at, { width, height }, onWays, wayPts, max = 4) {
  const far = (p, others) => others.every(q => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 >= HUB_GAP * HUB_GAP);
  const out = [];
  const candidates = context.nodes
    .filter(n => !onWays.has(n.st))
    .map(n => ({ n, p: at(n.lat, n.lon) }))
    .filter(({ p }) => p.x > 12 && p.x < width - 12 && p.y > 14 && p.y < height - 24)
    .sort((a, b) => b.n.deg - a.n.deg);
  for (const c of candidates) {
    if (out.length >= max) break;
    if (far(c.p, wayPts) && far(c.p, out.map(o => o.p))) out.push(c);
  }
  return out;
}

// Labels to the right of the station, or to the left in the right part of the box; nudged up or down, or flipped,
// until they clear the labels already placed. Important stations (the start, the target) are placed first. A label that
// found no clear place is returned where it was first tried, with clear: false.
export function placeLabels(items, width = WIDTH) {
  const placed = [];
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  return items.map(it => {
    const side = it.x > width * 0.6 ? -1 : 1;
    let first = null;
    for (const sd of [side, -side]) {
      for (const dy of [0, 16, -16, 32, -32]) {
        const x0 = sd > 0 ? it.x + 10 : it.x - 10 - it.w, y0 = it.y - 12 + dy;
        const box = { x0, y0, x1: x0 + it.w, y1: y0 + it.h };
        const r = { anchor: sd > 0 ? 'start' : 'end', x: sd > 0 ? it.x + 10 : it.x - 10, y: it.y + dy };
        first = first || { box, r };
        if (box.x0 >= 2 && box.x1 <= width - 2 && !placed.some(p => hit(p, box))) { placed.push(box); return { ...r, clear: true }; }
      }
    }
    placed.push(first.box);
    return { ...first.r, clear: false };
  });
}

function timeOf(n, t0) {
  if (n.src) return t0 === null || t0 === undefined ? '' : fmt(t0);
  if (n.arr === null) return '';
  return fmt(n.arr);
}

export function svgOf(model, { width = WIDTH, height = HEIGHT, label = 'Ways on', min = 'min' } = {}) {
  const proj = projector(model.me ? [...model.nodes, model.me] : model.nodes, { width, height, padX: width < 500 ? 70 : 96 });
  const pos = model.nodes.map(n => proj(n.lat, n.lon));
  const at = new Map(model.nodes.map((n, i) => [n.st, pos[i]]));
  const onWays = new Set(model.nodes.map(n => n.st));
  const edges = [...model.edges].sort((a, b) => ORDER[kindOf(a)] - ORDER[kindOf(b)]);
  let s = `<svg class="pb" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>`;
  const ctx = model.context && model.context.nodes.length ? model.context : null;
  if (ctx) s += contextSvg(ctx, proj, { width, height }, onWays);
  for (const e of edges) {
    const a = at.get(e.from), b = at.get(e.to);
    if (e.kind === 'ghost') s += `<line class="e ghost" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    else if (e.kind === 'active') s += `<line class="e act" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="6"/>`;
    else if (e.kind === 'walk') s += `<line class="e walk ${e.band}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="3"/>`;
    else s += `<line class="e ${e.band}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${widthOf(e.perHour)}"/>`;
  }
  const BAND = ['good', 'mid', 'bad'];
  for (const n of model.nodes) {
    const p = at.get(n.st);
    const cls = n.src ? 'src' : n.dst ? 'dst ' + n.band : n.rank < 3 ? BAND[n.rank] : '';
    s += `<circle class="n ${cls}" cx="${p.x}" cy="${p.y}" r="${n.src || n.dst ? 7 : 5}"/>`;
  }
  const order = [...model.nodes.keys()].sort((i, j) => (model.nodes[j].src || model.nodes[j].dst ? 1 : 0) - (model.nodes[i].src || model.nodes[i].dst ? 1 : 0));
  const items = order.map(i => {
    const n = model.nodes[i], p = at.get(n.st);
    const tm = timeOf(n, model.t0) + (n.dst && n.delta > 0 ? ' +' + n.delta + ' ' + min : '');
    return { n, x: p.x, y: p.y, nm: short(n.name), tm, w: Math.max(short(n.name).length * 7.2, tm.length * 6.6) + 4, h: 30 };
  });
  const me = model.me ? proj(model.me.lat, model.me.lon) : null;
  if (me) {
    s += `<circle class="me halo" cx="${me.x}" cy="${me.y}" r="12"/><circle class="me" cx="${me.x}" cy="${me.y}" r="6"/>`;
    if (model.me.label) items.push({ n: { name: model.me.label, src: true }, x: me.x, y: me.y, nm: model.me.label, tm: '', w: model.me.label.length * 7.2 + 4, h: 14, me: true });
  }
  // The names of the busiest stations around come last, so the stations on the ways keep their places.
  const hub = ctx ? hubs(ctx, proj, { width, height }, onWays, pos) : [];
  for (const { n, p } of hub) items.push({ n, x: p.x, y: p.y, nm: short(n.name), tm: '', w: short(n.name).length * 6.4 + 4, h: 14, hub: true });
  placeLabels(items, width).forEach((r, k) => {
    const it = items[k], key = it.n.src || it.n.dst;
    if (it.me) { s += `<text class="nm key me" x="${r.x}" y="${r.y}" text-anchor="${r.anchor}">${esc(it.nm)}</text>`; return; }
    if (it.hub) { if (r.clear) s += `<text class="nm hub" x="${r.x}" y="${r.y}" text-anchor="${r.anchor}">${esc(it.nm)}</text>`; return; }
    s += `<text class="nm${key ? ' key' : ''}" x="${r.x}" y="${r.y}" text-anchor="${r.anchor}">${esc(it.nm)}</text>`;
    if (it.tm) s += `<text class="tm" x="${r.x}" y="${r.y + 13}" text-anchor="${r.anchor}">${esc(it.tm)}</text>`;
  });
  return s + '</svg>';
}
