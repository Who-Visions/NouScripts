// Bottom band, three modules: lane and model (left), the producer input with + and Digest (centre), the last reply (right).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Plus, Sparkles, Globe, Search, PenLine, X, Square } from 'lucide-react';
import { startJob } from '@/lib/jobs';
import { cn } from '@/lib/utils';
import { cleanErr } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { BAND, GUTTER } from '@/lib/grid';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

const LANES = {
  edit: { label: 'Edit', icon: PenLine, ph: 'Tell Nou what to change… e.g. tighten line 5', note: 'Suggestions open in Write. Nothing saves until you do.' },
  fetch: { label: 'Web fetch', icon: Globe, ph: 'Paste links: pages, PDFs, YouTube, audio, video', note: 'Each link is read the right way for what it is, saved to sources/ and attached.' },
  research: { label: 'Research', icon: Search, ph: 'Ask a research question…', note: 'Plans searches, reads Exa (Tavily backup), writes a cited brief into the story.' },
};
const MODELS = [
  ['nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra'],
  ['mistralai/mistral-large-4-1t-a52b', 'Mistral Large 4'],
];

export default function Dock({ nou }) {
  const [lane, setLane] = useState('edit');
  const [model, setModel] = useState(MODELS[0][0]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const jobRef = useRef(null);
  const [live, setLive] = useState(null); // { text, t0 } while a job streams steps
  const box = useRef(null);
  useLayoutEffect(() => { const t = box.current; if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(140, t.scrollHeight)}px`; } }, [text]);
  const modelName = MODELS.find((m) => m[0] === model)[1];

  async function run(which, value) {
    if (busy || !nou.data) return;
    setBusy(true);
    // A MessagePort per job: the main process streams named steps and listens for Cancel.
    const job = startJob((ev) => { if (ev.type === 'step') setLive((l) => ({ text: ev.text, t0: l ? l.t0 : Date.now() })); });
    jobRef.current = job;
    setLive({ text: 'Starting…', t0: Date.now() });
    const base = { id: nou.id, version: nou.version, model, jobId: job.jobId };
    try {
      if (which === 'edit') {
        nou.setReply(`Asking ${modelName}…`, 'busy');
        const r = await window.nou.ask({ ...base, cues: nou.scriptCues(), instruction: value, attachmentIds: nou.chips.map((c) => c.id) });
        const n = Object.keys(r.edits).length;
        if (n) nou.setWriting(true, { ...(nou.writing ? nou.edits : {}), ...r.edits });
        nou.setReply(`${n ? `${n} line${n === 1 ? '' : 's'} suggested: ${Object.keys(r.edits).map((k) => `#${k}`).join(', ')}. Review in Write, then save or discard.` : 'No line changes.'}${r.note ? ` ${r.note}` : ''} (${r.seconds}s)`);
      } else if (which === 'fetch') {
        nou.setReply('Reading links…', 'busy');
        const r = await window.nou.fetchPages({ id: nou.id, text: value, jobId: job.jobId });
        nou.addChips(r.kept);
        nou.setReply(`${r.kept.length ? `Saved and attached: ${r.kept.map((k) => `${k.name} (${k.kind}, ${Math.round(k.chars / 1000)}k chars)`).join(', ')}.` : 'Nothing saved.'}${r.failed.length ? ` Couldn't read: ${r.failed.join('; ')}` : ''}`, r.kept.length ? '' : 'err');
        nou.refreshAux();
      } else if (which === 'research') {
        nou.setReply(`Researching with ${modelName}: planning searches…`, 'busy');
        const r = await window.nou.research({ ...base, question: value, cues: nou.scriptCues() });
        nou.addChips([r.brief]);
        nou.setReply(`${r.answer} (${r.sources} sources via ${r.lanes.join(' + ')}, ${r.seconds}s. Brief saved and attached.)`, '', r.file);
        nou.refreshAux();
      } else {
        nou.setReply(`Working out what each link is, then reading and digesting with ${modelName}… (audio and video are transcribed locally and can take minutes)`, 'busy');
        const r = await window.nou.digest({ ...base, text: value, cues: nou.scriptCues() });
        for (const x of r.done) nou.addChips(x.chips);
        const found = r.done.reduce((a, x) => a + ((x.media && x.media.added) || 0), 0);
        nou.setReply(`${r.done.length ? `${r.done.map((x) => `Digested ${x.kind} via ${x.lane}: ${x.what || x.title}`).join(' · ')} Saved in the story and attached.${found ? ` ${found} media source${found === 1 ? '' : 's'} added.` : ''}` : 'Nothing digested.'}${r.failed.length ? ` Couldn't read: ${r.failed.join('; ')}` : ''} (${r.seconds}s)`,
          r.done.length ? '' : 'err', r.done.length ? r.done[r.done.length - 1].file : null);
        nou.refreshAux();
      }
      setText('');
    } catch (err) {
      const msg = cleanErr(err);
      nou.setReply(msg === 'Cancelled.' ? 'Cancelled. Nothing was saved from the unfinished step.' : `Didn't work: ${msg}`, msg === 'Cancelled.' ? '' : 'err');
    } finally { job.end(); jobRef.current = null; setLive(null); setBusy(false); }
  }
  const runRef = useRef(run); runRef.current = run;
  const [, tick] = useState(0);
  useEffect(() => { if (!live) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [live]);

  // A media tile's Digest button lands here.
  useEffect(() => {
    if (!nou.pendingDigest) return;
    const url = nou.pendingDigest.url;
    nou.setPendingDigest(null); setText(url);
    runRef.current('digest', url);
  }, [nou.pendingDigest]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => { e && e.preventDefault(); const v = text.trim(); if (v) run(lane, v); };
  const digest = () => {
    const v = text.trim();
    if (!/https?:\/\//.test(v)) { nou.setReply('Paste a link in the box first: a page, PDF, YouTube, audio or video.', 'err'); box.current && box.current.focus(); return; }
    run('digest', v);
  };
  const attach = async () => nou.addChips(await window.nou.attach());
  const Lane = LANES[lane].icon;

  // Three cells on the shared column grid, divided by the same vertical lines as the bands above.
  return (
    <footer className={cn('grid border-t bg-chrome', BAND)}>
      <section className="flex min-w-0 items-center gap-2 border-r px-4 py-2.5" aria-label="Model lane" title={LANES[lane].note}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 flex-none gap-1.5"><Lane className="size-4" />{LANES[lane].label}<ChevronDown className="size-3.5 opacity-60" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-72 border-border bg-popover">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-[1.1px] text-faint">Lane · models run on NVIDIA</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={lane} onValueChange={setLane}>
              {Object.entries(LANES).map(([k, l]) => (
                <DropdownMenuRadioItem key={k} value={k} className="items-start py-2">
                  <span className="flex flex-col"><span className="flex items-center gap-1.5 font-medium"><l.icon className="size-3.5" />{l.label}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{l.note}</span></span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{MODELS.map(([v, n]) => <SelectItem key={v} value={v}>{n}</SelectItem>)}</SelectContent>
        </Select>
      </section>

      <form onSubmit={submit} className={cn('flex min-w-0 flex-col justify-center gap-1.5 py-2.5', GUTTER)}>
        {nou.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {nou.chips.map((c) => (
              <span key={c.id} className="inline-flex max-w-[260px] items-center gap-1 rounded-full bg-nou/15 py-0.5 pr-1 pl-2.5 text-[11px]" title={c.name}>
                <span className="truncate">{c.name}</span>
                <button type="button" onClick={() => nou.removeChip(c.id)} aria-label={`Remove ${c.name}`} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.12] bg-[#101012] p-1.5 pl-2 focus-within:border-gold/70">
          <Button type="button" variant="ghost" size="icon" className="size-8 flex-none" onClick={attach} aria-label="Attach files" title="Attach files (sources, notes, transcripts)"><Plus className="size-4" /></Button>
          <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={LANES[lane].ph} aria-label="Instruction"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            className="max-h-[140px] min-h-8 flex-1 resize-none bg-transparent px-0.5 py-[5px] font-read text-[15px] leading-[22px] outline-none placeholder:text-faint" />
          <Button type="button" variant="outline" size="sm" className="h-8 flex-none gap-1.5 hover:border-nou hover:text-nou" disabled={busy} onClick={digest}
            title="Digest the links in the box: page, PDF, YouTube, audio or video"><Sparkles className="size-4" />Digest</Button>
          {busy ? (
            <Button type="button" variant="outline" size="icon" className="size-8 flex-none border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => jobRef.current && jobRef.current.cancel()} aria-label="Stop" title="Stop this job"><Square className="size-3.5 fill-current" /></Button>
          ) : (
            <Button type="submit" variant="outline" size="icon" className="size-8 flex-none hover:border-gold hover:text-gold" disabled={!text.trim()} aria-label="Send" title="Send (Enter)"><ArrowUp className="size-4" /></Button>
          )}
        </div>
      </form>

      <section className="flex min-w-0 flex-col justify-center border-l px-4 py-2.5" aria-label="Last reply">
        <div className="mb-0.5 text-[10px] uppercase tracking-[1.2px] text-faint">Last reply</div>
        <div className={cn('line-clamp-2 text-xs leading-snug break-words text-muted-foreground hover:line-clamp-none',
          nou.reply.tone === 'busy' && 'text-gold', nou.reply.tone === 'err' && 'text-destructive')}>
          {live ? <span className="text-gold">{live.text} · {Math.round((Date.now() - live.t0) / 1000)}s</span> : nou.reply.text}
          {!live && nou.reply.file && <Button variant="outline" size="sm" className="ml-1.5 h-5 px-1.5 text-[11px]" onClick={() => nou.openFile(nou.reply.file)}>Open</Button>}
        </div>
      </section>
    </footer>
  );
}
