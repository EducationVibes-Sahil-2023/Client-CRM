"use client";

import type { LucideIcon } from "lucide-react";

/**
 * Animation presets. Hover variants (pop/wiggle/bounce/tada) play when the
 * icon's nearest `.group` ancestor is hovered — wrap the icon in a `group`
 * element (most nav links / cards already are). The `*-loop` variants animate
 * continuously on their own (good for empty states / live badges).
 */
export type IconAnim =
  | "pop" | "wiggle" | "bounce" | "tada"
  | "float-loop" | "bounce-loop" | "spin-loop" | "tada-loop"
  | "hover" | "none";

const ANIM_CLASS: Record<IconAnim, string> = {
  pop: "anim-ico",
  wiggle: "anim-ico anim-ico-wiggle",
  bounce: "anim-ico anim-ico-bounce",
  tada: "anim-ico anim-ico-tada",
  hover: "anim-ico anim-ico-hover",
  "float-loop": "anim-ico-loop-float",
  "bounce-loop": "anim-ico-loop-bounce",
  "spin-loop": "anim-ico-loop-spin",
  "tada-loop": "anim-ico-loop-tada",
  none: "",
};

/**
 * A lucide icon with a built-in motion preset. Backed by the CSS animation
 * layer in globals.css, so it respects `prefers-reduced-motion` automatically.
 *
 *   import { Inbox } from "lucide-react";
 *   <AnimatedIcon icon={Inbox} animation="float-loop" size={28} />
 */
export function AnimatedIcon({
  icon: Icon,
  animation = "pop",
  className = "",
  size = 20,
  strokeWidth = 2,
}: {
  icon: LucideIcon;
  animation?: IconAnim;
  className?: string;
  size?: number;
  strokeWidth?: number;
}) {
  return <Icon className={`${ANIM_CLASS[animation]} ${className}`.trim()} size={size} strokeWidth={strokeWidth} aria-hidden />;
}
