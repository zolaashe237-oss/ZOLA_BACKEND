"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

/** Translate son contenu en fonction du scroll (effet de profondeur/parallaxe). */
export function Parallax({
  speed = 0.18, axis = "y", children, className = "", style,
}: {
  speed?: number; axis?: "y" | "x"; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      const r = el.getBoundingClientRect();
      const offset = r.top + r.height / 2 - window.innerHeight / 2;
      const v = (-offset * speed).toFixed(1);
      el.style.transform = axis === "y" ? `translate3d(0,${v}px,0)` : `translate3d(${v}px,0,0)`;
    };
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, [speed, axis]);

  return <div ref={ref} className={className} style={{ willChange: "transform", ...style }}>{children}</div>;
}
