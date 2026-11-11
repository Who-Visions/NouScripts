// Top band. Row 1: hamburger menu, brand, title with a version dropdown, the four view modes, and a View menu.
// Row 2: telemetry. Secondary actions live in menus so the bar stays clean.
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Eye, FileDown, FolderOpen, FileText, Keyboard, Menu, PanelLeft, Library } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtTime, countWords, lint } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { BAND, GUTTER } from '@/lib/grid';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuCheckboxItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuShortcut,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';

const segItem = 'h-7 rounded-[5px] px-3 text-[13px] text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground';
const menu = 'min-w-56 border-border bg-popover';

export default function TopBar({ nou }) {
  const d = nou.data;
  const sc = d && d.script;
  const [note, setNote] = useState('');
  const flash = (t) => { setNote(t); setTimeout(() => setNote(''), 3000); };

  const stats = useMemo(() => {
    if (!sc) return null;
    if (!nou.writing) return { seconds: sc.seconds, words: sc.words, flagged: sc.flaggedCount };
    const wps = d.wordsPerSecond || 2.8;
    let words = 0; let seconds = 0; let flagged = 0;
    for (const c of sc.cues) {
      const t = nou.edits[c.n] ?? c.text; const w = countWords(t);
      words += w; seconds += Math.round(w / wps) + (c.sotSeconds || 0);
      if (lint(t, d.banlist || []).length) flagged++;
    }
    return { seconds, words, flagged };
  }, [sc, d, nou.writing, nou.edits]);

  const mode = nou.prompter ? 'prompt' : nou.writing ? 'write' : nou.view;
  const setMode = (m) => {
    if (!m || m === mode) return;
    if (m === 'write') return nou.setWriting(true);
    if (m === 'prompt') return nou.setPrompter(true);
    if (nou.writing && !nou.setWriting(false)) return;
    nou.setPrompter(false); nou.setView(m);
  };
  const changed = d ? d.diff.filter((x) => x !== 'same').length : 0;
  const story = nou.story;
  const approvedV = story && story.approval && story.approvalCurrent ? story.approval.version : null;

  const exportClap = async () => {
    try { const r = await window.nou.exportClap(nou.id, nou.version); flash(`Exported ${r.file}`); } catch { flash('Export failed'); }
  };

  const telemetry = stats && [
    [fmtTime(stats.seconds), 'runtime'],
    [stats.words, 'words'],
    [`${fmtTime(sc.onCameraSeconds)} · ${sc.avatarJobs} job${sc.avatarJobs === 1 ? '' : 's'}`, 'on camera'],
    [stats.flagged ? `${stats.flagged} flagged` : '0', 'clichés'],
  ];

  // Three cells on the shared column grid: brand (over rail + panel), title + modes (over the script),
  // view + status (over the right rail). Vertical lines continue the middle band's dividers.
  return (
    <header className={cn('drag grid border-b bg-chrome', BAND)}>
      <div className="flex h-[76px] flex-col justify-center border-r pl-[80px] pr-3">
        <div className="no-drag flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-ml-1.5 size-8" aria-label="Menu"><Menu className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={menu}>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-[1.1px] text-faint">Story</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><Library className="size-4" />Go to story</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={menu}>
                  {nou.stories.map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => nou.selectStory(s.id)}>
                      <span className="truncate">{s.title}</span>{s.id === nou.id && <Check className="ml-auto size-4 text-gold" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem disabled={!d} onSelect={() => window.nou.open(d.path)}><FileText className="size-4" />Open script file</DropdownMenuItem>
              <DropdownMenuItem disabled={!d} onSelect={() => window.nou.reveal(d.path)}><FolderOpen className="size-4" />Show in Finder</DropdownMenuItem>
              <DropdownMenuItem disabled={!d} onSelect={exportClap}><FileDown className="size-4" />Export .clap</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => nou.setRailCollapsed(!nou.railCollapsed)}>
                <PanelLeft className="size-4" />{nou.railCollapsed ? 'Show side panel' : 'Hide side panel'}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><Keyboard className="size-4" />Keyboard shortcuts</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={menu}>
                  {[['Find a story', '⌘K'], ['Save a new version', '⌘S'], ['Send to producer line', 'Enter'], ['New line in the input', '⇧Enter'],
                    ['Teleprompter play / pause', 'Space'], ['Teleprompter speed', '↑ ↓'], ['Leave teleprompter', 'Esc']].map(([k, s]) => (
                    <DropdownMenuItem key={k} className="pointer-events-none">{k}<DropdownMenuShortcut>{s}</DropdownMenuShortcut></DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="size-2 rounded-[2px] bg-gold" />
          <span className="font-semibold">Nou Scripts</span>
        </div>
        {note && <div className="mt-1 truncate pl-1 text-[11px] text-gold">{note}</div>}
      </div>

      <div className={cn('flex min-w-0 flex-col justify-center gap-1.5', GUTTER)}>
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[17px] font-bold tracking-tight">{sc ? sc.title : 'Loading…'}</h1>
          {d && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="no-drag h-7 flex-none gap-1 px-2 tabular-nums">
                  v{d.version}{approvedV === d.version && <span className="size-1.5 rounded-full bg-ok" />}<ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className={menu}>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-[1.1px] text-faint">Versions</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(nou.version)} onValueChange={(v) => nou.selectVersion(Number(v))}>
                  {[...d.story.versions].reverse().map((v, i) => (
                    <DropdownMenuRadioItem key={v} value={String(v)}>
                      v{v}<span className="ml-auto pl-4 text-[11px] text-faint">{v === approvedV ? 'approved' : i === 0 ? 'latest' : ''}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {d && (
            <ToggleGroup type="single" value={mode} onValueChange={setMode} className="no-drag ml-auto h-8 flex-none rounded-md border bg-card p-0.5" aria-label="View">
              <ToggleGroupItem value="read" className={segItem}>Read</ToggleGroupItem>
              <ToggleGroupItem value="write" className={segItem}>Write</ToggleGroupItem>
              <ToggleGroupItem value="broadcast" className={segItem}>As Broadcast</ToggleGroupItem>
              <ToggleGroupItem value="prompt" className={segItem}>Teleprompter</ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        {telemetry && (
          <div className="flex min-w-0 items-baseline divide-x divide-white/[0.08] font-mono text-[11px] text-muted-foreground tabular-nums">
            {telemetry.map(([b, s], i) => (
              <span key={s} className="whitespace-nowrap px-3 first:pl-0">
                <b className={cn('mr-1.5 text-foreground', i === 3 && stats.flagged && 'text-destructive')}>{b}</b>{s}
              </span>
            ))}
            <span className="ml-auto whitespace-nowrap !border-l-0 text-faint" title={`edited ${d.modified}`}>{d.modified.replace(/^\w+,\s*/, '').replace(/\s+E[SD]T$/, '')}</span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-1.5 border-l px-4">
        {d && (
          <>
            <div className="no-drag flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5"><Eye className="size-4" />View<ChevronDown className="size-3.5 opacity-60" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={menu}>
                  <DropdownMenuCheckboxItem checked={nou.showChanges} disabled={!d.prevVersion} onCheckedChange={nou.setShowChanges}>
                    Changes since v{d.prevVersion || '-'}<span className="ml-auto pl-4 text-[11px] tabular-nums text-faint">{changed}</span>
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={nou.showSources} onCheckedChange={nou.setShowSources}>Source notes</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={!nou.railCollapsed} onCheckedChange={(v) => nou.setRailCollapsed(!v)}>Side panel</DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className={cn('ml-auto flex items-center gap-1.5 text-[11px]', approvedV === d.version ? 'text-ok' : 'text-gold')}>
                <span className={cn('size-1.5 rounded-full', approvedV === d.version ? 'bg-ok' : 'bg-gold')} />
                {approvedV === d.version ? `v${d.version} approved` : 'Not approved'}
              </span>
            </div>
            <div className="font-mono text-[11px] text-faint tabular-nums">
              {d.prevVersion ? `${changed} of ${sc.cues.length} cues changed since v${d.prevVersion}` : 'First version'}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
