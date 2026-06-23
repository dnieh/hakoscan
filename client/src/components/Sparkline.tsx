import { useEffect, useRef } from 'react';

export interface Point {
  t: number;
  v: number;
}

export type SparkVariant = 'mini' | 'row' | 'raw';

interface SparklineProps {
  data: Point[];
  variant?: SparkVariant;
  unit?: string;
  className?: string;
}

// Theme colors read from the CSS custom properties (which hold HSL component
// triples like "349 100% 45%"); wrap them as hsl() for canvas use. Ported from
// palette() in the original public/index.html.
function palette() {
  const c = getComputedStyle(document.documentElement);
  const hsl = (name: string, fb: string) => {
    const v = c.getPropertyValue(name).trim();
    return v ? `hsl(${v})` : fb;
  };
  return {
    accent: hsl('--primary', '#e4002b'),
    muted: hsl('--muted-foreground', '#8a93a0'),
    border: hsl('--border', '#2c333d'),
  };
}

const tickDecimals = (span: number) => (span < 5 ? 2 : span < 50 ? 1 : 0);

// Compact sparkline (grid view): just the trace, auto-scaled, no axes.
function drawMiniSpark(ctx: CanvasRenderingContext2D, data: Point[], w: number, h: number) {
  const vals = data.map((d) => d.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 3 - ((d.v - min) / span) * (h - 6);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = palette().accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Full-width chart (row view): labelled time/value axes with gridlines.
function drawRowChart(
  ctx: CanvasRenderingContext2D,
  data: Point[],
  w: number,
  h: number,
  unit?: string,
) {
  const p = palette();
  const padL = 54;
  const padR = 16;
  const padT = 12;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  if (plotW <= 0 || plotH <= 0) return;

  const vals = data.map((d) => d.v);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const xAt = (i: number) => padL + (i / (data.length - 1)) * plotW;
  const yAt = (v: number) => padT + (1 - (v - min) / span) * plotH;

  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = p.muted;
  ctx.strokeStyle = p.border;
  ctx.lineWidth = 1;

  const dec = tickDecimals(span);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = min + (span * i) / 4;
    const y = Math.round(yAt(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(dec), padL - 7, y);
  }

  ctx.beginPath();
  ctx.moveTo(padL + 0.5, padT);
  ctx.lineTo(padL + 0.5, h - padB);
  ctx.lineTo(w - padR, h - padB);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(unit ?? '', 4, 2);

  const durS = Math.max(0, (data[data.length - 1].t - data[0].t) / 1000);
  ctx.fillText('-' + durS.toFixed(0) + 's', padL, h - padB + 7);
  ctx.textAlign = 'center';
  ctx.fillText('time', padL + plotW / 2, h - padB + 7);
  ctx.textAlign = 'right';
  ctx.fillText('now', w - padR, h - padB + 7);

  ctx.beginPath();
  data.forEach((d, i) => {
    const x = xAt(i);
    const y = yAt(d.v);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Raw watch: trace across the full 0–255 byte range (not auto-scaled), so both
// the absolute level and any swing are visible.
function drawRawSpark(ctx: CanvasRenderingContext2D, data: Point[], w: number, h: number) {
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - (d.v / 255) * (h - 4);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = palette().accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function Sparkline({ data, variant = 'mini', unit, className }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      // Match the backing buffer to the displayed size for crisp lines/text.
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw && (canvas.width !== cw || canvas.height !== ch)) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      if (!data || data.length < 2) return;
      if (variant === 'row') drawRowChart(ctx, data, w, h, unit);
      else if (variant === 'raw') drawRawSpark(ctx, data, w, h);
      else drawMiniSpark(ctx, data, w, h);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [data, variant, unit]);

  return <canvas ref={canvasRef} className={className} />;
}
