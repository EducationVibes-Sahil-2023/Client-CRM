// Client-panel branding/appearance: types, defaults, and the colour-scale
// machinery that lets a single brand hex re-theme the whole UI.
//
// The app is built on Tailwind v4, where every `emerald-*` utility compiles to
// `var(--color-emerald-NNN)`. So overriding those CSS variables on the client
// shell root recolours the entire panel without touching component classes.

export type ThemeMode = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type SidebarStyle = "subtle" | "solid";

export interface Branding {
  brand_color: string;
  app_name: string;
  app_tagline: string;
  logo_url: string;
  theme_mode: ThemeMode;
  density: Density;
  sidebar_style: SidebarStyle;
  menu_order: string[];
}

export const DEFAULT_BRANDING: Branding = {
  brand_color: "#10b981",
  app_name: "My CRM",
  app_tagline: "Client Panel",
  logo_url: "",
  theme_mode: "light",
  density: "comfortable",
  sidebar_style: "subtle",
  menu_order: [],
};

// The Tailwind shade stops we generate. The picked colour anchors 600 (the
// shade primary buttons use); lighter stops mix toward white, darker toward
// black. Ratios are tuned to roughly match Tailwind's own perceptual spacing.
const STOPS: Record<number, { toward: "white" | "black"; amount: number }> = {
  50: { toward: "white", amount: 0.93 },
  100: { toward: "white", amount: 0.84 },
  200: { toward: "white", amount: 0.68 },
  300: { toward: "white", amount: 0.5 },
  400: { toward: "white", amount: 0.3 },
  500: { toward: "white", amount: 0.12 },
  600: { toward: "white", amount: 0 }, // base
  700: { toward: "black", amount: 0.14 },
  800: { toward: "black", amount: 0.28 },
  900: { toward: "black", amount: 0.42 },
  950: { toward: "black", amount: 0.58 },
};

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x10b981;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(c: RGB, target: RGB, amount: number): RGB {
  return [
    c[0] + (target[0] - c[0]) * amount,
    c[1] + (target[1] - c[1]) * amount,
    c[2] + (target[2] - c[2]) * amount,
  ];
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [15, 23, 42]; // slate-900, softer than pure black for shades

/** Full 50–950 hex scale generated from a single brand colour (anchored at 600). */
export function shadeScale(hex: string): Record<number, string> {
  const base = hexToRgb(hex);
  const scale: Record<number, string> = {};
  for (const [stop, { toward, amount }] of Object.entries(STOPS)) {
    scale[Number(stop)] = rgbToHex(mix(base, toward === "white" ? WHITE : BLACK, amount));
  }
  return scale;
}

/**
 * CSS custom properties that override Tailwind's emerald scale with the brand
 * scale. Spread onto a `style` object on the client shell root.
 */
export function brandCssVars(hex: string): React.CSSProperties {
  const scale = shadeScale(hex);
  const vars: Record<string, string> = { "--brand": hex };
  for (const [stop, value] of Object.entries(scale)) {
    vars[`--color-emerald-${stop}`] = value;
  }
  return vars as React.CSSProperties;
}

/** Relative luminance → pick black/white text that reads on the brand colour. */
export function readableOn(hex: string): "#ffffff" | "#0f172a" {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#0f172a" : "#ffffff";
}

/** Resolve "system" mode to a concrete light/dark using the OS preference. */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}
