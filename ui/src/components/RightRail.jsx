// Right rail: the approval gate (with its dialog) and the script's notes as accordions.
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { fmtTime, Inline } from '@/lib/text';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

function approvalState(d) {
  const a = d.approval;
  if (a && d.approvalCurrent && a.version === d.version) return { tone: 'ok', what: `v${a.version} is approved for render`, why: `${a.approved_at_eastern}${a.note ? ` · “${a.note}”` : ''}`, can: false };
  if (a && !d.approvalCurrent) return { tone: 'stale', what: `v${a.version} was approved, but the file changed after`, why: 'The render step will refuse it until it is approved again.', can: true };
  if (a) return { tone: '', what: `v${a.version} is the approved version`, why: `You are viewing v${d.version}. Approving it replaces v${a.version}.`, can: true };
  return { tone: '', what: 'Not approved yet', why: 'Nothing renders until a version is approved here.', can: true };
}

function Notes({ notes }) {
  const sections = notes.filter((n) => n.lines.some((l) => l.trim()));
  if (!sections.length) return null;
  return (
    <Accordion type="multiple" defaultValue={sections.map((n) => n.heading)} className="mt-5">
      {sections.map((n) => {
        const items = n.lines.filter((l) => l.trim());
        return (
          <AccordionItem key={n.heading} value={n.heading} className="border-border">
            <AccordionTrigger className="py-2.5 text-[13px] font-semibold hover:no-underline">{n.heading}</AccordionTrigger>
            <AccordionContent className="pb-3 text-[13px] leading-normal text-muted-foreground">
              <ul className="m-0 list-disc space-y-1.5 pl-4">
                {items.map((l, i) => /^\s*[-*]\s/.test(l)
                  ? <li key={i}><Inline text={l.replace(/^\s*[-*]\s+/, '')} /></li>
                  : <p key={i} className="-ml-4 my-1 list-none"><Inline text={l} /></p>)}
              </ul>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

export default function RightRail({ nou }) {
  const d = nou.data;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!d) return <aside className="border-l bg-[#141415]" />;
  const st = approvalState(d);
  const sc = d.script;
  const approve = async () => {
    setBusy(true);
    try { await nou.approve(note.trim()); setOpen(false); setNote(''); } finally { setBusy(false); }
  };
  return (
    <aside className="min-h-0 overflow-auto border-l bg-[#141415] px-4 pt-4 pb-10" aria-label="Approval and notes">
      {!nou.writing && (
        <section className={cn('flex flex-col gap-2.5', st.tone && 'rounded-lg border px-4 py-3',
          st.tone === 'ok' && 'border-ok/35 bg-ok/10', st.tone === 'stale' && 'border-gold/35 bg-gold/10')}>
          <div>
            <div className="text-sm font-semibold tracking-tight">{st.what}</div>
            <div className="mt-0.5 text-xs leading-normal text-muted-foreground">{st.why}</div>
          </div>
          {st.can && <Button className="w-full font-bold" onClick={() => setOpen(true)}>Approve v{d.version}</Button>}
        </section>
      )}
      <Notes notes={sc.notes} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve v{d.version} for render</DialogTitle>
            <DialogDescription>
              {sc.title} · {fmtTime(sc.seconds)} · {sc.avatarJobs} OmniAvatar jobs. This records the exact file contents; any later edit needs a new approval.
            </DialogDescription>
          </DialogHeader>
          <label className="text-xs text-muted-foreground" htmlFor="approve-note">Note for the render step (optional)</label>
          <Textarea id="approve-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. keep line 5 slow" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={approve} disabled={busy} className="font-bold">{busy ? 'Approving…' : 'Approve'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
