# Nou Scripts React port: component contract

Port the old vanilla renderer (src/renderer/app.js + index.html, given below as REFERENCE) to React 19 function
components in JSX (not TypeScript). Same behaviour, same IPC, nicer UI. Every component file:

- `export default function Name({ nou, ... })`. `nou` is the object returned by `useNou()` (source given below).
- Imports: React hooks from 'react'; `cn` from '@/lib/utils'; helpers from '@/lib/text'
  (fmtTime, countWords, oneLine, lint, Inline, host, eastern, cleanErr, fileUrl); icons from 'lucide-react';
  shadcn/ui from '@/components/ui/<name>' (available: button {Button}, tabs {Tabs,TabsList,TabsTrigger,TabsContent},
  select {Select,SelectTrigger,SelectValue,SelectContent,SelectItem}, textarea {Textarea}, badge {Badge},
  tooltip {Tooltip,TooltipTrigger,TooltipContent}, dialog {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter},
  scroll-area {ScrollArea}, separator {Separator}, toggle-group {ToggleGroup,ToggleGroupItem}).
  Button variants: default (gold fill, ONLY for Approve), secondary, outline, ghost; sizes: default, sm, icon.
- Main process API: `window.nou` = list(), load(id,version), approve(id,version,note), save(id,version,edits),
  exportClap(id,version), reveal(path), open(path), onChange(fn), attach(), ask(req), fetchPages(req), digest(req),
  research(req), media(id), files(id), mediaAttach(id,url), mediaOpen(id,url). Same request/response shapes as REFERENCE uses.
- Tailwind v4 utility classes. Theme colours: background, foreground, card, muted, muted-foreground, primary (gold),
  secondary, border, nou (violet), gold, ok (green), faint, rail, chrome, sidebar, destructive. Fonts: font-sans,
  font-read (the spoken script), font-mono (time codes). Radii: rounded-lg = 10 px surfaces, rounded-md = 6 px controls.
- Design rules (design/premium_brief.md): true neutral greys; gold only for Approve and the current selection; violet
  = Nou / VO; status and segment tags are coloured uppercase 10 px tracked text, never boxed pills; hierarchy by weight
  and surface steps, not outlines; numbers tabular; time codes monospace; every control has hover + focus-visible
  states; nothing clips or wraps at 1280 x 860; text truncates with ellipsis instead of widening the window.
- Plain text only in UI copy. No emojis. Keep the exact user-facing wording from REFERENCE unless the spec says otherwise.
- Output ONLY the complete file content. No markdown fences, no commentary.
