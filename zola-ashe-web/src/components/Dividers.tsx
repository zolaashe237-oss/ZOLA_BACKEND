"use client";

import { useId } from "react";

/** Transitions de section en formes parlantes (SVG) avec arête dorée lumineuse.
 *  `color` = couleur de la section qui SUIT. */
type DProps = { color?: string; height?: number; glow?: boolean; className?: string };

const box = (h: number): React.CSSProperties => ({
  display: "block", width: "100%", height: h, marginBottom: -1, position: "relative", zIndex: 1,
});

function Divider({ fill, edge, height, color, glow }: { fill: string; edge: string; height: number; color: string; glow: boolean }) {
  const gid = "za" + useId().replace(/[:]/g, "");
  return (
    <svg viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden style={box(height)}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--gold)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--gold-2)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--terra)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={color} />
      {glow && <path d={edge} fill="none" stroke={`url(#${gid})`} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Arche centrée : la section suivante s'élève en dôme (porte / lever de soleil). */
export function ArchDivider({ color = "var(--bg)", height = 90, glow = true }: DProps) {
  return <Divider color={color} height={height} glow={glow}
    fill="M0,120 L0,52 Q720,-56 1440,52 L1440,120 Z" edge="M0,52 Q720,-56 1440,52" />;
}

/** Courbe organique asymétrique. */
export function CurveDivider({ color = "var(--bg)", height = 90, glow = true }: DProps) {
  return <Divider color={color} height={height} glow={glow}
    fill="M0,120 L0,72 C420,8 980,140 1440,46 L1440,120 Z" edge="M0,72 C420,8 980,140 1440,46" />;
}

/** Biais diagonal net. */
export function SlantDivider({ color = "var(--bg)", height = 70, glow = true }: DProps) {
  return <Divider color={color} height={height} glow={glow}
    fill="M0,120 L1440,18 L1440,120 Z" edge="M0,120 L1440,18" />;
}
