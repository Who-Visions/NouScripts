// The main column: Read (cue cards with word-level changes), Write (editors), and As Broadcast (two-column table).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmtTime, countWords, oneLine, lint, Inline } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { GUTTER, HEAD } from '@/lib/grid';
import Commercial from '@/components/Commercial';

const tag = 'text-[10px] font-bold uppercase tracking-[1px]';

function Banner({ d }) {
  if (!d.approval) return null;
  const matches = d.approvalCurrent && d.approval.version === d.version;
  if (matches) return null;
  return (
    <div className="mb-4 rounded-lg border border-gold/30 bg-gold/10 px-3.5 py-2 text-xs text-gold">
      {!d.approvalCurrent
        ? `Approval for v${d.approval.version} is stale because its script changed. Review and approve again before rendering.`
        : `You’re viewing v${d.version}; v${d.approval.version} is approved. This version is not approved for rendering.`}
    </div>
  );
}

function WriteBar({ nou }) {
  const d = nou.data; const sc = d.script; const wps = d.wordsPerSecond || 2.8;
  const next = Math.max(...d.story.versions) + 1;
  const n = Object.keys(nou.dirtyEdits).length;
  const empty = sc.cues.some((c) => !oneLine(nou.edits[c.n] ?? c.text) && !c.sotSeconds);
  // Same clock as the telemetry: the sum of each cue's rounded time plus any SOT run.
  let words = 0; let flagged = 0; let secs = 0;
  for (const c of sc.cues) { const t = nou.edits[c.n] ?? c.text; const w = countWords(t); words += w; secs += Math.round(w / wps) + (c.sotSeconds || 0); if (lint(t, d.banlist || []).length) flagged++; }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!n || empty || busy) return;
    setBusy(true); setErr('');
    try { await nou.save(); } catch (e) { setErr(`Save failed: ${String(e.message || e)}`); } finally { setBusy(false); }
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const status = err || (empty ? 'A line is empty. Every cue needs words before you can save.'
    : n ? `${n} line${n === 1 ? '' : 's'} edited · ${words} words · ~${fmtTime(secs)}${flagged ? ` · ${flagged} flagged` : ''}. v${d.version} stays as it is.`
      : `Editing v${d.version}. Saving makes v${next}; v${d.version} stays as it is.`);
  return (
    <div className="sticky top-0 z-10 mb-4 flex items-center gap-2.5 rounded-lg border border-gold/35 bg-card px-3.5 py-2.5 text-[13px] shadow-[0_6px_18px_rgba(0,0,0,.35)]">
      <span className={cn('flex-1 text-muted-foreground', (empty || err) && 'text-destructive')}>{status}</span>
      <Button variant="ghost" size="sm" onClick={() => nou.setWriting(false)}>Discard</Button>
      <Button variant="outline" size="sm" disabled={!n || empty || busy} onClick={save} className="border-gold/50 text-gold hover:text-gold">
        {busy ? 'Saving…' : `Save as v${next}`}
      </Button>
    </div>
  );
}

function Editor({ value, onChange, n }) {
  const ref = useRef(null);
  useLayoutEffect(() => { const t = ref.current; if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; } }, [value]);
  return (
    <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} spellCheck aria-label={`Cue ${n} spoken text`}
      className={cn('-mx-2.5 block w-[calc(100%+20px)] max-w-[calc(68ch+20px)] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2.5 py-1.5 font-read text-[18px] leading-[1.6] caret-gold outline-none hover:bg-white/[0.02] focus:border-gold/40 focus:bg-white/[0.03]',
        !oneLine(value) && 'border-destructive')} />
  );
}

function Runs({ runs }) {
  return runs.map((r, i) => (
    <span key={i}>{i > 0 && ' '}{r.t === 'add' ? <ins>{r.s}</ins> : r.t === 'del' ? <del>{r.s}</del> : r.s}</span>
  ));
}

function Cue({ nou, c, i }) {
  const d = nou.data;
  const wps = d.wordsPerSecond || 2.8;
  const text = nou.writing ? (nou.edits[c.n] ?? c.text) : c.text;
  const words = nou.writing ? countWords(text) : c.words;
  const seconds = nou.writing ? Math.round(words / wps) + (c.sotSeconds || 0) : c.seconds;
  const flags = nou.writing ? lint(text, d.banlist || []) : c.flags || [];
  const edited = nou.writing && oneLine(text) !== oneLine(c.text);
  const chg = d.diff[i];
  const runs = d.changes && d.changes[i];
  // The timing column already says how long it runs; keep only the words of the hint ("open").
  const hint = (c.hint || '').replace(/,?\s*~?\d+\s*s\b/i, '').trim();
  return (
    <article className={cn('group relative rounded-lg border border-white/[0.09] bg-[#101012] px-5 py-3.5 transition-colors hover:border-white/[0.16]',
      edited && 'border-gold/55')}>
      <span className={cn('absolute top-3.5 bottom-3.5 left-0 w-[2px] rounded-[2px]', c.onCamera ? 'bg-gold' : 'bg-nou')} />
      <div className="mb-3 flex items-center gap-2 border-b border-white/[0.06] pb-2 text-[11px] text-muted-foreground">
        <span className="font-mono text-[11px] font-semibold text-foreground tabular-nums">{String(c.n).padStart(2, '0')}</span>
        <span className={cn(tag, c.onCamera ? 'text-gold' : 'text-nou')}>{c.onCamera ? 'ON CAM' : c.kind}</span>
        {hint && <span className="whitespace-nowrap">{hint}</span>}
        {c.fields && c.fields.find((f) => f.key === 'VIDEO') && (
          <span className="min-w-0 flex-1 truncate border-l border-white/[0.08] pl-2.5 font-mono text-[11px] text-faint" title={c.fields.find((f) => f.key === 'VIDEO').value}>{c.fields.find((f) => f.key === 'VIDEO').value}</span>
        )}
        {!nou.writing && d.prevVersion && chg !== 'same' && <span className={cn(tag, 'text-muted-foreground')}>{chg === 'new' ? 'new' : 'changed'}</span>}
        {flags.length > 0 && <span className={cn(tag, 'text-destructive')} title={`AI cliché: ${flags.join(', ')}`}>cliché: {flags.join(', ')}</span>}
        <span className="ml-auto whitespace-nowrap pl-2 font-mono text-[11px] tabular-nums">{words} words · ~{seconds}s</span>
      </div>
      {nou.writing
        ? <Editor n={c.n} value={text} onChange={(v) => nou.setEdit(c.n, v)} />
        : <p className="m-0 max-w-[68ch] font-read text-[18px] leading-[1.6]">{nou.showChanges && runs ? <Runs runs={runs} /> : c.text}</p>}
      {nou.showSources && c.source && (
        <div className="mt-3 border-t border-white/[0.06] pt-2 text-xs text-faint"><Inline text={c.source} /></div>
      )}
    </article>
  );
}

function AsBroadcast({ nou }) {
  const d = nou.data; const sc = d.script; const h = sc.header || {};
  const field = (c, k) => c.fields.filter((f) => f.key === k).map((f) => f.value);
  const head = [['Program', h.program || 'NouGen News'], ['Slug', h.slug || d.story.id.replace(/^\d{4}-\d{2}-\d{2}_/, '').toUpperCase()],
    ['Talent', h.talent || 'Nou'], ['Version', `v${d.version}`], ['TRT', sc.trt]];
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-x-7 gap-y-1.5 border-b border-white/[0.08] px-1 pb-3">
        {head.map(([k, v]) => <div key={k}><span className="block text-[10px] uppercase tracking-[1.1px] text-faint">{k}</span><b className="text-[13px] tabular-nums">{v}</b></div>)}
      </div>
      <table className="w-full table-fixed border-collapse overflow-hidden rounded-lg bg-card">
        <thead>
          <tr className="border-b border-white/[0.08] bg-[#121214] text-left font-mono text-[10px] uppercase tracking-[1.2px] text-faint">
            <th className="w-[82px] px-3 py-[7px] font-semibold">Time code</th><th className="w-[92px] px-3 py-[7px] font-semibold">Segment</th>
            <th className="w-[27%] px-3 py-[7px] font-semibold">Video</th><th className="px-3 py-[7px] font-semibold">Audio</th>
          </tr>
        </thead>
        <tbody>
          {sc.cues.map((c) => {
            const video = field(c, 'VIDEO'); const supers = field(c, 'SUPER'); const gfx = field(c, 'GFX');
            return (
              <tr key={c.n} className="border-t align-top text-[13px]">
                <td className={cn('px-3 py-3 font-mono text-xs tabular-nums shadow-[inset_3px_0_0]', c.onCamera ? 'shadow-gold' : 'shadow-nou')}>
                  {c.tcIn}<small className="block text-[11px] text-faint">{c.seconds}s</small>
                </td>
                <td className="px-3 py-3 text-[11px] uppercase tracking-[0.6px] text-muted-foreground">
                  <b className="mr-1 text-foreground">{c.n}</b>{c.onCamera ? 'ON CAM' : c.kind}
                  {c.hint && <small className="mt-1 block text-[11px] normal-case text-faint">{c.hint}</small>}
                </td>
                <td className="space-y-1.5 border-r px-3 py-3 text-muted-foreground">
                  {video.length ? video.map((v, i) => <div key={i}><Inline text={v} /></div>)
                    : <div className={cn(!c.onCamera && 'italic text-faint')}>{c.onCamera ? `${field(c, 'TALENT')[0] || h.talent || 'Nou'} on camera` : 'Pictures to come'}</div>}
                  {gfx.map((v, i) => <div key={`g${i}`}><em className={cn(tag, 'mr-1 not-italic text-gold')}>GFX</em><Inline text={v} /></div>)}
                  {supers.map((v, i) => (
                    <div key={`s${i}`} className="text-foreground"><em className={cn(tag, 'mr-1 not-italic text-gold')}>SUPER</em>
                      {v.split(' | ').map((line, j) => <span key={j}>{j > 0 && <br />}{line}</span>)}</div>
                  ))}
                </td>
                <td className="px-3 py-3">
                  {['MUSIC', 'SFX', 'NAT'].flatMap((k) => field(c, k).map((v, i) => <div key={k + i} className="mb-1 text-xs text-faint">({k} {v})</div>))}
                  {c.text && <div className="font-read text-[16px] leading-[1.55]">{c.text}</div>}
                  {field(c, 'SOT').map((v, i) => <div key={`o${i}`} className="mt-1.5"><em className={cn(tag, 'mr-1 not-italic text-gold')}>SOT</em>{v}</div>)}
                  {nou.showSources && c.source && <div className="mt-2 text-xs text-faint"><Inline text={c.source} /></div>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr className="border-t text-xs text-muted-foreground"><td className="px-3 py-3 font-mono">{sc.trt}</td><td colSpan={3} className="px-3 py-3">End · total running time {sc.trt}</td></tr></tfoot>
      </table>
    </>
  );
}

export default function ScriptView({ nou }) {
  const d = nou.data;
  if (!d) return <p className={cn(GUTTER, 'pt-5 text-muted-foreground')}>{nou.root ? `Put a script_v1.md in a story folder under ${nou.root}.` : 'Loading…'}</p>;
  const broadcast = nou.view === 'broadcast' && !nou.writing;
  const commercial = nou.view === 'commercial' && !nou.writing;
  const cues = d.script.cues;
  const cam = cues.filter((c) => c.onCamera).length;
  return (
    <>
      <div className={cn(HEAD, GUTTER, 'flex items-center gap-3 font-mono text-[11px] uppercase tracking-[1.4px] text-faint')}>
        <span>Rundown · {cues.length} cues</span><span className="text-gold">{cam} on cam</span><span className="text-nou">{cues.length - cam} vo</span>
        <span className="ml-auto tabular-nums">TRT {d.script.trt}</span>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-auto pt-5 pb-12', GUTTER)}>
        <Banner d={d} />
        {nou.writing && <WriteBar nou={nou} />}
        {commercial ? <Commercial nou={nou} /> : broadcast ? <AsBroadcast nou={nou} /> : (
          <section className="flex flex-col gap-3" aria-live="polite">
            {cues.map((c, i) => <Cue key={c.n} nou={nou} c={c} i={i} />)}
          </section>
        )}
      </div>
    </>
  );
}
