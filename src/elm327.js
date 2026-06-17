// ELM327 (OBDII) client, used for things the Consult I port can't do —
// notably I/M readiness monitors (SRT) on 1996+ USDM cars, read via the
// standard Mode 01 PID 01 query. The adapter is a USB serial device; Nissans
// of this era talk ISO 9141-2, which the ELM327 negotiates automatically.

const { EventEmitter } = require('node:events');

class Elm327Client extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.buf = '';
    this.streaming = false; // parity with ConsultClient's interface
  }

  get connected() {
    return !!this.port && this.port.isOpen;
  }

  async connect(path) {
    let lastErr = new Error('no baud rates tried');
    for (const baudRate of [38400, 115200, 9600]) {
      try {
        await this._open(path, baudRate);
        const id = await this._cmd('ATZ', 4000); // reset, prints "ELM327 vX.X"
        if (!/ELM327/i.test(id)) throw new Error('no ELM327 banner');
        await this._cmd('ATE0', 2000); // echo off
        await this._cmd('ATSP0', 2000); // auto-detect protocol
        return;
      } catch (err) {
        lastErr = err;
        await this.disconnect();
      }
    }
    throw new Error(`ELM327 not responding on any baud rate (${lastErr.message})`);
  }

  async disconnect() {
    if (this.port) {
      const p = this.port;
      this.port = null;
      if (p.isOpen) await new Promise((resolve) => p.close(() => resolve()));
    }
    this.buf = '';
  }

  async stopStream() {} // interface parity; ELM mode has no consult stream

  // Mode 01 PID 01: MIL status, DTC count, and I/M readiness monitors.
  async readReadiness() {
    // First query after connect triggers the slow ISO 9141 bus init
    // ("SEARCHING..." can take ~10s).
    const resp = await this._cmd('0101', 20000);
    if (/UNABLE TO CONNECT|NO DATA|BUS INIT.*ERROR/i.test(resp)) {
      throw new Error(`OBD bus error: ${resp.replace(/\s+/g, ' ').trim()} — is the ignition on?`);
    }
    const hex = resp.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    const at = hex.indexOf('4101');
    if (at < 0) throw new Error(`Unexpected readiness response: ${resp.trim()}`);
    const bytes = [];
    for (let i = at + 4; i + 1 < hex.length && bytes.length < 4; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    if (bytes.length < 4) throw new Error('Short readiness response');
    const [a, b, c, d] = bytes;

    const monitors = [
      // Continuous monitors: supported in B bits 0-2, incomplete in bits 4-6.
      { name: 'Misfire', supported: !!(b & 0x01), ready: !(b & 0x10) },
      { name: 'Fuel system', supported: !!(b & 0x02), ready: !(b & 0x20) },
      { name: 'Comprehensive component', supported: !!(b & 0x04), ready: !(b & 0x40) },
    ];
    // Non-continuous monitors: supported bitmap in C, incomplete bitmap in D.
    const NON_CONTINUOUS = [
      'Catalyst',
      'Heated catalyst',
      'Evaporative system',
      'Secondary air system',
      'A/C refrigerant',
      'O2 sensor',
      'O2 sensor heater',
      'EGR system',
    ];
    NON_CONTINUOUS.forEach((name, bit) => {
      monitors.push({
        name,
        supported: !!(c & (1 << bit)),
        ready: !(d & (1 << bit)),
      });
    });

    return {
      milOn: !!(a & 0x80),
      dtcCount: a & 0x7f,
      monitors,
    };
  }

  // ---- plumbing ----

  _open(path, baudRate) {
    const { SerialPort } = require('serialport');
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({ path, baudRate, autoOpen: false });
      this.port.open((err) => (err ? reject(err) : resolve()));
      this.port.on('data', (buf) => {
        this.buf += buf.toString('ascii');
      });
    });
  }

  // Send a command and collect output until the ELM327 '>' prompt.
  async _cmd(cmd, timeoutMs) {
    if (!this.connected) throw new Error('Not connected');
    this.buf = '';
    this.port.write(cmd + '\r');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.buf.includes('>')) return this.buf.replace(/>/g, '');
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out on "${cmd}" (${timeoutMs}ms)`);
  }
}

module.exports = { Elm327Client };
