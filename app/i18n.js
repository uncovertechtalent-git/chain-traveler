// Languages. Every string the app shows is a key in app/locales/en.js; the other languages have the same keys.
//
//   t(key, params)    text, for textContent and attributes: placeholders {name} are filled in as they are
//   th(key, params)   HTML, for innerHTML: the params are escaped, unless wrapped in raw(). The translations themselves
//                     hold no markup (a test checks), so the markup lives in the code, around the sentence
//
// A value in a locale that is an object is a plural ({ one, few, many, other }); the form is chosen from params.n with
// Intl.PluralRules of the language. A missing key falls back to English, then to the key itself.
//
// The language is the saved choice (localStorage), else the first of the browser's languages that the app has, else
// English. Locale files are ES modules in the shell: the service worker caches them with the rest, so a language works
// offline.
import en from './locales/en.js';

// Code and the name of the language in itself.
export const LANGS = [
  ['en', 'English'], ['pl', 'Polski'], ['ru', 'Русский'], ['ro', 'Română'], ['bg', 'Български'],
  ['uk', 'Українська'], ['tr', 'Türkçe'], ['nl', 'Nederlands'], ['fr', 'Français'], ['es', 'Español'],
];
const KEY = 'ct-lang';
const loaded = { en };
let code = 'en', dict = en, rules = new Intl.PluralRules('en');
const listeners = [];

class Raw { constructor(html) { this.html = html; } }
export const raw = html => new Raw(html);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const lang = () => code;
export const num = (n, opts) => new Intl.NumberFormat(code, opts).format(n);

function fill(key, params, escape) {
  let v = dict[key] ?? en[key];
  if (v === undefined) return key;
  if (typeof v === 'object') v = v[rules.select(Number(params.n) || 0)] ?? v.other;
  return v.replace(/\{(\w+)\}/g, (m, name) => {
    if (!(name in params)) return m;
    const p = params[name];
    if (p instanceof Raw) return p.html;
    const s = name === 'n' && typeof p === 'number' ? num(p) : String(p);
    return escape ? esc(s) : s;
  });
}
export const t = (key, params = {}) => fill(key, params, false);
export const th = (key, params = {}) => fill(key, params, true);

// The text of a search error: the code the engine gave, else its own English message.
export const errText = r => (r.code ? t('err.' + r.code) : r.error);

// Units and dates, in the language of the page.
export const minutes = n => `${n} ${t('unit.min')}`;
export const dur = m => (m >= 60 ? `${Math.floor(m / 60)} ${t('unit.h')} ${String(m % 60).padStart(2, '0')} ${t('unit.min')}` : minutes(m));
export const dist = km => (km < 1
  ? t('unit.m', { n: Math.max(10, Math.round(km * 100) * 10) })
  : t('unit.km', { n: num(km, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
export const dayLabel = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(code, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// The fixed text of the page: [data-i18n] text, [data-i18n-ph] placeholder, [data-i18n-aria] aria-label.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

// Which language to start in: the saved one, else the first browser language the app has.
export function pickLang(saved, wanted, supported = LANGS.map(l => l[0])) {
  if (saved && supported.includes(saved)) return saved;
  for (const w of wanted || []) {
    const base = String(w).toLowerCase().split('-')[0];
    if (supported.includes(base)) return base;
  }
  return 'en';
}
export function initialLang() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  return pickLang(saved, navigator.languages || [navigator.language]);
}

// Switch language: load the file, set <html lang>, translate the fixed text, tell the listeners to redraw.
export async function setLang(next, { save = true } = {}) {
  let c = LANGS.some(l => l[0] === next) ? next : 'en';
  if (!loaded[c]) {
    try { loaded[c] = (await import(`./locales/${c}.js`)).default; } catch { c = 'en'; }
  }
  code = c; dict = loaded[c]; rules = new Intl.PluralRules(c);
  document.documentElement.lang = c;
  if (save) { try { localStorage.setItem(KEY, c); } catch { /* storage unavailable */ } }
  applyStatic();
  for (const f of listeners) f(c);
  return c;
}
export const onLang = f => { listeners.push(f); };
