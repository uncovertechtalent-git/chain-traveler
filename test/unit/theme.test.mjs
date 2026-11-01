// The light/dark switch: which theme a press chooses, and the script that applies the saved choice before the first paint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { isDark, nextTheme } from '../../app/theme.js';

const boot = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'theme-boot.js'), 'utf8');

test('with nothing chosen the page is as dark as the device; a choice wins over the device', () => {
  assert.equal(isDark(undefined, true), true);
  assert.equal(isDark(undefined, false), false);
  assert.equal(isDark('dark', false), true, 'dark chosen on a light device');
  assert.equal(isDark('light', true), false, 'light chosen on a dark device');
  assert.equal(isDark('', true), true, 'an empty value is no choice');
});

test('a press chooses the other theme, whatever way the page got to the current one', () => {
  assert.equal(nextTheme(undefined, true), 'light', 'a dark device goes light');
  assert.equal(nextTheme(undefined, false), 'dark', 'a light device goes dark');
  assert.equal(nextTheme('dark', false), 'light');
  assert.equal(nextTheme('light', true), 'dark');
  assert.equal(nextTheme('dark', true), 'light');
  assert.equal(nextTheme('light', false), 'dark');
});

function run(store) {
  const documentElement = { dataset: {} };
  const ctx = { document: { documentElement }, localStorage: store };
  vm.runInNewContext(boot, ctx);
  return documentElement.dataset.theme;
}

test('the head script applies a saved choice and nothing else', () => {
  assert.equal(run({ getItem: () => 'dark' }), 'dark');
  assert.equal(run({ getItem: () => 'light' }), 'light');
  assert.equal(run({ getItem: () => null }), undefined, 'nothing saved: the device decides');
  assert.equal(run({ getItem: () => 'sepia' }), undefined, 'an unknown value is ignored');
  assert.equal(run({ getItem: () => '<script>' }), undefined);
});

test('the head script survives storage that throws or is not there', () => {
  assert.equal(run({ getItem: () => { throw new Error('blocked'); } }), undefined);
  assert.doesNotThrow(() => vm.runInNewContext(boot, { document: { documentElement: { dataset: {} } } }), 'no localStorage at all');
});

test('the saved choice is read from the key the button writes', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'theme.js'), 'utf8');
  assert.match(src, /setItem\('ct-theme'/);
  assert.match(boot, /getItem\('ct-theme'\)/);
});
