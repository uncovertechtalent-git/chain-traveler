// Live delays: an overlay on the planned timetable, nothing more. data/delays.json is cut from the gtfs.de GTFS-Realtime
// stream by build/realtime.py every five minutes and says, per run (a trip on one service day), how late it is, that it is
// cancelled, or that stops are skipped. This module fetches it, checks it, answers lookups, and marks legs. The routing
// engine never sees it: the ways are still computed on planned times.
//
// What a mark means, and what its absence means: a leg with a mark has live data. A leg without one has none, because
// the feed is partial (about a fifth of today's runs, most of them running or about to), and that is not the same as
// on time, so nothing is drawn for it.
//
// A file is used only if it is well formed, made for the timetable build in use (numbers of trips are per build), no
// older than 15 minutes by its stream timestamp, and not dated ahead of the device's clock. Otherwise there is no data.
import { t, dur } from './i18n.js';

export const FORMAT = 1;
export const PATH = 'data/delays.json';
export const MAX_AGE_MS = 15 * 60 * 1000;    // the stream is older than this: stale, no data
export const MAX_AHEAD_MS = 5 * 60 * 1000;   // dated further ahead than this: the clock is wrong, no data
export const MAX_BYTES = 1024 * 1024;        // the same limit as build/realtime.py
export const MAX_DELAY_MIN = 24 * 60;
export const MID_MIN = 6;                    // from this many minutes late a mark is amber ...
export const BAD_MIN = 30;                   // ... and from this many red; the words carry the number either way

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_RE = /^\d{1,9}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export class DelaysError extends Error {
  constructor(message) { super(message); this.name = 'DelaysError'; }
}

const isInt = v => Number.isInteger(v);
// A real calendar day: 2026-02-30 is not one (Date.parse would roll it over to March).
const isDay = s => DATE_RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

// The runs of a validated file, by service day and trip number.
export class Delays {
  constructor({ feedTime, source, days }) {
    this.feedTime = feedTime;      // ms: the stream's own timestamp, not the time the file was made
    this.source = source;          // { publisher, license }
    this.days = days;              // Map iso date -> { delay: Map, cancelled: Set, skipped: Map }
  }

  // Usable at `now` (ms)? Not stale, and not from the future.
  fresh(now) {
    const age = now - this.feedTime;
    return age <= MAX_AGE_MS && -age <= MAX_AHEAD_MS;
  }

  // What the file says about one run: { cancelled, min (minutes late, negative early, null when it gives no delay),
  // skipped (stops skipped) }, or null when it says nothing. Null is "no data", never "on time".
  of(iso, trip) {
    const d = this.days.get(iso);
    if (!d) return null;
    const cancelled = d.cancelled.has(trip), min = d.delay.has(trip) ? d.delay.get(trip) : null, skipped = d.skipped.get(trip) || 0;
    return cancelled || min !== null || skipped ? { cancelled, min, skipped } : null;
  }
}

// A Delays from the parsed file, or a DelaysError saying why not. manifest: the build in use (its date and sha256).
export function checkDelays(d, { manifest, now }) {
  const bad = why => { throw new DelaysError('delays: ' + why); };
  if (!d || typeof d !== 'object' || Array.isArray(d)) bad('not an object');
  if (d.format !== FORMAT) bad('format ' + d.format + ' is not supported by this version of the app');
  for (const k of ['built', 'feedTime']) if (typeof d[k] !== 'string' || !STAMP_RE.test(d[k])) bad(k);
  const feedTime = Date.parse(d.feedTime);
  if (Number.isNaN(feedTime)) bad('feedTime');
  const s = d.source;
  if (!s || typeof s !== 'object' || [s.publisher, s.license].some(v => typeof v !== 'string' || !v || v.length > 400)) bad('source');
  const tt = d.timetable;
  if (!tt || typeof tt !== 'object' || tt.date !== manifest.date || tt.sha256 !== manifest.sha256) bad('made for another timetable build');
  if (!d.trips || typeof d.trips !== 'object' || Array.isArray(d.trips)) bad('trips');
  const days = new Map();
  for (const [iso, day] of Object.entries(d.trips)) {
    if (!isDay(iso)) bad('day ' + iso);
    if (!day || typeof day.delay !== 'object' || !day.delay || Array.isArray(day.delay) || !Array.isArray(day.cancelled)
      || typeof day.skipped !== 'object' || !day.skipped || Array.isArray(day.skipped)) bad('day ' + iso + ' needs delay, cancelled and skipped');
    const delay = new Map(), skipped = new Map();
    for (const [k, v] of Object.entries(day.delay)) {
      if (!NUM_RE.test(k) || !isInt(v) || Math.abs(v) > MAX_DELAY_MIN) bad('delay of ' + k);
      delay.set(+k, v);
    }
    for (const [k, v] of Object.entries(day.skipped)) {
      if (!NUM_RE.test(k) || !isInt(v) || v < 1) bad('skipped of ' + k);
      skipped.set(+k, v);
    }
    for (const v of day.cancelled) if (!isInt(v) || v < 0) bad('cancelled run ' + v);
    days.set(iso, { delay, cancelled: new Set(day.cancelled), skipped });
  }
  const out = new Delays({ feedTime, source: { publisher: s.publisher, license: s.license }, days });
  if (!out.fresh(now)) bad('stale or dated ahead of the clock');
  return out;
}

// Fetch the file from the app's own origin, past every cache, and check it. Resolves a Delays, or null for anything
// that goes wrong (offline, not published, malformed, stale, for another build): there is then simply no live data.
// base: absolute URL of the app directory, ending in "/".
export async function fetchDelays({ fetch, base, manifest, now = Date.now() }) {
  try {
    const res = await fetch(new URL(PATH, base).href, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_BYTES) return null;
    return checkDelays(JSON.parse(text), { manifest, now });
  } catch {
    return null;
  }
}

// ---- what the page does with it

let current = null;
export const useDelays = d => { current = d; };
export const haveDelays = (now = Date.now()) => !!current && current.fresh(now);
export const delaysInfo = () => (current ? { source: current.source, feedTime: current.feedTime } : null);

// The time of day of the stream's timestamp, 24-hour, in Germany, as the clock times elsewhere on the page.
export const clock = ms => new Date(ms).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });

// An empty mark for a run, to put in the markup of a leg; paintRt() fills it when the run has live data. The date and
// the trip number are numbers and digits, so nothing needs escaping.
export const rtMark = (iso, trip) => `<span class="rt" data-rt="${iso}:${trip}" hidden></span>`;
// A line saying what a mark means, for the markup of a list of legs.
export const rtNote = () => '<p class="note" data-rt-note hidden></p>';

// How a run looks: the words and the band (good, mid, bad) for its colour. Colour is never the only carrier.
export function describe(s) {
  const parts = [];
  let band = 'good';
  if (s.cancelled) { parts.push(t('rt.cancelled')); band = 'bad'; }
  else {
    if (s.min !== null) {
      parts.push(s.min > 0 ? '+' + dur(s.min) : s.min < 0 ? t('rt.early', { dur: dur(-s.min) }) : t('rt.onTime'));
      band = s.min >= BAD_MIN ? 'bad' : s.min >= MID_MIN ? 'mid' : 'good';
    }
    if (s.skipped) { parts.push(t('rt.skipped', { n: s.skipped })); if (band === 'good') band = 'mid'; }
  }
  return { text: parts.join(', '), band };
}

// Fill the marks and the note under `root` from the delays in use, and hide what has no data. Safe to call as often as
// you like; a stale file counts as no file.
export function paintRt(root = document, now = Date.now()) {
  const on = haveDelays(now);
  const time = on ? clock(current.feedTime) : '';
  for (const el of root.querySelectorAll('[data-rt]')) {
    const [iso, trip] = el.dataset.rt.split(':');
    const s = on ? current.of(iso, +trip) : null;
    if (!s) { el.hidden = true; el.textContent = ''; el.className = 'rt'; continue; }
    const { text, band } = describe(s);
    el.hidden = false;
    el.className = 'rt ' + band;
    el.dataset.live = t('rt.live');
    el.textContent = text;
    el.title = t('rt.title', { time });
  }
  for (const el of root.querySelectorAll('[data-rt-note]')) {
    el.hidden = !on;
    el.textContent = on ? t('rt.note') : '';
  }
}
