// All app state in one hook. Talks to the main process only through window.nou (src/preload.js).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { oneLine } from './text';

const params = new URLSearchParams(location.search);
const stored = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* optional */ } };

export function useNou() {
  const [root, setRoot] = useState('');
  const [stories, setStories] = useState([]);
  const [id, setId] = useState(null);
  const [version, setVersion] = useState(null);
  const [data, setData] = useState(null);
  const [panel, setPanelState] = useState(stored('nou-panel', 'stories'));
  const [railCollapsed, setRailCollapsedState] = useState(stored('nou-rail-collapsed', 'false') === 'true' || params.get('rail') === 'collapsed');
  const [view, setView] = useState(params.get('mode') === 'broadcast' ? 'broadcast' : 'read');
  const [writing, setWritingState] = useState(false);
  const [edits, setEdits] = useState({});
  const [prompter, setPrompter] = useState(params.get('mode') === 'prompt');
  const [showSources, setShowSources] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [media, setMedia] = useState([]);
  const [files, setFiles] = useState({ desk: [], sources: [] });
  // Producer line (bottom dock), shared so the side panel can attach files or send a link to Digest.
  const [chips, setChips] = useState([]);
  const [reply, setReplyState] = useState({ text: 'Nothing asked yet.', tone: '', file: null });
  const [pendingDigest, setPendingDigest] = useState(null);
  const addChips = useCallback((list) => setChips((cur) => [...cur, ...list.filter((c) => c && !cur.some((x) => x.id === c.id))]), []);
  const removeChip = useCallback((cid) => setChips((cur) => cur.filter((c) => c.id !== cid)), []);
  const setReply = useCallback((text, tone = '', file = null) => setReplyState({ text: String(text).replace(/\*\*([^*]+)\*\*/g, '$1'), tone, file }), []);
  const requestDigest = useCallback((url) => setPendingDigest({ url, at: Date.now() }), []);
  const writingRef = useRef(false);
  writingRef.current = writing;

  const dirtyEdits = useMemo(() => {
    const out = {};
    for (const c of (data ? data.script.cues : [])) {
      const v = edits[c.n];
      if (v !== undefined && oneLine(v) !== oneLine(c.text)) out[c.n] = v;
    }
    return out;
  }, [edits, data]);
  const dirty = Object.keys(dirtyEdits).length > 0;
  const leaveOk = useCallback(() => !writingRef.current || !dirty || confirm('Discard your unsaved edits?'), [dirty]);

  const refreshAux = useCallback(async (sid = id) => {
    if (!sid) return;
    const [m, f] = await Promise.all([window.nou.media(sid), window.nou.files(sid)]);
    setMedia(m); setFiles(f);
  }, [id]);

  const load = useCallback(async (sid, v) => {
    if (!sid || v == null) return;
    const d = await window.nou.load(sid, v);
    setData(d);
    refreshAux(sid);
  }, [refreshAux]);

  const refresh = useCallback(async (keep = true, want = {}) => {
    const r = await window.nou.list();
    setRoot(r.root); setStories(r.stories);
    if (!r.stories.length) { setData(null); return; }
    const sid = want.id ?? (keep && r.stories.find((s) => s.id === id) ? id : r.stories[0].id);
    const story = r.stories.find((s) => s.id === sid);
    const versions = story.versions.map((x) => x.version);
    const v = want.version ?? (keep && versions.includes(version) && sid === id ? version : versions[versions.length - 1]);
    setId(sid); setVersion(v);
    await load(sid, v);
  }, [id, version, load]);

  // First load, and reload when files change on disk (but never re-render the editors while you type).
  useEffect(() => { refresh(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    window.nou.onChange(() => {
      if (writingRef.current) window.nou.list().then((r) => setStories(r.stories));
      else refreshRef.current(true);
    });
  }, []);

  const selectStory = useCallback((sid) => {
    if (!leaveOk()) return;
    setWritingState(false); setEdits({});
    refresh(false, { id: sid });
  }, [leaveOk, refresh]);
  const selectVersion = useCallback((v) => {
    if (!leaveOk()) return;
    setEdits({}); setVersion(v); load(id, v);
  }, [leaveOk, load, id]);

  const setRailCollapsed = useCallback((c) => { setRailCollapsedState(c); store('nou-rail-collapsed', String(c)); }, []);
  const setPanel = useCallback((name) => {
    if (name === panel && !railCollapsed) return setRailCollapsed(true);
    setPanelState(name); store('nou-panel', name);
    if (railCollapsed) setRailCollapsed(false);
  }, [panel, railCollapsed, setRailCollapsed]);

  const setWriting = useCallback((on, prefill = {}) => {
    if (!on && !leaveOk()) return false;
    setWritingState(on); setEdits(on ? { ...prefill } : {});
    if (on) setPrompter(false);
    return true;
  }, [leaveOk]);
  const setEdit = useCallback((n, text) => setEdits((e) => ({ ...e, [n]: text })), []);

  const save = useCallback(async () => {
    if (!dirty) return null;
    const r = await window.nou.save(id, version, dirtyEdits);
    setWritingState(false); setEdits({}); setShowChanges(true);
    await refresh(true, { id, version: r.version });
    return r;
  }, [dirty, dirtyEdits, id, version, refresh]);

  const approve = useCallback(async (note) => {
    await window.nou.approve(id, version, note);
    await refresh(true, { id, version });
  }, [id, version, refresh]);

  // The script as it reads on screen: unsaved edits included.
  const scriptCues = useCallback(() => (data ? data.script.cues.map((c) => ({
    n: c.n, kind: c.kind, hint: c.hint, onCamera: c.onCamera, source: c.source, text: edits[c.n] ?? c.text,
  })) : []), [data, edits]);

  const story = stories.find((s) => s.id === id) || null;
  return {
    root, stories, story, id, version, data, panel, railCollapsed, view, writing, edits, dirtyEdits, dirty, prompter,
    showSources, showChanges, media, files,
    refresh, refreshAux, selectStory, selectVersion, setPanel, setRailCollapsed, setView, setWriting, setEdit, save, approve,
    setPrompter, setShowSources, setShowChanges, scriptCues, leaveOk,
    chips, addChips, removeChip, reply, setReply, pendingDigest, setPendingDigest, requestDigest,
  };
}
