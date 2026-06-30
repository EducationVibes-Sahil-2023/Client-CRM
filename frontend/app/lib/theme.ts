// Client-panel branding/appearance: types, defaults, and the colour-scale
// machinery that lets a single brand hex re-theme the whole UI.
//
// The app is built on Tailwind v4, where every `emerald-*` utility compiles to
// `var(--color-emerald-NNN)`. So overriding those CSS variables on the client
// shell root recolours the entire panel without touching component classes.

export type ThemeMode = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type SidebarStyle = "subtle" | "solid";
export type FontFamily = "inter" | "poppins" | "slab" | "mono" | "system";
export type FontSize = "sm" | "base" | "lg";

export interface Branding {
  brand_color: string;
  app_name: string;
  app_tagline: string;
  logo_url: string;
  /** Browser tab icon (favicon) — a separate upload from the sidebar logo. */
  favicon_url: string;
  /** Sidebar logo box size in px (stored as strings). Supports wide logos. */
  logo_width: string;
  logo_height: string;
  theme_mode: ThemeMode;
  density: Density;
  sidebar_style: SidebarStyle;
  menu_order: string[];
  /** Per-nav-key custom label overrides (key → label). */
  menu_labels: Record<string, string>;
  /** Per-nav-key custom icon overrides (key → icon name). */
  menu_icons: Record<string, string>;
  /** Default rows-per-page for every data table (stored as a string, e.g. "15"). */
  default_page_size: string;
  /** Typeface for the whole client dashboard. */
  font_family: FontFamily;
  /** Base text size for the whole client dashboard. */
  font_size: FontSize;
}

/** Selectable typefaces. `stack` references the next/font CSS vars set on <html>. */
export const FONT_FAMILY_OPTIONS: { value: FontFamily; label: string; stack: string }[] = [
  { value: "inter", label: "Inter", stack: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" },
  { value: "poppins", label: "Poppins", stack: "var(--font-poppins), ui-sans-serif, system-ui, sans-serif" },
  { value: "slab", label: "Slab", stack: "var(--font-slab), Georgia, 'Times New Roman', serif" },
  { value: "mono", label: "Mono", stack: "var(--font-mono-custom), ui-monospace, 'Courier New', monospace" },
  { value: "system", label: "System", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
];

/** Base font sizes — scale the whole dashboard's relative (rem) text. */
export const FONT_SIZE_OPTIONS: { value: FontSize; label: string; px: string }[] = [
  { value: "sm", label: "Small", px: "15px" },
  { value: "base", label: "Default", px: "16px" },
  { value: "lg", label: "Large", px: "18px" },
];

/** The CSS font-family stack for a saved font_family (falls back to Inter). */
export function fontStack(f: FontFamily | undefined): string {
  return FONT_FAMILY_OPTIONS.find((o) => o.value === f)?.stack ?? FONT_FAMILY_OPTIONS[0].stack;
}

/** The base font-size (px) for a saved font_size (falls back to 16px). */
export function fontSizePx(s: FontSize | undefined): string {
  return FONT_SIZE_OPTIONS.find((o) => o.value === s)?.px ?? "16px";
}

/** Logo box bounds (px). Width allows wide logos; height stays sidebar-friendly. */
export const LOGO_WIDTH_RANGE = { min: 24, max: 220, default: 40 } as const;
export const LOGO_HEIGHT_RANGE = { min: 24, max: 80, default: 40 } as const;

/** Clamp the stored logo width/height into a safe px range (falls back to 40×40). */
export function resolveLogoSize(width: string | number | undefined, height: string | number | undefined): { width: number; height: number } {
  const clamp = (v: string | number | undefined, r: { min: number; max: number; default: number }) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(r.max, Math.max(r.min, Math.round(n))) : r.default;
  };
  return { width: clamp(width, LOGO_WIDTH_RANGE), height: clamp(height, LOGO_HEIGHT_RANGE) };
}

/** Allowed "rows per page" values, shared by the picker and table page-size menus. */
export const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100] as const;

/** Parse a stored default_page_size into a valid number, falling back to 15. */
export function resolvePageSize(value: string | number | null | undefined): number {
  const n = Number(value);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : 15;
}

export const DEFAULT_BRANDING: Branding = {
  brand_color: "#10b981",
  app_name: "My CRM",
  app_tagline: "Client Panel",
  logo_url: "",
  favicon_url: "",
  logo_width: "40",
  logo_height: "40",
  theme_mode: "light",
  density: "comfortable",
  sidebar_style: "subtle",
  menu_order: [],
  menu_labels: {},
  menu_icons: {},
  default_page_size: "15",
  font_family: "inter",
  font_size: "base",
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
