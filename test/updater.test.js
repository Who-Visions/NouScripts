'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createUpdater } = require('../src/updater');

function fake() {
  const au = new EventEmitter();
  au.calls = []; au.feed = null;
  au.setFeedURL = (o) => { au.feed = o; au.calls.push('setFeedURL'); };
  au.checkForUpdates = () => au.calls.push('check');
  au.quitAndInstall = () => au.calls.push('quit');
  return au;
}
const timers = () => { const t = { set: [], cleared: [] }; t.setTimer = (fn, ms) => { t.set.push(ms); return 7; }; t.clearTimer = (id) => t.cleared.push(id); return t; };
function make(opts) {
  const sent = []; const au = fake(); const t = timers();
  const u = createUpdater({ autoUpdater: au, version: '0.1.0', platform: 'darwin', arch: 'arm64', send: (s) => sent.push(s), setTimer: t.setTimer, clearTimer: t.clearTimer, ...opts });
  return { u, au, sent, t };
}

test('disabled when the app is not packaged; nothing is touched', () => {
  const { u, au } = make({ isPackaged: false, feedUrl: 'https://example.invalid/feed' });
  assert.strictEqual(u.start().state, 'disabled');
  assert.match(u.status().text, /packaged/);
  assert.deepStrictEqual(au.calls, []);
});

test('disabled with a reason when packaged but no feed is configured', () => {
  const { u, au } = make({ isPackaged: true, feedUrl: '' });
  assert.strictEqual(u.start().state, 'disabled');
  assert.match(u.status().text, /NOU_UPDATE_URL/);
  assert.strictEqual(au.feed, null);
});

test('packaged with a feed: sets the feed for this platform and version, checks, and schedules six-hourly', () => {
  const { u, au, t } = make({ isPackaged: true, feedUrl: 'https://updates.example.invalid/nou/' });
  u.start();
  assert.deepStrictEqual(au.feed, { url: 'https://updates.example.invalid/nou/darwin-arm64/0.1.0' });
  assert.deepStrictEqual(au.calls, ['setFeedURL', 'check']);
  assert.deepStrictEqual(t.set, [6 * 60 * 60 * 1000]);
  u.stop(); assert.deepStrictEqual(t.cleared, [7]);
});

test('events map to states, including download progress', () => {
  const { u, au, sent } = make({ isPackaged: true, feedUrl: 'https://u.invalid/f' });
  u.start();
  au.emit('checking-for-update');
  au.emit('update-available');
  au.emit('download-progress', { percent: 41.6 });
  au.emit('update-downloaded', {}, 'notes', 'Nou Scripts 0.2.0', '2026-11-11');
  assert.strictEqual(u.status().state, 'ready');
  assert.strictEqual(u.status().version, 'Nou Scripts 0.2.0');
  assert.deepStrictEqual(sent.map((s) => s.state), ['checking', 'available', 'downloading', 'ready']);
});

test('an error is reported, not thrown', () => {
  const { u, au } = make({ isPackaged: true, feedUrl: 'https://u.invalid/f' });
  u.start();
  au.emit('error', new Error('net down'));
  assert.strictEqual(u.status().state, 'error');
  assert.match(u.status().text, /net down/);
});

test('install refuses when nothing is ready', () => {
  const { u, au } = make({ isPackaged: true, feedUrl: 'https://u.invalid/f' });
  u.start();
  assert.strictEqual(u.install().ok, false);
  assert.ok(!au.calls.includes('quit'));
});

test('install refuses while a job is running, then succeeds when idle', () => {
  let busy = true;
  const { u, au } = make({ isPackaged: true, feedUrl: 'https://u.invalid/f', isBusy: () => busy });
  u.start();
  au.emit('update-downloaded', {}, 'v2');
  const first = u.install();
  assert.strictEqual(first.ok, false);
  assert.match(first.reason, /job is still running/);
  busy = false;
  assert.deepStrictEqual(u.install(), { ok: true });
  assert.ok(au.calls.includes('quit'));
});

test('a check never runs in the disabled state', () => {
  const { u, au } = make({ isPackaged: false, feedUrl: '' });
  u.start(); u.check();
  assert.deepStrictEqual(au.calls, []);
});
