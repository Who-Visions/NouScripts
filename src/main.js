'use strict';
const { app, BrowserWindow, ipcMain, shell, nativeTheme, dialog, MessageChannelMain, Notification, screen, protocol, net } = require('electron');
const { pathToFileURL } = require('url');

// Thumbnails load over nou-media:// (security checklist item 18: no file:// in the page). Must be registered
// before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'nou-media', privileges: { standard: true, secure: true, supportFetchAPI: false } }]);
const { windowSize, refit } = require('./window-size');
const { AsyncLocalStorage } = require('async_hooks');
const { autoUpdater } = require('electron');
const { createUpdater } = require('./updater');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const S = require('./scripts');

const capture = (process.argv.find((a) => a.startsWith('--capture=')) || '').split('=')[1];
const captureMode = (process.argv.find((a) => a.startsWith('--mode=')) || '').split('=')[1] || 'read';
const captureRail = (process.argv.find((a) => a.startsWith('--rail=')) || '').split('=')[1] || '';
let win;
let watcher;

function storyById(id) {
  return S.listStories().find((s) => s.id === id);
}

function inRoot(p) {
  const root = path.resolve(S.storiesRoot());
  const abs = path.resolve(p);
  return abs === root || abs.startsWith(root + path.sep);
}

// The approval goes out through the nougen msg CLI, which holds the node token and reaches every lane.
// (It used to POST to 127.0.0.1:8766/messages first; that route does not exist, the node's route is /msg and
// needs the token, so every approval paid a failed request before the CLI ran. Measured 2026-11-12: 404.)
async function broadcastApproval(storyId, version, note) {
  const text = `[APPROVED] Story "${storyId}" script v${version} approved by Dave${note ? ` ("${note}")` : ''}`;
  const nougenBin = process.env.NOUGEN_BIN
    || path.join(require('os').homedir(), 'The Observatory', 'NouGen', 'nougenshards', '.venv', 'bin', 'nougen');
  if (!fs.existsSync(nougenBin)) {
    console.log('approval broadcast skipped: no nougen CLI at', nougenBin);
    return;
  }
  execFile(nougenBin, ['msg', '--to', '@all', text], { timeout: 60000 }, (err) => {
    if (err) console.log('approval broadcast failed:', err.message);
    else console.log('Broadcasted approval via nougen msg');
  });
}

ipcMain.handle('stories:list', () => ({
  root: S.storiesRoot(),
  stories: S.listStories().map((s) => ({ ...s, approvalCurrent: S.approvalIsCurrent(s.dir, s.approval) })),
}));

ipcMain.handle('script:load', (_e, { id, version }) => {
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  const idx = story.versions.findIndex((v) => v.version === version);
  if (idx < 0) throw new Error('version not found');
  const cur = story.versions[idx];
  const parsed = S.parseScript(fs.readFileSync(cur.path, 'utf8'));
  const prevV = idx > 0 ? story.versions[idx - 1] : null;
  const prev = prevV ? S.parseScript(fs.readFileSync(prevV.path, 'utf8')) : null;
  return {
    story: { id: story.id, title: story.title, dir: story.dir, versions: story.versions.map((v) => v.version) },
    version, path: cur.path, prevVersion: prevV ? prevV.version : null,
    script: parsed, diff: S.compare(prev, parsed), changes: S.cueChanges(prev, parsed),
    approval: story.approval, approvalCurrent: S.approvalIsCurrent(story.dir, story.approval),
    modified: S.easternTime(new Date(cur.mtime)),
    banlist: S.loadBanlist(), wordsPerSecond: S.WORDS_PER_SECOND,
    hasProduction: fs.existsSync(path.join(story.dir, 'production')),
  };
});

ipcMain.handle('script:approve', async (_e, { id, version, note }) => {
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  const result = S.writeApproval(story.dir, version, note);
  try {
    S.exportOpenClap(story.dir, version);
  } catch (e) {
    console.error('Failed to auto-export OpenClap on approval:', e.message);
  }
  broadcastApproval(story.id, version, note).catch(() => {});
  return result;
});

ipcMain.handle('script:save', (_e, { id, version, edits }) => {
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  return S.saveVersion(story.dir, version, edits);
});

// ── Producer line ──────────────────────────────────────────────────────────
// The NVIDIA key is read from the Keymaker by name and kept in this process only; the window never sees it.
const SHARDS = path.join(require('os').homedir(), 'The Observatory', 'NouGen', 'nougenshards');
let nvidiaKey = null;
function keymakerGet(name) {
  return new Promise((resolve, reject) => {
    const py = path.join(SHARDS, '.venv', 'bin', 'python');
    const code = "import sys; sys.path.insert(0,'src'); from nougen_shards import keymaker; sys.stdout.write(keymaker.get_secret(sys.argv[1]) or '')";
    execFile(py, ['-c', code, name], { cwd: SHARDS, timeout: 15000 }, (err, out) => {
      if (err || !out.trim()) reject(new Error(`${name} is not in the Keymaker on this machine`));
      else resolve(out.trim());
    });
  });
}

const TEXT_EXT = /\.(md|txt|markdown|html?|json|csv|srt|vtt|xml|ya?ml)$/i;
const attached = new Map(); // id -> { name, path }, so the window only ever holds ids and names
ipcMain.handle('ask:attach', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], title: 'Attach files for Nou' });
  if (r.canceled) return [];
  return r.filePaths.map((p) => {
    const id = require('crypto').randomUUID();
    attached.set(id, { name: path.basename(p), path: p });
    return { id, name: path.basename(p), text: TEXT_EXT.test(p) };
  });
});

function readAttachment(a) {
  if (!TEXT_EXT.test(a.path)) return { name: a.name, text: '' };
  let t = fs.readFileSync(a.path, 'utf8');
  if (/\.html?$/i.test(a.path)) t = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return { name: a.name, text: t.replace(/\s+/g, ' ').trim().slice(0, 24000) };
}

// ── Live jobs over MessagePorts ──────────────────────────────────────────────
// Each long job (fetch, digest, research, edit) gets its own MessageChannelMain. One end goes to the window
// (forwarded into the page by the preload); the job streams named steps over it, and the window can send
// {type:'cancel'}. AsyncLocalStorage carries the job's abort signal and progress poster into every helper.
const jobs = new AsyncLocalStorage();
const step = (text) => { const j = jobs.getStore(); if (j) j.post({ type: 'step', text }); };
const jobSignal = () => { const j = jobs.getStore(); return j ? j.signal : null; };
const sig = (ms) => { const j = jobSignal(); return j ? AbortSignal.any([AbortSignal.timeout(ms), j]) : AbortSignal.timeout(ms); };
const checkCancel = () => { const j = jobSignal(); if (j && j.aborted) throw new Error('Cancelled.'); };
let activeJobs = 0; // jobs streaming right now; an update never restarts the app under one
// A local notification when a long job ends while the window is not in front. Local only: no push service, no
// Apple account, nothing leaves the machine. Skipped when the window has focus, since the result is already on screen.
// Electron security checklist item 17: only the app's own top-level page may ask for file or link actions.
function fromAppPage(e) {
  return Boolean(win && !win.isDestroyed() && e.sender === win.webContents && e.senderFrame && e.senderFrame.parent === null);
}
const denied = () => { throw new Error('Not allowed from this page'); };

function notifyJob(label, ok, detail = '') {
  if (!Notification.isSupported()) return;
  if (win && !win.isDestroyed() && win.isFocused()) return;
  const n = new Notification({
    title: ok ? `${label} finished` : `${label} failed`,
    body: ok ? 'Open Nou Scripts to see the result.' : String(detail).slice(0, 200),
    silent: true,
  });
  n.on('click', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
  n.show();
}

function withJob(event, jobId, label, fn) {
  if (!jobId) return fn();
  activeJobs++;
  const { port1, port2 } = new MessageChannelMain();
  const ac = new AbortController(); const t0 = Date.now();
  const post = (msg) => { try { port1.postMessage({ ...msg, t: Math.round((Date.now() - t0) / 100) / 10 }); } catch { /* window gone */ } };
  port1.on('message', (m) => { if (m.data && m.data.type === 'cancel' && !ac.signal.aborted) { ac.abort(new Error('Cancelled.')); post({ type: 'step', text: 'Cancelling…' }); } });
  port1.start();
  event.sender.postMessage('nou-job-port', { jobId }, [port2]);
  return jobs.run({ signal: ac.signal, post }, async () => {
    try { const r = await fn(); post({ type: 'done' }); notifyJob(label, true); return r; }
    catch (err) {
      const msg = ac.signal.aborted ? 'Cancelled.' : err.message;
      post({ type: 'error', text: msg });
      if (msg !== 'Cancelled.') notifyJob(label, false, msg);
      throw new Error(msg);
    }
    finally { activeJobs--; setTimeout(() => port1.close(), 200); }
  });
}

async function nvidiaChat(model, messages, maxTokens = 3000) {
  nvidiaKey = nvidiaKey || await keymakerGet('NVIDIA_API_KEY');
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${nvidiaKey}`, 'Content-Type': 'application/json' },
    // Nemotron reasons before answering by default; on long prompts the reasoning used the whole budget and the
    // answer came back empty. These lanes need the answer, so reasoning is off for it.
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: maxTokens,
      ...(/nemotron/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {}) }),
    signal: sig(180000),
  });
  if (!res.ok) throw new Error(`NVIDIA ${res.status}${res.status === 404 ? ': this account cannot call that model' : ''}`);
  const d = await res.json();
  // Dave reads these; asterisks (bold, italics, star bullets) are stripped whatever the model does.
  const content = (d.choices?.[0]?.message?.content || '').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(^|\s)\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1$2').replace(/^(\s*)\* /gm, '$1- ').trim();
  if (!content) throw new Error(`${model.split('/').pop()} returned an empty answer (${d.choices?.[0]?.finish_reason || 'no reason given'})`);
  return content;
}

// Search and page-reading keys, tried in order; a key that answers 401/403 is skipped for the session.
// EXA_API_KEY (the first) returned 401 on 2026-11-11, so the numbered ones lead.
const EXA_KEYS = ['EXA_API_KEY_2', 'EXA_API_KEY_3', 'EXA_API_KEY'];
const deadKeys = new Set();
async function exa(pathname, body) {
  for (const name of EXA_KEYS) {
    if (deadKeys.has(name)) continue;
    let key; try { key = await keymakerGet(name); } catch { deadKeys.add(name); continue; }
    const res = await fetch(`https://api.exa.ai${pathname}`, {
      method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: sig(45000),
    });
    if (res.status === 401 || res.status === 403 || res.status === 402) { deadKeys.add(name); continue; }
    if (!res.ok) throw new Error(`Exa ${res.status}`);
    return res.json();
  }
  return null;
}
async function tavilySearch(query, n) {
  const key = await keymakerGet('TAVILY_API_KEY');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_results: n, search_depth: 'advanced', include_raw_content: true }), signal: sig(45000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const d = await res.json();
  return (d.results || []).map((r) => ({ url: r.url, title: r.title, text: (r.raw_content || r.content || '').slice(0, 6000), published: r.published_date || '' }));
}
async function search(query, n = 4) {
  const d = await exa('/search', { query, numResults: n, contents: { text: { maxCharacters: 6000 } } }).catch(() => null);
  if (d && d.results) return { lane: 'Exa', results: d.results.map((r) => ({ url: r.url, title: r.title, text: r.text || '', published: r.publishedDate || '' })) };
  return { lane: 'Tavily', results: await tavilySearch(query, n) };
}
async function readPage(url) {
  const d = await exa('/contents', { urls: [url], text: { maxCharacters: 40000 } }).catch(() => null);
  const r = d && d.results && d.results[0];
  if (r && r.text) return { url, title: r.title || url, text: r.text, lane: 'Exa' };
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 NouScripts' }, signal: sig(30000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  const html = await res.text();
  const title = (/<title[^>]*>([^<]*)/i.exec(html) || [])[1] || url;
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { url, title: title.trim(), text, lane: 'direct' };
}

// Resolve any link at runtime: YouTube captions, audio/video via local whisper, PDF, else a web page.
// tools/digest_resolve.py runs in ~/.nougen/venvs/digest; without that venv every link is read as a page.
const DIGEST_PY = path.join(require('os').homedir(), '.nougen', 'venvs', 'digest', 'bin', 'python');
const RESOLVER = path.join(__dirname, '..', 'tools', 'digest_resolve.py');
function runResolver(url) {
  return new Promise((resolve) => {
    if (!fs.existsSync(DIGEST_PY)) return resolve({ kind: 'page', lane: 'web', url, title: url, text: '' });
    execFile(DIGEST_PY, ['-I', RESOLVER, url, '--max-minutes', '45'], { timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, cwd: require('os').tmpdir(), ...(jobSignal() ? { signal: jobSignal() } : {}) },
      (err, out) => {
        try { resolve(JSON.parse(out)); } catch { resolve({ kind: 'error', url, title: url, note: err ? err.message.split('\n')[0] : 'resolver gave no answer' }); }
      });
  });
}
async function resolveLink(url) {
  const r = await runResolver(url);
  if (r.kind === 'error') throw new Error(r.note || 'could not read it');
  if (r.kind === 'page') { const pg = await readPage(url); return { ...pg, kind: 'page', lane: `web · ${pg.lane}` }; }
  return { url, title: r.title || url, text: r.text || '', kind: r.kind, lane: r.lane, note: r.note, thumbnail: r.thumbnail, hasVideo: r.has_video };
}
// ── Media sources: photos, videos, audio and embeds found while reading a link ──
function mediaFile(story) { return path.join(story.dir, 'media.json'); }
function readMedia(story) { try { return JSON.parse(fs.readFileSync(mediaFile(story), 'utf8')); } catch { return []; } }
async function downloadImage(story, m) {
  const res = await fetch(m.url, { headers: { 'User-Agent': 'Mozilla/5.0 NouScripts' }, signal: sig(20000) });
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0];
  if (!type.startsWith('image/') || /svg|icon/.test(type)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 6000 || buf.length > 15 * 1024 * 1024) return null; // icons and huge originals are not useful here
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[type] || 'img';
  const dir = path.join(story.dir, 'media'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${require('crypto').createHash('sha1').update(m.url).digest('hex').slice(0, 12)}.${ext}`);
  fs.writeFileSync(file, buf);
  return path.relative(story.dir, file);
}
async function collectMedia(story, url, item) {
  let found = [];
  if (item.kind === 'youtube' || item.kind === 'media') {
    found.push({ url, kind: item.kind === 'youtube' || item.hasVideo ? 'video' : 'audio', label: item.title, via: 'source' });
    if (item.thumbnail) found.push({ url: item.thumbnail, kind: 'image', label: `Thumbnail: ${item.title}`, via: 'thumbnail' });
  } else if (item.kind === 'page') {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 NouScripts' }, signal: sig(20000) });
      if (res.ok && /html/i.test(res.headers.get('content-type') || '')) found = S.extractMedia(await res.text(), url);
    } catch { /* the text was still read; this page just gives no media */ }
  }
  if (!found.length) return { added: 0 };
  const list = S.mergeMedia(readMedia(story), found, url);
  const fresh = list.filter((m) => m.source === url && !m.file);
  let saved = 0;
  for (const m of fresh.filter((x) => x.kind === 'image').slice(0, 12)) {
    try { const f = await downloadImage(story, m); if (f) { m.file = f; saved++; } } catch { /* keep the link */ }
  }
  fs.writeFileSync(mediaFile(story), JSON.stringify(list, null, 2) + '\n');
  return { added: found.length, saved };
}

// Desk (research briefs, digests) and Sources (saved pages and transcripts) for the left panel.
ipcMain.handle('story:files', (_e, { id }) => {
  const story = storyById(id);
  if (!story) return { desk: [], sources: [] };
  const first = (f, n = 2) => { try { return fs.readFileSync(f, 'utf8').split('\n').slice(0, n); } catch { return []; } };
  const stat = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const desk = fs.readdirSync(story.dir).filter((f) => /^(research|digest)_.*\.md$/.test(f)).map((f) => {
    const p = path.join(story.dir, f);
    return { name: f, path: p, kind: f.startsWith('research') ? 'research' : 'digest', title: (first(p, 1)[0] || f).replace(/^#\s*(Research|Digest):\s*/, ''), mtime: stat(p) };
  }).sort((a, b) => b.mtime - a.mtime);
  const sdir = path.join(story.dir, 'sources');
  const sources = fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((f) => /\.(txt|md|html|pdf)$/.test(f)).map((f) => {
    const p = path.join(sdir, f); const [title, url] = /\.txt$/.test(f) ? first(p, 2) : [f, ''];
    return { name: f, path: p, title: (title || f).slice(0, 160), url: /^https?:/.test(url || '') ? url : '', kind: f.split(/[_.]/)[0], mtime: stat(p) };
  }).sort((a, b) => b.mtime - a.mtime) : [];
  return { desk, sources };
});

ipcMain.handle('production:load', (_e, { id }) => {
  const story = storyById(id);
  return story ? S.loadProduction(story.dir, story.id) : null;
});

ipcMain.handle('media:list', (_e, { id }) => {
  const story = storyById(id);
  if (!story) return [];
  // src is what the page shows; path stays for attach/open decisions. Labels saved before entity decoding are cleaned here.
  return readMedia(story).map((m) => ({ ...m, label: S.decodeEntities(m.label || ''), path: m.file ? path.join(story.dir, m.file) : null, src: m.file ? S.mediaUrl(story.id, m.file) : null }));
});
ipcMain.handle('media:attach', (e, { id, url }) => {
  if (!fromAppPage(e)) return denied();
  const story = storyById(id);
  const m = story && readMedia(story).find((x) => x.url === url);
  if (!m || !m.file) throw new Error('only downloaded photos can be attached');
  const aid = require('crypto').randomUUID();
  attached.set(aid, { name: path.basename(m.file), path: path.join(story.dir, m.file) });
  return { id: aid, name: path.basename(m.file), text: false };
});
ipcMain.handle('media:open', (e, { id, url }) => {
  if (!fromAppPage(e)) return denied();
  const story = storyById(id);
  const m = story && readMedia(story).find((x) => x.url === url);
  if (m && m.file) return shell.openPath(path.join(story.dir, m.file)); // '' when opened, else the error text
  if (/^https:\/\//.test(url)) return shell.openExternal(url).then(() => '', (e) => e.message);
  return 'Only downloaded files and https links can be opened.';
});

const KIND_PREFIX = { youtube: 'video', media: 'media', pdf: 'pdf', page: 'web' };

// Save a page into the story's sources/ and register it as an attachment for the next edit.
function keepSource(story, page, prefix) {
  const dir = path.join(story.dir, 'sources'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, S.sourceFileName(page.url, prefix));
  fs.writeFileSync(file, `${page.title}\n${page.url}\nFetched ${new Date().toISOString()}${page.published ? `\nPublished ${page.published}` : ''}\n\n${page.text}\n`);
  const id = require('crypto').randomUUID();
  attached.set(id, { name: path.basename(file), path: file });
  return { id, name: path.basename(file), text: true };
}

ipcMain.handle('lane:fetch', (_e, __req) => withJob(_e, __req && __req.jobId, 'Web fetch', async () => {
  const { id, text } = __req;
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  const urls = S.extractUrls(text);
  if (!urls.length) throw new Error('paste one or more links to fetch');
  const kept = []; const failed = [];
  await Promise.all(urls.slice(0, 8).map(async (u) => {
    try {
      step(`Reading ${new URL(u).hostname.replace(/^www\./, '')}: working out what it is`);
      const pg = await resolveLink(u);
      step(`Read ${pg.kind} via ${pg.lane}; collecting photos and video`);
      const media = await collectMedia(story, u, pg);
      kept.push({ ...keepSource(story, pg, KIND_PREFIX[pg.kind] || 'web'), url: u, title: pg.title, chars: pg.text.length, kind: pg.kind, lane: pg.lane, media });
    }
    catch (err) { if (jobSignal() && jobSignal().aborted) throw new Error('Cancelled.'); failed.push(`${u} (${err.message})`); }
  }));
  return { kept, failed };
}));

// Digest: resolve each link, keep its text in sources/, and write a cited digest next to the script.
ipcMain.handle('lane:digest', (_e, __req) => withJob(_e, __req && __req.jobId, 'Digest', async () => {
  const { id, version, text, cues, model } = __req;
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  const urls = S.extractUrls(text);
  if (!urls.length) throw new Error('paste a link to digest: a page, PDF, YouTube, audio or video');
  const t0 = Date.now(); const done = []; const failed = [];
  for (const u of urls.slice(0, 5)) {
    try {
      checkCancel();
      step(`Link ${done.length + failed.length + 1}/${Math.min(urls.length, 5)}: working out what it is (captions, transcript, PDF or page)`);
      const item = await resolveLink(u);
      step(`Read ${item.kind} via ${item.lane}, ${item.text.length.toLocaleString()} chars; collecting media`);
      if (!item.text.trim()) throw new Error('no readable text');
      const src = keepSource(story, item, KIND_PREFIX[item.kind] || 'web');
      const media = await collectMedia(story, u, item);
      step(`Digesting with ${model.split('/').pop()}`);
      const body = (await nvidiaChat(model, S.digestMessages(item, cues), 3000)).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
      const file = path.join(story.dir, `digest_${stamp}_${S.sourceFileName(u, item.kind).replace(/\.txt$/, '')}.md`);
      fs.writeFileSync(file, `# Digest: ${item.title}\n\n${u}\n${item.kind} · read via ${item.lane}${item.note ? ` · ${item.note}` : ''} · ${item.text.length.toLocaleString()} chars · for v${version} · ${S.easternTime(new Date())} · ${model}\nFull text: sources/${src.name}\n\n${body}\n`);
      const did = require('crypto').randomUUID(); attached.set(did, { name: path.basename(file), path: file });
      const what = (/## What it is\s*\n([\s\S]*?)(\n## |$)/.exec(body) || [])[1] || '';
      done.push({ url: u, kind: item.kind, lane: item.lane, title: item.title, file, what: what.trim(), media, chips: [{ id: did, name: path.basename(file), text: true }, src] });
    } catch (err) { if (jobSignal() && jobSignal().aborted) throw new Error('Cancelled.'); failed.push(`${u} (${err.message})`); }
  }
  return { done, failed, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}));

ipcMain.handle('lane:research', (_e, __req) => withJob(_e, __req && __req.jobId, 'Research', async () => {
  const { id, version, question, cues, model } = __req;
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  if (!String(question || '').trim()) throw new Error('ask a research question');
  const t0 = Date.now();
  step('Planning searches');
  const queries = S.parsePlan(await nvidiaChat(model, S.researchPlanMessages(question, story.title), 400), question);
  step(`Searching ${queries.length} queries (Exa, Tavily backup)`);
  const found = await Promise.all(queries.map((q) => search(q, 4).catch(() => ({ lane: 'none', results: [] }))));
  const seen = new Set(); const sources = [];
  for (const f of found) for (const r of f.results) {
    const k = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (!seen.has(k) && r.text) { seen.add(k); sources.push(r); }
  }
  if (!sources.length) throw new Error('no sources came back from Exa or Tavily');
  const top = sources.slice(0, 10);
  step(`Reading ${top.length} sources; writing the cited brief`);
  const brief = await nvidiaChat(model, S.researchBriefMessages(question, top, cues), 4000);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const file = path.join(story.dir, `research_${stamp}.md`);
  fs.writeFileSync(file, `# Research: ${String(question).trim()}\n\nAsked of v${version} · ${S.easternTime(new Date())} · ${model}\nSearches: ${queries.map((q) => `"${q}"`).join(', ')} · lanes: ${[...new Set(found.map((f) => f.lane))].join(', ')}\n\n${brief.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()}\n`);
  for (const s2 of top) keepSource(story, s2, 'research');
  const briefId = require('crypto').randomUUID();
  attached.set(briefId, { name: path.basename(file), path: file });
  const answer = (/## Answer\s*\n([\s\S]*?)(\n## |$)/.exec(brief) || [])[1] || brief.slice(0, 600);
  return { file, brief: { id: briefId, name: path.basename(file), text: true }, answer: answer.trim(), queries, sources: top.length, lanes: [...new Set(found.map((f) => f.lane))], seconds: Math.round((Date.now() - t0) / 100) / 10 };
}));

ipcMain.handle('ask:send', (_e, __req) => withJob(_e, __req && __req.jobId, 'Edit', async () => {
  const { id, version, cues, instruction, attachmentIds = [], model } = __req;
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  if (!String(instruction || '').trim()) throw new Error('say what to change');
  const files = attachmentIds.map((a) => attached.get(a)).filter(Boolean).map(readAttachment);
  const t0 = Date.now();
  step(`Asking ${model.split('/').pop()}${files.length ? ` with ${files.length} attachment${files.length === 1 ? '' : 's'}` : ''}`);
  const out = S.parseAskReply(await nvidiaChat(model, S.buildAskMessages(cues, instruction, files)), cues.map((c) => c.n));
  // Keep a record next to the story: what was asked, of which version, and what came back.
  const log = path.join(story.dir, 'producer_log.jsonl');
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), version, model, instruction, attachments: files.map((f) => f.name), ...out }) + '\n');
  return { ...out, model, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}));

ipcMain.handle('script:exportClap', (_e, { id, version }) => {
  const story = storyById(id);
  if (!story) throw new Error('story not found');
  return S.exportOpenClap(story.dir, version);
});

ipcMain.handle('file:reveal', (e, p) => { if (!fromAppPage(e)) return denied(); if (inRoot(p)) shell.showItemInFolder(p); });
// Resolves to '' when the file opened, else the reason (shell.openPath resolves with the error text).
ipcMain.handle('file:open', async (e, p) => { if (!fromAppPage(e)) return denied(); return inRoot(p) ? shell.openPath(p) : 'That file is outside the story folder.'; });

function watchStories() {
  const root = S.storiesRoot();
  if (!fs.existsSync(root)) return;
  let t;
  try {
    watcher = fs.watch(root, { recursive: true }, (_ev, f) => {
      if (f && !/\.(md|json)$/i.test(f)) return;
      clearTimeout(t);
      t = setTimeout(() => win && !win.isDestroyed() && win.webContents.send('stories:changed'), 250);
    });
  } catch (e) { console.error('watch failed:', e.message); }
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    ...windowSize(screen.getPrimaryDisplay().workAreaSize),
    title: 'Nou Scripts', backgroundColor: '#121213', show: !capture,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url).catch(() => { /* the OS refused: nothing else to do */ });
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // The React renderer (ui/, built by `npm run build:ui`) when present; the vanilla renderer otherwise.
  const built = path.join(__dirname, 'renderer-dist', 'index.html');
  win.loadFile(fs.existsSync(built) ? built : path.join(__dirname, 'renderer', 'index.html'), { query: { mode: captureMode, rail: captureRail } });
  if (capture) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(path.resolve(capture)), { recursive: true });
      fs.writeFileSync(capture, img.toPNG());
      console.log('captured', capture, img.getSize());
      app.quit();
    }, 1500));
  }
}

// Auto-updates: inert unless the app is packaged and NOU_UPDATE_URL is set (see src/updater.js).
const updater = createUpdater({
  autoUpdater, isPackaged: app.isPackaged, feedUrl: process.env.NOU_UPDATE_URL || '',
  version: app.getVersion(), platform: process.platform, arch: process.arch,
  send: (s) => win && !win.isDestroyed() && win.webContents.send('updater:status', s),
  isBusy: () => activeJobs > 0,
});
ipcMain.handle('updater:status', () => updater.status());
ipcMain.handle('updater:check', () => updater.check());
ipcMain.handle('updater:install', (e) => (fromAppPage(e) ? updater.install() : denied()));

// A display was plugged in, unplugged, or changed resolution/scale: re-fit the window to the usable area of the
// display it is on, so it does not stay larger than the screen. Electron fires these on the screen module.
function refitToDisplay() {
  if (!win || win.isDestroyed() || win.isFullScreen() || win.isMaximized()) return;
  const display = screen.getDisplayMatching(win.getBounds());
  const size = refit(win.getBounds(), display.workAreaSize);
  if (size) win.setSize(size.width, size.height);
}
// The screen module is only usable after 'ready'; attach the display listeners there.
app.whenReady().then(() => {
  // Serve only downloaded photos from a story's media folder; anything else is a 404.
  protocol.handle('nou-media', (req) => {
    const file = S.resolveMediaUrl(req.url);
    if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow(); watchStories(); updater.start();
  screen.on('display-metrics-changed', refitToDisplay);
  screen.on('display-removed', refitToDisplay);
});
app.on('window-all-closed', () => { if (watcher) watcher.close(); app.quit(); });
