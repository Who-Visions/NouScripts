'use strict';
const $ = (id) => document.getElementById(id);
const state = {
  stories: [], id: null, version: null, data: null, showSources: true, showChanges: true,
  scrolling: null, speed: 40, query: '', filter: 'all',
  railCollapsed: localStorage.getItem('nou-rail-collapsed') === 'true',
  prompterMirror: false, prompterFontSize: 46,
  writing: false, edits: {}, view: 'read',
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Inline markdown for notes and source lines: `code`, **bold**, *italic*. Escapes first, so nothing raw gets through.
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
}
const fmtTime = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);

// Write mode: what you type, counted and linted live with the same rules as the main process.
const countWords = (s) => (s.match(/[A-Za-z0-9][A-Za-z0-9'’.,-]*/g) || []).length;
function lint(text, terms) {
  return [...new Set(terms.filter((t) => new RegExp(`(?:^|[^a-zA-Z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-zA-Z0-9])`, 'i').test(text)))];
}
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
function changedEdits() {
  const out = {};
  for (const c of (state.data ? state.data.script.cues : [])) {
    const v = state.edits[c.n];
    if (v !== undefined && oneLine(v) !== oneLine(c.text)) out[c.n] = v;
  }
  return out;
}
const dirty = () => Object.keys(changedEdits()).length > 0;
const leaveOk = () => !state.writing || !dirty() || confirm('Discard your unsaved edits?');
const nextVersion = () => Math.max(...state.data.story.versions) + 1;

function setWriting(on, prefill = {}) {
  state.writing = on; state.edits = { ...prefill };
  if (on && !$('prompter').hidden) closePrompter();
  setMode(on ? 'write' : state.view);
  load();
}

function updateWriteState() {
  const d = state.data; const wps = d.wordsPerSecond || 2.8;
  let words = 0; let flagged = 0;
  for (const c of d.script.cues) {
    const text = state.edits[c.n] ?? c.text;
    const w = countWords(text); const flags = lint(text, d.banlist || []);
    words += w; if (flags.length) flagged++;
    const art = document.querySelector(`.cue[data-n="${c.n}"]`);
    if (!art) continue;
    art.querySelector('.cue-time').textContent = `${w} words · ~${Math.round(w / wps)}s`;
    const fl = art.querySelector('.cliche-live');
    fl.hidden = !flags.length; fl.textContent = flags.length ? `cliché: ${flags.join(', ')}` : '';
    art.classList.toggle('edited', oneLine(text) !== oneLine(c.text));
    art.querySelector('.cue-edit').classList.toggle('empty', !oneLine(text));
  }
  const n = Object.keys(changedEdits()).length;
  const empty = d.script.cues.some((c) => !oneLine(state.edits[c.n] ?? c.text));
  const save = $('write-save');
  save.disabled = !n || empty;
  save.textContent = `Save as v${nextVersion()}`;
  $('write-status').textContent = empty ? 'A line is empty. Every cue needs words before you can save.'
    : n ? `${n} line${n === 1 ? '' : 's'} edited · ${words} words · ~${fmtTime(Math.round(words / wps))}${flagged ? ` · ${flagged} flagged` : ''}. v${d.version} stays as it is.`
    : `Editing v${d.version}. Saving makes v${nextVersion()}; v${d.version} stays as it is.`;
}

async function saveWriting() {
  const edits = changedEdits();
  if (!Object.keys(edits).length || $('write-save').disabled) return;
  $('write-save').disabled = true; $('write-save').textContent = 'Saving…';
  try {
    const r = await window.nou.save(state.id, state.version, edits);
    state.writing = false; state.edits = {}; state.version = r.version; state.showChanges = true;
    setMode(state.view);
    await refresh(true);
  } catch (err) {
    $('write-status').textContent = `Save failed: ${err.message}`;
    $('write-save').disabled = false;
  }
}

async function refresh(keep = true) {
  const { root, stories } = await window.nou.list();
  state.stories = stories;
  $('root').textContent = root;
  if (!stories.length) {
    $('stories').innerHTML = '';
    $('title').textContent = 'No scripts yet';
    $('cues').innerHTML = `<p class="empty">Put a <code>script_v1.md</code> in a story folder under ${esc(root)}.</p>`;
    return;
  }
  if (!keep || !stories.find((s) => s.id === state.id)) state.id = stories[0].id;
  const story = stories.find((s) => s.id === state.id);
  const versions = story.versions.map((v) => v.version);
  if (!keep || !versions.includes(state.version)) state.version = versions[versions.length - 1];
  renderStories();
  await load();
}

function renderStories() {
  const visible = state.stories.filter((s) => {
    const matchesQuery = `${s.title} ${s.id}`.toLowerCase().includes(state.query.toLowerCase());
    const current = s.approval && s.approvalCurrent;
    return matchesQuery && (state.filter === 'all' || (state.filter === 'ready' ? current : !current));
  });
  $('story-count').textContent = `${visible.length}`;
  $('stories').innerHTML = visible.map((s) => {
    const latest = s.versions[s.versions.length - 1].version;
    const current = s.approval && s.approvalCurrent;
    const appr = current
      ? `<span class="pill ok">v${s.approval.version} approved</span>`
      : s.approval ? `<span class="pill warn">approval stale</span>` : '<span class="pill warn">needs review</span>';
    return `<button class="story ${s.id === state.id ? 'on' : ''}" data-id="${esc(s.id)}" type="button">
      <span class="story-icon" aria-hidden="true">${esc(s.title.slice(0,1).toUpperCase())}</span><span class="story-copy"><span class="story-title">${esc(s.title)}</span>
      <span class="story-sub"><span>${esc(s.id.slice(0, 10))}</span><span class="pill">v${latest}</span>${appr}</span></span>
    </button>`;
  }).join('');
  if (!visible.length) $('stories').innerHTML = `<div class="story-empty">${state.query ? 'No matching stories' : 'No stories in this filter'}</div>`;
  for (const b of $('stories').querySelectorAll('.story')) {
    b.onclick = () => { if (!leaveOk()) return; state.writing = false; state.edits = {}; setMode(state.view); state.id = b.dataset.id; state.version = null; refresh(true); };
  }
}

function setRailCollapsed(collapsed) {
  state.railCollapsed = collapsed;
  document.body.classList.toggle('rail-collapsed', collapsed);
  $('rail-toggle').textContent = collapsed ? '›' : '‹';
  $('rail-toggle').title = collapsed ? 'Expand navigation' : 'Collapse navigation';
  $('rail-toggle').setAttribute('aria-label', $('rail-toggle').title);
  $('rail-expand').setAttribute('aria-hidden', String(!collapsed));
  $('rail-expand').tabIndex = collapsed ? 0 : -1;
  localStorage.setItem('nou-rail-collapsed', String(collapsed));
}

async function load() {
  const d = await window.nou.load(state.id, state.version);
  state.data = d;
  const sc = d.script;
  $('title').textContent = sc.title;
  $('meta').textContent = `v${d.version} · edited ${d.modified}` + (d.prevVersion ? ` · compared with v${d.prevVersion}` : '');
  const banner = $('version-banner');
  const approvalMatches = d.approval && d.approvalCurrent && d.approval.version === d.version;
  banner.hidden = !d.approval || approvalMatches;
  banner.textContent = d.approval && !d.approvalCurrent
    ? `Approval for v${d.approval.version} is stale because its script changed. Review and approve again before rendering.`
    : d.approval ? `You’re viewing v${d.version}; v${d.approval.version} is approved. This version is not approved for rendering.` : '';
  $('versions').innerHTML = d.story.versions.map((v) =>
    `<button type="button" class="${v === d.version ? 'on' : ''}" data-v="${v}">v${v}</button>`).join('');
  for (const b of $('versions').querySelectorAll('button')) b.onclick = () => { if (!leaveOk()) return; state.edits = {}; state.version = Number(b.dataset.v); load(); };

  const changed = d.diff.filter((x) => x !== 'same').length;
  const tc = $('toggle-changes');
  tc.hidden = !d.prevVersion;
  tc.textContent = d.prevVersion ? `Changes · ${changed}` : "Changes"; tc.title = d.prevVersion ? `Show what changed since v${d.prevVersion} (${changed} cues)` : "";
  tc.setAttribute('aria-pressed', String(state.showChanges));
  $('stats').innerHTML = [
    [fmtTime(sc.seconds), 'estimated runtime'],
    [sc.words, 'spoken words'],
    [`${fmtTime(sc.onCameraSeconds)} · ${sc.avatarJobs} job${sc.avatarJobs === 1 ? "" : "s"}`, 'on camera · OmniAvatar'],
    [sc.flaggedCount ? `<span style="color:#ff8b8b">${sc.flaggedCount} flagged</span>` : '0 clichés', 'voice lint'],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${esc(s)}</span></div>`).join('');

  renderApproval(d);

  $('cues').classList.toggle('hide-src', !state.showSources);
  $('cues').classList.toggle('as-broadcast', state.view === 'broadcast' && !state.writing);
  if (state.view === 'broadcast' && !state.writing) $('cues').innerHTML = asBroadcast(d);
  else $('cues').innerHTML = sc.cues.map((c, i) => {
    const chg = d.diff[i];
    const badge = d.prevVersion && chg !== 'same' ? `<span class="chg ${chg}">${chg === 'new' ? 'new' : 'changed'}</span>` : '';
    const flagBadge = c.flags && c.flags.length ? `<span class="chg cliche" title="AI cliché: ${esc(c.flags.join(', '))}">cliché: ${esc(c.flags.join(', '))}</span>` : '';
    const body = state.writing
      ? `<textarea class="cue-edit" data-n="${c.n}" spellcheck="true" aria-label="Cue ${c.n} spoken text">${esc(state.edits[c.n] ?? c.text)}</textarea>`
      : `<p class="cue-text">${cueText(c, d.changes && d.changes[i])}</p>`;
    return `<article class="cue ${c.onCamera ? 'cam' : 'vo'}" data-n="${c.n}">
      <div class="cue-head"><span class="cue-n">${c.n}</span><span class="kind">${c.onCamera ? 'ON CAM' : esc(c.kind)}</span>
        ${c.hint ? `<span>${esc(c.hint)}</span>` : ''}${state.writing ? '<span class="chg cliche cliche-live" hidden></span>' : badge + flagBadge}
        <span class="cue-time">${c.words} words · ~${c.seconds}s</span></div>
      ${body}
      ${c.source ? `<div class="cue-src">${inline(c.source)}</div>` : ''}
    </article>`;
  }).join('');

  $('write-bar').hidden = !state.writing;
  document.body.classList.toggle('writing', state.writing);
  if (state.writing) {
    const grow = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
    for (const t of $('cues').querySelectorAll('.cue-edit')) {
      grow(t);
      t.addEventListener('input', () => { state.edits[t.dataset.n] = t.value; grow(t); updateWriteState(); });
    }
    updateWriteState();
  }

  renderMedia();

  $('notes').innerHTML = sc.notes.map((n) => {
    const items = n.lines.filter((l) => l.trim());
    const list = items.filter((l) => /^\s*[-*]\s/.test(l));
    const body = list.length === items.length
      ? `<ul>${list.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`
      : items.map((l) => /^\s*[-*]\s/.test(l) ? `<p>• ${inline(l.replace(/^\s*[-*]\s+/, ''))}</p>` : `<p>${inline(l)}</p>`).join('');
    return `<h3>${esc(n.heading)}</h3>${body}`;
  }).join('');
}

// Media sources found while fetching or digesting links: photos (downloaded), videos, audio, embeds.
const media = { filter: 'all', items: [] };
async function renderMedia() {
  if (!state.id) return;
  media.items = await window.nou.media(state.id);
  const el = $('media');
  if (!media.items.length) { el.innerHTML = ''; return; }
  const counts = { all: media.items.length, image: 0, video: 0, audio: 0 };
  for (const m of media.items) if (counts[m.kind] !== undefined) counts[m.kind]++;
  const shown = media.items.filter((m) => media.filter === 'all' || m.kind === media.filter).slice(0, 24);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const tile = (m, i) => {
    // A video found with its thumbnail shows that picture on its tile.
    const poster = m.kind === 'video' && media.items.find((x) => x.kind === 'image' && x.path && x.source === m.source && x.via === 'thumbnail');
    const fileUrl = (p) => esc('file://' + p.split('/').map(encodeURIComponent).join('/'));
    const face = poster ? `<img src="${fileUrl(poster.path)}" alt="" loading="lazy"><span class="m-play">▶</span>` : m.kind === 'image' && m.path
      ? `<img src="${esc('file://' + m.path.split('/').map(encodeURIComponent).join('/'))}" alt="${esc(m.label || 'photo')}" loading="lazy">`
      : `<span class="m-glyph">${m.kind === 'video' ? '▶' : m.kind === 'audio' ? '♪' : m.kind === 'pdf' ? 'PDF' : '◻'}</span>`;
    const canDigest = m.kind !== 'image';
    return `<figure class="m-tile ${m.kind}" title="${esc(m.label || m.url)}">
      <button type="button" class="m-face" data-act="open" data-i="${i}">${face}</button>
      <figcaption><span class="m-label">${esc(m.label || host(m.url))}</span><span class="m-host">${esc(m.kind)} · ${esc(host(m.url))}</span>
      <span class="m-acts">${canDigest ? `<button type="button" data-act="digest" data-i="${i}">Digest</button>` : ''}${m.path ? `<button type="button" data-act="attach" data-i="${i}">Attach</button>` : ''}<button type="button" data-act="line" data-i="${i}">VIDEO line</button></span></figcaption></figure>`;
  };
  el.innerHTML = `<div class="m-head"><h3>Media sources</h3><div class="m-filter">${['all', 'image', 'video', 'audio'].filter((k) => k === 'all' || counts[k])
    .map((k) => `<button type="button" data-f="${k}" class="${media.filter === k ? 'on' : ''}">${{ all: 'All', image: 'Photos', video: 'Video', audio: 'Audio' }[k]} ${counts[k]}</button>`).join('')}</div></div>
    <div class="m-grid">${shown.map(tile).join('')}</div>`;
  for (const b of el.querySelectorAll('.m-filter button')) b.onclick = () => { media.filter = b.dataset.f; renderMedia(); };
  for (const b of el.querySelectorAll('[data-act]')) b.onclick = async () => {
    const m = shown[Number(b.dataset.i)];
    if (b.dataset.act === 'open') return window.nou.mediaOpen(state.id, m.url);
    if (b.dataset.act === 'digest') { $('ask-text').value = m.url; growAsk(); return runLane('digest', m.url); }
    if (b.dataset.act === 'attach') { try { addChips([await window.nou.mediaAttach(state.id, m.url)]); setReply(`Attached ${m.label || 'photo'}.`); } catch (err) { setReply(cleanErr(err), 'err'); } return; }
    if (b.dataset.act === 'line') {
      const line = `VIDEO: ${m.kind === 'image' ? 'Photo' : m.kind === 'video' ? 'Clip' : 'Audio'}: ${m.label || host(m.url)} (${m.url})`;
      try { await navigator.clipboard.writeText(line); setReply(`Copied for a cue: ${line}`); } catch { setReply(line); }
    }
  };
}

// As-broadcast: the two-column TV script. Left = what is seen, right = what is heard, with running time code.
function asBroadcast(d) {
  const sc = d.script; const h = sc.header || {};
  const field = (c, k) => c.fields.filter((f) => f.key === k).map((f) => f.value);
  const head = [['Program', h.program || 'NouGen News'], ['Slug', h.slug || d.story.id.replace(/^\d{4}-\d{2}-\d{2}_/, '').toUpperCase()],
    ['Talent', h.talent || 'Nou'], ['Version', `v${d.version}`], ['TRT', sc.trt]]
    .map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  const rows = sc.cues.map((c) => {
    const video = field(c, 'VIDEO'); const supers = field(c, 'SUPER'); const gfx = field(c, 'GFX');
    const seen = [
      ...(video.length ? video.map((v) => `<div>${inline(v)}</div>`) : [`<div class="${c.onCamera ? '' : 'tbd'}">${c.onCamera ? `${esc(field(c, 'TALENT')[0] || h.talent || 'Nou')} on camera` : 'Pictures to come'}</div>`]),
      ...gfx.map((v) => `<div><em>GFX</em> ${inline(v)}</div>`),
      ...supers.map((v) => `<div class="super"><em>SUPER</em> ${esc(v).split(' | ').join('<br>')}</div>`),
    ].join('');
    const heard = [
      ...['MUSIC', 'SFX', 'NAT'].flatMap((k) => field(c, k).map((v) => `<div class="dir">(${k} ${esc(v)})</div>`)),
      c.text ? `<div class="copy">${esc(c.text)}</div>` : '',
      ...field(c, 'SOT').map((v) => `<div class="sot"><em>SOT</em> ${esc(v)}</div>`),
      c.source ? `<div class="cue-src">${inline(c.source)}</div>` : '',
    ].join('');
    return `<tr class="${c.onCamera ? 'cam' : 'vo'}"><td class="tc">${c.tcIn}<small>${c.seconds}s</small></td>
      <td class="seg-cell"><b>${c.n}</b> ${c.onCamera ? 'ON CAM' : esc(c.kind)}${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</td>
      <td class="seen">${seen}</td><td class="heard">${heard}</td></tr>`;
  }).join('');
  return `<div class="ab-head">${head}</div>
    <table class="ab"><thead><tr><th>Time code</th><th>Segment</th><th>Video</th><th>Audio</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td class="tc">${sc.trt}</td><td colspan="3">End · total running time ${sc.trt}</td></tr></tfoot></table>`;
}

// Cue text with its edits since the previous version: cut words struck through, new words marked.
function cueText(c, runs) {
  if (!state.showChanges || !runs) return esc(c.text);
  return runs.map((r) => r.t === 'add' ? `<ins>${esc(r.s)}</ins>` : r.t === 'del' ? `<del>${esc(r.s)}</del>` : esc(r.s)).join(' ');
}

function renderApproval(d) {
  const a = d.approval;
  const el = $('approval');
  let cls = '', what, why, btn;
  if (a && d.approvalCurrent && a.version === d.version) {
    cls = 'ok'; what = `v${a.version} is approved for render`;
    why = `${a.approved_at_eastern}${a.note ? ` · “${a.note}”` : ''}`;
    btn = '';
  } else if (a && !d.approvalCurrent) {
    cls = 'stale'; what = `v${a.version} was approved, but the file changed after`;
    why = 'The render step will refuse it until it is approved again.';
    btn = `<button class="primary" id="approve" type="button">Approve v${d.version}</button>`;
  } else if (a) {
    what = `v${a.version} is the approved version`;
    why = `You are viewing v${d.version}. Approving it replaces v${a.version}.`;
    btn = `<button class="primary" id="approve" type="button">Approve v${d.version}</button>`;
  } else {
    what = 'Not approved yet'; why = 'Nothing renders until a version is approved here.';
    btn = `<button class="primary" id="approve" type="button">Approve v${d.version}</button>`;
  }
  el.className = `approval ${cls}`;
  el.innerHTML = `<div><div class="what">${esc(what)}</div><div class="why">${esc(why)}</div></div>${btn}`;
  const b = $('approve');
  if (b) b.onclick = () => openApprove(d);
}

function openApprove(d) {
  $('dlg-title').textContent = `Approve v${d.version} for render`;
  $('dlg-sub').textContent = `${d.script.title} · ${fmtTime(d.script.seconds)} · ${d.script.avatarJobs} OmniAvatar jobs. This records the exact file contents; any later edit needs a new approval.`;
  $('dlg-note').value = '';
  const dlg = $('approve-dialog');
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    await window.nou.approve(d.story.id, d.version, $('dlg-note').value.trim());
    await refresh(true);
  };
  dlg.showModal();
}

// teleprompter
function openPrompter() {
  const sc = state.data.script;
  $('p-title').textContent = `${sc.title} · v${state.data.version}`;
  $('p-text').innerHTML = sc.cues.map((c) =>
    `<div class="pc ${c.onCamera ? 'cam' : 'vo'}"><span class="pk">${c.n} · ${c.onCamera ? 'ON CAM' : esc(c.kind)}</span>${esc(c.text)}</div>`).join('');
  $('prompter').hidden = false;
  $('p-scroll').scrollTop = 0;
  setMode('prompt');
  updateSpeed();
}
function closePrompter() { stopScroll(); $('prompter').hidden = true; setMode(state.writing ? 'write' : state.view); }
function setMode(m) { for (const k of ['read', 'write', 'broadcast', 'prompt']) $(`mode-${k}`).classList.toggle('on', m === k); }
function updateSpeed() { $('p-speed').textContent = `${state.speed} px/s${state.scrolling ? ' · playing' : ''}`; }
function startScroll() {
  let last = performance.now(); const box = $('p-scroll'); let acc = 0;
  const step = (t) => { acc += ((t - last) / 1000) * state.speed; last = t; const whole = Math.floor(acc); if (whole) { box.scrollTop += whole; acc -= whole; } state.scrolling = requestAnimationFrame(step); };
  state.scrolling = requestAnimationFrame(step); updateSpeed();
}
function stopScroll() { if (state.scrolling) cancelAnimationFrame(state.scrolling); state.scrolling = null; updateSpeed(); }

document.addEventListener('keydown', (e) => {
  if ($('prompter').hidden) return;
  if (e.key === 'Escape') closePrompter();
  else if (e.key === ' ') { e.preventDefault(); state.scrolling ? stopScroll() : startScroll(); }
  else if (e.key === 'ArrowUp') { state.speed = Math.min(200, state.speed + 5); updateSpeed(); }
  else if (e.key === 'ArrowDown') { state.speed = Math.max(5, state.speed - 5); updateSpeed(); }
});

$('mode-read').onclick = () => { if (!$('prompter').hidden) closePrompter(); state.view = 'read'; if (state.writing) { if (leaveOk()) setWriting(false); } else { setMode('read'); load(); } };
$('mode-broadcast').onclick = () => { if (!$('prompter').hidden) closePrompter(); if (state.writing && !leaveOk()) return; state.view = 'broadcast'; state.writing = false; state.edits = {}; setMode('broadcast'); load(); };
$('mode-write').onclick = () => { if (!$('prompter').hidden) closePrompter(); if (state.data && !state.writing) setWriting(true); };
$('mode-prompt').onclick = () => { if (state.data && leaveOk()) { state.writing = false; state.edits = {}; load(); openPrompter(); } };
$('write-save').onclick = saveWriting;
$('write-cancel').onclick = () => { if (leaveOk()) setWriting(false); };
document.addEventListener('keydown', (e) => {
  if (state.writing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveWriting(); }
});
$('p-mirror').onclick = () => {
  state.prompterMirror = !state.prompterMirror;
  $('p-mirror').classList.toggle('on', state.prompterMirror);
  $('p-text').classList.toggle('mirrored', state.prompterMirror);
};
$('p-font-dec').onclick = () => {
  state.prompterFontSize = Math.max(24, state.prompterFontSize - 4);
  $('p-text').style.fontSize = `${state.prompterFontSize}px`;
};
$('p-font-inc').onclick = () => {
  state.prompterFontSize = Math.min(80, state.prompterFontSize + 4);
  $('p-text').style.fontSize = `${state.prompterFontSize}px`;
};
$('btn-export-clap').onclick = async () => {
  if (!state.data) return;
  const btn = $('btn-export-clap');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  try {
    const res = await window.nou.exportClap(state.id, state.version);
    btn.textContent = `Exported (${res.file})`;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  } catch (err) {
    btn.textContent = 'Export failed';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  }
};
$('rail-toggle').onclick = () => setRailCollapsed(!state.railCollapsed);
$('rail-expand').onclick = () => setRailCollapsed(false);
$('story-search').addEventListener('input', (e) => { state.query = e.target.value; renderStories(); });
for (const b of document.querySelectorAll('.filter')) b.onclick = () => {
  state.filter = b.dataset.filter;
  document.querySelectorAll('.filter').forEach((x) => x.classList.toggle('on', x === b));
  renderStories();
};
document.addEventListener('keydown', (e) => {
  const target = e.target;
  const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !typing) { e.preventDefault(); setRailCollapsed(false); $('story-search').focus(); }
});
$('toggle-changes').onclick = () => { state.showChanges = !state.showChanges; if (state.data) load(); };
$('toggle-sources').onclick = (e) => {
  state.showSources = !state.showSources;
  e.currentTarget.setAttribute('aria-pressed', String(state.showSources));
  $('cues').classList.toggle('hide-src', !state.showSources);
};

// ── Bottom dock: the producer line into Nou's ear ─────────────────────────
const ask = { files: [], busy: false, lane: 'edit' };
const LANES = {
  edit: { ph: 'Tell Nou what to change… e.g. tighten line 5', note: 'Suggestions open in Write. Nothing saves until you do.' },
  fetch: { ph: 'Paste links: pages, PDFs, YouTube, audio, video', note: 'Each link is read the right way for what it is, saved to sources/ and attached.' },
  research: { ph: 'Ask a research question…', note: 'Plans searches, reads Exa (Tavily backup), writes a cited brief into the story.' },
};
function setLane(l) {
  ask.lane = l;
  for (const b of document.querySelectorAll('.lane-seg button')) b.classList.toggle('on', b.dataset.lane === l);
  $('ask-text').placeholder = LANES[l].ph; $('ask-lane').textContent = LANES[l].note;
}
for (const b of document.querySelectorAll('.lane-seg button')) b.onclick = () => setLane(b.dataset.lane);
function addChips(list) { for (const c of list) if (c && !ask.files.some((f) => f.id === c.id)) ask.files.push(c); renderChips(); }
function replyOpen(file) {
  if (!file) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'reply-open'; b.textContent = 'Open';
  b.onclick = () => window.nou.open(file); $('ask-reply').append(' ', b);
}
const scriptCues = () => state.data.script.cues.map((c) => ({ n: c.n, kind: c.kind, hint: c.hint, onCamera: c.onCamera, source: c.source, text: state.edits[c.n] ?? c.text }));
const cleanErr = (err) => String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
async function runLane(lane, text) {
  const model = $('ask-model').value; const modelName = $('ask-model').selectedOptions[0].textContent;
  ask.busy = true; $('ask-send').disabled = true; $('ask-digest').disabled = true;
  try {
    if (lane === 'digest') {
      setReply(`Working out what each link is, then reading and digesting with ${modelName}… (audio and video are transcribed locally and can take minutes)`, 'busy');
      const r = await window.nou.digest({ id: state.id, version: state.version, text, cues: scriptCues(), model });
      for (const d of r.done) addChips(d.chips);
      const found = r.done.reduce((a, d) => a + ((d.media && d.media.added) || 0), 0);
      setReply(`${r.done.length ? r.done.map((d) => `Digested ${d.kind} via ${d.lane}: ${d.what || d.title}`).join(' · ') + ` Saved in the story and attached.${found ? ` ${found} media source${found === 1 ? '' : 's'} added to the panel.` : ''}` : 'Nothing digested.'}${r.failed.length ? ` Couldn't read: ${r.failed.join('; ')}` : ''} (${r.seconds}s)`, r.done.length ? '' : 'err');
      if (r.done.length) replyOpen(r.done[r.done.length - 1].file);
      renderMedia();
    } else if (lane === 'fetch') {
      setReply('Reading links…', 'busy');
      const r = await window.nou.fetchPages({ id: state.id, text });
      addChips(r.kept);
      renderMedia();
      setReply(`${r.kept.length ? `Saved and attached: ${r.kept.map((k) => `${k.name} (${k.kind}, ${Math.round(k.chars / 1000)}k chars)`).join(', ')}.` : 'Nothing saved.'}${r.failed.length ? ` Couldn't read: ${r.failed.join('; ')}` : ''}`, r.kept.length ? '' : 'err');
    } else if (lane === 'research') {
      setReply(`Researching with ${modelName}: planning searches…`, 'busy');
      const r = await window.nou.research({ id: state.id, version: state.version, question: text, cues: scriptCues(), model });
      addChips([r.brief]);
      setReply(`${r.answer} (${r.sources} sources via ${r.lanes.join(' + ')}, ${r.seconds}s. Brief saved and attached.)`);
      replyOpen(r.file);
    }
    $('ask-text').value = ''; growAsk();
  } catch (err) { setReply(`Didn't work: ${cleanErr(err)}`, 'err'); }
  finally { ask.busy = false; $('ask-send').disabled = false; $('ask-digest').disabled = false; }
}
$('ask-digest').onclick = () => {
  const text = $('ask-text').value.trim();
  if (ask.busy || !state.data) return;
  if (!/https?:\/\//.test(text)) { setReply('Paste a link in the box first: a page, PDF, YouTube, audio or video.', 'err'); $('ask-text').focus(); return; }
  runLane('digest', text);
};
function renderChips() {
  $('ask-chips').innerHTML = ask.files.map((f, i) =>
    `<span class="chip" title="${esc(f.name)}${f.text ? '' : ' (name only: not a text file)'}"><span>${esc(f.name)}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('');
  for (const b of $('ask-chips').querySelectorAll('button')) b.onclick = () => { ask.files.splice(Number(b.dataset.i), 1); renderChips(); };
}
function setReply(text, cls = '') { $('ask-reply').textContent = String(text).replace(/\*\*([^*]+)\*\*/g, '$1'); $('ask-reply').closest('.dock-reply').className = `dock-mod dock-reply ${cls}`; }
function growAsk() { const t = $('ask-text'); t.style.height = 'auto'; t.style.height = `${Math.min(140, t.scrollHeight)}px`; }
$('ask-attach').onclick = async () => { ask.files.push(...await window.nou.attach()); renderChips(); };
$('ask-text').addEventListener('input', growAsk);
$('ask-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('ask-form').requestSubmit(); } });
$('ask-form').onsubmit = async (e) => {
  e.preventDefault();
  const instruction = $('ask-text').value.trim();
  if (!instruction || ask.busy || !state.data) return;
  if (ask.lane !== 'edit') return runLane(ask.lane, instruction);
  ask.busy = true; $('ask-send').disabled = true;
  const model = $('ask-model').value;
  $('ask-digest').disabled = true;
  setReply(`Asking ${$('ask-model').selectedOptions[0].textContent}…`, 'busy');
  // Ask about what is on screen: your unsaved edits if you are writing, else this version.
  const cues = state.data.script.cues.map((c) => ({ n: c.n, kind: c.kind, hint: c.hint, onCamera: c.onCamera, source: c.source, text: state.edits[c.n] ?? c.text }));
  try {
    const r = await window.nou.ask({ id: state.id, version: state.version, cues, instruction, attachmentIds: ask.files.map((f) => f.id), model });
    const n = Object.keys(r.edits).length;
    $('ask-text').value = ''; growAsk();
    if (n) {
      const keep = state.writing ? { ...state.edits } : {};
      if (!$('prompter').hidden) closePrompter();
      setWriting(true, { ...keep, ...r.edits });
    }
    setReply(`${n ? `${n} line${n === 1 ? '' : 's'} suggested: ${Object.keys(r.edits).map((k) => `#${k}`).join(', ')}. Review in Write, then save or discard.` : 'No line changes.'}${r.note ? ` ${r.note}` : ''} (${r.seconds}s)`);
  } catch (err) {
    setReply(`Didn't work: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'err');
  } finally { ask.busy = false; $('ask-send').disabled = false; $('ask-digest').disabled = false; }
};

setRailCollapsed(state.railCollapsed || new URLSearchParams(location.search).get('rail') === 'collapsed');
// A file change while you type would re-render the editors and lose your words; refresh the list only.
window.nou.onChange(() => (state.writing ? window.nou.list().then(({ stories }) => { state.stories = stories; renderStories(); }) : refresh(true)));
refresh(false).then(() => {
  const m = new URLSearchParams(location.search).get('mode');
  if (m === 'prompt') openPrompter();
  if (m === 'write') setWriting(true);
  if (m === 'broadcast') $('mode-broadcast').click();
});
