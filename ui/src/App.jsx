// Three bands on ONE column grid: icon rail · panel · script · right rail. The top bar, the middle and the dock
// share the same column edges, so every vertical line runs unbroken from top to bottom, and every column's
// header row is 40 px, so the first horizontal line runs unbroken across the window.
import { useNou } from '@/lib/useNou';
import TopBar from '@/components/TopBar';
import IconRail from '@/components/IconRail';
import SidePanel from '@/components/SidePanel';
import ScriptView from '@/components/ScriptView';
import RightRail from '@/components/RightRail';
import Dock from '@/components/Dock';
import Teleprompter from '@/components/Teleprompter';

export const COLS = 'grid-cols-[56px_var(--panel)_minmax(0,1fr)_320px]';

export default function App() {
  const nou = useNou();
  return (
    <div className="grid h-screen w-screen grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
      style={{ '--panel': nou.railCollapsed ? '0px' : '248px' }}>
      <TopBar nou={nou} />
      <div className={`grid min-h-0 ${COLS}`}>
        <IconRail nou={nou} />
        <SidePanel nou={nou} />
        <main className="flex min-h-0 min-w-0 flex-col">
          <ScriptView nou={nou} />
        </main>
        <RightRail nou={nou} />
      </div>
      <Dock nou={nou} />
      {nou.prompter && nou.data && <Teleprompter nou={nou} />}
    </div>
  );
}
