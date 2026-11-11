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

// Template fields (templates/broadcast_script_template.md). Header fields sit above the first cue;
// cue fields sit inside a cue. Neither is spoken.
const HEADER_FIELD = /^(Program|Slug|Talent|Format|Writer|Air)\s*:\s*(.+)$/i;
const CUE_FIELD = /^>?\s*(VIDEO|SUPER|SOT|MUSIC|SFX|NAT|GFX|TALENT)\s*:\s*(.+)$/i;
const SOT_RUNS = /RUNS\s+(\d+):(\d{2})/i;
const timecode = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');

function parseScript(md, terms = DEFAULT_BANLIST) {
  const lines = md.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = { title: titleOf(md), intro: [], header: {}, cues: [], notes: [] };
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
      cur = { n: Number(cue[1]), kind: cue[2].trim(), hint: (cue[3] || '').trim(), text: [], source: [], fields: [] };
      out.cues.push(cur);
      continue;
    }
    if (!cur) {
      const h = HEADER_FIELD.exec(line.trim());
      if (h) out.header[h[1].toLowerCase()] = h[2].trim();
      else if (line.trim()) out.intro.push(line.trim());
      continue;
    }
    const t = line.trim();
    if (!t) continue;
    const f = CUE_FIELD.exec(t);
    if (f) { cur.fields.push({ key: f[1].toUpperCase(), value: f[2].trim() }); continue; }
    const src = /^\*(?!\*)(.+)\*$/.exec(t);
    if (src) cur.source.push(src[1].trim());
    else cur.text.push(t);
  }
  for (const c of out.cues) {
    c.text = c.text.join(' ');
    c.source = c.source.join(' ');
    c.words = countWords(c.text);
    // Recorded sound (SOT: ... RUNS m:ss) runs on the clock too, on top of anything Nou says.
    c.sotSeconds = c.fields.filter((f) => f.key === 'SOT').reduce((a, f) => {
      const m = SOT_RUNS.exec(f.value); return a + (m ? Number(m[1]) * 60 + Number(m[2]) : 0);
    }, 0);
    c.seconds = Math.round(c.words / WORDS_PER_SECOND) + c.sotSeconds;
    c.onCamera = /ON\s*CAM/i.test(c.kind);
    c.flags = lintCue(c.text, terms);
  }
  let clock = 0;
  for (const c of out.cues) { c.tcIn = timecode(clock); clock += c.seconds; c.tcOut = timecode(clock); }
  out.trt = timecode(clock);
  out.words = out.cues.reduce((a, c) => a + c.words, 0);
  // One clock: the runtime is the sum of the cue times, so it always equals the as-broadcast TRT.
  out.seconds = out.cues.reduce((a, c) => a + c.seconds, 0);
  out.onCameraSeconds = out.cues.filter((c) => c.onCamera).reduce((a, c) => a + c.seconds - c.sotSeconds, 0);
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

// Word-level changes between two cue texts, as runs: [{ t: 'same' | 'add' | 'del', s: 'words' }].
// Longest common subsequence over whitespace tokens. Words compare without case or edge punctuation,
// so "three." -> "three four." reads as one added word, not a rewrite. Same runs show the new wording.
function wordDiff(a, b) {
  const x = (a || '').split(/\s+/).filter(Boolean);
  const y = (b || '').split(/\s+/).filter(Boolean);
  const key = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '') || w;
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = key(x[i]) === key(y[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const runs = [];
  const push = (t, w) => {
    const last = runs[runs.length - 1];
    if (last && last.t === t) last.s += ' ' + w; else runs.push({ t, s: w });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (key(x[i]) === key(y[j])) { push('same', y[j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push('del', x[i++]);
    else push('add', y[j++]);
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('add', y[j++]);
  return runs;
}

// Per cue of `next`: word runs against the same-numbered cue of `prev`, or null when there is nothing to compare.
function cueChanges(prev, next) {
  if (!prev) return next.cues.map(() => null);
  const byN = new Map(prev.cues.map((c) => [c.n, c]));
  return next.cues.map((c) => {
    const p = byN.get(c.n);
    if (!p || norm(p.text) === norm(c.text)) return null;
    const runs = wordDiff(p.text, c.text);
    // A rewrite reads better whole than as confetti: if under 40% of the new words survive, show old then new.
    const kept = runs.filter((r) => r.t === 'same').reduce((a, r) => a + r.s.split(' ').length, 0);
    const total = c.text.split(/\s+/).filter(Boolean).length;
    return kept / Math.max(1, total) < REWRITE_KEEP ? [{ t: 'del', s: p.text.trim() }, { t: 'add', s: c.text.trim() }] : runs;
  });
}
const REWRITE_KEEP = 0.4;

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

// Rewrite the spoken text of the cues named in `edits` ({ cueNumber: 'new text' }) and stamp the title with
// `version`. Headers, source lines, intro and notes pass through byte for byte, so only the words change.
function applyCueEdits(md, edits, version) {
  const out = [];
  let skipping = false;
  let pending = null;
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const t = raw.trim();
    const cue = CUE.exec(t);
    if (cue || /^##\s/.test(t)) skipping = false;
    if (cue && Object.prototype.hasOwnProperty.call(edits, cue[1])) {
      out.push(raw);
      pending = oneLine(edits[cue[1]]);
      skipping = true;
      continue;
    }
    // The new spoken text goes where the old text started: after any VIDEO/SUPER lines, before the source.
    if (pending !== null && (!t || !CUE_FIELD.exec(t))) {
      out.push(pending); pending = null;
    }
    if (skipping && t && !/^\*(?!\*)(.+)\*$/.test(t) && !CUE_FIELD.exec(t)) continue;
    out.push(/^#\s/.test(t) && version ? raw.replace(/(Nou script v)\d+/i, `$1${version}`) : raw);
  }
  if (pending !== null) out.push(pending);
  return out.join('\n');
}
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

// Save edits made from `baseVersion` as the next version number. Never overwrites a file (flag 'wx').
function saveVersion(dir, baseVersion, edits) {
  const base = path.join(dir, `script_v${baseVersion}.md`);
  if (!fs.existsSync(base)) throw new Error(`no script_v${baseVersion}.md in ${dir}`);
  for (const [n, s] of Object.entries(edits)) if (!oneLine(s)) throw new Error(`cue ${n} is empty`);
  const next = Math.max(...fs.readdirSync(dir).map(versionOf).filter((v) => v !== null)) + 1;
  const file = path.join(dir, `script_v${next}.md`);
  fs.writeFileSync(file, applyCueEdits(fs.readFileSync(base, 'utf8'), edits, next), { flag: 'wx' });
  return { version: next, path: file };
}

// The producer line: Dave's instruction (plus any attached files) goes to a model, which answers with edits
// to the spoken lines only. Craft rules borrowed from the newsroom: substance over polish, no performed
// feeling, every claim traceable to a source note or an attachment.
const ASK_RULES = [
  'You are the producer in the ear of Nou, the on-camera AI reporter for NouGen News. The script is read aloud by a text-to-speech voice.',
  'Apply the instruction to the script. Change only what the instruction calls for; leave other cues untouched.',
  'Facts: never add a claim, number or name that is not in that cue\'s source note or in an attached file. Never drop a caveat.',
  'Write for the ear: short sentences, one idea each, concrete verbs, numbers as words. Calm, clear news tone. Substance over polish; no hype and no performed emotion.',
  'Never use these words or phrases: ' + DEFAULT_BANLIST.join(', ') + '.',
  'Answer with ONLY a JSON object: {"edits": {"<cue number>": "<new spoken text>"}, "note": "<one or two plain sentences on what you changed and why>"}. Include only cues you changed.',
].join('\n');

function buildAskMessages(cues, instruction, attachments = []) {
  const script = cues.map((c) => `[${c.n}] ${c.onCamera ? 'ON CAM' : c.kind}${c.hint ? ` (${c.hint})` : ''}\n${c.text}${c.source ? `\nSource note: ${c.source}` : ''}`).join('\n\n');
  const files = attachments.map((a) => `--- Attached: ${a.name} ---\n${a.text || '(binary file, name only)'}`).join('\n\n');
  return [
    { role: 'system', content: ASK_RULES },
    { role: 'user', content: `SCRIPT:\n${script}${files ? `\n\nATTACHMENTS:\n${files}` : ''}\n\nINSTRUCTION:\n${String(instruction).trim()}` },
  ];
}

// Pull the JSON object out of a model reply (fences, preambles and <think> blocks tolerated) and keep
// only edits to cues that exist and have words.
function parseAskReply(text, cueNumbers) {
  const body = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const start = body.indexOf('{'); const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('the model did not answer with JSON');
  let obj;
  try { obj = JSON.parse(body.slice(start, end + 1)); } catch { throw new Error('the model answered with broken JSON'); }
  const valid = new Set(cueNumbers.map(String));
  const raw = obj.edits && typeof obj.edits === 'object' ? obj.edits : obj;
  const edits = {};
  for (const [n, s] of Object.entries(raw)) if (valid.has(String(n)) && typeof s === 'string' && oneLine(s)) edits[n] = oneLine(s);
  return { edits, note: typeof obj.note === 'string' ? obj.note.trim() : '' };
}

// ── Research lanes ──────────────────────────────────────────────────────────
function extractUrls(text) {
  return [...new Set((String(text).match(/https?:\/\/[^\s<>"')\]]+/g) || []).map((u) => u.replace(/[.,;:!?]+$/, '')))];
}

// A stable, readable file name for a fetched page: web_<host>_<path-slug>.txt
function sourceFileName(url, prefix = 'web') {
  let u; try { u = new URL(url); } catch { return `${prefix}_page.txt`; }
  const host = u.hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-');
  const slug = (u.pathname + u.search).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'home';
  return `${prefix}_${host}_${slug}.txt`.toLowerCase();
}

function researchPlanMessages(question, title) {
  return [
    { role: 'system', content: 'You plan web searches for a news fact-checker. Answer with ONLY a JSON array of 3 or 4 short, different search queries (strings) that together cover the question: the primary source, independent coverage, and the strongest counter-evidence or criticism.' },
    { role: 'user', content: `Story: ${title}\nQuestion: ${String(question).trim()}` },
  ];
}

function parsePlan(text, question) {
  const body = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const a = body.indexOf('['); const b = body.lastIndexOf(']');
  let qs = [];
  if (a >= 0 && b > a) { try { qs = JSON.parse(body.slice(a, b + 1)); } catch { qs = []; } }
  qs = (Array.isArray(qs) ? qs : []).filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()).slice(0, 4);
  return qs.length ? qs : [String(question).trim()];
}

function researchBriefMessages(question, sources, cues = []) {
  const src = sources.map((s, i) => `[${i + 1}] ${s.title || s.url}\n${s.url}${s.published ? `\nPublished: ${s.published}` : ''}\n${s.text}`).join('\n\n');
  const script = cues.map((c) => `[${c.n}] ${c.text}`).join('\n');
  return [
    { role: 'system', content: [
      'You are the research desk for NouGen News. Write a short research brief in Markdown from the numbered sources only.',
      'Every factual sentence ends with its source number(s) like [2]. If sources disagree, say so. If the question is not answered by the sources, say that plainly. Never use outside knowledge.',
      'Plain text only: no asterisks, no bold or italics; use - for list items.',
      'Sections: "## Answer" (3 to 6 sentences), "## Usable lines" (bullets: a fact Nou could say aloud, with source number), "## Check against the script" (bullets: any script line the sources support, contradict or update, by cue number; write "Nothing to flag." if none), "## Sources" (numbered list: title and URL).',
    ].join('\n') },
    { role: 'user', content: `QUESTION:\n${String(question).trim()}\n\nCURRENT SCRIPT:\n${script || '(none)'}\n\nSOURCES:\n${src}` },
  ];
}

function digestMessages(item, cues = []) {
  const script = cues.map((c) => `[${c.n}] ${c.text}`).join('\n');
  return [
    { role: 'system', content: [
      'You are the digest desk for NouGen News. Digest ONE item (a web page, PDF, video or audio transcript) for a reporter. Use only the item text; no outside knowledge.',
      'If the text has [hh:mm:ss] timestamps, cite them for each point. Machine transcripts mishear names: flag any name that looks misheard instead of repeating it as fact.',
      'Plain text only: no asterisks, no bold or italics; use - for list items.',
      'Markdown sections: "## What it is" (one or two sentences: who, what, when), "## Key points" (5 to 8 bullets), "## Usable lines" (bullets: facts Nou could say aloud, each with its timestamp or section), "## Check against the script" (bullets by cue number: supports, contradicts or updates; "Nothing to flag." if none).',
    ].join('\n') },
    { role: 'user', content: `ITEM: ${item.title}\n${item.url}\nKind: ${item.kind} (${item.lane})\n\nCURRENT SCRIPT:\n${script || '(none)'}\n\nTEXT:\n${String(item.text).slice(0, 60000)}` },
  ];
}

// ── Media found while scraping ─────────────────────────────────────────────
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
const VID_EXT = /\.(mp4|m4v|mov|webm|m3u8)(\?|#|$)/i;
const AUD_EXT = /\.(mp3|m4a|aac|wav|ogg|opus|flac)(\?|#|$)/i;
const EMBED = /(youtube\.com\/(embed|watch)|youtu\.be\/|player\.vimeo\.com|vimeo\.com\/\d|x\.com\/.+\/status|twitter\.com\/.+\/status|tiktok\.com\/|loom\.com\/(share|embed))/i;
const NOISE = /(sprite|icon|logo|favicon|avatar|pixel|tracking|spacer|badge|emoji|1x1|gravatar)/i;

function mediaKind(u) {
  if (IMG_EXT.test(u)) return 'image';
  if (VID_EXT.test(u)) return 'video';
  if (AUD_EXT.test(u)) return 'audio';
  if (/\.pdf(\?|#|$)/i.test(u)) return 'pdf';
  if (EMBED.test(u)) return 'video';
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m));
}

// Photos, videos, audio and embeds referenced by a page. Absolute URLs, de-duplicated, decorative noise dropped,
// social preview images (og:/twitter:image) first because they are the page's own chosen picture.
function extractMedia(html, baseUrl, limit = 40) {
  const out = []; const seen = new Set();
  const add = (raw, kind, label = '', from = '') => {
    if (!raw || /^(data|blob|javascript):/i.test(raw)) return;
    let u; try { u = new URL(raw.replace(/&amp;/g, '&').trim(), baseUrl).href; } catch { return; }
    if (!/^https?:/i.test(u) || NOISE.test(u.split('?')[0]) || /\.(svg|ico)(\?|$)/i.test(u)) return;
    const k = kind || mediaKind(u); if (!k) return;
    const key = u.replace(/[?#].*$/, '');
    if (seen.has(key)) return; seen.add(key);
    out.push({ url: u, kind: k, label: decodeEntities(String(label)).replace(/\s+/g, ' ').trim().slice(0, 140), via: from });
  };
  const s = String(html || '');
  for (const m of s.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|twitter:image)["'][^>]*>/gi)) add((/content=["']([^"']+)/i.exec(m[0]) || [])[1], 'image', 'preview image', 'og');
  for (const m of s.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|twitter:player)["'][^>]*>/gi)) add((/content=["']([^"']+)/i.exec(m[0]) || [])[1], 'video', 'page video', 'og');
  for (const m of s.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const w = Number((/\bwidth=["']?(\d+)/i.exec(tag) || [])[1] || 0);
    if (w && w < 120) continue;
    const srcset = (/\bsrcset=["']([^"']+)/i.exec(tag) || [])[1];
    const best = srcset ? srcset.split(',').map((x) => x.trim().split(/\s+/)[0]).pop() : null;
    add(best || (/\b(?:data-src|src)=["']([^"']+)/i.exec(tag) || [])[1], 'image', (/\balt=["']([^"']*)/i.exec(tag) || [])[1] || '', 'img');
  }
  for (const m of s.matchAll(/<(?:video|audio|source)\b[^>]*>/gi)) {
    const src = (/\bsrc=["']([^"']+)/i.exec(m[0]) || [])[1];
    add(src, /^<audio/i.test(m[0]) ? 'audio' : null, 'embedded media', 'tag');
    add((/\bposter=["']([^"']+)/i.exec(m[0]) || [])[1], 'image', 'video poster', 'tag');
  }
  for (const m of s.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)/gi)) if (EMBED.test(m[1])) add(m[1], 'video', 'embedded video', 'iframe');
  for (const m of s.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) if (mediaKind(m[1])) add(m[1], null, m[2].replace(/<[^>]+>/g, ''), 'link');
  return out.slice(0, limit);
}

// Merge new items into a story's media list, newest first, keeping what is already there.
function mergeMedia(existing, items, source, now = new Date()) {
  const list = Array.isArray(existing) ? existing.slice() : [];
  const have = new Set(list.map((m) => m.url.replace(/[?#].*$/, '')));
  const fresh = items.filter((m) => !have.has(m.url.replace(/[?#].*$/, ''))).map((m) => ({ ...m, source, added: now.toISOString() }));
  return [...fresh, ...list];
}

// nou-media://m/<storyId>/<file> -> the absolute path of a downloaded photo, or null. Only a plain file name
// inside <root>/<storyId>/media/ resolves: no slashes, no "..", image extensions only.
function mediaUrl(storyId, file) {
  return `nou-media://m/${encodeURIComponent(storyId)}/${encodeURIComponent(path.basename(file))}`;
}
function resolveMediaUrl(url, root = storiesRoot()) {
  let u; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'nou-media:' || u.hostname !== 'm') return null;
  const parts = u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  if (parts.length !== 2) return null;
  const [storyId, file] = parts;
  if (!storyId || !file || /[\\/]/.test(storyId) || /[\\/]/.test(file) || storyId.startsWith('.') || file.startsWith('.')) return null;
  if (!/\.(jpe?g|png|webp|gif|avif|img)$/i.test(file)) return null;
  const dir = path.resolve(root, storyId, 'media');
  const abs = path.resolve(dir, file);
  return abs.startsWith(dir + path.sep) ? abs : null;
}

module.exports = {
  mediaUrl, resolveMediaUrl, decodeEntities,
  extractMedia, mergeMedia, mediaKind,
  digestMessages,
  extractUrls, sourceFileName, researchPlanMessages, parsePlan, researchBriefMessages,
  ASK_RULES, buildAskMessages, parseAskReply,
  applyCueEdits, saveVersion,
  WORDS_PER_SECOND, storiesRoot, listStories, parseScript, compare, wordDiff, cueChanges, writeApproval,
  readApproval, approvalIsCurrent, easternTime, countWords, DEFAULT_BANLIST,
  loadBanlist, lintCue, toOpenClap, exportOpenClap,
};
