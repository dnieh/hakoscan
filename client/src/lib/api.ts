// Typed client for the server.js REST endpoints. Mirrors the fetch helper from
// the original public/index.html: parses JSON and throws body.error on !ok.

export async function api<T = unknown>(
  url: string,
  opts?: RequestInit,
): Promise<T> {
  const res = await fetch(url, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body as T;
}

export function postJson<T = unknown>(url: string, data?: unknown): Promise<T> {
  return api<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

// ---- Response shapes (see server.js) ----

export type ConnType = 'consult' | 'obd';

export interface Port {
  path: string;
  manufacturer: string;
}

export interface Status {
  connected: boolean;
  streaming: boolean;
  type: ConnType | null;
  mock: boolean;
}

export interface Sensor {
  id: string;
  name: string;
  unit: string;
  bytes: number;
}

export interface FlagDef {
  reg: number;
  name: string;
  bits: Record<string, string>; // bit index (as string) -> label
}

// REGISTER_NAMES: keys arrive as decimal strings once JSON-serialized.
export type RegisterNames = Record<string, string>;

export interface EcuProfile {
  name: string;
  sensors?: string[];
  flags?: Array<number | string>;
}

export interface EcuInfo {
  raw: string;
  ascii: string;
  partNumber: string;
  model: string | null;
  profile: EcuProfile | null;
}

export interface Fault {
  code: number;
  startsSinceSeen: number;
  description: string;
  ok: boolean;
}

// Per-register result streamed from /api/scan.
export interface ScanRow {
  reg: number;
  name: string | null;
  samples: number[];
  supported: boolean;
}

// Live SSE frame from /api/live.
export interface LiveFrame {
  t: number;
  values: Record<string, number>;
  flags: Record<string, number>; // reg -> raw byte
}

// Raw SSE frame from /api/raw.
export interface RawFrame {
  t: number;
  values: Record<string, number>; // reg -> raw byte
}
