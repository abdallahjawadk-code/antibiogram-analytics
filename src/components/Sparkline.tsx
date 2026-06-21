interface SparklineProps {
  values: number[];   // %S values in chronological order
  width?: number;
  height?: number;
}

/** Tiny inline SVG trend line for %S over time. */
export function Sparkline({ values, width = 36, height = 14 }: SparklineProps) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xs = values.map((_, i) => (i / (values.length - 1)) * width);
  const ys = values.map((v) => height - ((v - min) / range) * height);
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  const first = values[0];
  const color = last < first - 3 ? '#10b981' : last > first + 3 ? '#ef4444' : '#94a3b8';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block align-middle mx-0.5">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="1.8" fill={color} />
    </svg>
  );
}
