"use client";

import type { CSSProperties } from "react";

import { Parallax } from "./Parallax";
import { SunMark } from "./AfricanMotifs";

/** Soleil décoratif en filigrane (parallaxe + rotation lente). À placer dans une
 *  section `position: relative; overflow: hidden`. */
export function SunWatermark({
  size = 440, side = "right", top = "-12%", speed = 0.12, opacity = 0.07, color = "var(--gold)",
}: {
  size?: number; side?: "left" | "right"; top?: string; speed?: number; opacity?: number; color?: string;
}) {
  const pos: CSSProperties = {
    position: "absolute", top, color, opacity, zIndex: 0, pointerEvents: "none",
    ...(side === "right" ? { right: "-9%" } : { left: "-9%" }),
  };
  return (
    <Parallax speed={speed} className="sun-spin" style={pos}>
      <SunMark size={size} />
    </Parallax>
  );
}
