import { useMemo } from 'react';
import { BookOpen, Image, FileText, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const PANELS = [
  { key: 'stories', label: 'Stories', icon: BookOpen, count: null },
  { key: 'media', label: 'Media sources', icon: Image, count: (nou) => nou.media?.length ?? 0 },
  { key: 'desk', label: 'Desk', icon: FileText, count: (nou) => nou.files?.desk?.length ?? 0 },
  { key: 'sources', label: 'Sources', icon: Link2, count: (nou) => nou.files?.sources?.length ?? 0 },
];

export default function IconRail({ nou }) {
  const panels = useMemo(() => PANELS.map((p) => ({
    ...p,
    count: p.count ? p.count(nou) : 0,
    active: nou.panel === p.key && !nou.railCollapsed,
  })), [nou.panel, nou.railCollapsed, nou.media?.length, nou.files?.desk?.length, nou.files?.sources?.length]);

  return (
    <nav
      className={cn(
        'flex flex-col items-center border-r bg-rail',
        'w-[56px] h-full shrink-0',
        'pt-3 gap-1',
        'transition-all duration-200'
      )}
      aria-label="Sections"
      role="navigation"
    >
      {panels.map(({ key, label, icon: Icon, count, active }) => (
        <Tooltip key={key} delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'relative w-[38px] h-[38px] rounded-md',
                'text-muted-foreground',
                'hover:bg-card hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-rail',
                'transition-colors duration-150',
                active && 'bg-secondary text-foreground',
                'before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[2px] before:h-3/4 before:rounded-r before:bg-transparent',
                active && 'before:bg-gold'
              )}
              onClick={() => nou.setPanel(key)}
              aria-label={label}
              aria-pressed={active}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              {count > 0 && (
                <span
                  className={cn(
                    'absolute -top-1 -right-1',
                    'min-w-[18px] h-4',
                    'rounded-full',
                    'bg-muted text-[9px] font-mono tabular-nums',
                    'flex items-center justify-center px-1',
                    'pointer-events-none',
                    active && 'bg-gold text-primary-foreground',
                    'transition-colors duration-150'
                  )}
                  aria-label={`${count} ${label.toLowerCase()}`}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-sm font-medium">{label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}
