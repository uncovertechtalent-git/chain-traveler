// Guards on the app shell: what the service worker precaches is what the app has, and the page can run under a
// strict Content-Security-Policy (no inline script, no inline style, no event handler attributes) as the CDN sends it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const read = f => fs.readFileSync(path.join(app, f), 'utf8');
// Every file of the app except the service worker, the data (laid out by the pipeline) and the 404 page with its script.
const NOT_SHELL = new Set(['sw.js', '404.html', 'notfound.js']);
function listShell(dir = '') {
  return fs.readdirSync(path.join(app, dir), { withFileTypes: true }).flatMap(d => {
    const rel = dir ? dir + '/' + d.name : d.name;
    if (d.name.startsWith('.') || rel === 'data' || NOT_SHELL.has(rel)) return [];
    return d.isDirectory() ? listShell(rel) : [rel];
  });
}
const shellFiles = listShell().sort();

// 404.html is served by the CDN for missing paths (site-infra: custom error response) and is not part of the offline shell.
test('the service worker precaches exactly the shell files', () => {
  const list = read('sw.js').match(/const SHELL = \[(.*?)\];/s)[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.ok(list.includes('./'), 'the root is cached for navigations');
  assert.deepEqual(list.filter(f => f !== './').sort(), shellFiles);
});

test('the service worker carries the version placeholder once, for the deploy to fill', () => {
  assert.equal(read('sw.js').split('__SHELL_VERSION__').length - 1, 1);
});

test('index.html has no inline script, no inline style and no event handler attributes', () => {
  const html = read('index.html');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'inline <script>');
  assert.ok(!/<style[\s>]/i.test(html), 'inline <style>');
  assert.ok(!/\sstyle\s*=/i.test(html), 'style attribute');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'event handler attribute');
});

test('the scripts do not build markup with inline styles or handlers', () => {
  for (const f of ['app.js', 'data-store.js', 'engine.js', 'planb.js', 'graph.js', 'zoomview.js', 'live.js', 'navigate.js', 'i18n.js', 'notfound.js']) {
    const js = read(f);
    assert.ok(!/style\s*=\s*["'\\]/.test(js.replace(/\.style\.[a-z]+\s*=/g, '')), f + ': style attribute in markup');
    assert.ok(!/\son(click|load|error|input|change)\s*=\s*["']/.test(js), f + ': handler attribute in markup');
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(js), f + ': eval');
  }
});

test('every local file the page names exists', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (/^(https?:)?\/\//.test(m[1])) assert.fail('external resource: ' + m[1]);
    assert.ok(fs.existsSync(path.join(app, m[1])), 'missing: ' + m[1]);
  }
});

test('the app makes no network request except to its own files', () => {
  for (const f of ['app.js', 'data-store.js', 'sw.js', 'engine.js', 'planb.js', 'graph.js', 'live.js', 'navigate.js', 'i18n.js', 'notfound.js', ...fs.readdirSync(path.join(app, 'locales')).map(f => 'locales/' + f)]) {
    assert.ok(!/https?:\/\//.test(read(f).replace(/\/\/ .*$/gm, '')), f + ' names an absolute URL');
  }
});

test('the 404 page exists, has no inline script and only the script that picks the language', () => {
  const html = read('404.html');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html) && !/\sstyle\s*=/i.test(html) && !/\son[a-z]+\s*=/i.test(html));
  assert.deepEqual([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]), ['/notfound.js']);
  assert.ok(fs.existsSync(path.join(app, 'notfound.js')));
  assert.match(html, /href="\/style\.css"/);
});

test('the locales hold no code that does anything: plain data only', () => {
  for (const f of fs.readdirSync(path.join(app, 'locales'))) {
    const js = read('locales/' + f).replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    assert.ok(/^\s*export default \{[\s\S]*\};\s*$/.test(js), f + ': one default export of an object');
    assert.ok(!/\b(import|require|eval|fetch|function)\b|=>|new Function/.test(js), f + ': code in a locale');
  }
});
