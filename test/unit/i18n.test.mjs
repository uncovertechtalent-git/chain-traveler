// Locale tests: every language has the keys, placeholders and plural forms of English, and every key the code asks
// for exists. Run one language while translating: LOCALE=pl node --test --test-name-pattern='locale pl' test/unit/i18n.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const localeDir = path.join(appDir, 'locales');
const en = (await import(path.join(localeDir, 'en.js'))).default;
const codes = fs.readdirSync(localeDir).filter(f => f.endsWith('.js') && f !== 'en.js').map(f => f.slice(0, -3)).sort()
  .filter(c => !process.env.LOCALE || process.env.LOCALE.split(',').includes(c));
const NEEDED = ['pl', 'ru', 'ro', 'bg', 'uk', 'tr', 'nl', 'fr', 'es'];

const placeholders = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const strings = v => (typeof v === 'string' ? [v] : Object.values(v));
// The plural categories a language uses for the whole numbers 0 to 200 ("many" in French and Spanish is for millions).
const categoriesUsed = code => { const r = new Intl.PluralRules(code); return [...new Set(Array.from({ length: 201 }, (_, n) => r.select(n)))].sort(); };

test('English: every plural has other, no markup, no empty value', () => {
  for (const [k, v] of Object.entries(en)) {
    if (typeof v === 'object') assert.ok(typeof v.other === 'string', `${k}: a plural needs "other"`);
    for (const s of strings(v)) {
      assert.ok(s.length > 0, `${k}: empty`);
      assert.ok(!/[<>&]/.test(s), `${k}: no HTML or ampersand in a value`);
    }
  }
});

if (!process.env.LOCALE) {
  test('the nine first languages are all there', () => {
    assert.deepEqual(NEEDED.filter(c => !codes.includes(c)), []);
  });
}

for (const code of codes) {
  test(`locale ${code}: same keys as English, no extra`, async () => {
    const dict = (await import(path.join(localeDir, code + '.js'))).default;
    const missing = Object.keys(en).filter(k => !(k in dict));
    const extra = Object.keys(dict).filter(k => !(k in en));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
  });

  test(`locale ${code}: placeholders, plural forms and markup`, async () => {
    const dict = (await import(path.join(localeDir, code + '.js'))).default;
    const cats = categoriesUsed(code);
    const problems = [];
    for (const [k, src] of Object.entries(en)) {
      const v = dict[k];
      if (v === undefined) continue;   // reported by the keys test
      const want = [...new Set(strings(src).flatMap(placeholders))].sort();
      if (typeof src === 'string' && typeof v !== 'string') { problems.push(`${k}: must be a string`); continue; }
      if (typeof src === 'object') {
        if (typeof v !== 'object') { problems.push(`${k}: must be a plural object`); continue; }
        for (const c of cats) if (typeof v[c] !== 'string') problems.push(`${k}: no "${c}" form (needed for ${code})`);
        for (const c of Object.keys(v)) if (!['zero', 'one', 'two', 'few', 'many', 'other'].includes(c)) problems.push(`${k}: unknown form "${c}"`);
        if (typeof v.other !== 'string') problems.push(`${k}: no "other" form`);
      }
      for (const s of strings(v)) {
        if (typeof s !== 'string' || !s.trim()) { problems.push(`${k}: empty`); continue; }
        if (/[<>&]/.test(s)) problems.push(`${k}: no HTML or ampersand: ${s}`);
        const got = placeholders(s);
        if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${k}: placeholders {${got}} but English has {${want}}: ${s}`);
        if (s.length > 3 * (typeof src === 'string' ? src.length : Math.max(...strings(src).map(x => x.length))) + 20) problems.push(`${k}: much longer than English: ${s}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test(`locale ${code}: is a translation, not a copy of English`, async () => {
    const dict = (await import(path.join(localeDir, code + '.js'))).default;
    const same = Object.keys(en).filter(k => JSON.stringify(dict[k]) === JSON.stringify(en[k]));
    assert.ok(same.length <= Object.keys(en).length * 0.15, `too many strings equal to English (${same.length}): ${same.join(', ')}`);
  });
}

// Every key the code asks for is in English, and every English key is used somewhere.
const sources = ['app.js', 'live.js', 'navigate.js', 'graph.js', 'zoomview.js', 'planb.js', 'engine.js', 'data-store.js', 'i18n.js', 'notfound.js', 'index.html', '404.html']
  .filter(f => fs.existsSync(path.join(appDir, f))).map(f => [f, fs.readFileSync(path.join(appDir, f), 'utf8')]);
const asked = new Map();   // keys passed straight to t() / th() or written as data-i18n
const used = new Set();    // any string in the code that is a key of English (keys picked by a ternary, built by parts)
for (const [f, src] of sources) {
  for (const m of src.matchAll(/\bth?\(\s*['"`]([\w.]+)['"`]|data-i18n(?:-[a-z]+)?="([\w.]+)"/g)) asked.set(m[1] || m[2], f);
  for (const m of src.matchAll(/['"`]([a-z][A-Za-z]*(?:\.[A-Za-z]+)+)['"`]/g)) if (m[1] in en) used.add(m[1]);
}
for (const k of asked.keys()) used.add(k);

test('every key the code asks for exists in English', () => {
  const missing = [...asked.keys()].filter(k => !k.endsWith('.') && !(k in en));   // a key ending in a dot is a prefix, completed by the code
  assert.deepEqual(missing, []);
});

test('every English key is used by the code', () => {
  // Keys built from parts (chip.plan.<band>, legend.<band>, err.<code>, tag.<code>, age.*, loc.*) are listed by prefix.
  const dynamic = ['chip.best.', 'chip.plan.', 'err.', 'tag.', 'loc.', 'age.', 'unit.', 'legend.'];
  const unused = Object.keys(en).filter(k => !used.has(k) && !dynamic.some(p => k.startsWith(p)));
  assert.deepEqual(unused, []);
});
