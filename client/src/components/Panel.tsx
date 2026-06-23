import { type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// The original .panel: a card with an uppercase muted title row and optional
// right-aligned actions.
export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="mb-3 flex items-baseline">
        <h2 className="m-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {actions ? <span className="ml-auto">{actions}</span> : null}
      </div>
      {children}
    </Card>
  );
}
