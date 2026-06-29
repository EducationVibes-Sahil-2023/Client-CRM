"use client";

import { useEffect, useRef, useState } from "react";

interface CounterProps {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number; // ms
}

/** Counts up from 0 to `to` the first time it scrolls into view. */
export default function Counter({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1600,
}: CounterProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || started.current) return;
      started.current = true;

      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(to * eased);
        if (progress < 1) requestAnimationFrame(tick);
        else setValue(to);
      };
      requestAnimationFrame(tick);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}
