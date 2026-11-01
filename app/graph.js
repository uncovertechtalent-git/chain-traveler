// The Plan B graph as an SVG string: stations at their real positions, legs as lines. Colour says how late a way is
// against the plan, thickness says how many trains an hour serve the leg. Pure string building: no DOM, and no style
// attribute anywhere, so the page keeps to its Content-Security-Policy. Colours and dashes live in style.css.
import { fmt } from './engine.js';

export const WIDTH = 720, HEIGHT = 520;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// "Leipzig Hbf" is "Leipzig", "Leipzig Hbf (tief)" is "Leipzig (tief)": two stations a short walk apart stay two labels.
export const short = name => name.replace(/\s+Hbf(\s*\(tief\))?$/, (m, tief) => (tief ? ' (tief)' : ''));
const ORDER = { bad: 0, mid: 1, good: 2, ghost: 3 };      // drawn in this order: the good ways on top of the bad, the plan we had over all

// 1 train an hour is a thin line, 4 or more a thick one.
export const widthOf = perHour => +(2 + 1.75 * Math.min(4, Math.max(1, perHour))).toFixed(2);

// Place the stations in the box: longitude shrunk by cos(latitude), north up, scaled to fit, centred. A box that
// would zoom in on a handful of close stations is kept to a minimum size.
export function project(nodes, { width = WIDTH, height = HEIGHT, padX = 96, padY = 34 } = {}) {
  if (!nodes.length) return [];
  const lat0 = nodes.reduce((s, n) => s + n.lat, 0) / nodes.length;
  const k = Math.cos(lat0 * Math.PI / 180);
  const xs = nodes.map(n => n.lon * k), ys = nodes.map(n => -n.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.4 * k), spanY = Math.max(maxY - minY, 0.4);
  const scale = Math.min((width - 2 * padX) / spanX, (height - 2 * padY) / spanY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return nodes.map((n, i) => ({ x: +(width / 2 + (xs[i] - cx) * scale).toFixed(1), y: +(height / 2 + (ys[i] - cy) * scale).toFixed(1) }));
}

// Labels to the right of the station, or to the left in the right part of the box; nudged up or down, or flipped,
// until they clear the labels already placed. Important stations (the start, the target) are placed first.
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
        if (box.x0 >= 2 && box.x1 <= width - 2 && !placed.some(p => hit(p, box))) { placed.push(box); return r; }
      }
    }
    placed.push(first.box);
    return first.r;
  });
}

function timeOf(n, t0) {
  if (n.src) return t0 === null || t0 === undefined ? '' : fmt(t0);
  if (n.arr === null) return '';
  return fmt(n.arr);
}

export function svgOf(model, { width = WIDTH, height = HEIGHT, label = 'Ways on' } = {}) {
  const pos = project(model.nodes, { width, height, padX: width < 500 ? 70 : 96 });
  const at = new Map(model.nodes.map((n, i) => [n.st, pos[i]]));
  const edges = [...model.edges].sort((a, b) => ORDER[a.kind === 'ghost' ? 'ghost' : a.band] - ORDER[b.kind === 'ghost' ? 'ghost' : b.band]);
  let s = `<svg class="pb" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>`;
  for (const e of edges) {
    const a = at.get(e.from), b = at.get(e.to);
    if (e.kind === 'ghost') s += `<line class="e ghost" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
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
    const tm = timeOf(n, model.t0) + (n.dst && n.delta > 0 ? ' +' + n.delta + ' min' : '');
    return { n, x: p.x, y: p.y, nm: short(n.name), tm, w: Math.max(short(n.name).length * 7.2, tm.length * 6.6) + 4, h: 30 };
  });
  placeLabels(items, width).forEach((r, k) => {
    const it = items[k], key = it.n.src || it.n.dst;
    s += `<text class="nm${key ? ' key' : ''}" x="${r.x}" y="${r.y}" text-anchor="${r.anchor}">${esc(it.nm)}</text>`;
    if (it.tm) s += `<text class="tm" x="${r.x}" y="${r.y + 13}" text-anchor="${r.anchor}">${esc(it.tm)}</text>`;
  });
  return s + '</svg>';
}
