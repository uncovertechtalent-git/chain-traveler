// "I bring": nothing, a bicycle, a folding bicycle or an e-scooter. The choice is kept on this device and adds minutes to
// the minimum change, in every place the scan runs (the chain, the reach map, Plan B, Navigate), so a chain that needs a
// quick change on foot is not offered to someone who has a bicycle to get through the door. Plain functions: app/app.js
// wires them to the page.
//
// What this does not know: which train carries a bicycle. The feed has no such column, so no train is hidden or marked
// here; the notes under the results are general, and the rules per operator are a later step (docs/bicycle-and-scooter.md).

export const ITEMS = ['none', 'bike', 'folding', 'scooter'];

// Extra minutes on every change. PLACEHOLDERS until the owner sets them: these are the first guesses of the brief, not
// measured times. They live here and nowhere else.
export const NOTHING_EXTRA_MIN = 0;
export const BICYCLE_EXTRA_MIN = 4;
export const FOLDING_EXTRA_MIN = 2;
export const SCOOTER_EXTRA_MIN = 2;
export const EXTRA_MIN = { none: NOTHING_EXTRA_MIN, bike: BICYCLE_EXTRA_MIN, folding: FOLDING_EXTRA_MIN, scooter: SCOOTER_EXTRA_MIN };

// The general notes, as keys of the locales, per item. Wording and sources: docs/bicycle-and-scooter.md.
export const NOTES = {
  none: [],
  bike: ['bring.note.bikeTicket', 'bring.note.bikeSpace', 'bring.note.bikeBus'],
  folding: ['bring.note.foldingLuggage'],
  scooter: ['bring.note.scooterFold', 'bring.note.scooterOperators'],
};

export const STORE_KEY = 'ct-bring';

// Anything that is not one of the four is nothing: a value from an older or a damaged store changes no result.
export const normalizeItem = v => (ITEMS.includes(v) ? v : 'none');
export const extraMin = item => EXTRA_MIN[normalizeItem(item)];
export const noteKeys = item => NOTES[normalizeItem(item)];

// The minimum change a scan is asked for: what the page says (the box "Minimum change") plus what is brought.
export const changeTime = (base, item) => Math.max(0, Number(base) || 0) + extraMin(item);

// Kept on the device with the other settings (the language, the theme, the map). Storage may be missing or full.
export function loadItem(storage = globalThis.localStorage) {
  try { return normalizeItem(storage.getItem(STORE_KEY)); } catch { return 'none'; }
}
export function saveItem(item, storage = globalThis.localStorage) {
  try { storage.setItem(STORE_KEY, normalizeItem(item)); } catch { /* not kept */ }
}
