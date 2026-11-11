// Three bands (Dave's layout): top = menu bar + telemetry; middle = icon rail, panel, script, right rail;
// bottom = three modules with the producer input in the centre.
import { useNou } from '@/lib/useNou';
import { cn } from '@/lib/utils';
import TopBar from '@/components/TopBar';
import IconRail from '@/components/IconRail';
import SidePanel from '@/components/SidePanel';
import ScriptView from '@/components/ScriptView';
import RightRail from '@/components/RightRail';
import Dock from '@/components/Dock';
import Teleprompter from '@/components/Teleprompter';

export default function App() {
  const nou = useNou();
  return (
    <div className="grid h-screen w-screen grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <TopBar nou={nou} />
      <div className={cn('grid min-h-0', nou.railCollapsed ? 'grid-cols-[56px_0_minmax(0,1fr)_320px]' : 'grid-cols-[56px_248px_minmax(0,1fr)_320px]')}>
        <IconRail nou={nou} />
        <SidePanel nou={nou} />
        <main className="min-h-0 min-w-0 overflow-auto px-[clamp(18px,3vw,44px)] pt-5 pb-12">
          <ScriptView nou={nou} />
        </main>
        <RightRail nou={nou} />
      </div>
      <Dock nou={nou} />
      {nou.prompter && nou.data && <Teleprompter nou={nou} />}
    </div>
  );
}
