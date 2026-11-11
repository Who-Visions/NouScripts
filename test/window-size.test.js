'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { windowSize } = require('../src/window-size');

test('a large display keeps the preferred 1280x860', () => {
  const s = windowSize({ width: 1728, height: 1079 });
  assert.deepStrictEqual([s.width, s.height], [1280, 860]);
});

test('a smaller display shrinks the window so it fits the work area', () => {
  const s = windowSize({ width: 1280, height: 800 });
  assert.strictEqual(s.height, 760, 'work height minus the margin');
  assert.strictEqual(s.width, 1240);
  assert.ok(s.height <= 800 - 40);
});

test('a tiny display never goes below the minimum', () => {
  const s = windowSize({ width: 800, height: 500 });
  assert.deepStrictEqual([s.width, s.height], [900, 600]);
  assert.deepStrictEqual([s.minWidth, s.minHeight], [900, 600]);
});
