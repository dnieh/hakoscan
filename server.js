const express = require('express');
const path = require('node:path');
const { SENSORS, FAULT_CODES, REGISTER_NAMES, FLAG_REGISTERS } = require('./src/sensors');
const { lookupEcu } = require('./src/ecu-db');
const { lookupProfile } = require('./src/profile');

const MOCK = process.env.MOCK === '1';
const PORT = process.env.PORT || 3100;

// Two connection types share the port: 'consult' (the grey 14-pin port,
// Consult I protocol) and 'obd' (an ELM327 adapter on the 16-pin OBDII port,
// used for I/M readiness on 1996+ cars). The mock client answers both.
let client = MOCK ? new (require('./src/mock').MockConsultClient)() : null;
let clientType = MOCK ? 'consult' : null;

const requireClient = () => {
  if (!client || !client.connected) throw new Error('Not connected');
  return client;
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/ports', handle(async () => {
  if (MOCK) return [{ path: '/dev/mock-ecu', manufacturer: 'Mock ECU' }];
  const { SerialPort } = require('serialport');
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer || '',
  }));
}));

app.get('/api/status', handle(async () => ({
  connected: !!client && client.connected,
  streaming: !!client && client.streaming,
  type: client && client.connected ? clientType : null,
  mock: MOCK,
})));

app.get('/api/sensors', handle(async () =>
  SENSORS.map(({ id, name, unit, regs }) => ({ id, name, unit, bytes: regs.length }))
));

// Probe every register and report which ones this ECU actually answers.
// A register that returns 0xFF in every sample is treated as unsupported.
//
// Streamed over Server-Sent Events, one event per register, because a deep
// scan takes minutes: buffering the whole result and replying at the end
// leaves the connection idle long enough for a proxy/keep-alive idle timeout
// to drop it mid-scan (truncating the result to whatever finished in ~60s).
// Emitting each result as it's probed keeps bytes flowing and shows progress.
app.get('/api/scan', (req, res) => {
  let c;
  try {
    c = requireConsult();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Documented registers run to 0x53; a deep scan probes the whole address
  // space (0x00–0xFF) to discover undocumented registers, at the cost of time
  // (every unsupported address costs its own timeout).
  const deep = req.query.deep === '1' || req.query.deep === 'true';
  const LAST = deep ? 0xff : 0x53;
  const entry = (reg, samples) => ({
    reg,
    name: REGISTER_NAMES[reg] || null,
    samples,
    supported: samples.length > 0 && samples.some((b) => b !== 0xff),
  });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  let aborted = false;
  req.on('close', () => { aborted = true; });

  (async () => {
    // Probe one register at a time. A register the ECU won't ack throws, but
    // sampleRegisters always drains the ECU back to silence first, so each
    // probe is isolated — a bad address only costs its own timeout. Stop early
    // if the client disconnects so we don't keep hammering the ECU for nothing.
    for (let reg = 0; reg <= LAST && !aborted; reg++) {
      let result;
      try {
        const frames = await c.sampleRegisters([reg], 3, 700);
        result = entry(reg, frames.map((f) => f[0]));
      } catch {
        result = entry(reg, []);
      }
      res.write(`data: ${JSON.stringify(result)}\n\n`);
    }
    if (!aborted) res.write(`event: done\ndata: ${JSON.stringify({ total: LAST + 1 })}\n\n`);
    res.end();
  })();
});

app.post('/api/connect', handle(async (req) => {
  const { path: portPath, type = 'consult' } = req.body;
  if (!portPath) throw new Error('No port selected');
  if (client) await client.disconnect();
  if (!MOCK) {
    client = type === 'obd'
      ? new (require('./src/elm327').Elm327Client)()
      : new (require('./src/consult').ConsultClient)();
  }
  clientType = type;
  await client.connect(portPath);
  return { connected: true, type: clientType };
}));

app.post('/api/disconnect', handle(async () => {
  if (client) await client.disconnect();
  return { connected: false };
}));

// Connection diagnostic: send the Consult init at several baud rates and
// report exactly what the ECU returns at each, to distinguish silence
// (wiring/sequence) from garbage (baud mismatch) from a non-0x10 ack.
app.post('/api/probe', handle(async (req) => {
  const { path: portPath } = req.body;
  if (!portPath) throw new Error('No port selected');
  if (MOCK) return [{ baud: 9600, bytes: ['10'], gotAck: true }];
  if (client && client.connected) throw new Error('Disconnect before running a probe');
  const { ConsultClient } = require('./src/consult');
  return new ConsultClient().probe(portPath);
}));

const requireConsult = () => {
  const c = requireClient();
  if (clientType !== 'consult') throw new Error('This needs a Consult connection (not OBDII)');
  return c;
};

app.get('/api/ecu', handle(async () => {
  const info = await requireConsult().readPartNumber();
  return {
    ...info,
    model: lookupEcu(info.partNumber),
    profile: lookupProfile(info.partNumber),
  };
}));

// I/M readiness (SRT) over OBDII — Consult I has no public readiness command,
// so this requires an ELM327 connection. The mock client supports it too.
app.get('/api/readiness', handle(async () => {
  const c = requireClient();
  if (!c.readReadiness) throw new Error('Readiness needs an OBDII (ELM327) connection');
  return c.readReadiness();
}));

const describeFaults = (faults) =>
  faults.map((f) => ({
    ...f,
    description: FAULT_CODES[f.code] || `Unknown code ${f.code}`,
    ok: f.code === 55,
  }));

app.get('/api/faults', handle(async () => describeFaults(await requireConsult().readFaults())));

app.post('/api/faults/clear', handle(async () => describeFaults(await requireConsult().eraseFaults())));

// Live data over Server-Sent Events. Opening this endpoint starts the ECU
// stream for the requested numeric sensors and bit-flag registers; closing
// the connection stops it. Both kinds share one stream since the ECU only
// streams a single registered set at a time.
app.get('/api/live', async (req, res) => {
  const ids = (req.query.sensors || '').split(',').filter(Boolean);
  const selected = SENSORS.filter((s) => ids.includes(s.id));
  const flagRegs = (req.query.flags || '')
    .split(',')
    .filter(Boolean)
    .map((r) => parseInt(r, 16))
    .filter((r) => FLAG_REGISTERS.some((f) => f.reg === r));
  if (!selected.length && !flagRegs.length)
    return res.status(400).json({ error: 'Nothing selected' });
  if (!client || !client.connected || clientType !== 'consult')
    return res.status(400).json({ error: 'Not connected via Consult' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Flatten register lists; each frame byte maps back to its sensor/flag in
  // order. Numeric sensors first, then one byte per flag register.
  const registers = [...selected.flatMap((s) => s.regs), ...flagRegs];

  const onFrame = (frame) => {
    const values = {};
    let offset = 0;
    for (const s of selected) {
      const bytes = [...frame.subarray(offset, offset + s.regs.length)];
      offset += s.regs.length;
      values[s.id] = +s.convert(...bytes).toFixed(s.decimals);
    }
    const flags = {};
    for (const reg of flagRegs) flags[reg] = frame[offset++];
    res.write(`data: ${JSON.stringify({ t: Date.now(), values, flags })}\n\n`);
  };

  const onStreamError = (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  };
  client.on('streamError', onStreamError);

  req.on('close', async () => {
    client.off('streamError', onStreamError);
    await client.stopStream().catch(() => {});
  });

  try {
    await client.startStream(registers, onFrame);
  } catch (err) {
    onStreamError(err);
  }
});

app.get('/api/flag-defs', handle(async () => FLAG_REGISTERS));

// Start the HTTP server. Returns a promise that resolves once it's listening,
// so the Electron wrapper knows when it's safe to load the window. Still works
// as a plain CLI server (`node server.js`) via the require.main check below.
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const actualPort = server.address().port;
      console.log(
        `Nissan Consult dashboard ${MOCK ? '(MOCK MODE) ' : ''}at http://localhost:${actualPort}`
      );
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${PORT} is already in use. Set PORT=... to use another.`
        : err.message
    );
    process.exit(1);
  });
}

module.exports = { app, start };
