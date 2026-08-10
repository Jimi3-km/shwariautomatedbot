import React, { useId } from 'react';
import type { SeriesPoint } from '../types';

/**
 * Small dependency-free area chart. Rendered as inline SVG so it inherits the
 * theme and adds no bundle weight. Values are plotted exactly as returned by
 * the API; nothing is smoothed or invented.
 */
export function AreaChart({
  data, height = 140, color = 'var(--accent)', formatValue = (n: number) => String(n),
}: {
  data: SeriesPoint[];
  height?: number;
  color?: string;
  formatValue?: (n: number) => string;
}) {
  const gradientId = useId();
  if (data.length === 0) return null;

  const width = 600; // viewBox space; the SVG scales to its container
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? width / (data.length - 1) : width;

  const points = data.map((d, i) => ({
    x: i * stepX,
    y: height - (d.value / max) * (height - 16) - 8,
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  const last = data[data.length - 1];
  const first = data[0];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
        role="img"
        aria-label={`Chart from ${first.date} to ${last.date}, peak ${formatValue(max)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: 'var(--text-3)', marginTop: 6,
      }}>
        <span>{first.date}</span>
        <span>peak {formatValue(max)}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

/** Horizontal comparison bars, used for channel performance. */
export function BarList({
  items, formatValue = (n: number) => String(n),
}: {
  items: Array<{ label: string; value: number }>;
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {items.map((item) => (
        <div key={item.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ textTransform: 'capitalize' }}>{item.label}</span>
            <span style={{ color: 'var(--text-2)' }}>{formatValue(item.value)}</span>
          </div>
          <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${(item.value / max) * 100}%`, height: '100%',
              background: 'var(--accent)', borderRadius: 999,
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}
