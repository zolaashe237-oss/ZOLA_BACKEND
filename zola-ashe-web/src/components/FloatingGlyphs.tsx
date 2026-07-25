"use client";

import { Parallax } from "./Parallax";
import { GlyphStar, GlyphSpiral, GlyphRings } from "./AfricanMotifs";

type Item = { C: typeof GlyphStar; top: string; left?: string; right?: string; size: number; speed: number; op: number };

const DEFAULT: Item[] = [
  { C: GlyphStar, top: "14%", left: "5%", size: 64, speed: 0.30, op: 0.28 },
  { C: GlyphSpiral, top: "58%", right: "7%", size: 78, speed: 0.20, op: 0.24 },
  { C: GlyphRings, top: "30%", right: "15%", size: 50, speed: 0.42, op: 0.22 },
];

/** Symboles adinkra qui flottent en parallaxe (profondeur vivante).
 *  À placer dans une section `position: relative; overflow: hidden`. */
export function FloatingGlyphs({ items = DEFAULT, color = "var(--gold)" }: { items?: Item[]; color?: string }) {
  return (
    <>
      {items.map((g, i) => (
        <Parallax key={i} speed={g.speed}
          style={{ position: "absolute", top: g.top, left: g.left, right: g.right,
                   color, opacity: g.op, zIndex: 0, pointerEvents: "none" }}>
          <g.C size={g.size} />
        </Parallax>
      ))}
    </>
  );
}
