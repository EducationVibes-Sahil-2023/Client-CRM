// Animated, fake "live" pipeline dashboard shown in the hero.
// Pure CSS animation — no client JS needed.

const stages = [
  { label: "New", count: 128, color: "bg-sky-500", bar: "h-16" },
  { label: "Qualified", count: 94, color: "bg-indigo-500", bar: "h-24" },
  { label: "Proposal", count: 57, color: "bg-violet-500", bar: "h-20" },
  { label: "Won", count: 41, color: "bg-emerald-500", bar: "h-28" },
];

export default function HeroVisual() {
  return (
    <div className="relative animate-float">
      {/* Glow behind the card */}
      <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-indigo-400/30 to-violet-400/30 blur-2xl" />

      <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        {/* Window chrome */}
        <div className="mb-5 flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <span className="ml-3 text-xs font-medium text-slate-400">
            Pipeline · This month
          </span>
        </div>

        {/* Revenue row */}
        <div className="mb-6 flex items-end justify-between">
          <div>
            <div className="text-xs text-slate-400">Forecasted revenue</div>
            <div className="text-2xl font-bold text-slate-900">$284,500</div>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            +18%
          </div>
        </div>

        {/* Animated bars */}
        <div className="flex h-32 items-end justify-between gap-4">
          {stages.map((s, i) => (
            <div key={s.label} className="flex flex-1 flex-col items-center gap-2">
              <div
                className={`bar-grow w-full rounded-t-md ${s.color} ${s.bar}`}
                style={{ animationDelay: `${i * 180}ms` }}
              />
              <span className="text-[11px] font-medium text-slate-500">{s.label}</span>
              <span className="text-xs font-bold text-slate-800">{s.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Floating "new lead" toast */}
      <div className="absolute -right-4 -top-4 hidden rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl sm:block">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 animate-pulse-ring items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
            +1
          </span>
          <div>
            <div className="text-xs font-semibold text-slate-900">New lead captured</div>
            <div className="text-[11px] text-slate-400">Score 92 · Hot 🔥</div>
          </div>
        </div>
      </div>

      {/* Floating conversion chip */}
      <div className="absolute -bottom-5 -left-5 hidden rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl sm:block">
        <div className="text-[11px] text-slate-400">Conversion</div>
        <div className="text-lg font-bold text-indigo-600">32.4%</div>
      </div>
    </div>
  );
}
