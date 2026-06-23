import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, postJson, type ConnType, type EcuInfo } from '@/lib/api';
import { useApp } from '@/state/AppState';

export function ConnectionTab() {
  const {
    ports,
    reloadPorts,
    connection,
    setConnected,
    setEcu,
    applyProfile,
    setMsg,
  } = useApp();

  // Preselect anything that looks like a USB-serial adapter.
  const usbDefault =
    ports.find((p) => /usb/i.test(p.path + p.manufacturer))?.path ??
    ports[0]?.path ??
    '';
  const [selectedPort, setSelectedPort] = useState(usbDefault);
  const [connType] = useState<ConnType>('consult');

  const port = selectedPort || usbDefault;

  const refresh = async () => {
    try {
      await reloadPorts();
    } catch (e) {
      setMsg((e as Error).message, true);
    }
  };

  const connect = async () => {
    setMsg(connType === 'obd' ? 'Connecting to ELM327…' : 'Connecting + initializing ECU…');
    try {
      await postJson('/api/connect', { path: port, type: connType });
      setConnected(true, connType);
      setMsg('Connected.');
      if (connType === 'consult') {
        try {
          const ecu = await api<EcuInfo>('/api/ecu');
          setEcu(ecu);
          applyProfile(ecu.profile);
        } catch {
          /* part number read is best-effort */
        }
      }
    } catch (e) {
      setMsg((e as Error).message, true);
    }
  };

  const disconnect = async () => {
    await postJson('/api/disconnect').catch(() => {});
    setConnected(false);
    setEcu(null);
    setMsg('Disconnected.');
  };

  return (
    <Panel title="Connection">
      <div className="flex flex-wrap items-center gap-2.5">
        <Select value={port} onValueChange={setSelectedPort}>
          <SelectTrigger className="min-w-[280px] max-w-[420px]">
            <SelectValue placeholder="No serial ports found" />
          </SelectTrigger>
          <SelectContent>
            {ports.length === 0 ? (
              <SelectItem value="" disabled>
                No serial ports found
              </SelectItem>
            ) : (
              ports.map((p) => (
                <SelectItem key={p.path} value={p.path}>
                  {p.path}
                  {p.manufacturer ? ' — ' + p.manufacturer : ''}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <Select value={connType} disabled>
          <SelectTrigger className="w-auto" title="Consult: grey 14-pin port.">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="consult">Consult (14-pin)</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="icon" onClick={refresh} title="Rescan serial ports">
          <RotateCw />
        </Button>
        <Button onClick={connect} disabled={connection.connected}>
          Connect
        </Button>
        <Button variant="outline" onClick={disconnect} disabled={!connection.connected}>
          Disconnect
        </Button>
      </div>
    </Panel>
  );
}
