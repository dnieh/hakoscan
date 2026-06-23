import { useEffect, useState } from 'react';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sparkline, type Point } from '@/components/Sparkline';
import { cn } from '@/lib/utils';
import type { LiveFrame } from '@/lib/api';
import { useEventStream } from '@/lib/useEventStream';
import { useApp } from '@/state/AppState';

// The Consult protocol streams at most 20 data bytes per frame; 16-bit sensors
// use two, each flag register one.
const MAX_STREAM_BYTES = 20;

const hx = (b: number) => '0x' + b.toString(16).padStart(2, '0').toUpperCase();

export function LiveTab() {
  const {
    sensors,
    flagDefs,
    selSensors,
    setSelSensors,
    selFlags,
    setSelFlags,
    connection,
    streamOwner,
    claimStream,
    setMsg,
  } = useApp();

  const consult = connection.connected && connection.type === 'consult';

  const [view, setView] = useState<'grid' | 'rows'>('grid');
  const [streaming, setStreaming] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<Record<string, Point[]>>({});
  const [flagVals, setFlagVals] = useState<Record<number, number>>({});

  const sensorBytes = (id: string) => sensors.find((s) => s.id === id)?.bytes ?? 1;
  const usedBytes =
    selSensors.reduce((a, id) => a + sensorBytes(id), 0) + selFlags.length;

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (selSensors.length) params.set('sensors', selSensors.join(','));
    if (selFlags.length)
      params.set('flags', selFlags.map((r) => r.toString(16)).join(','));
    return '/api/live?' + params;
  };

  // Drop history for sensors that are no longer selected (re-selecting starts a
  // fresh trace), mirroring syncGauges in the original.
  useEffect(() => {
    setHistory((prev) => {
      const next: Record<string, Point[]> = {};
      for (const id of selSensors) if (prev[id]) next[id] = prev[id];
      return next;
    });
  }, [selSensors]);

  // Re-subscribe when the selection changes mid-stream so newly-ticked items
  // get data; stop cleanly if it became empty or over budget.
  useEffect(() => {
    if (!streaming) return;
    const hasSel = selSensors.length || selFlags.length;
    if (hasSel && usedBytes <= MAX_STREAM_BYTES) {
      setStreamUrl(buildUrl());
    } else {
      setStreamUrl(null);
      setStreaming(false);
      claimStream(null);
      setMsg('Stream stopped — selection is empty or over the byte budget.', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selSensors, selFlags]);

  // Another tab (raw/scan) claimed the single ECU stream — tear ours down.
  useEffect(() => {
    if (streamOwner !== 'live' && streaming) {
      setStreamUrl(null);
      setStreaming(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamOwner]);

  useEventStream(streamUrl, {
    onMessage: (d: LiveFrame) => {
      const ts = d.t || Date.now();
      setValues(d.values || {});
      setHistory((prev) => {
        const next = { ...prev };
        for (const [id, v] of Object.entries(d.values || {})) {
          const arr = next[id] ? next[id].slice() : [];
          arr.push({ t: ts, v });
          if (arr.length > 120) arr.shift();
          next[id] = arr;
        }
        return next;
      });
      setFlagVals(d.flags || {});
    },
    onError: (info) => {
      if (info.serverError) setMsg('Stream error: ' + info.serverError.error, true);
      else if (info.closed) {
        setMsg('Stream closed', true);
        setStreaming(false);
      }
    },
  });

  const toggleSensor = (id: string, checked: boolean) =>
    setSelSensors((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  const toggleFlag = (reg: number, checked: boolean) =>
    setSelFlags((prev) => (checked ? [...prev, reg] : prev.filter((x) => x !== reg)));

  const setAll = (checked: boolean) => {
    setSelSensors(checked ? sensors.map((s) => s.id) : []);
    setSelFlags(checked ? flagDefs.map((f) => f.reg) : []);
  };

  const start = () => {
    if (!selSensors.length && !selFlags.length)
      return setMsg('Select at least one item', true);
    if (usedBytes > MAX_STREAM_BYTES)
      return setMsg(
        `Too much selected: the ECU streams at most ${MAX_STREAM_BYTES} bytes — deselect a few`,
        true,
      );
    claimStream('live'); // raw watch and live data share the single ECU stream
    setStreamUrl(buildUrl());
    setStreaming(true);
  };

  const stop = () => {
    setStreamUrl(null);
    setStreaming(false);
    if (streamOwner === 'live') claimStream(null);
    setMsg('Stopped.');
  };

  const selectedSensors = sensors.filter((s) => selSensors.includes(s.id));
  const selectedFlagDefs = flagDefs.filter((f) => selFlags.includes(f.reg));
  const dimmed = !streaming;

  return (
    <Panel
      title="Live data"
      actions={
        <span className="text-sm normal-case tracking-normal">
          <button
            className="text-muted-foreground underline hover:text-foreground"
            onClick={() => setAll(true)}
          >
            Select all
          </button>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <button
            className="text-muted-foreground underline hover:text-foreground"
            onClick={() => setAll(false)}
          >
            Clear all
          </button>
        </span>
      }
    >
      {/* Sensor picker */}
      <div className="mb-3.5 flex flex-wrap gap-x-4 gap-y-2">
        {sensors.map((s) => {
          const checked = selSensors.includes(s.id);
          const disabled = !checked && usedBytes + s.bytes > MAX_STREAM_BYTES;
          return (
            <label
              key={s.id}
              className={cn(
                'flex cursor-pointer select-none items-center gap-1.5 text-sm text-muted-foreground',
                disabled && 'cursor-default opacity-40',
              )}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => toggleSensor(s.id, v === true)}
              />
              {s.name}
            </label>
          );
        })}
      </div>

      <div className="mb-2 border-t border-border pt-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        Switches &amp; flags
      </div>
      <div className="mb-3.5 flex flex-wrap gap-x-4 gap-y-2">
        {flagDefs.map((f) => {
          const checked = selFlags.includes(f.reg);
          const disabled = !checked && usedBytes + 1 > MAX_STREAM_BYTES;
          return (
            <label
              key={f.reg}
              className={cn(
                'flex cursor-pointer select-none items-center gap-1.5 text-sm text-muted-foreground',
                disabled && 'cursor-default opacity-40',
              )}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => toggleFlag(f.reg, v === true)}
              />
              {f.name}
            </label>
          );
        })}
      </div>

      {/* Controls */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <Button onClick={start} disabled={!consult || streaming}>
          Start
        </Button>
        <Button variant="outline" onClick={stop} disabled={!streaming}>
          Stop
        </Button>
        <span
          className={cn(
            'text-sm',
            usedBytes > MAX_STREAM_BYTES
              ? 'font-semibold text-primary'
              : 'text-muted-foreground',
          )}
        >
          {usedBytes}/{MAX_STREAM_BYTES} stream bytes
        </span>
        <span
          className={cn(
            'ml-auto inline-flex overflow-hidden rounded-md border border-border',
            dimmed && 'opacity-50',
          )}
          role="group"
          aria-label="Chart layout"
        >
          <button
            className={cn(
              'flex items-center justify-center px-2 py-1',
              view === 'grid'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
            title="Grid view — compact sparklines"
          >
            <LayoutGrid className="h-[15px] w-[15px]" />
          </button>
          <button
            className={cn(
              'flex items-center justify-center border-l border-border px-2 py-1',
              view === 'rows'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setView('rows')}
            aria-pressed={view === 'rows'}
            title="Row view — full-width charts with axes"
          >
            <Rows3 className="h-[15px] w-[15px]" />
          </button>
        </span>
      </div>

      {/* Gauges */}
      <div
        className={cn(
          'grid gap-3',
          view === 'rows'
            ? 'grid-cols-1'
            : '[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]',
          dimmed && 'opacity-50',
        )}
      >
        {selectedSensors.map((s) => (
          <div
            key={s.id}
            className="rounded-lg border border-border bg-[hsl(217_17%_7%)] px-3.5 py-3"
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {s.name}
            </div>
            <div className="text-3xl font-bold tabular-nums">
              {values[s.id] ?? '–'}
              <small className="ml-1 text-sm font-normal text-muted-foreground">
                {s.unit}
              </small>
            </div>
            <Sparkline
              data={history[s.id] ?? []}
              variant={view === 'rows' ? 'row' : 'mini'}
              unit={s.unit}
              className={cn('mt-1.5 block w-full', view === 'rows' ? 'h-[150px]' : 'h-9')}
            />
          </div>
        ))}
      </div>

      {/* Flag chips */}
      {selectedFlagDefs.length > 0 && (
        <div className={cn('mt-4', dimmed && 'opacity-50')}>
          {selectedFlagDefs.map((f) => {
            const byte = flagVals[f.reg] ?? 0;
            return (
              <div key={f.reg} className="mb-4">
                <h3 className="m-0 mb-2 text-sm font-semibold">
                  {f.name}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                    {hx(f.reg)} = {hx(byte)}
                  </span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(f.bits).map(([bit, label]) => {
                    const on = (byte & (1 << Number(bit))) !== 0;
                    return (
                      <div
                        key={bit}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border bg-[hsl(217_17%_7%)] px-3 py-1.5 text-sm transition-colors',
                          on
                            ? 'border-[hsl(var(--ok))] text-foreground'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        <span
                          className={cn(
                            'h-2.5 w-2.5 rounded-full',
                            on
                              ? 'bg-[hsl(var(--ok))] shadow-[0_0_6px_hsl(var(--ok))]'
                              : 'bg-border',
                          )}
                        />
                        {label}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
