import { cn } from '@/lib/utils';
import { useApp } from '@/state/AppState';

// Fixed bottom-right pill that pulses while live/raw data is streaming.
export function StreamIndicator() {
  const { streamOwner } = useApp();
  const on = streamOwner === 'live' || streamOwner === 'raw';
  return (
    <div
      className={cn(
        'fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-sm shadow-lg backdrop-blur',
        'bg-card/90',
        on ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-2.5 w-2.5 rounded-full transition-colors',
          on
            ? 'animate-stream-pulse bg-[hsl(var(--ok))]'
            : 'bg-muted-foreground',
        )}
      />
      <span>{on ? 'Streaming' : 'Not streaming'}</span>
    </div>
  );
}
