import { useState } from 'react';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { api, postJson, type Fault } from '@/lib/api';
import { useApp } from '@/state/AppState';

export function FaultsTab() {
  const { connection, claimStream, setMsg } = useApp();
  const consult = connection.connected && connection.type === 'consult';

  const [faults, setFaults] = useState<Fault[] | null>(null);

  const read = async () => {
    claimStream(null); // stop any live/raw stream sharing the serial
    try {
      setFaults(await api<Fault[]>('/api/faults'));
    } catch (e) {
      setMsg((e as Error).message, true);
    }
  };

  const clear = async () => {
    claimStream(null);
    try {
      setFaults(await postJson<Fault[]>('/api/faults/clear'));
      setMsg('Fault codes cleared.');
    } catch (e) {
      setMsg((e as Error).message, true);
    }
  };

  return (
    <Panel title="Fault codes">
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <Button variant="outline" onClick={read} disabled={!consult}>
          Read codes
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={!consult}>
              Clear codes
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Erase all stored fault codes?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears all stored fault codes from the ECU. This can't be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={clear}>Erase codes</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {faults !== null && (
        <ul className="m-0 list-none p-0">
          {faults.length === 0 ? (
            <li className="py-2">No data returned</li>
          ) : (
            faults.map((f, i) => (
              <li
                key={i}
                className="flex gap-3 border-b border-border px-1 py-2 tabular-nums last:border-b-0"
              >
                <span
                  className={cn(
                    'w-9 font-bold',
                    f.ok ? 'text-[hsl(var(--ok))]' : 'text-[hsl(var(--warn))]',
                  )}
                >
                  {f.code}
                </span>
                <span>{f.description}</span>
                <span className="ml-auto text-sm text-muted-foreground">
                  {f.ok ? '' : `${f.startsSinceSeen} starts since seen`}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </Panel>
  );
}
