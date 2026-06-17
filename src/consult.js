// Nissan Consult I protocol client.
//
// The protocol (used on most Nissans ~1989-2000 with the grey 14-pin port):
//   - Serial 9600 baud, 8 data bits, no parity, 1 stop bit.
//   - Init: send FF FF EF, ECU replies 0x10.
//   - Every command byte is acknowledged by the ECU with its bitwise inverse
//     (e.g. send 0x5A, receive 0xA5).
//   - 0x5A <reg>   register a sensor address for streaming
//   - 0xF0         execute / start streaming registered data
//   - 0x30         stop stream (ECU replies 0xCF)
//   - 0xD0         read ECU part number
//   - 0xD1         read fault codes (pairs of [code, starts since seen])
//   - 0xC1         erase fault codes
//   - Data frames look like: FF <length> <length bytes of data>.

const { EventEmitter } = require('node:events');

const INIT_SEQ = Buffer.from([0xff, 0xff, 0xef]);
const INIT_ACK = 0x10;
const CMD_REGISTER = 0x5a;
const CMD_EXECUTE = 0xf0;
const CMD_STOP = 0x30;
const STOP_ACK = 0xcf;
const CMD_PART_NUMBER = 0xd0;
const CMD_READ_FAULTS = 0xd1;
const CMD_ERASE_FAULTS = 0xc1;
const FRAME_START = 0xff;

const inv = (b) => ~b & 0xff;

class ConsultClient extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.rx = [];
    this.waiters = [];
    this.streaming = false;
    this.streamRegs = [];
  }

  get connected() {
    return !!this.port && this.port.isOpen;
  }

  async connect(path) {
    const { SerialPort } = require('serialport');
    await this.disconnect();
    this.port = new SerialPort({
      path,
      baudRate: 9600,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false,
    });
    await new Promise((resolve, reject) =>
      this.port.open((err) => (err ? reject(err) : resolve()))
    );
    this.port.on('data', (buf) => this._onData(buf));
    this.port.on('close', () => this.emit('disconnected'));
    await this._init();
  }

  async disconnect() {
    if (this.streaming) {
      try {
        await this.stopStream();
      } catch {
        /* port may already be gone */
      }
    }
    if (this.port) {
      const p = this.port;
      this.port = null;
      if (p.isOpen) await new Promise((resolve) => p.close(() => resolve()));
    }
    this._flush();
  }

  // ---- protocol operations ----

  async _init() {
    // In case the ECU is mid-stream from a previous session, break that off
    // first so it's listening for the init sequence.
    await this._drainStop();

    // Send FF FF EF and listen for the 0x10 ack, capturing every byte we get
    // so a failure can report what the ECU actually sent. The three cases —
    // nothing / non-0x10 bytes / garbage — point at very different problems
    // (wiring or sequence / protocol variant / baud mismatch).
    const seen = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      this._flush();
      this._write(INIT_SEQ);
      const deadline = Date.now() + 600;
      while (Date.now() < deadline) {
        let b;
        try {
          b = await this._nextByte(Math.max(1, deadline - Date.now()));
        } catch {
          break; // quiet this window; resend init
        }
        seen.push(b);
        if (b === INIT_ACK) return;
      }
    }

    const hex = (b) => '0x' + b.toString(16).padStart(2, '0');
    const detail = seen.length
      ? `ECU sent ${seen.length} byte(s) but no 0x10: ${seen.slice(0, 24).map(hex).join(' ')}` +
        (seen.length > 24 ? ' …' : '')
      : 'ECU sent nothing back';
    throw new Error(
      `ECU did not respond to init (no 0x10). ${detail}. ` +
        `Check: ignition ON, and cable connected before key-on (per the FSM, key off → connect → key on).`
    );
  }

  // Raw init diagnostic: try several baud rates, report exactly what each
  // returns to the init sequence. Used to tell a baud mismatch (garbage at the
  // wrong rate, 0x10 at the right one) from silence (wiring) or a protocol
  // variant (consistent non-0x10 byte). Leaves the port closed.
  async probe(path) {
    const { SerialPort } = require('serialport');
    const results = [];
    for (const baudRate of [9600, 4800, 19200, 38400]) {
      const port = new SerialPort({ path, baudRate, autoOpen: false });
      const rx = [];
      try {
        await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())));
        port.on('data', (buf) => rx.push(...buf));
        port.write(INIT_SEQ);
        await new Promise((r) => setTimeout(r, 800));
        results.push({
          baud: baudRate,
          bytes: rx.slice(0, 32).map((b) => b.toString(16).padStart(2, '0')),
          gotAck: rx.includes(INIT_ACK),
        });
      } catch (err) {
        results.push({ baud: baudRate, error: err.message });
      } finally {
        if (port.isOpen) await new Promise((r) => port.close(() => r()));
      }
    }
    return results;
  }

  async readPartNumber() {
    const data = await this._commandFrame(CMD_PART_NUMBER);
    // The 22-byte response mixes binary and ASCII; the human-useful piece is
    // the printable part-number fragment (e.g. "5U010" -> 23710-5U010).
    const ascii = [...data]
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
      .join('')
      .trim();
    return { raw: data.toString('hex'), ascii, partNumber: ascii ? `23710-${ascii.slice(-5)}` : null };
  }

  async readFaults() {
    const data = await this._commandFrame(CMD_READ_FAULTS);
    return this._parseFaults(data);
  }

  async eraseFaults() {
    // C1 erases and then streams the (now clear) fault table like D1 does.
    const data = await this._commandFrame(CMD_ERASE_FAULTS);
    return this._parseFaults(data);
  }

  _parseFaults(data) {
    // Codes arrive as BCD: byte 0x55 is code 55, 0x11 is code 11.
    const faults = [];
    for (let i = 0; i + 1 < data.length; i += 2) {
      const b = data[i];
      if (b === 0xff) continue; // frame marker / padding, never a fault code
      const hi = b >> 4;
      const lo = b & 0x0f;
      const code = hi <= 9 && lo <= 9 ? hi * 10 + lo : b;
      faults.push({ code, startsSinceSeen: data[i + 1] });
    }
    return faults;
  }

  // Register a set of sensor addresses and start streaming. `onFrame` is
  // called with a Buffer of one byte per registered address, in order.
  async startStream(registers, onFrame) {
    if (this.streaming) await this.stopStream();
    // Drain to silence before registering. A previous stream (especially one
    // that was stopped or errored) can leave frame bytes still arriving; if we
    // register on top of them, the first frame is read mid-stream and locks
    // onto a data byte as a false frame start, so every value reads at the
    // wrong offset. Starting from a quiet line guarantees correct alignment.
    await this._drainStop();
    for (const reg of registers) {
      this._write(Buffer.from([CMD_REGISTER, reg]));
      await this._waitForByte(inv(CMD_REGISTER), 1000);
    }
    this._write(Buffer.from([CMD_EXECUTE]));
    this.streaming = true;
    this.streamRegs = registers;
    this._streamDone = this._streamLoop(registers.length, onFrame);
  }

  // Register a set of addresses, collect a few frames, and stop. Used by the
  // register scanner. Probe one register at a time: a register the ECU won't
  // ack throws, and if that throw isn't fully cleaned up it desyncs every
  // later probe — so registration is inside try/finally and the finally
  // always drains the ECU back to silence before returning.
  async sampleRegisters(registers, frameCount = 3, frameTimeoutMs = 800) {
    if (this.streaming) await this.stopStream();
    const frames = [];
    try {
      this._flush();
      for (const reg of registers) {
        this._write(Buffer.from([CMD_REGISTER, reg]));
        await this._waitForByte(inv(CMD_REGISTER), 600);
      }
      this._write(Buffer.from([CMD_EXECUTE]));
      for (let i = 0; i < frameCount; i++) {
        const frame = await this._readFrame(frameTimeoutMs);
        if (frame.length >= registers.length) {
          frames.push(frame.subarray(0, registers.length));
        }
      }
    } finally {
      await this._drainStop();
    }
    return frames;
  }

  // Tell the ECU to stop streaming and read-and-discard until the line goes
  // quiet. More robust than waiting for a single STOP_ACK byte: a probe may
  // have left the ECU streaming, half-registered, or silent, and this leaves
  // the buffer clean for the next probe in all three cases.
  async _drainStop() {
    if (!this.connected) return;
    try {
      this._write(Buffer.from([CMD_STOP]));
    } catch {
      return;
    }
    const quietMs = 120;
    while (true) {
      try {
        await this._nextByte(quietMs); // resets the quiet window each byte
      } catch {
        break; // nothing for quietMs -> ECU has stopped
      }
    }
    this._flush();
  }

  async stopStream() {
    if (!this.streaming) return;
    this.streaming = false;
    // Wait for the read loop to notice and exit before draining, so the loop
    // and the drain don't both pull from the rx queue (that race is what made
    // stop eat the ack and time out).
    if (this._streamDone) {
      await this._streamDone.catch(() => {});
      this._streamDone = null;
    }
    await this._drainStop();
  }

  async _streamLoop(frameLen, onFrame) {
    // A single slow or truncated frame is normal right after (re)registration
    // and during brief line hiccups, so don't tear the stream down on the first
    // timeout. Only surface an error once the line has stayed silent across
    // several consecutive reads (~real disconnect), retrying transient gaps.
    const MAX_MISSES = 4;
    let misses = 0;
    try {
      while (this.streaming && this.connected) {
        let frame;
        try {
          frame = await this._readFrame(2000);
          misses = 0;
        } catch (err) {
          if (!this.streaming) return;
          if (++misses >= MAX_MISSES) { this.emit('streamError', err); return; }
          continue;
        }
        if (this.streaming && frame.length >= frameLen) {
          onFrame(frame.subarray(0, frameLen));
        }
      }
    } finally {
      // Keep state consistent if we exited via error/return, so a later
      // start/stop doesn't think a stream is still live.
      this.streaming = false;
    }
  }

  // Send a one-byte command, wait for its inverted ack, execute, read one
  // data frame, then stop the ECU's repeat transmission.
  async _commandFrame(cmd) {
    this._flush();
    this._write(Buffer.from([cmd]));
    await this._waitForByte(inv(cmd), 1500);
    this._write(Buffer.from([CMD_EXECUTE]));
    const frame = await this._readFrame(2000);
    this._write(Buffer.from([CMD_STOP]));
    try {
      await this._waitForByte(STOP_ACK, 1000);
    } catch {
      /* some ECUs skip the stop ack here */
    }
    this._flush();
    return frame;
  }

  // ---- byte-level plumbing ----

  _write(buf) {
    if (!this.connected) throw new Error('Not connected');
    this.port.write(buf);
  }

  _onData(buf) {
    for (const b of buf) this.rx.push(b);
    this.waiters.forEach((w) => w());
  }

  _flush() {
    this.rx = [];
  }

  _nextByte(timeoutMs) {
    if (this.rx.length) return Promise.resolve(this.rx.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== check);
        reject(new Error(`Timed out waiting for data (${timeoutMs}ms)`));
      }, timeoutMs);
      const check = () => {
        if (!this.rx.length) return;
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== check);
        resolve(this.rx.shift());
      };
      this.waiters.push(check);
    });
  }

  async _waitForByte(byte, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const b = await this._nextByte(Math.max(1, deadline - Date.now()));
      if (b === byte) return;
    }
    throw new Error(`Timed out waiting for 0x${byte.toString(16)}`);
  }

  async _readFrame(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    // scan for FF <len> <data...>
    while (Date.now() < deadline) {
      const b = await this._nextByte(Math.max(1, deadline - Date.now()));
      if (b !== FRAME_START) continue;
      const len = await this._nextByte(Math.max(1, deadline - Date.now()));
      if (len === 0 || len === FRAME_START) continue;
      const data = Buffer.alloc(len);
      for (let i = 0; i < len; i++) {
        data[i] = await this._nextByte(Math.max(1, deadline - Date.now()));
      }
      return data;
    }
    throw new Error('Timed out waiting for data frame');
  }
}

module.exports = { ConsultClient };
