// Pan and zoom for the graphs, and the "Show map" switch. Not lively: the picture moves with the hand and stops when the
// hand does. A view is a zoom k and a shift (dx, dy) in picture units about the middle of the picture; app/graph.js
// applies it after the projection. The maths is plain functions; the rest binds them to pointer, wheel, keys and buttons
// on one element that stays in the page, so a gesture survives the redraws of the picture inside it.
import { t } from './i18n.js';

export const FIT = Object.freeze({ k: 1, dx: 0, dy: 0 });
export const MIN_K = 0.5;
export const MAX_K = 8;

export const isFit = v => v.k === 1 && v.dx === 0 && v.dy === 0;

// Keep the zoom in its limits and the middle of the picture inside the frame.
export function clampView(v, width, height) {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k));
  const mx = width * k / 2, my = height * k / 2;
  return { k, dx: Math.min(mx, Math.max(-mx, v.dx)), dy: Math.min(my, Math.max(-my, v.dy)) };
}

// Zoom by a factor and keep the point (px, py) of the picture where it is.
export function zoomAt(v, factor, px, py, width, height) {
  const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
  const r = k / v.k, cx = width / 2, cy = height / 2;
  return clampView({ k, dx: px - cx - (px - cx - v.dx) * r, dy: py - cy - (py - cy - v.dy) * r }, width, height);
}

export function panBy(v, ddx, ddy, width, height) {
  return clampView({ k: v.k, dx: v.dx + ddx, dy: v.dy + ddy }, width, height);
}

// Two fingers moved from (a0, b0) to (a1, b1): scale by the change of their distance about where they were, then follow
// the middle between them.
export function pinchTo(v, a0, b0, a1, b1, width, height) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const zoomed = d0 > 0 && d1 > 0 ? zoomAt(v, d1 / d0, m0.x, m0.y, width, height) : v;
  return panBy(zoomed, m1.x - m0.x, m1.y - m0.y, width, height);
}

// The picture got wider or narrower: the shift keeps its share of the picture.
export function rescale(v, from, to) {
  return from > 0 && to > 0 && from !== to ? { k: v.k, dx: v.dx * to / from, dy: v.dy * to / from } : v;
}

// ---- "Show map": one choice for every graph on the page, kept in this browser.
const KEY = 'ct-map';
let mapOn = true;
try { mapOn = localStorage.getItem(KEY) !== '0'; } catch { /* no storage: the default */ }
const views = new Set();
export const showMap = () => mapOn;
export function setShowMap(on) {
  mapOn = !!on;
  try { localStorage.setItem(KEY, mapOn ? '1' : '0'); } catch { /* not kept */ }
  for (const z of views) z.sync();
}

const STEP = 1.4;
const KEY_PAN = 40;

// One graph with its controls. show() hands it what to draw; the element goes into the page once.
export function zoomView() {
  const el = document.createElement('div');
  el.className = 'zoomwrap';
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  const pic = document.createElement('div');
  pic.className = 'zpic';
  const bar = document.createElement('div');
  bar.className = 'zbar';
  const btn = (act, text) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'zbtn'; b.dataset.z = act; b.textContent = text; return b; };
  const bOut = btn('out', '−'), bIn = btn('in', '+'), bFit = btn('fit', '');
  const lab = document.createElement('label');
  lab.className = 'zmap';
  const box = document.createElement('input');
  box.type = 'checkbox';
  const boxText = document.createElement('span');
  lab.append(box, boxText);
  bar.append(bOut, bIn, bFit, lab);
  const hint = document.createElement('p');
  hint.className = 'note zhint';
  el.append(pic, bar, hint);

  let view = FIT, width = 0, height = 0, draw = null, frame = 0;
  const pts = new Map();   // pointer id -> last place, in client pixels

  const unit = () => { const r = pic.firstElementChild ? pic.firstElementChild.getBoundingClientRect() : null; return r && r.width ? { r, u: width / r.width } : null; };
  const toPic = (p, f) => ({ x: (p.x - f.r.left) * f.u, y: (p.y - f.r.top) * f.u });

  function paint() {
    frame = 0;
    if (!draw) return;
    pic.innerHTML = draw(view);
    el.classList.toggle('zoomed', !isFit(view));
  }
  const later = () => { if (!frame) frame = requestAnimationFrame(paint); };
  const set = v => { view = v; later(); };

  const zoom = (factor, px = width / 2, py = height / 2) => set(zoomAt(view, factor, px, py, width, height));

  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-z]');
    if (!b) return;
    if (b.dataset.z === 'in') zoom(STEP);
    else if (b.dataset.z === 'out') zoom(1 / STEP);
    else set(FIT);
  });
  box.addEventListener('change', () => setShowMap(box.checked));

  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.zbar')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
    el.classList.add('grab');
  });
  el.addEventListener('pointermove', e => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    const f = unit();
    if (f) {
      if (pts.size === 1) view = panBy(view, (cur.x - prev.x) * f.u, (cur.y - prev.y) * f.u, width, height);
      else if (pts.size === 2) {
        const other = [...pts.entries()].find(([id]) => id !== e.pointerId)[1];
        view = pinchTo(view, toPic(prev, f), toPic(other, f), toPic(cur, f), toPic(other, f), width, height);
      }
      later();
    }
    pts.set(e.pointerId, cur);
  });
  const lift = e => { pts.delete(e.pointerId); if (!pts.size) el.classList.remove('grab'); };
  el.addEventListener('pointerup', lift);
  el.addEventListener('pointercancel', lift);

  // The wheel scrolls the page; with Ctrl or ⌘ held (a trackpad pinch arrives that way) it zooms about the pointer.
  el.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const f = unit();
    if (!f) return;
    const step = e.deltaMode === 1 ? 0.05 : Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025;
    const p = toPic({ x: e.clientX, y: e.clientY }, f);
    zoom(Math.exp(-e.deltaY * step), p.x, p.y);
  }, { passive: false });
  el.addEventListener('dblclick', e => {
    if (e.target.closest('.zbar')) return;
    const f = unit();
    if (!f) return;
    const p = toPic({ x: e.clientX, y: e.clientY }, f);
    zoom(2, p.x, p.y);
  });
  el.addEventListener('keydown', e => {
    if (e.target !== el || e.altKey || e.ctrlKey || e.metaKey) return;
    const pan = { ArrowLeft: [KEY_PAN, 0], ArrowRight: [-KEY_PAN, 0], ArrowUp: [0, KEY_PAN], ArrowDown: [0, -KEY_PAN] }[e.key];
    if (pan) set(panBy(view, pan[0], pan[1], width, height));
    else if (e.key === '+' || e.key === '=') zoom(STEP);
    else if (e.key === '-' || e.key === '_') zoom(1 / STEP);
    else if (e.key === '0') set(FIT);
    else return;
    e.preventDefault();
  });

  const self = {
    el,
    get view() { return view; },
    // What to draw and at which size. draw(view) returns the SVG; the view is kept between calls.
    show({ width: w, height: h, draw: fn }) {
      view = rescale(view, width, w);
      width = w; height = h; draw = fn;
      bOut.setAttribute('aria-label', t('map.zoomOut'));
      bIn.setAttribute('aria-label', t('map.zoomIn'));
      bFit.textContent = t('map.fit');
      boxText.textContent = t('map.show');
      hint.textContent = t('map.hint');
      el.setAttribute('aria-label', t('map.hint'));
      self.sync(false);
      views.add(self);
      paint();
    },
    reset() { view = FIT; },
    // The "Show map" choice changed (here or in the other graph): the box follows it and the picture is drawn again.
    sync(redraw = true) { box.checked = mapOn; if (redraw) paint(); },
    // The picture is gone from the page for good.
    drop() { views.delete(self); },
  };
  return self;
}
