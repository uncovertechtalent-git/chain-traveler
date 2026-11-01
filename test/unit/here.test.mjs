// Where you are and when: the clock of Germany, a time that follows it, and what becomes of a place that came from the
// device when the page is opened again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { berlinClock, tick, atLaunch, onReturn, migrate } from '../../app/here.js';

test('the clock of Germany: winter time, summer time and midnight', () => {
  assert.deepEqual(berlinClock(new Date('2026-11-01T14:09:30Z')), { iso: '2026-11-01', hm: '15:09' }, 'CET, UTC+1');
  assert.deepEqual(berlinClock(new Date('2026-07-01T14:09:30Z')), { iso: '2026-07-01', hm: '16:09' }, 'CEST, UTC+2');
  assert.deepEqual(berlinClock(new Date('2026-11-01T23:30:00Z')), { iso: '2026-11-02', hm: '00:30' }, 'the next day in Germany');
  assert.deepEqual(berlinClock(new Date('2026-11-01T22:59:00Z')), { iso: '2026-11-01', hm: '23:59' });
  assert.deepEqual(berlinClock(new Date('2026-03-29T00:59:00Z')), { iso: '2026-03-29', hm: '01:59' }, 'just before the clocks go forward');
  assert.deepEqual(berlinClock(new Date('2026-03-29T01:00:00Z')), { iso: '2026-03-29', hm: '03:00' }, 'and just after: there is no 02:xx');
  assert.match(berlinClock().hm, /^\d\d:\d\d$/, 'the hour is two digits, 24 hour clock');
  assert.equal(berlinClock(new Date('2026-11-01T22:00:00Z')).hm, '23:00');
  assert.equal(berlinClock(new Date('2026-11-01T23:00:00Z')).hm, '00:00', 'midnight is 00:00, not 24:00');
});

test('a tick changes the date and time only on a page that follows the clock, and only when the minute has moved', () => {
  const clock = { iso: '2026-11-01', hm: '15:10' };
  assert.deepEqual(tick({ nowOn: true, shown: { iso: '2026-11-01', hm: '15:09' }, clock }), clock);
  assert.deepEqual(tick({ nowOn: true, shown: { iso: '2026-10-31', hm: '15:10' }, clock }), clock, 'the day changed');
  assert.equal(tick({ nowOn: true, shown: clock, clock }), null, 'the same minute: nothing to draw again');
  assert.equal(tick({ nowOn: false, shown: { iso: '2026-11-01', hm: '06:00' }, clock }), null, 'a time somebody set stays');
});

test('a place from the device is asked again when that costs no question, and dropped when it cannot be', () => {
  assert.equal(atLaunch({ source: 'gps', granted: true, hasPlace: true }), 'locate');
  assert.equal(atLaunch({ source: 'gps', granted: true, hasPlace: false }), 'locate');
  assert.equal(atLaunch({ source: 'gps', granted: false, hasPlace: true }), 'clear', 'a place from yesterday is not "here"');
  assert.equal(atLaunch({ source: 'gps', granted: false, hasPlace: false }), 'keep', 'nothing to drop');
  assert.equal(atLaunch({ source: 'manual', granted: true, hasPlace: true }), 'keep', 'a station somebody picked stays');
  assert.equal(atLaunch({ source: 'manual', granted: false, hasPlace: true }), 'keep');
  assert.equal(atLaunch({ source: '', granted: true, hasPlace: false }), 'keep', 'no place was ever given: no question on its own');
});

test('coming back to the page reads the device again only for a place that came from it', () => {
  assert.equal(onReturn({ source: 'gps', granted: true }), 'locate');
  assert.equal(onReturn({ source: 'gps', granted: false }), 'keep');
  assert.equal(onReturn({ source: 'manual', granted: true }), 'keep', 'a typed station is not overwritten');
  assert.equal(onReturn({ source: '', granted: true }), 'keep');
});

test('the saved state of the earlier version: the clock is on and a saved start is a picked station', () => {
  const defaults = { date: '', src: '', dst: '', via: '', t0: '06:00', stay: 180, tr: 4 };
  assert.deepEqual(migrate({ src: 'Wolfsburg Hbf', dst: 'Leipzig Hbf', t0: '08:00', stay: 120 }, defaults),
    { date: '', src: 'Wolfsburg Hbf', dst: 'Leipzig Hbf', via: '', t0: '08:00', stay: 120, tr: 4, now: true, from: 'manual' });
  assert.deepEqual(migrate({}, defaults), { ...defaults, now: true, from: '' });
  assert.deepEqual(migrate(null, defaults), { ...defaults, now: true, from: '' });
  assert.deepEqual(migrate('junk', defaults), { ...defaults, now: true, from: '' });
  const kept = migrate({ src: 'X', now: false, from: 'gps', t0: '09:00' }, defaults);
  assert.deepEqual([kept.now, kept.from, kept.t0], [false, 'gps', '09:00'], 'what the new version saved is kept');
  assert.equal(migrate({ now: 'yes', from: 'sky', src: 'X' }, defaults).now, true, 'a wrong type is the default');
  assert.equal(migrate({ now: 'yes', from: 'sky', src: 'X' }, defaults).from, 'manual', 'an unknown source of the place is a picked one');
});
