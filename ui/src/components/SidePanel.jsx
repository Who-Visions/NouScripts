// The panel column next to the icon rail: Stories, Media sources, Desk, Sources.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Play, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { host, eastern, fileUrl, cleanErr } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

const TITLES = { stories: 'Stories', media: 'Media sources', desk: 'Desk', sources: 'Sources' };
const segItem = 'h-6 min-w-0 flex-1 basis-0 rounded-[5px] px-1 text-[10px] text-faint data-[state=on]:bg-secondary data-[state=on]:text-foreground';
const Empty = ({ children }) => <p className="px-2 py-1 text-xs leading-relaxed text-faint">{children}</p>;

function Stories({ nou }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const input = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !typing) { e.preventDefault(); input.current && input.current.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const visible = nou.stories.filter((s) => {
    const current = s.approval && s.approvalCurrent;
    return `${s.title} ${s.id}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'ready' ? current : !current));
  });
  return (
    <>
      <label className="mx-px mb-2.5 flex h-9 items-center gap-2 rounded-md border bg-[#0e0e0f] px-2 text-faint focus-within:border-gold/60">
        <Search className="size-3.5" aria-hidden="true" />
        <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a story…" aria-label="Find a story"
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-faint" />
        <kbd className="rounded border px-1 text-[10px]">⌘ K</kbd>
      </label>
      <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v)} className="mb-2.5 flex w-full rounded-md bg-[#0e0e0f] p-[3px]" aria-label="Filter stories">
        <ToggleGroupItem value="all" className={segItem}>All</ToggleGroupItem>
        <ToggleGroupItem value="ready" className={segItem}>Approved</ToggleGroupItem>
        <ToggleGroupItem value="review" className={segItem}>Needs review</ToggleGroupItem>
      </ToggleGroup>
      <nav className="flex flex-1 flex-col gap-1 overflow-auto" aria-label="Stories">
        {visible.map((s) => {
          const latest = s.versions[s.versions.length - 1].version;
          const current = s.approval && s.approvalCurrent;
          const on = s.id === nou.id;
          return (
            <button key={s.id} type="button" onClick={() => nou.selectStory(s.id)}
              className={cn('flex w-full items-center gap-2.5 rounded-md border border-transparent p-2 text-left hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
                on && 'border-gold/35 bg-gold/10')}>
              <span className={cn('grid size-8 flex-none place-items-center rounded-md bg-secondary text-[13px] font-bold text-nou', on && 'text-gold')}>{s.title.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{s.title}</span>
                <span className="flex gap-2 text-[10px] text-faint">
                  <span>{s.id.slice(0, 10)}</span><span>v{latest}</span>
                  <span className={current ? 'text-ok' : 'text-gold'}>{current ? `v${s.approval.version} approved` : s.approval ? 'approval stale' : 'needs review'}</span>
                </span>
              </span>
            </button>
          );
        })}
        {!visible.length && <Empty>{query ? 'No matching stories' : 'No stories in this filter'}</Empty>}
      </nav>
      <div className="mt-2 truncate border-t px-2 pt-2.5 text-[10px] text-faint" title={nou.root}>{nou.root}</div>
    </>
  );
}

function Media({ nou }) {
  const [filter, setFilter] = useState('all');
  const items = nou.media;
  const counts = useMemo(() => {
    const c = { all: items.length, image: 0, video: 0, audio: 0 };
    for (const m of items) if (c[m.kind] !== undefined) c[m.kind]++;
    return c;
  }, [items]);
  if (!items.length) return <Empty>Digest or fetch a link and its photos, videos and audio appear here.</Empty>;
  const shown = items.filter((m) => filter === 'all' || m.kind === filter).slice(0, 24);
  const act = async (kind, m) => {
    if (kind === 'open') return window.nou.mediaOpen(nou.id, m.url);
    if (kind === 'digest') return nou.requestDigest(m.url);
    if (kind === 'attach') {
      try { nou.addChips([await window.nou.mediaAttach(nou.id, m.url)]); nou.setReply(`Attached ${m.label || 'photo'}.`); }
      catch (err) { nou.setReply(cleanErr(err), 'err'); }
      return;
    }
    const line = `VIDEO: ${m.kind === 'image' ? 'Photo' : m.kind === 'video' ? 'Clip' : 'Audio'}: ${m.label || host(m.url)} (${m.url})`;
    try { await navigator.clipboard.writeText(line); nou.setReply(`Copied for a cue: ${line}`); } catch { nou.setReply(line); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v)} className="mb-2 flex w-full rounded-md bg-card p-[3px]" aria-label="Filter media">
        {['all', 'image', 'video', 'audio'].filter((k) => k === 'all' || counts[k]).map((k) => (
          <ToggleGroupItem key={k} value={k} className={segItem}>{{ all: 'All', image: 'Photos', video: 'Video', audio: 'Audio' }[k]} {counts[k]}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-2 overflow-auto pb-2">
        {shown.map((m) => {
          const poster = m.kind === 'video' && items.find((x) => x.kind === 'image' && x.path && x.source === m.source && x.via === 'thumbnail');
          const face = poster ? poster.path : m.kind === 'image' ? m.path : null;
          return (
            <figure key={m.url} className="m-0 min-w-0 overflow-hidden rounded-md bg-card" title={m.label || m.url}>
              <button type="button" onClick={() => act('open', m)} className="relative grid aspect-[16/10] w-full place-items-center overflow-hidden bg-[#0e0e0f]">
                {face ? <img src={fileUrl(face)} alt={m.label || ''} loading="lazy" className="size-full object-cover" />
                  : <span className={cn('text-lg text-muted-foreground', m.kind === 'video' && 'text-nou')}>{m.kind === 'pdf' ? 'PDF' : m.kind === 'audio' ? '♪' : m.kind === 'image' ? '◻' : '▶'}</span>}
                {poster && <span className="absolute bottom-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-black/65"><Play className="size-2.5 fill-white text-white" /></span>}
              </button>
              <figcaption className="flex min-w-0 flex-col p-1.5">
                <span className="truncate text-[11px]">{m.label || host(m.url)}</span>
                <span className="truncate text-[10px] text-faint">{m.kind} · {host(m.url)}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {m.kind !== 'image' && <Mini onClick={() => act('digest', m)}>Digest</Mini>}
                  {m.path && <Mini onClick={() => act('attach', m)}>Attach</Mini>}
                  <Mini onClick={() => act('line', m)}>VIDEO line</Mini>
                </span>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
const Mini = (p) => <button type="button" {...p} className="rounded border px-1.5 text-[10px] text-muted-foreground hover:border-[#3f3f44] hover:text-foreground" />;

// Files grouped by kind in collapsible sections (research, digest, web, video, pdf...), newest first inside each.
function FileList({ items, empty, sub }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  const groups = [];
  for (const f of items) { let g = groups.find((x) => x.kind === f.kind); if (!g) groups.push(g = { kind: f.kind, items: [] }); g.items.push(f); }
  return (
    <Accordion type="multiple" defaultValue={groups.map((g) => g.kind)} className="-mx-1 overflow-auto">
      {groups.map((g) => (
        <AccordionItem key={g.kind} value={g.kind} className="border-none">
          <AccordionTrigger className={cn('rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.8px] text-muted-foreground hover:bg-card hover:no-underline',
            g.kind === 'research' && 'text-gold', g.kind === 'digest' && 'text-nou')}>
            <span>{g.kind} <span className="ml-1 font-normal tabular-nums text-faint">{g.items.length}</span></span>
          </AccordionTrigger>
          <AccordionContent className="pb-1">
            {g.items.map((f) => (
              <button key={f.path} type="button" onClick={() => window.nou.open(f.path)}
                className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-card focus-visible:ring-2 focus-visible:ring-ring">
                <span className="line-clamp-2 text-xs">{f.title}</span>
                <span className="truncate text-[10px] text-faint">{sub(f)}</span>
              </button>
            ))}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export default function SidePanel({ nou }) {
  if (nou.railCollapsed) return <div aria-hidden="true" />;
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-sidebar px-3 pt-3.5 pb-3.5">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-[10px] uppercase tracking-[1.2px] text-faint">{TITLES[nou.panel]}</span>
        <span className="flex items-center gap-1">
          {nou.panel === 'stories' && <span className="text-[11px] tabular-nums text-faint">{nou.stories.length}</span>}
          <Button variant="ghost" size="icon" className="size-7" onClick={() => nou.setRailCollapsed(true)} aria-label="Collapse panel" title="Collapse panel">
            <ChevronLeft className="size-4" />
          </Button>
        </span>
      </div>
      {nou.panel === 'stories' && <Stories nou={nou} />}
      {nou.panel === 'media' && <Media nou={nou} />}
      {nou.panel === 'desk' && <FileList items={nou.files.desk} sub={(f) => eastern(f.mtime)}
        empty="Research briefs and digests you run from the producer line land here." />}
      {nou.panel === 'sources' && <FileList items={nou.files.sources} sub={(f) => host(f.url) || f.name}
        empty="Pages, transcripts and PDFs read for this story are saved here." />}
    </aside>
  );
}
