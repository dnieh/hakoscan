import { useEffect, useRef, useState } from 'react';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Sparkline, type Point } from '@/components/Sparkline';
import { cn } from '@/lib/utils';
import type { RawFrame } from '@/lib/api';
import { useEventStream } from '@/lib/useEventStream';
import { useApp } from '@/state/AppState';

const hx = (b: number) => '0x' + b.toString(16).padStart(2, '0').toUpperCase();

interface RegState {
  last: number;
  min: number;
  max: number;
  changedAt: number;
  history: Point[];
}

// Parse the text input into a unique, ordered list of byte addresses (hex).
function parseRawRegs(text: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const tok of text.split(/[\s,]+/)) {
    if (!tok) continue;
    const n = parseInt(tok, 16);
    if (Number.isInteger(n) && n >= 0 && n <= 0xff && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function RawTab() {
  const { connection, registerNames, scan, claimStream, streamOwner, setMsg } =
    useApp();
  const consult = connection.connected && connection.type === 'consult';

  const [input, setInput] = useState('');
  const [watching, setWatching] = useState(false);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [regs, setRegs] = useState<number[]>([]);
  const [state, setState] = useState<Record<number, RegState>>({});
  const [recording, setRecording] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [status, setStatus] = useState('');

  // Refs read inside the SSE handler (which closes over the first render).
  const regsRef = useRef<number[]>([]);
  const recordingRef = useRef(false);
  const samplesRef = useRef<Array<{ t: number; values: Record<number, number> }>>([]);
  regsRef.current = regs;
  recordingRef.current = recording;

  // Another tab claimed the single ECU stream — tear our watch down.
  useEffect(() => {
    if (streamOwner !== 'raw' && watching) {
      setRawUrl(null);
      setWatching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamOwner]);

  useEventStream(rawUrl, {
    onMessage: (d: RawFrame) => {
      const ts = d.t || Date.now();
      if (recordingRef.current) {
        samplesRef.current.push({ t: ts, values: d.values });
        setSampleCount(samplesRef.current.length);
        setStatus(`Recording… ${samplesRef.current.length} samples`);
      }
      setState((prev) => {
        const next = { ...prev };
        for (const reg of regsRef.current) {
          const v = d.values[reg];
          if (v == null) continue;
          const cur = next[reg];
          const st: RegState = cur
            ? { ...cur, history: cur.history.slice() }
            : { last: v, min: v, max: v, changedAt: 0, history: [] };
          if (v !== st.last) st.changedAt = Date.now();
          st.last = v;
          st.min = Math.min(st.min, v);
          st.max = Math.max(st.max, v);
          st.history.push({ t: ts, v });
          if (st.history.length > 120) st.history.shift();
          next[reg] = st;
        }
        return next;
      });
    },
    onError: (info) => {
      if (info.serverError) setMsg('Raw watch error: ' + info.serverError.error, true);
      else if (info.closed) {
        setMsg('Raw watch stream closed', true);
        setWatching(false);
        setRawUrl(null);
      }
    },
  });

  const watch = () => {
    const parsed = parseRawRegs(input);
    if (!parsed.length) return setMsg('Enter at least one register (hex)', true);
    if (parsed.length > 20)
      return setMsg('At most 20 registers — the ECU streams 20 bytes per frame', true);
    claimStream('raw'); // one serial operation at a time
    setRegs(parsed);
    setState({});
    samplesRef.current = [];
    setSampleCount(0);
    setWatching(true);
    setStatus('');
    setRawUrl('/api/raw?regs=' + parsed.map((r) => r.toString(16)).join(','));
    setMsg(
      `Watching ${parsed.length} register${parsed.length === 1 ? '' : 's'}: ` +
        parsed.map(hx).join(' '),
    );
  };

  const stop = () => {
    setRawUrl(null);
    setWatching(false);
    if (streamOwner === 'raw') claimStream(null);
    setMsg('Raw watch stopped.');
  };

  const reset = () => {
    setState({});
    samplesRef.current = [];
    setSampleCount(0);
    setStatus(recording ? 'Recording… 0 samples' : '');
  };

  // Fill the input with responding-but-undocumented registers from the last
  // scan — the prime suspects for an unmapped channel — capped at 20.
  const fromScan = () => {
    if (!scan) return setMsg('Run a register scan first (Register scan tab).', true);
    const suspects = scan.registers
      .filter((r) => r.supported && !r.name)
      .map((r) => r.reg);
    if (!suspects.length)
      return setMsg('No undocumented responders in the last scan.', true);
    const capped = suspects.slice(0, 20);
    setInput(capped.map((r) => r.toString(16)).join(', '));
    setMsg(
      `Filled ${capped.length} undocumented responder${capped.length === 1 ? '' : 's'}` +
        (suspects.length > 20 ? ` (of ${suspects.length}; capped at 20)` : '') +
        '.',
    );
  };

  const toggleRecord = (checked: boolean) => {
    setRecording(checked);
    setStatus(
      checked
        ? `Recording… ${samplesRef.current.length} samples`
        : samplesRef.current.length
          ? `${samplesRef.current.length} samples recorded`
          : '',
    );
  };

  const downloadCsv = () => {
    if (!samplesRef.current.length) return;
    const header = ['t_ms', 'iso', ...regs.map(hx)].join(',');
    const rows = samplesRef.current.map((s) =>
      [s.t, new Date(s.t).toISOString(), ...regs.map((r) => s.values[r] ?? '')].join(','),
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raw-watch-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel
      title="Raw watch"
      actions={
        <button
          className="text-sm text-muted-foreground underline hover:text-foreground"
          onClick={fromScan}
          title="Fill in the registers that responded in the last scan but have no documented name — the prime suspects for undocumented channels (capped at 20)."
        >
          From last scan
        </button>
      }
    >
      <p className="m-0 mb-3.5 max-w-[760px] text-sm text-muted-foreground">
        Stream arbitrary registers as raw bytes to reverse-engineer unmapped
        channels. Enter addresses (hex, comma-separated), Watch, then induce a
        known change and see which byte moves — e.g. rock the car for a G-sensor,
        blip the throttle for front-torque split, roll for wheel speeds.
      </p>

      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && consult) watch();
          }}
          placeholder="e.g. 29, 2a, 33, b0, b1"
          autoComplete="off"
          className="min-w-[240px] flex-1 font-mono"
        />
        <Button onClick={watch} disabled={!consult || watching}>
          Watch
        </Button>
        <Button variant="outline" onClick={stop} disabled={!watching}>
          Stop
        </Button>
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-muted-foreground">
          <Checkbox checked={recording} onCheckedChange={(v) => toggleRecord(v === true)} />
          Record samples
        </label>
        <Button
          variant="outline"
          onClick={downloadCsv}
          disabled={sampleCount === 0}
          title="Download the recorded samples as CSV for offline correlation."
        >
          Download CSV
        </Button>
        <Button
          variant="outline"
          onClick={reset}
          disabled={regs.length === 0}
          title="Clear min/max ranges and recorded samples."
        >
          Reset
        </Button>
        <span className="text-sm text-muted-foreground">{status}</span>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
        {regs.map((reg) => {
          const st = state[reg];
          const name = registerNames[reg];
          const changed = st ? Date.now() - st.changedAt < 400 : false;
          return (
            <div
              key={reg}
              className={cn(
                'rounded-lg border bg-[hsl(217_17%_7%)] px-3.5 py-3 transition-colors',
                changed ? 'border-primary' : 'border-border',
              )}
            >
              <div className="flex items-baseline gap-2 font-mono text-xs text-muted-foreground">
                {hx(reg)}
                {name ? <span className="font-sans">{name}</span> : null}
              </div>
              <div className="text-3xl font-bold tabular-nums">
                {st ? st.last : '–'}
                <small className="ml-1.5 font-mono text-sm font-normal text-muted-foreground">
                  {st ? hx(st.last) : ''}
                </small>
              </div>
              <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {st
                  ? `min ${st.min} · max ${st.max} · span ${st.max - st.min}`
                  : 'min – · max –'}
              </div>
              <Sparkline
                data={st?.history ?? []}
                variant="raw"
                className="mt-1.5 block h-9 w-full"
              />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
