// Bottom band, three modules: lane and model (left), the producer input with + and Digest (centre), the last reply (right).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Plus, Sparkles, Globe, Search, PenLine, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cleanErr } from '@/lib/text';
import { Button } from '@/components/ui/button';
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
const label = 'mb-1.5 text-[10px] uppercase tracking-[1.2px] text-faint';
const mod = 'min-w-0 rounded-lg border bg-card px-3 py-2.5';

export default function Dock({ nou }) {
  const [lane, setLane] = useState('edit');
  const [model, setModel] = useState(MODELS[0][0]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  useLayoutEffect(() => { const t = box.current; if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(140, t.scrollHeight)}px`; } }, [text]);
  const modelName = MODELS.find((m) => m[0] === model)[1];

  async function run(which, value) {
    if (busy || !nou.data) return;
    setBusy(true);
    const base = { id: nou.id, version: nou.version, model };
    try {
      if (which === 'edit') {
        nou.setReply(`Asking ${modelName}…`, 'busy');
        const r = await window.nou.ask({ ...base, cues: nou.scriptCues(), instruction: value, attachmentIds: nou.chips.map((c) => c.id) });
        const n = Object.keys(r.edits).length;
        if (n) nou.setWriting(true, { ...(nou.writing ? nou.edits : {}), ...r.edits });
        nou.setReply(`${n ? `${n} line${n === 1 ? '' : 's'} suggested: ${Object.keys(r.edits).map((k) => `#${k}`).join(', ')}. Review in Write, then save or discard.` : 'No line changes.'}${r.note ? ` ${r.note}` : ''} (${r.seconds}s)`);
      } else if (which === 'fetch') {
        nou.setReply('Reading links…', 'busy');
        const r = await window.nou.fetchPages({ id: nou.id, text: value });
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
      nou.setReply(`Didn't work: ${cleanErr(err)}`, 'err');
    } finally { setBusy(false); }
  }
  const runRef = useRef(run); runRef.current = run;

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

  return (
    <footer className="grid grid-cols-[minmax(260px,1fr)_minmax(0,2.4fr)_minmax(280px,1fr)] gap-3 border-t bg-chrome px-3.5 pt-2.5 pb-3">
      <section className={mod} aria-label="Model lane">
        <div className={label}>Producer line · NVIDIA</div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 flex-none gap-1.5"><Lane className="size-4" />{LANES[lane].label}<ChevronDown className="size-3.5 opacity-60" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-72 border-border bg-popover">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-[1.1px] text-faint">Lane</DropdownMenuLabel>
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
        </div>
        <p className="mt-2 text-xs leading-normal text-muted-foreground">{LANES[lane].note}</p>
      </section>

      <form onSubmit={submit} className={cn(mod, 'flex flex-col justify-center gap-1.5 focus-within:border-gold/60')}>
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
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="size-[38px] flex-none" onClick={attach} aria-label="Attach files" title="Attach files (sources, notes, transcripts)"><Plus className="size-4" /></Button>
          <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={LANES[lane].ph} aria-label="Instruction"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            className="max-h-[140px] min-h-[38px] flex-1 resize-none bg-transparent px-0.5 py-2 font-read text-[15px] leading-[22px] outline-none placeholder:text-faint" />
          <Button type="button" variant="outline" className="h-[38px] flex-none gap-1.5 hover:border-nou hover:text-nou" disabled={busy} onClick={digest}
            title="Digest the links in the box: page, PDF, YouTube, audio or video"><Sparkles className="size-4" />Digest</Button>
          <Button type="submit" variant="outline" size="icon" className="size-[38px] flex-none hover:border-gold hover:text-gold" disabled={busy || !text.trim()} aria-label="Send" title="Send (Enter)"><ArrowUp className="size-4" /></Button>
        </div>
      </form>

      <section className={mod} aria-label="Last reply">
        <div className={label}>Last reply</div>
        <div className={cn('max-h-[92px] overflow-auto text-xs leading-normal break-words text-muted-foreground',
          nou.reply.tone === 'busy' && 'text-gold', nou.reply.tone === 'err' && 'text-destructive')}>
          {nou.reply.text}
          {nou.reply.file && <Button variant="outline" size="sm" className="ml-1.5 h-5 px-1.5 text-[11px]" onClick={() => window.nou.open(nou.reply.file)}>Open</Button>}
        </div>
      </section>
    </footer>
  );
}
