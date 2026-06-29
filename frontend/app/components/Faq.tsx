"use client";

import { useState } from "react";

const faqs = [
  {
    q: "How long does it take to get set up?",
    a: "Most teams are live in under 15 minutes. Import your leads from a CSV or connect your existing tools, and your pipeline is ready to go — no engineering required.",
  },
  {
    q: "Can I import leads from my current CRM?",
    a: "Yes. LeadFlow imports from CSV and connects to popular tools so you can bring your contacts, deals, and history across without losing data.",
  },
  {
    q: "Is my data secure?",
    a: "Your data is encrypted in transit and at rest, with role-based access control, audit logs, and 99.9% uptime backed by our SLA on Enterprise plans.",
  },
  {
    q: "Do you offer a free trial?",
    a: "The Starter plan is free forever for up to 3 users. You can upgrade to Growth any time — and request a demo to see the advanced features first.",
  },
  {
    q: "What kind of support do I get?",
    a: "Every plan includes email support. Growth adds priority support, and Enterprise includes a dedicated account manager and guided onboarding.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto max-w-3xl divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {faqs.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
            >
              <span className="font-semibold text-slate-900">{item.q}</span>
              <svg
                className={`h-5 w-5 flex-shrink-0 text-indigo-600 transition-transform duration-300 ${
                  isOpen ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div
              className={`grid overflow-hidden px-6 transition-all duration-300 ease-out ${
                isOpen ? "grid-rows-[1fr] pb-5 opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 text-sm leading-relaxed text-slate-600">
                {item.a}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
