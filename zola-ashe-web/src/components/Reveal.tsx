"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";

/** Révèle son contenu en douceur quand il entre dans le viewport (scroll). */
export function Reveal({
  children, as: Tag = "div", delay = 0, className = "", style,
}: {
  children: ReactNode; as?: ElementType; delay?: number; className?: string; style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`reveal ${visible ? "is-visible" : ""} ${className}`.trim()}
         style={{ transitionDelay: `${delay}ms`, ...style }}>
      {children}
    </Tag>
  );
}
