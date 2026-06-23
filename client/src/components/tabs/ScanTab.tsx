import { useEffect, useRef, useState } from 'react';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ScanRow } from '@/lib/api';
import { useEventStream } from '@/lib/useEventStream';
import { useApp } from '@/state/AppState';

const hex = (b: number) => b.toString(16).padStart(2, '0').toUpperCase();

export function ScanTab() {
  const { connection, ecu, scan, setScan, claimStream, streamOwner } = useApp();
  const consult = connection.connected && connection.type === 'consult';

  const [scanning, setScanning] = useState(false);
  const [deep, setDeep] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [status, setStatus] = useState('');
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  // Set imperatively (not from render) because the server's `done` event and
  // the transport-close `error` fire back-to-back — a render-synced ref would
  // still read stale when `error` arrives and clobber the done summary.
  const scanningRef = useRef(false);
  const doneRef = useRef(false);

  const range = deep ? '0x00–0xFF' : '0x00–0x53';
  const total = deep ? 256 : 0x54;

  // Progress line while results stream in.
  useEffect(() => {
    if (!scanning) return;
    const scanned = rows.length;
    const responding = rows.filter((r) => r.supported).length;
    setStatus(
      `Scanning registers ${range}… ${scanned}/${total} probed, ${responding} responding` +
        ` (${deep ? 'several minutes' : 'about a minute'} — unsupported registers each time out).`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, scanning]);

  // Another tab claimed the single ECU stream — abort the scan.
  useEffect(() => {
    if (streamOwner !== 'scan' && scanning) {
      scanningRef.current = false;
      setScanUrl(null);
      setScanning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamOwner]);

  const finish = () => {
    scanningRef.current = false;
    setScanUrl(null);
    setScanning(false);
    if (streamOwner === 'scan') claimStream(null);
  };

  useEventStream(scanUrl, {
    onMessage: (r: ScanRow) => setRows((prev) => [...prev, r]),
    onNamed: {
      done: () => {
        doneRef.current = true;
        setRows((prev) => {
          const responding = prev.filter((r) => r.supported).length;
          const undoc = prev.filter((r) => r.supported && !r.name).length;
          setStatus(
            `${responding} of ${prev.length} registers respond on this ECU` +
              (undoc ? ` (${undoc} undocumented).` : '.'),
          );
          setScan({ deep, registers: prev });
          finish();
          return prev;
        });
      },
    },
    onError: () => {
      // A clean server-side end fires error right after `done`; ignore it.
      if (doneRef.current || !scanningRef.current) return;
      setRows((prev) => {
        setStatus(
          prev.length
            ? `Scan interrupted after ${prev.length} registers — connection lost.`
            : 'Scan failed: could not start.',
        );
        return prev;
      });
      finish();
    },
  });

  const runScan = (deepScan: boolean) => {
    claimStream('scan'); // one serial operation at a time; stops live/raw
    scanningRef.current = true;
    doneRef.current = false;
    setDeep(deepScan);
    setRows([]);
    setStatus('');
    setScanning(true);
    setScanUrl('/api/scan?deep=' + (deepScan ? 1 : 0));
  };

  // Export the completed scan + ECU part number as JSON, so a car with a
  // different ECU can be added as a profile.
  const exportMapping = () => {
    if (!scan) return;
    const partNumber = ecu?.partNumber ?? null;
    const mapping = {
      exportedAt: new Date().toISOString(),
      ecu: {
        partNumber,
        model: ecu?.model ?? null,
        profile: ecu?.profile ?? null,
      },
      scan: {
        deep: scan.deep,
        registers: scan.registers.map((r) => ({
          reg: r.reg,
          name: r.name || null,
          supported: r.supported,
          samples: r.samples,
        })),
      },
    };
    const blob = new Blob([JSON.stringify(mapping, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (partNumber || 'unknown-ecu').replace(/[^a-z0-9]+/gi, '-');
    a.href = url;
    a.download = `register-mapping-${slug}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel title="Register scan">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="outline" onClick={() => runScan(false)} disabled={scanning || !consult}>
          Scan ECU registers
        </Button>
        <Button
          variant="outline"
          onClick={() => runScan(true)}
          disabled={scanning || !consult}
          title="Probe the entire 0x00–0xFF address space to find undocumented registers. Slow — several minutes."
        >
          Deep scan
        </Button>
        <Button
          variant="outline"
          onClick={exportMapping}
          disabled={scanning || !scan}
          title="Download the scan results and ECU part number as JSON, to add this car as a profile."
        >
          Export mapping
        </Button>
        <span className="text-sm text-muted-foreground">{status}</span>
      </div>

      {(scanning || rows.length > 0) && (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Reg</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Samples (hex)</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.reg} className={cn(!r.supported && 'opacity-55')}>
                <TableCell className="font-mono">0x{hex(r.reg)}</TableCell>
                <TableCell>{r.name || '—'}</TableCell>
                <TableCell className="font-mono">{r.samples.map(hex).join(' ')}</TableCell>
                <TableCell>
                  <Badge variant={r.supported ? 'ok' : 'muted'}>
                    {r.supported ? 'responds' : 'no data'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
