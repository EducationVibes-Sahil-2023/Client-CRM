"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getBilling, type Billing } from "../../lib/client";
import { useClient } from "../ClientContext";
import { Card, PageHeader, SkeletonStats, SkeletonBlock, ValidityBadge, planValidity, fmtDate } from "../../admin/ui";
import { DataTable, type Column } from "../../admin/DataTable";
import { parseServer } from "../../lib/datetime";

const money = (currency: string, n: number) => (n <= 0 ? "Free" : `${currency}${n.toLocaleString("en-IN")}`);

interface Invoice {
  number: string;
  start: string;
  end: string;
  amount: number;
  status: "paid" | "due" | "upcoming";
}

// Derive a simple invoice history from the subscription window (monthly periods).
function buildInvoices(planStart: string | null, planEnd: string | null, price: number, nowTs: number): Invoice[] {
  const start = parseServer(planStart);
  if (!start || price <= 0) return [];
  const now = new Date(nowTs);
  const end = planEnd ? parseServer(planEnd) : null;
  const cap = end && end.getTime() < now.getTime() ? end : now;

  const out: Invoice[] = [];
  const cursor = new Date(start);
  for (let i = 0; i < 24 && cursor.getTime() <= cap.getTime(); i++) {
    const ps = new Date(cursor);
    const pe = new Date(cursor);
    pe.setMonth(pe.getMonth() + 1);
    pe.setDate(pe.getDate() - 1);
    out.push({
      number: `INV-${ps.getFullYear()}${String(ps.getMonth() + 1).padStart(2, "0")}`,
      start: ps.toISOString(),
      end: pe.toISOString(),
      amount: price,
      status: "paid",
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  out.reverse();

  // Upcoming renewal row.
  if (end) {
    const renew = new Date(end);
    renew.setDate(renew.getDate() + 1);
    out.unshift({
      number: "Next renewal",
      start: end.toISOString(),
      end: renew.toISOString(),
      amount: price,
      status: end.getTime() < now.getTime() ? "due" : "upcoming",
    });
  }
  return out;
}

const invoiceStatus: Record<Invoice["status"], { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-emerald-100 text-emerald-700" },
  due: { label: "Due", cls: "bg-rose-100 text-rose-700" },
  upcoming: { label: "Scheduled", cls: "bg-amber-100 text-amber-700" },
};

export default function BillingPage() {
  const { defaultPageSize, isAdmin } = useClient();
  const [data, setData] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowTs] = useState(() => Date.now());

  useEffect(() => {
    getBilling()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const invoices = useMemo(
    () => (data ? buildInvoices(data.client.plan_start, data.client.plan_end, data.plan.price, nowTs) : []),
    [data, nowTs],
  );

  if (loading) return (
    <div className="space-y-6">
      <SkeletonStats count={3} />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64" />
      </div>
    </div>
  );
  if (!data) return <Card><p className="py-10 text-center text-sm text-slate-400">Could not load billing details.</p></Card>;

  const { client, plan, catalog, features, currency } = data;
  const validity = planValidity(client.plan_start, client.plan_end);

  const invoiceColumns: Column<Invoice>[] = [
    { key: "number", header: "Invoice", lockVisible: true, width: 150, render: (inv) => <span className="font-mono text-xs text-slate-600">{inv.number}</span> },
    { key: "period", header: "Period", width: 220, render: (inv) => <span className="text-slate-600">{fmtDate(inv.start)} – {fmtDate(inv.end)}</span> },
    { key: "amount", header: "Amount", width: 130, render: (inv) => <span className="font-medium text-slate-800">{money(currency, inv.amount)}</span> },
    { key: "status", header: "Status", width: 130, render: (inv) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${invoiceStatus[inv.status].cls}`}>{invoiceStatus[inv.status].label}</span> },
  ];

  return (
    <>
      <PageHeader title="Billing" subtitle="Your plan, usage and payment details" />

      <div className="space-y-6">
        {/* Plan + payment summary */}
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Current plan hero */}
          <Card className="lg:col-span-2 overflow-hidden !p-0">
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-emerald-50">Current plan</div>
                  <div className="mt-1 flex items-center gap-3">
                    <h2 className="text-2xl font-bold">{plan.name}</h2>
                    <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold capitalize">{client.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-emerald-50">{plan.blurb}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">{money(currency, plan.price)}</div>
                  {plan.price > 0 && <div className="text-xs text-emerald-50">per {plan.cycle}</div>}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3">
              <Fact label="Started" value={fmtDate(client.plan_start)} />
              <Fact label="Renews / ends" value={fmtDate(client.plan_end)} />
              <Fact label="Status" value={<ValidityBadge start={client.plan_start} end={client.plan_end} />} />
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-4">
              <Link href="/client/chat" className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Request plan change
              </Link>
              <span className="text-xs text-slate-400">Plan changes are handled by your account manager.</span>
            </div>
          </Card>

          {/* Payment summary */}
          <Card>
            <h3 className="font-semibold text-slate-900">Payment summary</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Amount" value={money(currency, plan.price)} />
              <Row label="Billing cycle" value={plan.price > 0 ? `Monthly` : "—"} />
              <Row label="Next payment" value={client.plan_end ? fmtDate(client.plan_end) : "No expiry"} />
              <Row
                label="Subscription"
                value={<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${validity.expired ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{validity.text}</span>}
              />
            </dl>
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              Invoices are issued for each billing period. Reach out in chat for receipts or payment questions.
            </div>
          </Card>
        </div>

        {/* Plan comparison */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Available plans</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {catalog.map((p) => {
              const current = p.key === plan.key;
              return (
                <div key={p.key} className={`rounded-2xl border bg-white p-5 shadow-sm transition ${current ? "border-emerald-300 ring-2 ring-emerald-500/20" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-slate-900">{p.name}</h4>
                    {current && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Current</span>}
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{money(currency, p.price)}<span className="text-sm font-normal text-slate-400">{p.price > 0 ? `/${p.cycle}` : ""}</span></div>
                  <p className="mt-1 text-sm text-slate-500">{p.blurb}</p>
                  {current ? (
                    <div className="mt-4 rounded-lg bg-emerald-50 py-2 text-center text-sm font-medium text-emerald-700">Your plan</div>
                  ) : (
                    <Link href="/client/chat" className="mt-4 block rounded-lg border border-slate-300 py-2 text-center text-sm font-medium text-slate-600 hover:bg-slate-50">Switch to {p.name}</Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* What's included + usage */}
        <Card>
          <h3 className="font-semibold text-slate-900">What&apos;s included in your plan</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {features.map((f) => (
              <div key={f.key} className={`flex items-center gap-3 rounded-xl border p-3 ${f.enabled ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
                <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${f.enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                  {f.enabled ? (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" /></svg>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{f.label}</div>
                  {f.enabled && f.quota && (
                    <UsageBar usage={f.usage ?? 0} limit={f.limit} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Invoices */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Invoices</h3>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Print
            </button>
          </div>
          {invoices.length === 0 ? (
            <Card><p className="py-10 text-center text-sm text-slate-400">{plan.price <= 0 ? "You’re on the free plan — no invoices." : "No invoices yet. They’ll appear here once your billing period starts."}</p></Card>
          ) : (
            <DataTable<Invoice>
              tableKey="billing"
              canRenameColumns={isAdmin}
              paginate
              defaultPageSize={defaultPageSize}
              columns={invoiceColumns}
              rows={invoices}
              getKey={(inv) => `${inv.number}-${inv.start}`}
              searchKeys={(inv) => [inv.number, fmtDate(inv.start), fmtDate(inv.end), invoiceStatus[inv.status].label]}
              searchPlaceholder="Search invoices…"
              emptyTitle="No invoices"
            />
          )}
        </div>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 font-medium text-slate-800">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function UsageBar({ usage, limit }: { usage: number; limit: number | null }) {
  if (limit === null) {
    return <div className="mt-1 text-xs text-slate-400">{usage} used · Unlimited</div>;
  }
  const pct = limit > 0 ? Math.min(100, Math.round((usage / limit) * 100)) : 0;
  const over = usage >= limit;
  return (
    <div className="mt-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{usage} / {limit} used</div>
    </div>
  );
}
