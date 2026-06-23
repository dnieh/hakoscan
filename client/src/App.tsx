import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StreamIndicator } from '@/components/StreamIndicator';
import { useApp } from '@/state/AppState';
import { cn } from '@/lib/utils';
import { ConnectionTab } from '@/components/tabs/ConnectionTab';
import { LiveTab } from '@/components/tabs/LiveTab';
import { ScanTab } from '@/components/tabs/ScanTab';
import { RawTab } from '@/components/tabs/RawTab';
import { FaultsTab } from '@/components/tabs/FaultsTab';

const TABS = [
  { value: 'connection', label: 'Connection', Comp: ConnectionTab },
  { value: 'live', label: 'Live data', Comp: LiveTab },
  { value: 'scan', label: 'Register scan', Comp: ScanTab },
  { value: 'raw', label: 'Raw watch', Comp: RawTab },
  { value: 'faults', label: 'Fault codes', Comp: FaultsTab },
] as const;

function EcuInfo() {
  const { ecu } = useApp();
  if (!ecu?.partNumber) return null;
  const text =
    ecu.profile && ecu.model
      ? `ECU: ${ecu.partNumber} · ${ecu.model}`
      : `ECU: ${ecu.partNumber}`;
  return <span className="ml-auto text-sm text-muted-foreground">{text}</span>;
}

function StatusBadge() {
  const { connection, ecu } = useApp();
  const { connected, type } = connection;
  return (
    <div
      className={cn(
        'text-sm',
        connected ? 'text-[hsl(var(--ok))]' : 'text-muted-foreground',
        ecu?.partNumber ? 'ml-4' : 'ml-auto',
      )}
    >
      {connected
        ? `Connected (${type === 'obd' ? 'OBDII' : 'Consult'})`
        : 'Disconnected'}
    </div>
  );
}

function MessageBar() {
  const { msg } = useApp();
  if (!msg.text) return null;
  return (
    <p className={cn('m-0 text-sm', msg.error ? 'text-primary' : 'text-muted-foreground')}>
      {msg.text}
    </p>
  );
}

export function App() {
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <a href="/" title="Hakoscan" className="text-foreground no-underline">
          <h1 className="m-0 text-[17px] font-extrabold tracking-wider">
            HAKO<span className="text-primary">SCAN</span>
          </h1>
        </a>
        <EcuInfo />
        <StatusBadge />
      </header>

      <main className="mx-auto grid max-w-[1100px] gap-4 p-5">
        <Tabs defaultValue="connection" className="grid gap-4">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <MessageBar />

          {/* forceMount keeps every panel mounted (hidden when inactive) so an
              active stream survives tab switches, matching the original UI. */}
          {TABS.map(({ value, Comp }) => (
            <TabsContent key={value} value={value} forceMount className="data-[state=inactive]:hidden">
              <Comp />
            </TabsContent>
          ))}
        </Tabs>
      </main>

      <StreamIndicator />
    </div>
  );
}
