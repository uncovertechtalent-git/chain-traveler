// The maths of pan and zoom: the point under the pointer stays put, the limits hold, two fingers zoom and move. The
// element that binds this to the pointer is checked in a browser; these are the plain functions under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIT, MIN_K, MAX_K, isFit, clampView, zoomAt, panBy, pinchTo, rescale } from '../../app/zoomview.js';
import { withView } from '../../app/graph.js';

const W = 720, H = 520;
const flat = (lat, lon) => ({ x: lon, y: lat });
const screen = (v, w) => withView(flat, v, W, H)(w.y, w.x);      // where a picture point ends up in a view
const world = (v, q) => ({ x: (q.x - W / 2 - v.dx) / v.k + W / 2, y: (q.y - H / 2 - v.dy) / v.k + H / 2 });   // the point shown at q
const near = (a, b, d = 0.06) => assert.ok(Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

test('the fit is the identity and is frozen', () => {
  assert.deepEqual(FIT, { k: 1, dx: 0, dy: 0 });
  assert.ok(isFit(FIT) && !isFit({ k: 1.01, dx: 0, dy: 0 }) && !isFit({ k: 1, dx: 1, dy: 0 }) && !isFit({ k: 1, dx: 0, dy: -1 }));
  assert.throws(() => { 'use strict'; FIT.k = 2; }, TypeError);
});

test('zoomAt keeps the point under the pointer where it is, in and out, from any view', () => {
  for (const v of [FIT, { k: 2, dx: 30, dy: -20 }, { k: 0.7, dx: -50, dy: 10 }]) {
    for (const f of [1.4, 2, 0.5, 1 / 1.4]) {
      for (const q of [{ x: 100, y: 80 }, { x: 360, y: 260 }, { x: 700, y: 500 }]) {
        const w = world(v, q);
        const z = zoomAt(v, f, q.x, q.y, W, H);
        near(screen(z, w), q);
        assert.ok(Math.abs(z.k - Math.min(MAX_K, Math.max(MIN_K, v.k * f))) < 1e-9);
      }
    }
  }
});

test('zoom stays within its limits, and at a limit the picture does not slide', () => {
  let v = FIT;
  for (let i = 0; i < 50; i++) v = zoomAt(v, 1.4, 100, 100, W, H);
  assert.equal(v.k, MAX_K);
  const stuck = zoomAt(v, 1.4, 500, 400, W, H);
  assert.deepEqual(stuck, v);
  for (let i = 0; i < 80; i++) v = zoomAt(v, 1 / 1.4, 100, 100, W, H);
  assert.equal(v.k, MIN_K);
  assert.deepEqual(zoomAt(v, 0.5, 5, 5, W, H), v);
});

test('panning follows the hand, and the middle of the picture cannot leave the frame', () => {
  assert.deepEqual(panBy(FIT, 12, -7, W, H), { k: 1, dx: 12, dy: -7 });
  assert.deepEqual(panBy({ k: 2, dx: 12, dy: -7 }, 3, 3, W, H), { k: 2, dx: 15, dy: -4 });
  assert.deepEqual(panBy(FIT, 1e6, -1e6, W, H), { k: 1, dx: W / 2, dy: -H / 2 });
  assert.deepEqual(panBy({ k: 4, dx: 0, dy: 0 }, -1e6, 1e6, W, H), { k: 4, dx: -W * 2, dy: H * 2 });
  assert.deepEqual(clampView({ k: 99, dx: 0, dy: 0 }, W, H), { k: MAX_K, dx: 0, dy: 0 });
  assert.equal(clampView({ k: 0.01, dx: 0, dy: 0 }, W, H).k, MIN_K);
});

test('two fingers moving apart zoom about their middle; moving together zoom out', () => {
  const a0 = { x: 300, y: 260 }, b0 = { x: 400, y: 260 };
  const w = world(FIT, { x: 350, y: 260 });
  const out = pinchTo(FIT, a0, b0, { x: 250, y: 260 }, { x: 450, y: 260 }, W, H);
  assert.ok(Math.abs(out.k - 2) < 1e-9);
  near(screen(out, w), { x: 350, y: 260 });
  const inw = pinchTo(FIT, a0, b0, { x: 325, y: 260 }, { x: 375, y: 260 }, W, H);
  assert.ok(Math.abs(inw.k - 0.5) < 1e-9);
});

test('two fingers moving together drag the picture without zooming', () => {
  const r = pinchTo({ k: 2, dx: 5, dy: 5 }, { x: 300, y: 260 }, { x: 400, y: 260 }, { x: 330, y: 270 }, { x: 430, y: 270 }, W, H);
  assert.ok(Math.abs(r.k - 2) < 1e-9);
  assert.deepEqual([r.dx, r.dy], [35, 15]);
});

test('two fingers on one spot do not divide by zero', () => {
  const p = { x: 300, y: 260 };
  assert.deepEqual(pinchTo(FIT, p, p, { x: 310, y: 260 }, { x: 330, y: 260 }, W, H), { k: 1, dx: 20, dy: 0 });
  const r = pinchTo(FIT, { x: 300, y: 260 }, { x: 400, y: 260 }, p, p, W, H);
  assert.ok(Number.isFinite(r.k) && Number.isFinite(r.dx) && r.k === 1);
});

test('a picture drawn wider or narrower keeps its place in proportion', () => {
  assert.deepEqual(rescale({ k: 2, dx: 100, dy: -50 }, 400, 800), { k: 2, dx: 200, dy: -100 });
  const same = { k: 2, dx: 100, dy: -50 };
  assert.equal(rescale(same, 400, 400), same);
  assert.equal(rescale(same, 0, 400), same, 'nothing drawn before');
  assert.equal(rescale(same, 400, 0), same);
});
