// Guards on the app shell: what the service worker precaches is what the app has, and the page can run under a
// strict Content-Security-Policy (no inline script, no inline style, no event handler attributes) as the CDN sends it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const read = f => fs.readFileSync(path.join(app, f), 'utf8');
const shellFiles = fs.readdirSync(app, { withFileTypes: true }).filter(d => d.isFile() && !d.name.startsWith('.') && d.name !== 'sw.js' && d.name !== '404.html').map(d => d.name).sort();

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
  for (const f of ['app.js', 'data-store.js', 'engine.js']) {
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
  for (const f of ['app.js', 'data-store.js', 'sw.js', 'engine.js']) {
    assert.ok(!/https?:\/\//.test(read(f).replace(/\/\/ .*$/gm, '')), f + ' names an absolute URL');
  }
});

test('the 404 page exists and needs no script', () => {
  const html = read('404.html');
  assert.ok(!/<script/i.test(html) && !/\sstyle\s*=/i.test(html));
  assert.match(html, /href="\/style\.css"/);
});
