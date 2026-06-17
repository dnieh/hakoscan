// Simulated ECU with the same interface as ConsultClient, for developing the
// UI without being plugged into the car. Run with: MOCK=1 node server.js

const { EventEmitter } = require('node:events');

// Raw register values the mock "ECU" reports, keyed by register address.
// Kept in raw consult units so the same conversions in sensors.js apply.
class MockConsultClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.streaming = false;
    this.timer = null;
    this.t = 0;
  }

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    await this.stopStream();
    this.connected = false;
  }

  async readPartNumber() {
    return { raw: 'mock', ascii: '0A903', partNumber: '23710-0A903' };
  }

  async readFaults() {
    return [
      { code: 33, startsSinceSeen: 12 },
      { code: 14, startsSinceSeen: 40 },
    ];
  }

  async eraseFaults() {
    return [{ code: 55, startsSinceSeen: 0 }];
  }

  // Typical 1998 KA24DE readiness picture: EVAP not yet run, rest complete.
  async readReadiness() {
    const mk = (name, supported, ready) => ({ name, supported, ready });
    return {
      milOn: false,
      dtcCount: 0,
      monitors: [
        mk('Misfire', true, true),
        mk('Fuel system', true, true),
        mk('Comprehensive component', true, true),
        mk('Catalyst', true, true),
        mk('Heated catalyst', false, true),
        mk('Evaporative system', true, false),
        mk('Secondary air system', false, true),
        mk('A/C refrigerant', false, true),
        mk('O2 sensor', true, true),
        mk('O2 sensor heater', true, true),
        mk('EGR system', true, true),
      ],
    };
  }

  _regValue(reg) {
    const t = this.t;
    const rpm = 850 + 400 * (1 + Math.sin(t / 3)); // idle wander
    const word = Math.round(rpm / 12.5);
    switch (reg) {
      case 0x00: return (word >> 8) & 0xff;
      case 0x01: return word & 0xff;
      case 0x04: return 0;
      case 0x05: return Math.round(180 + 40 * Math.sin(t / 3)); // MAF mV/5
      case 0x06: return 0;
      case 0x07: return Math.round(175 + 40 * Math.sin(t / 3)); // RH MAF
      case 0x08: return Math.round(50 + 82 + 3 * Math.sin(t / 20)); // ~82°C
      case 0x09: return Math.round(45 + 40 * Math.sin(t * 2)); // O2 swing
      case 0x0a: return Math.round(45 + 40 * Math.cos(t * 2)); // RH O2
      case 0x0b: return 0; // stationary
      case 0x0c: return Math.round(14.1 * 1000 / 80); // 14.1 V
      case 0x0d: return Math.round((480 + 30 * Math.sin(t / 3)) / 20); // TPS
      case 0x11: return 50 + 28; // 28°C IAT
      case 0x14: return 0;
      case 0x15: return Math.round(250 + 60 * Math.sin(t / 3)); // ~2.5ms
      case 0x13: return 0x05; // closed throttle + park/neutral
      case 0x16: return 110 - 15; // 15° BTDC
      case 0x17: return Math.round(2 * (38 + 6 * Math.sin(t / 5))); // AAC %
      // Flag registers: fuel pump relay on, fan low cycling, lean flags swing.
      case 0x1e: return 0x40 | (Math.sin(t / 4) > 0 ? 0x08 : 0); // pump + fan lo
      case 0x1f: return 0x00;
      case 0x21: return Math.sin(t / 2) > 0 ? 0xc0 : 0x00; // both banks lean/rich
      case 0x1a: return Math.round(100 + 8 * Math.sin(t / 7)); // alpha
      case 0x1b: return Math.round(100 + 8 * Math.cos(t / 7)); // alpha RH
      case 0x22: return 0;
      case 0x23: return Math.round(245 + 60 * Math.sin(t / 3)); // RH inj
      case 0x28: return Math.round(30 + 10 * Math.sin(t / 4)); // wastegate %
      case 0x29: return Math.round(90 + 20 * Math.sin(t / 3)); // boost raw
      default: return 0xff;
    }
  }

  async sampleRegisters(registers, frameCount = 4) {
    // Emulate real ECU behavior: no frames at all if any requested register
    // is invalid (this is what the scanner's per-register fallback handles).
    if (registers.some((r) => this._regValue(r) === 0xff)) {
      throw new Error('Timed out waiting for data frame');
    }
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      this.t += 0.1;
      frames.push(Buffer.from(registers.map((r) => this._regValue(r))));
    }
    return frames;
  }

  async startStream(registers, onFrame) {
    await this.stopStream();
    this.streaming = true;
    this.timer = setInterval(() => {
      this.t += 0.1;
      onFrame(Buffer.from(registers.map((r) => this._regValue(r))));
    }, 100);
  }

  async stopStream() {
    this.streaming = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { MockConsultClient };
