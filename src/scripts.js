'use strict';
// Pure logic: find stories, parse Nou scripts, compare versions. No Electron imports, so `node --test` covers it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORDS_PER_SECOND = 2.8; // Nou's Kokoro af_sky voice at speed 1.05, measured on the v5 intro line.

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

function parseScript(md) {
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
  }
  out.words = out.cues.reduce((a, c) => a + c.words, 0);
  out.seconds = Math.round(out.words / WORDS_PER_SECOND);
  out.onCameraSeconds = out.cues.filter((c) => c.onCamera).reduce((a, c) => a + c.seconds, 0);
  // OmniAvatar renders about 4.6 s of audio per free job (talkinghead.CHUNK).
  out.avatarJobs = out.cues.filter((c) => c.onCamera).reduce((a, c) => a + Math.max(1, Math.ceil(c.seconds / 4.6)), 0);
  return out;
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
  readApproval, approvalIsCurrent, easternTime, countWords,
};
