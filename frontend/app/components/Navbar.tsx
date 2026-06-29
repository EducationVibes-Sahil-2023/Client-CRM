"use client";

import { useState } from "react";
import Link from "next/link";

const links = [
  { href: "#product", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#demo", label: "Demo" },
  { href: "#contact", label: "Contact" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold text-indigo-600">
          LeadFlow
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition"
            >
              {l.label}
            </a>
          ))}
          <Link
            href="/login"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
          >
            Login
          </Link>
        </div>

        <button
          className="md:hidden text-slate-700"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
      </nav>

      {open && (
        <div className="md:hidden border-t border-slate-200 bg-white px-6 py-4 space-y-3">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block text-sm font-medium text-slate-600 hover:text-indigo-600"
            >
              {l.label}
            </a>
          ))}
          <Link
            href="/login"
            className="block rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-semibold text-white"
          >
            Login
          </Link>
        </div>
      )}
    </header>
  );
}
