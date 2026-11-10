'use strict';
// Pure logic: find stories, parse Nou scripts, compare versions. No Electron imports, so `node --test` covers it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORDS_PER_SECOND = 2.8; // Nou's Kokoro af_sky voice at speed 1.05, measured on the v5 intro line.

const DEFAULT_BANLIST = [
  'delve', 'delves', 'delved', 'delving',
  'intricate', 'intricacies',
  'underscore', 'underscores', 'underscoring',
  'showcase', 'showcases', 'showcasing',
  'realm', 'tapestry', 'testament',
  'groundbreaking', 'garnered', 'boasts', 'advancements',
  'aligns', 'meticulous', 'meticulously', 'vibrant',
  'unlock', 'unlocks', 'unleash', 'seamless', 'transformative', 'paramount',
  'it is important to note that', 'it is worth noting that',
  "in today's ever-evolving", 'in the realm of',
  'at the end of the day', "let's delve into", "let's take a deep dive into",
  "here's the thing", "here's why", 'what this means is',
  'in conclusion', 'a testament to', 'a rich tapestry of', 'a vibrant landscape',
];

function loadBanlist(root = storiesRoot()) {
  const custom = path.join(root, 'banlist.txt');
  if (fs.existsSync(custom)) {
    try {
      const terms = fs.readFileSync(custom, 'utf8')
        .split('\n')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s && !s.startsWith('#'));
      if (terms.length) return terms;
    } catch {
      // Fall through to DEFAULT_BANLIST
    }
  }
  return DEFAULT_BANLIST;
}

function lintCue(text, terms = DEFAULT_BANLIST) {
  if (!text) return [];
  const found = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, 'i');
    if (rx.test(text)) found.push(term);
  }
  return [...new Set(found)];
}

function storiesRoot() {
  return process.env.NOU_STORIES || path.join(require('os').homedir(), '.nougen', 'nou_assets', 'stories');
}

function versionOf(name) {
  const m = /^script_v(\d+)\.md$/i.exec(name);
  return m ? Number(m[1]) : null;
}

function listStories(root = storiesRoot()) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(root, d.name);
      const versions = fs.readdirSync(dir)
        .map((f) => ({ file: f, version: versionOf(f) }))
        .filter((v) => v.version !== null)
        .sort((a, b) => a.version - b.version)
        .map((v) => ({ ...v, path: path.join(dir, v.file), mtime: fs.statSync(path.join(dir, v.file)).mtimeMs }));
      const title = versions.length ? titleOf(fs.readFileSync(versions[versions.length - 1].path, 'utf8')) : d.name;
      return { id: d.name, dir, title, versions, approval: readApproval(dir), hasBrief: fs.existsSync(path.join(dir, 'brief.md')) };
    })
    .filter((s) => s.versions.length)
    .sort((a, b) => b.id.localeCompare(a.id));
}

function titleOf(md) {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].replace(/\s*\((?:draft|not rendered)[^)]*\)\s*$/i, '').replace(/^Nou script v\d+:\s*/i, '').trim() : 'Untitled script';
}

// A cue line looks like: **1. ON CAM (open, ~7 s)**  or  **2. VO (~14 s)**
const CUE = /^\*\*(\d+)\.\s+([A-Z][A-Z /-]*?)\s*(?:\(([^)]*)\))?\*\*\s*$/;

function parseScript(md, terms = DEFAULT_BANLIST) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = { title: titleOf(md), intro: [], cues: [], notes: [] };
  let cur = null;
  let inNotes = false;
  let noteSection = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#\s/.test(line)) continue;
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      inNotes = true; cur = null;
      noteSection = { heading: h2[1].trim(), lines: [] };
      out.notes.push(noteSection);
      continue;
    }
    if (inNotes) { noteSection.lines.push(line); continue; }
    const cue = CUE.exec(line.trim());
    if (cue) {
      cur = { n: Number(cue[1]), kind: cue[2].trim(), hint: (cue[3] || '').trim(), text: [], source: [] };
      out.cues.push(cur);
      continue;
    }
    if (!cur) { if (line.trim()) out.intro.push(line.trim()); continue; }
    const t = line.trim();
    if (!t) continue;
    const src = /^\*(?!\*)(.+)\*$/.exec(t);
    if (src) cur.source.push(src[1].trim());
    else cur.text.push(t);
  }
  for (const c of out.cues) {
    c.text = c.text.join(' ');
    c.source = c.source.join(' ');
    c.words = countWords(c.text);
    c.seconds = Math.round(c.words / WORDS_PER_SECOND);
    c.onCamera = /ON\s*CAM/i.test(c.kind);
    c.flags = lintCue(c.text, terms);
  }
  out.words = out.cues.reduce((a, c) => a + c.words, 0);
  out.seconds = Math.round(out.words / WORDS_PER_SECOND);
  out.onCameraSeconds = out.cues.filter((c) => c.onCamera).reduce((a, c) => a + c.seconds, 0);
  // OmniAvatar renders about 4.6 s of audio per free job (talkinghead.CHUNK).
  out.avatarJobs = out.cues.filter((c) => c.onCamera).reduce((a, c) => a + Math.max(1, Math.ceil(c.seconds / 4.6)), 0);
  out.flaggedCount = out.cues.filter((c) => c.flags.length > 0).length;
  return out;
}

function toOpenClap(parsed, { id = 'story', version = 1 } = {}) {
  const docs = [];
  let currentMs = 0;
  const scenes = [];
  const segments = [];

  for (const c of parsed.cues) {
    const cueDurationMs = Math.max(1000, c.seconds * 1000);
    const startMs = currentMs;
    const endMs = startMs + cueDurationMs;
    currentMs = endMs;

    scenes.push([
      `id: scene-${c.n}`,
      `sceneNumber: ${c.n}`,
      `name: ${JSON.stringify(c.kind + (c.hint ? ' (' + c.hint + ')' : ''))}`,
      `onCamera: ${c.onCamera}`,
      `startTimeInMs: ${startMs}`,
      `endTimeInMs: ${endMs}`,
      `durationInMs: ${cueDurationMs}`,
    ].join('\n'));

    // Video track segment (track 1)
    const videoPrompt = c.onCamera
      ? `Nou high-tech anchor on camera: ${c.text}`
      : `B-roll visual b-roll graphic: ${c.hint || c.text}`;
    segments.push([
      `id: seg-video-${c.n}`,
      `track: 1`,
      `category: video`,
      `sceneId: scene-${c.n}`,
      `startTimeInMs: ${startMs}`,
      `endTimeInMs: ${endMs}`,
      `prompt: ${JSON.stringify(videoPrompt)}`,
    ].join('\n'));

    // Dialogue track segment (track 2)
    const dialogueLines = [
      `id: seg-dialogue-${c.n}`,
      `track: 2`,
      `category: dialogue`,
      `sceneId: scene-${c.n}`,
      `entityId: entity-nou`,
      `startTimeInMs: ${startMs}`,
      `endTimeInMs: ${endMs}`,
      `speaker: Nou`,
      `voice: Kokoro:af_sky`,
      `text: ${JSON.stringify(c.text)}`,
    ];
    if (c.source) dialogueLines.push(`source: ${JSON.stringify(c.source)}`);
    segments.push(dialogueLines.join('\n'));
  }

  const totalDurationMs = currentMs;

  // Header document
  docs.push([
    `format: clap-0`,
    `numberOfEntities: 1`,
    `numberOfScenes: ${scenes.length}`,
    `numberOfSegments: ${segments.length}`,
  ].join('\n'));

  // Meta document
  docs.push([
    `id: ${JSON.stringify(id)}`,
    `title: ${JSON.stringify(parsed.title)}`,
    `description: ${JSON.stringify('Nou script v' + version)}`,
    `durationInMs: ${totalDurationMs}`,
    `width: 1920`,
    `height: 1080`,
    `fps: 30`,
    `defaultVideoModel: "Remotion / OmniAvatar"`,
    `defaultVoiceModel: "Kokoro:af_sky"`,
  ].join('\n'));

  // Entity document
  docs.push([
    `id: entity-nou`,
    `category: character`,
    `name: Nou`,
    `appearance: "Cybernetic high-tech anchor, sharp dark suit, crisp broadcast delivery"`,
    `voice: "Kokoro:af_sky"`,
  ].join('\n'));

  // Scenes & Segments
  docs.push(...scenes);
  docs.push(...segments);

  return docs.map((d) => `---\n${d}`).join('\n') + '\n';
}

function exportOpenClap(dir, version) {
  const file = path.join(dir, `script_v${version}.md`);
  if (!fs.existsSync(file)) throw new Error(`no script_v${version}.md in ${dir}`);
  const parsed = parseScript(fs.readFileSync(file, 'utf8'), loadBanlist(path.dirname(dir)));
  const storyId = path.basename(dir);
  const clapContent = toOpenClap(parsed, { id: storyId, version });
  const clapFile = `${storyId}_v${version}.clap`;
  const clapPath = path.join(dir, clapFile);
  fs.writeFileSync(clapPath, clapContent, 'utf8');
  return { file: clapFile, path: clapPath, size: Buffer.byteLength(clapContent, 'utf8') };
}

function countWords(s) {
  return (s.match(/[A-Za-z0-9][A-Za-z0-9'’.,-]*/g) || []).length;
}

// Mark each cue as new, changed or same against the previous version, matched by cue number.
function compare(prev, next) {
  if (!prev) return next.cues.map(() => 'new');
  const byN = new Map(prev.cues.map((c) => [c.n, c]));
  return next.cues.map((c) => {
    const p = byN.get(c.n);
    if (!p) return 'new';
    return norm(p.text) === norm(c.text) ? 'same' : 'changed';
  });
}

function norm(s) { return s.replace(/\s+/g, ' ').trim().toLowerCase(); }

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readApproval(dir) {
  const f = path.join(dir, 'approval.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

// The approval gate a render step can check: which version, its exact bytes, and when.
function writeApproval(dir, version, note, now = new Date()) {
  const file = path.join(dir, `script_v${version}.md`);
  if (!fs.existsSync(file)) throw new Error(`no script_v${version}.md in ${dir}`);
  const rec = {
    version,
    file: path.basename(file),
    sha256: sha256(file),
    approved_at: now.toISOString(),
    approved_at_eastern: easternTime(now),
    note: (note || '').slice(0, 2000),
    by: 'Dave (Nou Scripts app)',
  };
  fs.writeFileSync(path.join(dir, 'approval.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

function approvalIsCurrent(dir, approval) {
  if (!approval) return false;
  const file = path.join(dir, approval.file || '');
  return fs.existsSync(file) && sha256(file) === approval.sha256;
}

function easternTime(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
}

module.exports = {
  WORDS_PER_SECOND, storiesRoot, listStories, parseScript, compare, writeApproval,
  readApproval, approvalIsCurrent, easternTime, countWords, DEFAULT_BANLIST,
  loadBanlist, lintCue, toOpenClap, exportOpenClap,
};
