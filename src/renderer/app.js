'use strict';
const $ = (id) => document.getElementById(id);
const state = { stories: [], id: null, version: null, data: null, showSources: true, scrolling: null, speed: 40, query: '', filter: 'all', railCollapsed: localStorage.getItem('nou-rail-collapsed') === 'true' };

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
    b.onclick = () => { state.id = b.dataset.id; state.version = null; refresh(true); };
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
  for (const b of $('versions').querySelectorAll('button')) b.onclick = () => { state.version = Number(b.dataset.v); load(); };

  const changed = d.diff.filter((x) => x !== 'same').length;
  $('stats').innerHTML = [
    [fmtTime(sc.seconds), 'estimated runtime'],
    [sc.words, 'spoken words'],
    [`${fmtTime(sc.onCameraSeconds)} · ${sc.avatarJobs} jobs`, 'on camera · OmniAvatar'],
    [d.prevVersion ? `${changed} of ${sc.cues.length}` : `${sc.cues.length}`, d.prevVersion ? `cues changed since v${d.prevVersion}` : 'cues'],
  ].map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');

  renderApproval(d);

  $('cues').classList.toggle('hide-src', !state.showSources);
  $('cues').innerHTML = sc.cues.map((c, i) => {
    const chg = d.diff[i];
    const badge = d.prevVersion && chg !== 'same' ? `<span class="chg ${chg}">${chg === 'new' ? 'new' : 'changed'}</span>` : '';
    return `<article class="cue ${c.onCamera ? 'cam' : 'vo'}">
      <div class="cue-head"><span class="cue-n">${c.n}</span><span class="kind">${c.onCamera ? 'ON CAM' : esc(c.kind)}</span>
        ${c.hint ? `<span>${esc(c.hint)}</span>` : ''}${badge}
        <span class="cue-time">${c.words} words · ~${c.seconds}s</span></div>
      <p class="cue-text">${esc(c.text)}</p>
      ${c.source ? `<div class="cue-src">${inline(c.source)}</div>` : ''}
    </article>`;
  }).join('');

  $('notes').innerHTML = sc.notes.map((n) => {
    const items = n.lines.filter((l) => l.trim());
    const list = items.filter((l) => /^\s*[-*]\s/.test(l));
    const body = list.length === items.length
      ? `<ul>${list.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`
      : items.map((l) => /^\s*[-*]\s/.test(l) ? `<p>• ${inline(l.replace(/^\s*[-*]\s+/, ''))}</p>` : `<p>${inline(l)}</p>`).join('');
    return `<h3>${esc(n.heading)}</h3>${body}`;
  }).join('');
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
function closePrompter() { stopScroll(); $('prompter').hidden = true; setMode('read'); }
function setMode(m) { $('mode-read').classList.toggle('on', m === 'read'); $('mode-prompt').classList.toggle('on', m === 'prompt'); }
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

$('mode-read').onclick = () => { if (!$('prompter').hidden) closePrompter(); };
$('mode-prompt').onclick = () => state.data && openPrompter();
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
$('toggle-sources').onclick = (e) => {
  state.showSources = !state.showSources;
  e.currentTarget.setAttribute('aria-pressed', String(state.showSources));
  $('cues').classList.toggle('hide-src', !state.showSources);
};

setRailCollapsed(state.railCollapsed || new URLSearchParams(location.search).get('rail') === 'collapsed');
window.nou.onChange(() => refresh(true));
refresh(false).then(() => {
  if (new URLSearchParams(location.search).get('mode') === 'prompt') openPrompter();
});
