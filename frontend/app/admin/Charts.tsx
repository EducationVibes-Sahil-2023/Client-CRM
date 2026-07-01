"use client";

import { useState } from "react";

// Lightweight dependency-free SVG charts.

// ---- donut geometry helpers (0° at top, clockwise) ----
function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
/** SVG path for a donut segment between two angles. */
function donutArc(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const [ox0, oy0] = polar(cx, cy, rOuter, a0);
  const [ox1, oy1] = polar(cx, cy, rOuter, a1);
  const [ix1, iy1] = polar(cx, cy, rInner, a1);
  const [ix0, iy0] = polar(cx, cy, rInner, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${ox0} ${oy0} A ${rOuter} ${rOuter} 0 ${large} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${rInner} ${rInner} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

export interface DonutDatum {
  id?: number;
  label: string;
  value: number;
  color: string; // hex
}

/**
 * Interactive donut + clickable legend. Hovering a slice or legend row lifts
 * that slice and shows its value/label in the centre; clicking calls onSelect.
 * The row matching `activeId` is highlighted (e.g. the active table filter).
 */
export function DonutSelect({
  data,
  total,
  activeId = null,
  onSelect,
  size = 196,
}: {
  data: DonutDatum[];
  total?: number;
  activeId?: number | null;
  onSelect?: (id: number) => void;
  size?: number;
}) {
  const [hoverId, setHoverId] = useState<number | null>(null);
  const sum = total ?? data.reduce((a, b) => a + b.value, 0);
  const focusId = hoverId ?? activeId;
  // ids may arrive from the API as strings while activeId is numeric — compare
  // both as numbers so highlight / center-label track the active slice.
  const nid = (v: number | string | null | undefined) => (v == null ? -1 : Number(v));
  const focus = focusId != null ? data.find((d) => nid(d.id) === focusId) ?? null : null;

  // Cumulative slice angles (plain loop — no reassignment inside render closures).
  const cx = 100, cy = 100, rOuter = 84, rInner = 56;
  const slices: { d: DonutDatum; a0: number; a1: number }[] = [];
  let acc = 0;
  for (const d of data) {
    const frac = sum > 0 ? d.value / sum : 0;
    slices.push({ d, a0: acc * 360, a1: (acc + frac) * 360 });
    acc += frac;
  }
  const single = data.length === 1;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 200 200" style={{ width: size, height: size }}>
          {single ? (
            <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke={data[0].color} strokeWidth={rOuter - rInner} />
          ) : (
            slices.map((s) => {
              const id = nid(s.d.id);
              const isFocus = focusId === id;
              const dimmed = focusId != null && !isFocus;
              return (
                <path
                  key={id}
                  d={donutArc(cx, cy, isFocus ? rOuter + 5 : rOuter, rInner, s.a0, s.a1)}
                  fill={s.d.color}
                  className="cursor-pointer transition-[opacity] duration-150"
                  style={{ opacity: dimmed ? 0.4 : 1 }}
                  onMouseEnter={() => setHoverId(id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={() => id >= 0 && onSelect?.(id)}
                />
              );
            })
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[26px] font-bold leading-none text-slate-900">{focus ? focus.value : sum}</span>
          <span className="mt-1 max-w-[7.5rem] truncate text-[11px] font-medium text-slate-400">{focus ? focus.label : "total leads"}</span>
        </div>
      </div>

      <ul className="grid max-h-[210px] w-full grid-cols-1 gap-0.5 overflow-y-auto pr-1">
        {data.map((d) => {
          const id = nid(d.id);
          const active = activeId === id;
          const pct = sum > 0 ? Math.round((d.value / sum) * 100) : 0;
          return (
            <li key={id}>
              <button
                onMouseEnter={() => setHoverId(id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => id >= 0 && onSelect?.(id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${active ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"}`}
              >
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: d.color }} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{d.label}</span>
                <span className="flex-shrink-0 text-xs tabular-nums">
                  <span className="font-semibold text-slate-800">{d.value}</span>
                  <span className="ml-1 text-slate-400">{pct}%</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AreaChart({
  data,
  series,
  height = 220,
}: {
  data: Record<string, number | string>[];
  series: { key: string; color: string; label: string }[];
  height?: number;
}) {
  const w = 600;
  const h = height;
  const pad = { t: 16, r: 12, b: 26, l: 30 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const max =
    Math.max(
      1,
      ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)),
    ) * 1.2;

  const x = (i: number) =>
    pad.l + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;

  const linePath = (key: string) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(Number(d[key]) || 0)}`).join(" ");
  const areaPath = (key: string) =>
    `${linePath(key)} L ${x(data.length - 1)} ${pad.t + innerH} L ${x(0)} ${pad.t + innerH} Z`;

  const ticks = 4;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const gy = pad.t + (i / ticks) * innerH;
          return (
            <g key={i}>
              <line x1={pad.l} y1={gy} x2={w - pad.r} y2={gy} stroke="#eef2f7" strokeWidth="1" />
              <text x={pad.l - 6} y={gy + 3} textAnchor="end" className="fill-slate-400 text-[9px]">
                {Math.round(max - (i / ticks) * max)}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <g key={s.key}>
            <defs>
              <linearGradient id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath(s.key)} fill={`url(#grad-${s.key})`} />
            <path d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {data.map((d, i) => (
              <circle key={i} cx={x(i)} cy={y(Number(d[s.key]) || 0)} r="2.5" fill={s.color} />
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex justify-center gap-5">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DonutChart({
  data,
  size = 180,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  const r = 70;
  const c = 2 * Math.PI * r;
  // Precompute each segment's length + start offset (no reassignment in render).
  const segs: { d: { label: string; value: number; color: string }; len: number; offset: number }[] = [];
  let acc = 0;
  for (const d of data) {
    const len = (d.value / total) * c;
    segs.push({ d, len, offset: acc });
    acc += len;
  }

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 180 180" style={{ width: size, height: size }} className="-rotate-90">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#eef2f7" strokeWidth="22" />
        {segs.map((s) => (
          <circle
            key={s.d.label}
            cx="90"
            cy="90"
            r={r}
            fill="none"
            stroke={s.d.color}
            strokeWidth="22"
            strokeDasharray={`${s.len} ${c - s.len}`}
            strokeDashoffset={-s.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="space-y-2">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-sm" style={{ background: d.color }} />
            <span className="capitalize text-slate-600">{d.label}</span>
            <span className="font-semibold text-slate-900">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarChart({
  data,
  color = "#4f46e5",
  height = 200,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end justify-between gap-3" style={{ height }}>
      {data.map((d, i) => (
        <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-2">
          <span className="text-xs font-semibold text-slate-700">{d.value}</span>
          <div
            className="bar-grow w-full rounded-t-md"
            style={{
              height: `${(d.value / max) * (height - 40)}px`,
              background: color,
              animationDelay: `${i * 100}ms`,
            }}
          />
          <span className="truncate text-[11px] capitalize text-slate-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
