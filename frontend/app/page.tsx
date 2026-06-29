import Link from "next/link";
import Navbar from "./components/Navbar";
import DemoForm from "./components/DemoForm";
import ContactForm from "./components/ContactForm";
import Reveal from "./components/Reveal";
import Counter from "./components/Counter";
import Faq from "./components/Faq";
import HeroVisual from "./components/HeroVisual";
import {
  DashboardVisual,
  CallTrackerVisual,
  FollowUpVisual,
  ChatVisual,
  NotificationVisual,
  ReportsVisual,
} from "./components/Visuals";

const stats = [
  { to: 38, suffix: "%", label: "More leads converted" },
  { to: 2.4, decimals: 1, suffix: "×", label: "Faster follow-up" },
  { to: 12, suffix: "k+", label: "Sales teams" },
  { to: 99.9, decimals: 1, suffix: "%", label: "Uptime SLA" },
];

const integrations = [
  "Google Meet",
  "Twilio",
  "Gmail",
  "Outlook",
  "Webhooks / API",
  "Slack",
  "Zapier",
  "WhatsApp",
  "Stripe",
  "Google Sheets",
];

// The product-tour showcases (each pairs copy with an animated mockup).
const showcases = [
  {
    id: "product",
    eyebrow: "Virtual real-time dashboard",
    title: "Your whole business, live on one screen",
    desc: "A real-time command center that updates the instant something happens — new leads, calls, deals, and team activity stream in live.",
    bullets: ["Live KPIs & revenue", "Activity feed in real time", "Drill into any metric"],
    visual: <DashboardVisual />,
    reverse: false,
  },
  {
    eyebrow: "Real-time call tracker",
    title: "Track every call as it happens",
    desc: "Twilio-powered calling logs every inbound and outbound call live — with recordings, duration, and outcome attached to the right lead automatically.",
    bullets: ["Live call status & timer", "Auto-logged to the lead", "Recordings & call notes"],
    visual: <CallTrackerVisual />,
    reverse: true,
  },
  {
    eyebrow: "Follow-ups, reminders & tasks",
    title: "Never miss a follow-up again",
    desc: "Schedule follow-ups, set reminders, and manage tasks in one place. The system nudges your reps before anything slips.",
    bullets: ["Smart reminders", "Recurring follow-ups", "Team task management"],
    visual: <FollowUpVisual />,
    reverse: false,
  },
  {
    eyebrow: "Real-time chat & auto lead transfer",
    title: "Your team, perfectly in sync",
    desc: "Chat with staff in real time and let leads auto-transfer to the right rep based on availability, region, or workload — no lead waits.",
    bullets: ["Real-time staff chat", "Auto lead transfer rules", "Online presence aware"],
    visual: <ChatVisual />,
    reverse: true,
  },
  {
    eyebrow: "Reports management",
    title: "Reports that drive decisions",
    desc: "Sales, leads, and performance reports with live charts and exports. See conversion, velocity, and rep performance at a glance.",
    bullets: ["Sales, leads & performance", "Live charts & exports", "Per-rep breakdowns"],
    visual: <ReportsVisual />,
    reverse: false,
  },
];

// Full capability grid — everything in the platform.
const features = [
  { t: "Real-time call tracker", d: "Live inbound/outbound call logging with recordings.", i: "M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.2 11 11 0 003.8.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11 11 0 00.6 3.8 1 1 0 01-.2 1l-2.3 2z" },
  { t: "Reminders", d: "Timely nudges so nothing falls through the cracks.", i: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { t: "Follow-ups", d: "Schedule and automate follow-ups per lead.", i: "M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-5M20 15a8 8 0 01-14 5" },
  { t: "Task management", d: "Assign, track, and complete team tasks.", i: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
  { t: "Staff management", d: "Manage your team, roles, and workloads.", i: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" },
  { t: "Webhook APIs", d: "Connect anything with REST + webhooks.", i: "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" },
  { t: "Google Meet integration", d: "Spin up Meet calls right from a lead.", i: "M15 10l4.5-2.5v9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" },
  { t: "Email integration", d: "Send, receive & log email on the timeline.", i: "M3 8l9 6 9-6M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8M3 8l9-5 9 5" },
  { t: "Twilio integration", d: "Calls and SMS powered by Twilio.", i: "M12 1a11 11 0 100 22 11 11 0 000-22zm0 6a2 2 0 110 4 2 2 0 010-4zm5 5a2 2 0 110 4 2 2 0 010-4zM7 12a2 2 0 110 4 2 2 0 010-4zm5 5a2 2 0 110 4 2 2 0 010-4z" },
  { t: "Reports management", d: "Sales, leads & performance reporting.", i: "M3 3v18h18M9 17V9m4 8V5m4 12v-6" },
  { t: "Announcements", d: "Broadcast updates to your whole team.", i: "M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12" },
  { t: "Real-time dashboard", d: "A live, virtual command center.", i: "M4 5h16v6H4zM4 13h7v6H4zM13 13h7v6h-7z" },
  { t: "Real-time staff chat", d: "Message your team instantly, in-app.", i: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
  { t: "Auto lead transfer", d: "Route leads to the right rep automatically.", i: "M4 7h16M4 7l4-4M4 7l4 4M20 17H4M20 17l-4-4M20 17l-4 4" },
  { t: "Assets management", d: "Track company assets and assignments.", i: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4" },
  { t: "Lead & user activity logs", d: "Real-time audit trail of every action.", i: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { t: "Support tickets", d: "Raise, assign & resolve support tickets.", i: "M15 5l4 4m-4-4a2.8 2.8 0 014 4l-9 9-5 1 1-5 9-9z" },
  { t: "Leads import", d: "Bulk-import leads from CSV in seconds.", i: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" },
  { t: "Sales / leads / performance reports", d: "Multiple report types, ready to export.", i: "M9 17v-6h2v6H9zm4 0V7h2v10h-2zM5 17v-2h2v2H5zM3 21h18" },
  { t: "Permission-based access", d: "Granular, role-based control over everything.", i: "M12 11a3 3 0 100-6 3 3 0 000 6zM4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2M12 1l3 3-3 3-3-3 3-3z" },
  { t: "Push notifications", d: "Real-time alerts on every device.", i: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
];

const testimonials = [
  { quote: "We replaced three tools with this CRM. Follow-up rate doubled and the live dashboard keeps the whole floor accountable.", name: "Priya Sharma", role: "Head of Sales, Northwind", initials: "PS" },
  { quote: "The call tracker and auto lead transfer changed everything. Leads get a call within seconds — revenue is up 27% this quarter.", name: "Marcus Lee", role: "VP Revenue, Brightpath", initials: "ML" },
  { quote: "Permission-based access and activity logs gave us the control we needed to scale the team without losing visibility.", name: "Elena Rossi", role: "Founder, Pulse Digital", initials: "ER" },
];

const pricing = [
  { name: "Starter", price: "$0", period: "/mo", desc: "For small teams getting started.", features: ["Up to 3 users", "1,000 leads", "Call tracker & follow-ups", "Email support"], cta: "Start free", highlight: false },
  { name: "Growth", price: "$29", period: "/user/mo", desc: "For growing sales teams.", features: ["Unlimited users", "50,000 leads", "Auto lead transfer & chat", "All reports & dashboards", "Twilio & Meet integrations"], cta: "Request a demo", highlight: true },
  { name: "Enterprise", price: "Custom", period: "", desc: "For organizations at scale.", features: ["Unlimited everything", "Advanced permissions & SSO", "Webhooks & full API", "Dedicated manager", "SLA & onboarding"], cta: "Talk to sales", highlight: false },
];

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-slate-700">
      <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

export default function Home() {
  return (
    <div className="bg-white text-slate-800">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-indigo-50 via-white to-white">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="animate-blob absolute -left-24 -top-24 h-72 w-72 rounded-full bg-indigo-300/40 blur-3xl" />
          <div className="animate-blob absolute right-0 top-32 h-72 w-72 rounded-full bg-violet-300/40 blur-3xl [animation-delay:3s]" />
          <div className="animate-blob absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-sky-300/30 blur-3xl [animation-delay:6s]" />
        </div>

        <div className="mx-auto grid max-w-6xl items-center gap-16 px-6 py-24 lg:grid-cols-2">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-600" />
              The all-in-one CRM for lead management
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-6xl">
              Turn more leads into{" "}
              <span className="animate-gradient bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 bg-clip-text text-transparent">
                closed revenue
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-600">
              Call tracking, follow-ups, real-time dashboards, staff chat, auto
              lead transfer, reports and more — everything your sales team needs
              in one powerful, permission-based platform.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <a href="#demo" className="rounded-lg bg-indigo-600 px-6 py-3 text-center font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-xl">
                Request a demo
              </a>
              <Link href="/login" className="rounded-lg border border-slate-300 px-6 py-3 text-center font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-400">
                Login
              </Link>
            </div>
            <div className="mt-8 flex items-center gap-6 text-sm text-slate-500">
              <span className="flex items-center gap-2"><svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>No credit card</span>
              <span className="flex items-center gap-2"><svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>Free forever plan</span>
            </div>
          </Reveal>

          <Reveal delay={150}>
            <HeroVisual />
          </Reveal>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-slate-200 bg-slate-900">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-14 sm:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 100} className="text-center">
              <div className="text-3xl font-bold text-white sm:text-4xl">
                <Counter to={s.to} decimals={s.decimals} suffix={s.suffix} />
              </div>
              <div className="mt-1 text-sm text-slate-400">{s.label}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Integrations marquee */}
      <section className="overflow-hidden border-b border-slate-200 bg-white py-10">
        <p className="mb-6 text-center text-sm font-medium uppercase tracking-wider text-slate-400">
          Integrates with the tools your team already uses
        </p>
        <div className="relative flex">
          <div className="animate-marquee flex shrink-0 items-center gap-12 pr-12">
            {[...integrations, ...integrations].map((name, i) => (
              <span key={i} className="whitespace-nowrap text-lg font-semibold text-slate-400">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Product tour — alternating showcases */}
      <div className="mx-auto max-w-6xl px-6">
        {showcases.map((s, i) => (
          <section
            key={s.title}
            id={s.id}
            className="grid items-center gap-12 border-b border-slate-100 py-20 lg:grid-cols-2 lg:gap-16"
          >
            <Reveal className={s.reverse ? "lg:order-2" : ""}>
              <span className="text-sm font-semibold uppercase tracking-wider text-indigo-600">{s.eyebrow}</span>
              <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">{s.title}</h2>
              <p className="mt-4 text-slate-600">{s.desc}</p>
              <ul className="mt-6 space-y-3">
                {s.bullets.map((b) => (
                  <Bullet key={b}>{b}</Bullet>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={120} className={s.reverse ? "lg:order-1" : ""}>
              {s.visual}
            </Reveal>
          </section>
        ))}
      </div>

      {/* Real-time push notifications highlight */}
      <section className="relative overflow-hidden bg-slate-900">
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <div className="animate-blob absolute -left-10 top-0 h-72 w-72 rounded-full bg-indigo-500 blur-3xl" />
          <div className="animate-blob absolute -right-10 bottom-0 h-72 w-72 rounded-full bg-violet-500 blur-3xl [animation-delay:4s]" />
        </div>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-2">
          <Reveal className="text-white">
            <span className="text-sm font-semibold uppercase tracking-wider text-indigo-300">Real-time push notifications</span>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Your team never misses a beat</h2>
            <p className="mt-4 text-slate-300">
              Instant push alerts for new leads, reminders, auto-transfers,
              support tickets, and task updates — delivered in real time across
              every device.
            </p>
            <ul className="mt-6 space-y-3 text-slate-200">
              <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />Lead & reminder alerts</li>
              <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />Support ticket updates</li>
              <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />Auto-transfer & task events</li>
            </ul>
          </Reveal>
          <Reveal delay={150}>
            <NotificationVisual />
          </Reveal>
        </div>
      </section>

      {/* Full feature grid */}
      <section id="features" className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal className="text-center">
            <span className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Everything included</span>
            <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">One platform. Every tool your sales team needs.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-600">From the first lead to the closed deal — manage it all, with granular permissions for every role.</p>
          </Reveal>
          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.t} delay={(i % 3) * 90}>
                <div className="group flex h-full items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-xl">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 transition group-hover:scale-110 group-hover:bg-indigo-600 group-hover:text-white">
                    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d={f.i} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{f.t}</h3>
                    <p className="mt-1 text-sm text-slate-600">{f.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <span className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Why teams choose us</span>
            <h2 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">Built for sales, not paperwork</h2>
            <p className="mt-4 text-slate-600">
              We watched great salespeople lose deals to messy spreadsheets and
              forgotten follow-ups. Our mission: give every team a clear, fast,
              and honest view of their pipeline — with the controls to scale.
            </p>
            <ul className="mt-6 space-y-3">
              <Bullet>No more leads lost in inboxes or sticky notes</Bullet>
              <Bullet>A real-time pipeline the whole team can trust</Bullet>
              <Bullet>Permission-based — the right data for the right people</Bullet>
            </ul>
          </Reveal>
          <Reveal delay={150}>
            <div className="grid grid-cols-2 gap-4">
              {[
                { v: "12k+", l: "Teams onboarded" },
                { v: "4.9/5", l: "Average rating" },
                { v: "30M+", l: "Leads managed" },
                { v: "150+", l: "Countries" },
              ].map((b) => (
                <div key={b.l} className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 text-center">
                  <div className="text-3xl font-bold text-indigo-600">{b.v}</div>
                  <div className="mt-1 text-sm text-slate-500">{b.l}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal className="text-center">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Loved by sales teams everywhere</h2>
            <p className="mt-4 text-slate-600">Don&apos;t take our word for it.</p>
          </Reveal>
          <div className="mt-16 grid gap-8 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 120}>
                <figure className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="flex gap-1 text-amber-400">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <svg key={s} className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.34 4.12a1 1 0 00.95.69h4.33c.97 0 1.37 1.24.59 1.81l-3.5 2.54a1 1 0 00-.36 1.12l1.33 4.12c.3.92-.75 1.69-1.54 1.12l-3.5-2.54a1 1 0 00-1.18 0l-3.5 2.54c-.78.57-1.83-.2-1.53-1.12l1.33-4.12a1 1 0 00-.36-1.12L1.68 9.55c-.78-.57-.38-1.81.59-1.81h4.33a1 1 0 00.95-.69l1.5-4.12z" /></svg>
                    ))}
                  </div>
                  <blockquote className="mt-4 flex-1 text-slate-700">“{t.quote}”</blockquote>
                  <figcaption className="mt-6 flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">{t.initials}</span>
                    <span>
                      <span className="block font-semibold text-slate-900">{t.name}</span>
                      <span className="block text-sm text-slate-500">{t.role}</span>
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Simple, transparent pricing</h2>
          <p className="mt-4 text-slate-600">Start free. Upgrade when you grow.</p>
        </Reveal>
        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {pricing.map((tier, i) => (
            <Reveal key={tier.name} delay={i * 120}>
              <div className={`flex h-full flex-col rounded-2xl border p-8 transition hover:-translate-y-1 ${tier.highlight ? "border-indigo-600 shadow-2xl ring-1 ring-indigo-600 lg:-mt-4 lg:mb-4" : "border-slate-200 hover:shadow-xl"}`}>
                {tier.highlight && <span className="self-start rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
                <h3 className="mt-2 text-lg font-semibold text-slate-900">{tier.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-slate-900">{tier.price}</span>
                  <span className="text-slate-500">{tier.period}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{tier.desc}</p>
                <ul className="mt-6 flex-1 space-y-3">
                  {tier.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm text-slate-700">
                      <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
                <a href="#demo" className={`mt-8 rounded-lg px-4 py-2.5 text-center font-semibold transition ${tier.highlight ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border border-slate-300 text-slate-700 hover:border-slate-400"}`}>{tier.cta}</a>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal className="text-center">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Frequently asked questions</h2>
            <p className="mt-4 text-slate-600">Everything you need to know before you start.</p>
          </Reveal>
          <div className="mt-12">
            <Reveal><Faq /></Reveal>
          </div>
        </div>
      </section>

      {/* Demo */}
      <section id="demo" className="relative overflow-hidden bg-indigo-600">
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <div className="animate-blob absolute -left-10 top-0 h-72 w-72 rounded-full bg-indigo-400 blur-3xl" />
          <div className="animate-blob absolute -right-10 bottom-0 h-72 w-72 rounded-full bg-violet-400 blur-3xl [animation-delay:4s]" />
        </div>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-2">
          <Reveal className="text-white">
            <h2 className="text-3xl font-bold sm:text-4xl">See the CRM in action</h2>
            <p className="mt-4 text-indigo-100">Book a 20-minute walkthrough tailored to your team. We&apos;ll show you the dashboard, call tracker, automations, and reports live.</p>
            <p className="mt-4 text-sm text-indigo-200">A specialist reaches out within one business day.</p>
          </Reveal>
          <Reveal delay={150}>
            <div className="rounded-2xl bg-white p-8 shadow-2xl"><DemoForm /></div>
          </Reveal>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-12 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">Get in touch</h2>
            <p className="mt-4 text-slate-600">Questions about pricing, onboarding, or integrations? Send us a note and we&apos;ll get back to you.</p>
            <div className="mt-8 space-y-4 text-sm text-slate-600">
              <div className="flex items-center gap-3"><span className="font-semibold text-slate-900">Email:</span>hello@leadflow.app</div>
              <div className="flex items-center gap-3"><span className="font-semibold text-slate-900">Sales:</span>+1 (555) 010-2030</div>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><ContactForm /></div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-900 text-slate-300">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
          <div className="text-lg font-bold text-white">LeadFlow</div>
          <nav className="flex flex-wrap justify-center gap-6 text-sm">
            <a href="#product" className="hover:text-white">Product</a>
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <a href="#contact" className="hover:text-white">Contact</a>
            <Link href="/login" className="hover:text-white">Login</Link>
          </nav>
          <div className="text-sm text-slate-400">© 2026 LeadFlow. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
