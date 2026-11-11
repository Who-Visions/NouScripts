// Full-screen teleprompter: auto-scroll, speed, mirror, font size.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export default function Teleprompter({ nou }) {
  const sc = nou.data.script;
  const [speed, setSpeed] = useState(40);
  const [playing, setPlaying] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [size, setSize] = useState(46);
  const box = useRef(null);
  const speedRef = useRef(speed); speedRef.current = speed;

  useEffect(() => {
    if (!playing) return undefined;
    let raf; let last = performance.now(); let acc = 0;
    const step = (t) => {
      acc += ((t - last) / 1000) * speedRef.current; last = t;
      const whole = Math.floor(acc);
      if (whole && box.current) { box.current.scrollTop += whole; acc -= whole; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') nou.setPrompter(false);
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSpeed((s) => Math.min(200, s + 5)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSpeed((s) => Math.max(5, s - 5)); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [nou]);

  const btn = 'h-7 border-white/15 bg-transparent px-2.5 text-xs text-white/80 hover:bg-white/10';
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center gap-4 border-b border-white/10 px-5 py-2.5 text-xs text-white/70">
        <span className="font-semibold text-white">{sc.title} · v{nou.version}</span>
        <span className="text-white/45">Space play/pause · ↑↓ speed · Esc exit</span>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" className={cn(btn, mirror && 'bg-white/15')} onClick={() => setMirror(!mirror)} title="Flip for reflection glass">Mirror</Button>
          <Button variant="outline" className={btn} onClick={() => setSize((s) => Math.max(24, s - 4))} title="Decrease font size">A-</Button>
          <Button variant="outline" className={btn} onClick={() => setSize((s) => Math.min(80, s + 4))} title="Increase font size">A+</Button>
          <Button variant="outline" className={btn} onClick={() => nou.setPrompter(false)}>Close</Button>
        </div>
        <span className="tabular-nums">{speed} px/s{playing ? ' · playing' : ''}</span>
      </div>
      <div ref={box} className="relative flex-1 overflow-auto">
        <div className="mx-auto max-w-[900px] px-8 pt-[35vh] pb-[70vh] font-read leading-[1.35]" style={{ fontSize: size, transform: mirror ? 'scaleX(-1)' : undefined }}>
          {sc.cues.map((c) => (
            <div key={c.n} className="mb-[1.2em]">
              <span className={cn('mb-1 block font-sans text-sm font-bold uppercase tracking-[1px]', c.onCamera ? 'text-gold' : 'text-nou')}>{c.n} · {c.onCamera ? 'ON CAM' : c.kind}</span>
              {c.text}
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none fixed inset-x-0 top-[35%] h-px bg-gold/40" aria-hidden="true" />
    </div>
  );
}
