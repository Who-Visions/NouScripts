// One column grid for all three bands. Middle: icon rail 56 + panel (248 or 0) + script + right rail 320.
// Top bar and dock: the first cell spans rail + panel, but never narrower than the brand (304 px).
export const BAND = 'grid-cols-[max(304px,calc(56px+var(--panel)))_minmax(0,1fr)_320px]';
export const GUTTER = 'px-[clamp(18px,3vw,44px)]'; // the script column's side padding; titles and the input align to it
export const HEAD = 'h-10 flex-none border-b'; // every column's header row, so the first line runs straight across
