'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../src/scripts');

const V1 = `# Nou script v1: Test story (draft, not rendered)

Intro line.

**1. ON CAM (open, ~6 s)**
Nou here. One two three.

**2. VO (~10 s)**
Second cue text stays the same.
*Source: Anthropic.*

## Notes

- a note
`;
const V2 = V1.replace('One two three.', 'One two three four.').replace('## Notes', '**3. ON CAM (close)**\nI am Nou.\n\n## Notes');

test('parses cues, kinds, sources and notes', () => {
  const s = S.parseScript(V1);
  assert.strictEqual(s.title, 'Test story');
  assert.strictEqual(s.cues.length, 2);
  assert.deepStrictEqual(s.cues.map((c) => [c.n, c.onCamera]), [[1, true], [2, false]]);
  assert.strictEqual(s.cues[0].text, 'Nou here. One two three.');
  assert.strictEqual(s.cues[1].source, 'Source: Anthropic.');
  assert.strictEqual(s.notes[0].heading, 'Notes');
  assert.strictEqual(s.words, 5 + 6);
});

test('marks changed and new cues against the previous version', () => {
  assert.deepStrictEqual(S.compare(S.parseScript(V1), S.parseScript(V2)), ['changed', 'same', 'new']);
  assert.deepStrictEqual(S.compare(null, S.parseScript(V1)), ['new', 'new']);
});

test('approval pins the exact bytes and goes stale on edit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nouscripts-'));
  const dir = path.join(root, '2026-11-10_test');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'script_v1.md'), V1);
  fs.writeFileSync(path.join(dir, 'script_v2.md'), V2);
  const stories = S.listStories(root);
  assert.strictEqual(stories.length, 1);
  assert.deepStrictEqual(stories[0].versions.map((v) => v.version), [1, 2]);
  const rec = S.writeApproval(dir, 2, 'ok', new Date('2026-11-10T18:05:00Z'));
  assert.match(rec.approved_at_eastern, /1:05\s?PM EST/);
  assert.ok(S.approvalIsCurrent(dir, S.readApproval(dir)));
  fs.appendFileSync(path.join(dir, 'script_v2.md'), '\nedit\n');
  assert.ok(!S.approvalIsCurrent(dir, S.readApproval(dir)));
  assert.throws(() => S.writeApproval(dir, 9, ''), /no script_v9/);
  fs.rmSync(root, { recursive: true });
});

test('parses the real Fable 5.2 script when present', { skip: !fs.existsSync(path.join(S.storiesRoot(), '2026-11-10_fable-5-2', 'script_v2.md')) }, () => {
  const s = S.parseScript(fs.readFileSync(path.join(S.storiesRoot(), '2026-11-10_fable-5-2', 'script_v2.md'), 'utf8'));
  assert.strictEqual(s.cues.length, 7);
  assert.deepStrictEqual(s.cues.filter((c) => c.onCamera).map((c) => c.n), [1, 7]);
  assert.ok(s.words > 200 && s.words < 300, `words=${s.words}`);
});

test('detects AI clichés and banlist terms in cues', () => {
  const fluffScript = `# Nou script v1: Fluff story

**1. ON CAM**
Let's delve into this vibrant realm and showcase groundbreaking advancements.

**2. VO**
This is clean direct reporting without any fluff.
`;
  const s = S.parseScript(fluffScript);
  assert.strictEqual(s.flaggedCount, 1);
  assert.ok(s.cues[0].flags.includes('delve') || s.cues[0].flags.includes("let's delve into"));
  assert.ok(s.cues[0].flags.includes('vibrant'));
  assert.ok(s.cues[0].flags.includes('showcase'));
  assert.ok(s.cues[0].flags.includes('realm'));
  assert.strictEqual(s.cues[1].flags.length, 0);
});

test('generates OpenClap .clap interchange format and exports file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nouscripts-clap-'));
  const dir = path.join(root, '2026-11-10_clap-test');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'script_v1.md'), V1);

  const res = S.exportOpenClap(dir, 1);
  assert.strictEqual(res.file, '2026-11-10_clap-test_v1.clap');
  assert.ok(fs.existsSync(res.path));
  const text = fs.readFileSync(res.path, 'utf8');

  assert.match(text, /format: clap-0/);
  assert.match(text, /numberOfEntities: 1/);
  assert.match(text, /id: entity-nou/);
  assert.match(text, /track: 1/);
  assert.match(text, /track: 2/);
  assert.match(text, /voice: Kokoro:af_sky/);
  assert.match(text, /Nou here\. One two three\./);

  fs.rmSync(root, { recursive: true });
});

