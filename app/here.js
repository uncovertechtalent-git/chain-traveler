// Where you are and when, for the whole page: one place, one date and one time, shared by every tab, so no tab keeps an
// answer to a question that was asked a while ago. The time can follow the clock ("Now"). A place that came from the
// device's position is refreshed when the device lets it and dropped when it does not, because an "I am at" kept from
// yesterday is wrong, while a station that was typed stays. Plain functions: app/app.js wires them to the page.

const TZ = 'Europe/Berlin';
const FORMAT = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// The date (YYYY-MM-DD) and the time (HH:MM) on the clocks of Germany.
export function berlinClock(date = new Date()) {
  const p = {};
  for (const { type, value } of FORMAT.formatToParts(date)) p[type] = value;
  return { iso: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

// What a tick of the clock changes: nothing, or the date and time to show. Only a page that follows the clock changes.
export function tick({ nowOn, shown, clock }) {
  if (!nowOn) return null;
  return shown.iso === clock.iso && shown.hm === clock.hm ? null : { iso: clock.iso, hm: clock.hm };
}

// A place kept from the last visit. source is 'gps' (the device said so), 'manual' (a station was picked) or ''.
//   locate: ask the device again, silently, because it already allowed it;
//   clear:  the place came from the device and the device will not say it again: it is old, do not show it as "here";
//   keep:   a station somebody picked stays as it was.
export function atLaunch({ source, granted, hasPlace }) {
  if (source !== 'gps') return 'keep';
  if (granted) return 'locate';
  return hasPlace ? 'clear' : 'keep';
}

// The page is shown again after a while: a place from the device is read again when that costs no question.
export function onReturn({ source, granted }) {
  return source === 'gps' && granted ? 'locate' : 'keep';
}

// The saved state of an earlier version has no clock and no source of the place: a clock that follows the time is the
// default, and a saved start is a station somebody picked.
export function migrate(saved, defaults) {
  const s = { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
  s.now = typeof (saved && saved.now) === 'boolean' ? saved.now : true;
  s.from = saved && (saved.from === 'gps' || saved.from === 'manual') ? saved.from : (s.src ? 'manual' : '');
  return s;
}
