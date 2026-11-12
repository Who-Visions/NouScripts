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


test('word-level changes show what was cut and what was added', () => {
  const runs = S.wordDiff('It is cheaper and faster than before.', 'It is twenty percent cheaper than before.');
  assert.deepStrictEqual(runs, [
    { t: 'same', s: 'It is' }, { t: 'add', s: 'twenty percent' }, { t: 'same', s: 'cheaper' },
    { t: 'del', s: 'and faster' }, { t: 'same', s: 'than before.' },
  ]);
  // Case alone is not an edit, and identical text has no change runs.
  assert.ok(S.wordDiff('Nou here.', 'nou here.').every((r) => r.t === 'same'));
  // Rebuilding the new text from same+add runs gives back exactly the new text.
  const b = 'Anthropic released two models on Monday, and both are faster.';
  const rebuilt = S.wordDiff('Anthropic shipped a model on Monday.', b).filter((r) => r.t !== 'del').map((r) => r.s).join(' ');
  assert.strictEqual(rebuilt, b);
});

test('cueChanges returns runs only for edited cues', () => {
  const ch = S.cueChanges(S.parseScript(V1), S.parseScript(V2));
  assert.strictEqual(ch.length, 3);
  assert.deepStrictEqual(ch[0].filter((r) => r.t === 'add'), [{ t: 'add', s: 'four.' }]);
  assert.strictEqual(ch[1], null); // unchanged cue
  assert.strictEqual(ch[2], null); // new cue: nothing to compare against
  assert.deepStrictEqual(S.cueChanges(null, S.parseScript(V1)), [null, null]);
});

test('a heavy rewrite shows as old line then new line, not confetti', () => {
  const mk = (a) => S.parseScript(`# t\n\n**1. VO**\n${a}\n`);
  const ch = S.cueChanges(mk('Anthropic just shipped its most capable model yet, and it held one thing back on purpose.'),
    mk("Anthropic's newest models can take on bigger technical work than ever."));
  assert.deepStrictEqual(ch[0].map((r) => r.t), ['del', 'add']);
  // A light edit stays word-level.
  const light = S.cueChanges(mk('They are the same model underneath.'), mk("They're the same model underneath."));
  assert.ok(light[0].some((r) => r.t === 'same'));
});

test('applyCueEdits changes only the spoken words and restamps the title', () => {
  const md = '# Nou script v2: T (draft, not rendered)\n\nIntro.\n\n**1. ON CAM (open, ~7 s)**\nOld line one.\n\n**2. VO (~14 s)**\nKeep me.\n*Source two.*\n\n## Notes\n- note\n';
  const out = S.applyCueEdits(md, { 1: 'New\n line   one.' }, 3);
  assert.match(out, /^# Nou script v3: T \(draft, not rendered\)/);
  assert.ok(out.includes('**1. ON CAM (open, ~7 s)**\nNew line one.\n'));
  assert.ok(!out.includes('Old line one.'));
  assert.ok(out.includes('Keep me.\n*Source two.*'));
  assert.ok(out.endsWith('## Notes\n- note\n'));
  const p = S.parseScript(out);
  assert.strictEqual(p.cues[0].text, 'New line one.');
  assert.strictEqual(p.cues[1].source, 'Source two.');
});

test('saveVersion writes the next version and never overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nou-save-'));
  fs.writeFileSync(path.join(dir, 'script_v1.md'), '# Nou script v1: T\n\n**1. VO**\nA b c.\n*Src.*\n');
  fs.writeFileSync(path.join(dir, 'script_v2.md'), '# Nou script v2: T\n\n**1. VO**\nA b c d.\n*Src.*\n');
  const r = S.saveVersion(dir, 1, { 1: 'Edited from one.' });
  assert.strictEqual(r.version, 3);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'script_v2.md'), 'utf8').includes('A b c d.'), true);
  assert.strictEqual(S.parseScript(fs.readFileSync(r.path, 'utf8')).cues[0].text, 'Edited from one.');
  assert.throws(() => S.saveVersion(dir, 3, { 1: '   ' }), /empty/);
});

test('producer line: prompt carries cues, sources, attachments and the instruction', () => {
  const cues = [{ n: 1, kind: 'ON CAM', onCamera: true, hint: 'open', text: 'Hello.', source: 'Src one.' }];
  const m = S.buildAskMessages(cues, ' tighten it ', [{ name: 'notes.txt', text: 'Fact A.' }]);
  assert.strictEqual(m[0].role, 'system');
  assert.match(m[0].content, /never add a claim/i);
  assert.match(m[1].content, /\[1\] ON CAM \(open\)\nHello\.\nSource note: Src one\./);
  assert.match(m[1].content, /Attached: notes\.txt ---\nFact A\./);
  assert.match(m[1].content, /INSTRUCTION:\ntighten it$/);
});

test('producer line: reply parsing keeps only real, non-empty cue edits', () => {
  const r = S.parseAskReply('<think>hmm {x}</think>Sure!\n```json\n{"edits":{"1":"New  one.","9":"ghost","2":"  "},"note":"Tightened."}\n```', [1, 2]);
  assert.deepStrictEqual(r.edits, { 1: 'New one.' });
  assert.strictEqual(r.note, 'Tightened.');
  assert.deepStrictEqual(S.parseAskReply('{"2":"Flat form."}', [1, 2]).edits, { 2: 'Flat form.' });
  assert.throws(() => S.parseAskReply('no json here', [1]), /JSON/);
});

test('broadcast template: header, VIDEO/SUPER/SOT fields, SOT run time and time codes', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'templates', 'broadcast_script_template.md'), 'utf8');
  const p = S.parseScript(md);
  assert.strictEqual(p.header.slug, 'STORY-SLUG');
  assert.strictEqual(p.header.program, 'NouGen News');
  assert.strictEqual(p.cues.length, 5);
  const [open, , sot] = p.cues;
  assert.deepStrictEqual(open.fields.map((f) => f.key), ['VIDEO', 'SUPER']);
  assert.ok(!open.text.includes('VIDEO'), 'fields are not spoken');
  assert.strictEqual(sot.text, '');
  assert.strictEqual(sot.sotSeconds, 12);
  assert.strictEqual(sot.seconds, 12);
  assert.strictEqual(p.cues[0].tcIn, '00:00:00');
  assert.strictEqual(p.cues[1].tcIn, p.cues[0].tcOut);
  assert.strictEqual(p.trt, p.cues[4].tcOut);
  assert.ok(!p.notes.some((n) => n.lines.join(' ').includes('reverse-engineered')), 'the HTML comment is not shown');
});

test('editing a templated cue keeps its VIDEO/SUPER lines and puts the words before the source', () => {
  const md = '# Nou script v1: T\n\n**1. VO (~5 s)**\nVIDEO: B-roll.\nSUPER: A | B\nOld words.\n*Src.*\n\n**2. SOT**\nVIDEO: Clip.\nSOT: IN "a" OUT "b" RUNS 0:05\n*Src2.*\n';
  const out = S.applyCueEdits(md, { 1: 'New words.', 2: 'Lead-in line.' }, 2);
  assert.ok(out.includes('**1. VO (~5 s)**\nVIDEO: B-roll.\nSUPER: A | B\nNew words.\n*Src.*'));
  assert.ok(out.includes('SOT: IN "a" OUT "b" RUNS 0:05\nLead-in line.\n*Src2.*'));
  const p = S.parseScript(out);
  assert.strictEqual(p.cues[1].fields.length, 2);
  assert.strictEqual(p.cues[1].text, 'Lead-in line.');
});

test('research lanes: links, file names, search plans and digest prompts', () => {
  assert.deepStrictEqual(S.extractUrls('see https://a.com/x, and (https://youtu.be/abcdefghijk). again https://a.com/x'), ['https://a.com/x', 'https://youtu.be/abcdefghijk']);
  assert.strictEqual(S.sourceFileName('https://www.metr.org/blog/2026-11-05-x/', 'web'), 'web_metr-org_blog-2026-11-05-x.txt');
  assert.deepStrictEqual(S.parsePlan('<think>x</think>["a", " b ", 3, ""]', 'q'), ['a', 'b']);
  assert.deepStrictEqual(S.parsePlan('no plan', 'fallback q'), ['fallback q']);
  const m = S.digestMessages({ title: 'T', url: 'u', kind: 'youtube', lane: 'captions', text: '[00:00:01] hi' }, [{ n: 1, text: 'Line.' }]);
  assert.match(m[0].content, /timestamps/);
  assert.match(m[1].content, /Kind: youtube \(captions\)/);
  const b = S.researchBriefMessages('Q?', [{ url: 'https://x', title: 'X', text: 'fact' }]);
  assert.match(b[1].content, /\[1\] X\nhttps:\/\/x\nfact/);
});

test('media: photos, videos, embeds and audio are pulled from a page, noise dropped', () => {
  const html = `<meta property="og:image" content="/img/hero.jpg"><img src="/static/logo.png"><img src="a.webp" alt="Chart  of cost" width="800">
    <img src="tiny.png" width="16"><img srcset="s.jpg 400w, l.jpg 1200w"><video src="/v/clip.mp4" poster="/v/p.jpg"></video>
    <iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe><a href="/pod/ep1.mp3">Episode 1</a><a href="/about">About</a>
    <img src="data:image/png;base64,xx"><img src="/img/hero.jpg?w=2">`;
  const m = S.extractMedia(html, 'https://news.example.com/story/1');
  const urls = m.map((x) => `${x.kind} ${x.url}`);
  assert.strictEqual(urls[0], 'image https://news.example.com/img/hero.jpg');
  assert.ok(urls.includes('image https://news.example.com/story/a.webp'));
  assert.ok(urls.includes('image https://news.example.com/story/l.jpg'), 'largest srcset entry');
  assert.ok(urls.includes('video https://news.example.com/v/clip.mp4'));
  assert.ok(urls.includes('image https://news.example.com/v/p.jpg'));
  assert.ok(urls.includes('video https://www.youtube.com/embed/abcdefghijk'));
  assert.ok(urls.includes('audio https://news.example.com/pod/ep1.mp3'));
  assert.ok(!urls.some((u) => /logo|tiny|data:|about/.test(u)));
  assert.strictEqual(urls.filter((u) => u.includes('hero.jpg')).length, 1, 'query-string duplicates collapse');
  assert.strictEqual(m.find((x) => x.url.endsWith('a.webp')).label, 'Chart of cost');
  const merged = S.mergeMedia([{ url: 'https://news.example.com/v/clip.mp4', kind: 'video' }], m, 'https://news.example.com/story/1');
  assert.strictEqual(merged.length, m.length);
  assert.strictEqual(merged[merged.length - 1].url, 'https://news.example.com/v/clip.mp4');
});

test('media labels decode HTML entities', () => {
  const m = S.extractMedia('<a href="/m.pdf">Mythos 5.2&#8217;s card &amp; notes</a>', 'https://a.com/');
  assert.strictEqual(m[0].label, 'Mythos 5.2’s card & notes');
});

test('nou-media URLs resolve only to image files inside a story media folder', () => {
  const root = '/stories';
  const u = S.mediaUrl('2026-11-10_fable-5-2', 'media/abc123.jpg');
  assert.strictEqual(u, 'nou-media://m/2026-11-10_fable-5-2/abc123.jpg');
  assert.strictEqual(S.resolveMediaUrl(u, root), '/stories/2026-11-10_fable-5-2/media/abc123.jpg');
  for (const bad of [
    'nou-media://m/story/..%2F..%2Fetc%2Fpasswd', 'nou-media://m/..%2F..%2Fx/a.jpg', 'nou-media://m/story/a.txt',
    'nou-media://m/story/sub/a.jpg', 'nou-media://x/story/a.jpg', 'file:///etc/passwd', 'nou-media://m/story/.hidden.jpg', 'not a url',
  ]) assert.strictEqual(S.resolveMediaUrl(bad, root), null, bad);
});

test('production package: EDL table, frame totals, checks and clips', () => {
  const md = '# EDL\n\n| Cut | Frames | In | Out | Length | Camera |\n|---|---|---|---|---|---|\n| 1 Hook | F000-F082 | 00:00:00:00 | 00:00:03:10 | 83 | Push-in \\| slow |\n| 2 Stall | F083-F184 | 00:00:03:11 | 00:00:07:16 | 102 | OTS |\n\n## Checks on the numbers\n\n- One frame too many.\n- Labels differ.\n\n## Other\n\n- not a check\n';
  const e = S.parseEdl(md);
  assert.deepStrictEqual(e.cuts.map((c) => [c.name, c.start, c.end, c.frames]), [['1 Hook', 0, 82, 83], ['2 Stall', 83, 184, 102]]);
  assert.strictEqual(e.cuts[0].note, 'Push-in | slow');
  assert.strictEqual(e.totalFrames, 185);
  assert.strictEqual(e.seconds, 7.708);
  assert.deepStrictEqual(e.checks, ['One frame too many.', 'Labels differ.']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nou-prod-'));
  assert.strictEqual(S.loadProduction(dir), null);
  fs.mkdirSync(path.join(dir, 'production'));
  fs.writeFileSync(path.join(dir, 'production', 'edl.md'), md);
  fs.writeFileSync(path.join(dir, 'production', 'veo_payloads.json'), JSON.stringify({ status: 'NOT RUN', clips: [{ clip_id: 'a', duration_s: 3.5 }, { clip_id: 'b', duration_s: 4 }] }));
  const p = S.loadProduction(dir);
  assert.strictEqual(p.clips.length, 2);
  assert.strictEqual(p.clipSeconds, 7.5);
  assert.strictEqual(p.clipStatus, 'NOT RUN');
  assert.strictEqual(p.stems, null);
  assert.deepStrictEqual(p.files.map((f) => f.name), ['edl.md', 'veo_payloads.json']);
});

test('production docs: tables, code, checks; files summarise frame folders; stills come from media', () => {
  const doc = S.parseProductionDoc('lipsync.md', '# Lip-sync: spot\n\n```\nfloor | plan\n```\n\n| Cut | Line |\n|---|---|\n| 1 | Hello |\n\n## Checks\n\n- Re-timed.\n');
  assert.strictEqual(doc.title, 'Lip-sync');
  assert.deepStrictEqual(doc.code, ['floor | plan']);
  assert.strictEqual(doc.tables.length, 1);
  assert.deepStrictEqual(doc.tables[0].rows, [['1', 'Hello']]);
  assert.deepStrictEqual(doc.checks, ['Re-timed.']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nou-prod2-'));
  fs.mkdirSync(path.join(dir, 'production', 'hud', 'frames'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'production', 'lipsync.md'), '# Lip\n');
  fs.writeFileSync(path.join(dir, 'production', 'edl.md'), '# EDL\n');
  fs.writeFileSync(path.join(dir, 'production', 'hud', 'rig.js'), '');
  for (const f of ['F561.png', 'F562.png']) fs.writeFileSync(path.join(dir, 'production', 'hud', 'frames', f), '');
  for (const f of ['hud_sheet.png', 'other.png', 'prod_board.jpg']) fs.writeFileSync(path.join(dir, 'media', f), '');
  const p = S.loadProduction(dir, 'story-1');
  assert.deepStrictEqual(p.files.map((f) => f.name), ['edl.md', 'hud/frames/', 'hud/rig.js', 'lipsync.md']);
  assert.strictEqual(p.files[1].note, '2 rendered frames');
  assert.deepStrictEqual(p.docs.map((d) => d.name), ['lipsync.md']);
  assert.deepStrictEqual(p.stills.map((s) => s.name), ['hud_sheet.png', 'prod_board.jpg']);
  assert.strictEqual(p.stills[0].src, 'nou-media://m/story-1/hud_sheet.png');
});
