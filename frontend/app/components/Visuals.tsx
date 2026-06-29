// Pure-CSS animated product "screenshots". No client JS — animations are CSS.

function Window({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-amber-400" />
        <span className="h-3 w-3 rounded-full bg-emerald-400" />
        <span className="ml-3 text-xs font-medium text-slate-400">{title}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-emerald-500">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ---------------- Real-time virtual dashboard ---------------- */
export function DashboardVisual() {
  const bars = ["h-10", "h-16", "h-12", "h-20", "h-14", "h-24", "h-16"];
  return (
    <Window title="Dashboard · Overview">
      <div className="grid grid-cols-3 gap-3">
        {[
          { l: "Leads today", v: "342", c: "text-indigo-600" },
          { l: "Calls", v: "1,204", c: "text-violet-600" },
          { l: "Won", v: "$48k", c: "text-emerald-600" },
        ].map((k) => (
          <div key={k.l} className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] text-slate-400">{k.l}</div>
            <div className={`text-lg font-bold ${k.c}`}>{k.v}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex h-28 items-end justify-between gap-2 rounded-xl bg-slate-50 p-3">
        {bars.map((h, i) => (
          <div
            key={i}
            className={`bar-grow w-full rounded-t bg-gradient-to-t from-indigo-500 to-violet-400 ${h}`}
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-100 p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">
            AK
          </span>
          <div>
            <div className="text-xs font-semibold text-slate-800">Aarav closed a deal</div>
            <div className="text-[11px] text-slate-400">just now · $4,200</div>
          </div>
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
          +1
        </span>
      </div>
    </Window>
  );
}

/* ---------------- Real-time call tracker ---------------- */
export function CallTrackerVisual() {
  return (
    <Window title="Call Tracker · Live">
      <div className="flex items-center gap-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 p-4 text-white">
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/20">
          <span className="animate-pulse-ring absolute h-12 w-12 rounded-full" />
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6.6 10.8a15.5 15.5 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.3 0 .7-.2 1l-2.3 2z" />
          </svg>
        </span>
        <div className="flex-1">
          <div className="text-sm font-semibold">Riya Mehta</div>
          <div className="text-xs text-indigo-100">+91 98••• ••432 · Connected</div>
        </div>
        <div className="font-mono text-lg font-bold tabular-nums">02:41</div>
      </div>
      {/* Waveform */}
      <div className="mt-4 flex h-14 items-center justify-center gap-1 rounded-xl bg-slate-50 px-3">
        {Array.from({ length: 28 }).map((_, i) => (
          <span
            key={i}
            className="animate-wave w-1 rounded-full bg-indigo-400"
            style={{
              height: `${20 + ((i * 7) % 30)}px`,
              animationDelay: `${(i % 7) * 90}ms`,
              animationDuration: `${0.8 + (i % 5) * 0.12}s`,
            }}
          />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {[
          { n: "Karan S.", s: "Outgoing · 04:12", c: "text-emerald-500", d: "↗" },
          { n: "Neha P.", s: "Missed", c: "text-red-500", d: "↘" },
        ].map((c) => (
          <div key={c.n} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`text-base ${c.c}`}>{c.d}</span>
              <span className="text-xs font-semibold text-slate-700">{c.n}</span>
            </div>
            <span className="text-[11px] text-slate-400">{c.s}</span>
          </div>
        ))}
      </div>
    </Window>
  );
}

/* ---------------- Follow-ups, reminders & tasks ---------------- */
export function FollowUpVisual() {
  const items = [
    { t: "Call back — Acme Corp", time: "Today · 2:00 PM", done: true, tag: "Follow-up", c: "bg-indigo-500" },
    { t: "Send proposal to Riya", time: "Today · 4:30 PM", done: false, tag: "Task", c: "bg-violet-500" },
    { t: "Demo with Brightpath", time: "Tomorrow · 11:00 AM", done: false, tag: "Reminder", c: "bg-amber-500" },
    { t: "Quarterly review", time: "Fri · 9:00 AM", done: false, tag: "Task", c: "bg-emerald-500" },
  ];
  return (
    <Window title="Follow-ups & Tasks">
      <div className="space-y-3">
        {items.map((it, i) => (
          <div
            key={it.t}
            className="animate-bubble flex items-center gap-3 rounded-xl border border-slate-100 p-3"
            style={{ animationDelay: `${i * 160}ms` }}
          >
            <span
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                it.done ? "border-emerald-500 bg-emerald-500" : "border-slate-300"
              }`}
            >
              {it.done && (
                <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <div className="flex-1">
              <div className={`text-sm font-medium ${it.done ? "text-slate-400 line-through" : "text-slate-800"}`}>
                {it.t}
              </div>
              <div className="text-[11px] text-slate-400">{it.time}</div>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${it.c}`} />
              {it.tag}
            </span>
          </div>
        ))}
      </div>
    </Window>
  );
}

/* ---------------- Real-time chat with staff ---------------- */
export function ChatVisual() {
  return (
    <Window title="Team Chat · #sales">
      <div className="space-y-3">
        <div className="animate-bubble flex gap-2" style={{ animationDelay: "0ms" }}>
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-600">SM</span>
          <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-sm text-slate-700">
            New lead assigned to you — hot one 🔥
          </div>
        </div>
        <div className="animate-bubble flex justify-end gap-2" style={{ animationDelay: "300ms" }}>
          <div className="rounded-2xl rounded-tr-sm bg-indigo-600 px-3 py-2 text-sm text-white">
            On it! Calling now ☎️
          </div>
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-600">ME</span>
        </div>
        <div className="animate-bubble flex gap-2" style={{ animationDelay: "600ms" }}>
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-600">SM</span>
          <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3">
            <span className="animate-chat-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
            <span className="animate-chat-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "200ms" }} />
            <span className="animate-chat-dot h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: "400ms" }} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-400">
        Message your team…
        <svg className="ml-auto h-5 w-5 text-indigo-600" fill="currentColor" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
      </div>
    </Window>
  );
}

/* ---------------- Push notifications ---------------- */
export function NotificationVisual() {
  const notes = [
    { icon: "🔔", title: "Reminder: Call Acme Corp", body: "Due in 10 minutes", c: "bg-amber-100" },
    { icon: "🔄", title: "Lead auto-transferred", body: "Assigned to Priya (online)", c: "bg-indigo-100" },
    { icon: "🎫", title: "New support ticket #2841", body: "Priority: High", c: "bg-rose-100" },
    { icon: "✅", title: "Task completed", body: "Karan sent the proposal", c: "bg-emerald-100" },
  ];
  return (
    <div className="space-y-3">
      {notes.map((n, i) => (
        <div
          key={n.title}
          className="animate-slide-in flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur"
          style={{ animationDelay: `${i * 280}ms` }}
        >
          <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-lg ${n.c}`}>
            {n.icon}
          </span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">{n.title}</div>
            <div className="text-xs text-slate-500">{n.body}</div>
          </div>
          <span className="text-[10px] text-slate-400">now</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Reports & analytics ---------------- */
export function ReportsVisual() {
  return (
    <Window title="Reports · Sales & Performance">
      <div className="grid grid-cols-2 gap-4">
        {/* Donut */}
        <div className="flex flex-col items-center justify-center rounded-xl bg-slate-50 p-4">
          <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
            <circle
              cx="18" cy="18" r="15.9" fill="none" stroke="#4f46e5" strokeWidth="3.5"
              strokeLinecap="round" strokeDasharray="100" strokeDashoffset="32"
              className="animate-draw" style={{ strokeDasharray: 100, strokeDashoffset: 32 }}
            />
          </svg>
          <div className="mt-2 text-sm font-semibold text-slate-700">68% won</div>
        </div>
        {/* Line chart */}
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] text-slate-400">Revenue trend</div>
          <svg viewBox="0 0 100 50" className="mt-2 h-20 w-full">
            <polyline
              points="0,40 18,28 34,32 52,16 70,20 88,6 100,10"
              fill="none" stroke="#7c3aed" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" className="animate-draw"
            />
          </svg>
          <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            +24% vs last month
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {[
          { l: "Leads", v: 82, c: "bg-indigo-500" },
          { l: "Sales", v: 64, c: "bg-violet-500" },
          { l: "Performance", v: 91, c: "bg-emerald-500" },
        ].map((r, i) => (
          <div key={r.l} className="flex items-center gap-3">
            <span className="w-24 text-xs text-slate-500">{r.l}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`bar-grow h-full rounded-full ${r.c}`}
                style={{ width: `${r.v}%`, animationDelay: `${i * 160}ms` }}
              />
            </div>
            <span className="w-9 text-right text-xs font-semibold text-slate-600">{r.v}%</span>
          </div>
        ))}
      </div>
    </Window>
  );
}
