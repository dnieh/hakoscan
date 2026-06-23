import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  type ConnType,
  type EcuInfo,
  type EcuProfile,
  type FlagDef,
  type Port,
  type RegisterNames,
  type ScanRow,
  type Sensor,
  type Status,
} from '@/lib/api';

export const DEFAULT_SENSORS = ['rpm', 'coolant', 'tps', 'battery', 'o2', 'timing'];

// live / raw / scan share the single ECU stream and are mutually exclusive;
// whichever tab claims it tears the others down (mirrors the
// stopStream/rawStop/stopScan calls scattered through the original UI).
export type StreamOwner = 'live' | 'raw' | 'scan' | null;

export interface ScanResult {
  deep: boolean;
  registers: ScanRow[];
}

interface Connection {
  connected: boolean;
  type: ConnType | null;
  mock: boolean;
}

interface AppStateValue {
  // Static data, loaded once.
  ports: Port[];
  reloadPorts: () => Promise<void>;
  sensors: Sensor[];
  flagDefs: FlagDef[];
  registerNames: Record<number, string>;

  // Connection.
  connection: Connection;
  setConnected: (connected: boolean, type?: ConnType | null) => void;

  // Cross-tab: ECU info + last scan feed export and "From last scan".
  ecu: EcuInfo | null;
  setEcu: (e: EcuInfo | null) => void;
  scan: ScanResult | null;
  setScan: (s: ScanResult | null) => void;

  // Cross-tab: sensor/flag selection (connect-time profile pre-selects them).
  selSensors: string[];
  setSelSensors: React.Dispatch<React.SetStateAction<string[]>>;
  selFlags: number[];
  setSelFlags: React.Dispatch<React.SetStateAction<number[]>>;
  applyProfile: (profile: EcuProfile | null) => void;

  // Global status message bar.
  msg: { text: string; error: boolean };
  setMsg: (text: string, error?: boolean) => void;

  // Single-stream ownership + bottom-right indicator.
  streamOwner: StreamOwner;
  claimStream: (owner: StreamOwner) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function useApp() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useApp must be used within AppStateProvider');
  return ctx;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [ports, setPorts] = useState<Port[]>([]);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [flagDefs, setFlagDefs] = useState<FlagDef[]>([]);
  const [registerNames, setRegisterNames] = useState<Record<number, string>>({});

  const [connection, setConnection] = useState<Connection>({
    connected: false,
    type: null,
    mock: false,
  });
  const [ecu, setEcu] = useState<EcuInfo | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);

  const [selSensors, setSelSensors] = useState<string[]>([]);
  const [selFlags, setSelFlags] = useState<number[]>([]);

  const [msgState, setMsgState] = useState<{ text: string; error: boolean }>({
    text: '',
    error: false,
  });
  const [streamOwner, setStreamOwner] = useState<StreamOwner>(null);

  const setMsg = useCallback((text: string, error = false) => {
    setMsgState({ text, error });
  }, []);

  const claimStream = useCallback((owner: StreamOwner) => {
    setStreamOwner(owner);
  }, []);

  const reloadPorts = useCallback(async () => {
    const list = await api<Port[]>('/api/ports');
    setPorts(list);
  }, []);

  const setConnected = useCallback(
    (connected: boolean, type: ConnType | null = null) => {
      setConnection((c) => ({ ...c, connected, type: connected ? type : null }));
      if (!connected) setStreamOwner(null);
    },
    [],
  );

  const applyProfile = useCallback(
    (profile: EcuProfile | null) => {
      if (!profile) return;
      if (profile.sensors) setSelSensors([...profile.sensors]);
      if (profile.flags) setSelFlags(profile.flags.map(Number));
      const nS = profile.sensors?.length ?? 0;
      const nF = profile.flags?.length ?? 0;
      setMsg(
        `Loaded preset for ${profile.name}: ${nS} sensors, ${nF} flag group${nF === 1 ? '' : 's'} selected.`,
      );
    },
    [setMsg],
  );

  // Bootstrap: load the static data, set selection defaults, then read status.
  // Mirrors the IIFE at the bottom of the original public/index.html.
  useEffect(() => {
    (async () => {
      try {
        const [portList, sensorList, flagList, names] = await Promise.all([
          api<Port[]>('/api/ports'),
          api<Sensor[]>('/api/sensors'),
          api<FlagDef[]>('/api/flag-defs'),
          api<RegisterNames>('/api/register-names'),
        ]);
        setPorts(portList);
        setSensors(sensorList);
        setFlagDefs(flagList);
        const numericNames: Record<number, string> = {};
        for (const [k, v] of Object.entries(names)) numericNames[+k] = v;
        setRegisterNames(numericNames);

        // Defaults: the documented default sensors, all flag registers checked.
        const available = new Set(sensorList.map((s) => s.id));
        setSelSensors(DEFAULT_SENSORS.filter((id) => available.has(id)));
        setSelFlags(flagList.map((f) => f.reg));

        const status = await api<Status>('/api/status');
        setConnection({
          connected: status.connected,
          type: status.connected ? status.type : null,
          mock: status.mock,
        });
        if (status.mock) {
          setMsg('Running in MOCK mode — simulated ECU, no car needed.');
        }
      } catch (e) {
        setMsg((e as Error).message, true);
      } finally {
        setReady(true);
      }
    })();
  }, [setMsg]);

  const value = useMemo<AppStateValue>(
    () => ({
      ports,
      reloadPorts,
      sensors,
      flagDefs,
      registerNames,
      connection,
      setConnected,
      ecu,
      setEcu,
      scan,
      setScan,
      selSensors,
      setSelSensors,
      selFlags,
      setSelFlags,
      applyProfile,
      msg: msgState,
      setMsg,
      streamOwner,
      claimStream,
    }),
    [
      ports,
      reloadPorts,
      sensors,
      flagDefs,
      registerNames,
      connection,
      setConnected,
      ecu,
      scan,
      selSensors,
      selFlags,
      applyProfile,
      msgState,
      setMsg,
      streamOwner,
      claimStream,
    ],
  );

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}
