// The Commercial tab: a story's production package (production/ folder) on one page.
// Timeline of cuts, then sections: Shots, Generation clips, Audio stems, VFX, Checks, Files.
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Inline } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const label = 'font-mono text-[10px] uppercase tracking-[1.2px] text-faint';
const segItem = 'h-7 rounded-[5px] px-3 text-[12px] text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground';
// Cut colour by what the shot is: Nou to camera, the room, graphics.
const tone = (name) => (/hook/i.test(name) ? 'bg-gold' : /hud|end card/i.test(name) ? 'bg-[#00b0ff]' : 'bg-nou');
const toneText = (name) => (/hook/i.test(name) ? 'text-gold' : /hud|end card/i.test(name) ? 'text-[#00b0ff]' : 'text-nou');

function Timeline({ edl, active, onPick }) {
  return (
    <div>
      <div className="flex h-9 w-full gap-px overflow-hidden rounded-md">
        {edl.cuts.map((c, i) => (
          <button key={c.name} type="button" onClick={() => onPick(i)} title={`${c.name} · ${c.frames} frames`}
            style={{ flexGrow: c.frames, flexBasis: 0 }}
            className={cn('relative min-w-0 px-1.5 text-left text-[10px] font-semibold text-black/80 transition-opacity', tone(c.name), active !== null && active !== i && 'opacity-35')}>
            <span className="block truncate">{c.name.replace(/^\S+\s/, '')}</span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-faint tabular-nums">
        <span>00:00:00:00</span><span>{edl.totalFrames} frames · {edl.seconds.toFixed(2)} s at {edl.fps} fps</span><span>{edl.cuts.length ? edl.cuts[edl.cuts.length - 1].tcOut : ''}</span>
      </div>
    </div>
  );
}

function Shots({ edl, active, onPick }) {
  return (
    <table className="w-full table-fixed border-collapse overflow-hidden rounded-lg bg-[#101012]">
      <thead>
        <tr className="border-b border-white/[0.08] bg-[#121214] text-left font-mono text-[10px] uppercase tracking-[1.2px] text-faint">
          <th className="w-[150px] px-3 py-[7px] font-semibold">Cut</th><th className="w-[104px] px-3 py-[7px] font-semibold">Frames</th>
          <th className="w-[96px] px-3 py-[7px] font-semibold">In</th><th className="w-[56px] px-3 py-[7px] font-semibold">Len</th><th className="px-3 py-[7px] font-semibold">Camera and key frames</th>
        </tr>
      </thead>
      <tbody>
        {edl.cuts.map((c, i) => (
          <tr key={c.name} onClick={() => onPick(i)} className={cn('cursor-pointer border-t border-white/[0.06] align-top text-[13px] hover:bg-white/[0.02]', active === i && 'bg-white/[0.04]')}>
            <td className={cn('px-3 py-2.5 text-xs font-semibold', toneText(c.name))}>{c.name}</td>
            <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground tabular-nums">F{String(c.start).padStart(3, '0')}-F{String(c.end).padStart(3, '0')}</td>
            <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground tabular-nums">{c.tcIn}</td>
            <td className="px-3 py-2.5 font-mono text-[11px] tabular-nums">{c.frames}</td>
            <td className="px-3 py-2.5 leading-normal text-muted-foreground">{c.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Clips({ p, nou }) {
  const [copied, setCopied] = useState('');
  const copy = async (c) => {
    try { await navigator.clipboard.writeText(c.prompt); setCopied(c.clip_id); setTimeout(() => setCopied(''), 1500); }
    catch { nou.setReply(c.prompt); }
  };
  return (
    <div className="flex flex-col gap-3">
      {p.clipStatus && <div className="rounded-lg border border-gold/30 bg-gold/10 px-3.5 py-2 text-xs text-gold">{p.clipStatus}</div>}
      {p.clips.map((c) => (
        <article key={c.clip_id} className="rounded-lg border border-white/[0.09] bg-[#101012] px-5 py-3.5">
          <div className="mb-2 flex items-center gap-2.5 border-b border-white/[0.06] pb-2 text-[11px] text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{c.clip_id}</span>
            <span className="min-w-0 flex-1 truncate border-l border-white/[0.08] pl-2.5 font-mono text-faint" title={c.camera}>{c.camera}</span>
            <span className="font-mono tabular-nums">{Number(c.duration_s).toFixed(1)} s</span>
            <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => copy(c)}>
              {copied === c.clip_id ? <Check className="size-3" /> : <Copy className="size-3" />}{copied === c.clip_id ? 'Copied' : 'Copy prompt'}
            </Button>
          </div>
          <p className="m-0 text-[14px] leading-relaxed">{c.prompt}</p>
          {c.audio_cue && <p className="mt-2 mb-0 border-t border-white/[0.06] pt-2 text-xs text-faint"><span className={cn(label, 'mr-2 text-gold')}>Audio</span>{c.audio_cue}</p>}
        </article>
      ))}
    </div>
  );
}

// Any markdown table from the package. Columns that hold frame ranges or anchors are set in mono.
const monoCol = (h) => /frame|anchor|sync|length|stop|focus/i.test(h);
function Table({ table }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-[#101012]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-white/[0.08] bg-[#121214] text-left font-mono text-[10px] uppercase tracking-[1.2px] text-faint">
            {table.headers.map((h) => <th key={h} className="px-3 py-[7px] font-semibold whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri} className="border-t border-white/[0.06] align-top text-[13px]">
              {r.map((cell, i) => <td key={i} className={cn('px-3 py-2.5 leading-normal', i === 0 ? 'text-xs font-semibold text-foreground whitespace-nowrap' : 'text-muted-foreground', monoCol(table.headers[i] || '') && 'font-mono text-[11px]')}><Inline text={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Wide tables (more than five columns) read as one card per row in the middle column: the first two cells
// head the card, the rest are label and value pairs. A value made of " · " parts (viseme anchors) stacks.
const Value = ({ text }) => (/ · /.test(text)
  ? <span className="flex flex-col gap-0.5">{text.split(' · ').map((t, i) => <span key={i}><Inline text={t} /></span>)}</span>
  : <Inline text={text} />);
function RowCards({ table }) {
  const [h0, h1, ...rest] = table.headers;
  return (
    <div className="flex flex-col gap-2.5">
      {table.rows.map((r, ri) => (
        <article key={ri} className="rounded-lg border border-white/[0.09] bg-[#101012] px-5 py-3">
          <div className="mb-2 flex items-baseline gap-2.5 border-b border-white/[0.06] pb-2">
            <span className="text-xs font-semibold" title={h0}>{r[0]}</span>
            <span className="text-xs text-muted-foreground" title={h1}>{r[1]}</span>
          </div>
          <dl className="m-0 grid grid-cols-[112px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
            {rest.map((h, i) => (
              <div key={h} className="contents">
                <dt className="pt-px font-mono text-[10px] uppercase tracking-[1.1px] text-faint">{h}</dt>
                <dd className={cn('m-0 leading-normal', monoCol(h) ? 'font-mono text-[12px] text-muted-foreground' : 'text-foreground')}><Value text={r[i + 2] || ''} /></dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}
const AnyTable = ({ table }) => (table.headers.length > 5 ? <RowCards table={table} /> : <Table table={table} />);

const Checks = ({ items }) => (
  <ul className="m-0 flex list-none flex-col gap-2 p-0">
    {items.map((c, i) => <li key={i} className="rounded-lg border border-gold/25 bg-gold/[0.06] px-4 py-2.5 text-[13px] leading-normal"><Inline text={c} /></li>)}
  </ul>
);

const Code = ({ text }) => <pre className="m-0 overflow-auto rounded-lg border border-white/[0.09] bg-[#101012] p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">{text}</pre>;

function Doc({ doc }) {
  return (
    <div className="flex flex-col gap-3">
      {doc.code.map((c, i) => <Code key={i} text={c} />)}
      {doc.tables.map((t, i) => <AnyTable key={i} table={t} />)}
      {doc.checks.length > 0 && <Checks items={doc.checks} />}
    </div>
  );
}

// Short section name from a doc title: "Camera, lighting and blocking" -> "Camera".
const shortTitle = (t) => t.split(/,| and /)[0].trim();

export default function Commercial({ nou }) {
  const p = nou.production;
  const [tab, setTab] = useState('shots');
  const [active, setActive] = useState(null);
  if (!p) return <p className="text-sm text-muted-foreground">This story has no production package yet. Put an <code className="font-mono">edl.md</code>, <code className="font-mono">veo_payloads.json</code>, <code className="font-mono">audio.md</code> or <code className="font-mono">vfx.yaml</code> in its <code className="font-mono">production/</code> folder.</p>;
  const tabs = [
    ['shots', `Shots ${p.edl.cuts.length}`, p.edl.cuts.length > 0],
    ...(p.docs || []).map((d) => [`doc:${d.name}`, shortTitle(d.title), true]),
    ['clips', `Generation clips ${p.clips.length}`, p.clips.length > 0],
    ['audio', `Audio stems ${p.stems ? p.stems.rows.length : 0}`, Boolean(p.stems)],
    ['vfx', 'VFX', Boolean(p.vfx)],
    ['stills', `Renders ${(p.stills || []).length}`, (p.stills || []).length > 0],
    ['checks', `Checks ${p.edl.checks.length}`, p.edl.checks.length > 0],
    ['files', `Files ${p.files.length}`, true],
  ].filter((t) => t[2]);
  const cur = tabs.some((t) => t[0] === tab) ? tab : tabs[0][0];
  const pick = (i) => setActive(active === i ? null : i);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-7 gap-y-1.5 border-b border-white/[0.08] px-1 pb-3">
        {[['Cuts', p.edl.cuts.length], ['Frames', p.edl.totalFrames], ['Edit length', `${p.edl.seconds.toFixed(2)} s`], ['Clips', p.clips.length], ['Clip total', `${p.clipSeconds.toFixed(1)} s`], ['Script', `v${nou.version} · ${nou.data.script.trt}`]]
          .map(([k, v]) => <div key={k}><span className="block text-[10px] uppercase tracking-[1.1px] text-faint">{k}</span><b className="text-[13px] tabular-nums">{v}</b></div>)}
      </div>
      {p.edl.cuts.length > 0 && <Timeline edl={p.edl} active={active} onPick={pick} />}
      <ToggleGroup type="single" value={cur} onValueChange={(v) => v && setTab(v)} className="h-auto w-fit flex-wrap justify-start rounded-md border bg-card p-0.5" aria-label="Production section">
        {tabs.map(([k, name]) => <ToggleGroupItem key={k} value={k} className={segItem}>{name}</ToggleGroupItem>)}
      </ToggleGroup>
      {cur === 'shots' && <Shots edl={p.edl} active={active} onPick={pick} />}
      {cur === 'clips' && <Clips p={p} nou={nou} />}
      {cur.startsWith('doc:') && <Doc doc={p.docs.find((d) => `doc:${d.name}` === cur)} />}
      {cur === 'audio' && <AnyTable table={p.stems} />}
      {cur === 'vfx' && <Code text={p.vfx} />}
      {cur === 'stills' && (
        <div className="flex flex-col gap-3">
          {p.stills.map((s) => (
            <figure key={s.name} className="m-0 overflow-hidden rounded-lg border border-white/[0.09] bg-[#101012]">
              <img src={s.src} alt={s.name} className="block w-full" />
              <figcaption className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
                <span className="font-mono">{s.name}</span>
                <button type="button" onClick={() => nou.openFile(s.path)} className="ml-auto text-faint hover:text-foreground">Open</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {cur === 'checks' && <Checks items={p.edl.checks} />}
      {cur === 'files' && (
        <div className="flex flex-col gap-1">
          {p.files.map((f) => (
            <button key={f.name} type="button" onClick={() => nou.openFile(f.path)} className="flex items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-card focus-visible:ring-2 focus-visible:ring-ring">
              <span className="font-mono text-[13px]">{f.name}</span><span className="text-xs text-faint">{f.note || 'production/'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
