import type { CSSProperties, ReactNode } from "react";

import { ArchDivider } from "@/components/Dividers";

/** En-tête de page intérieure : image (parallaxe) + voile chaud + titre + arche. */
export function PageHero({ image, eyebrow, title, children }: {
  image: string; eyebrow: string; title: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="page-hero" style={{ "--hero-img": `url(${image})`, paddingBottom: "5.5rem" } as CSSProperties}>
      <div className="container-sm" style={{ position: "relative" }}>
        <div className="eyebrow">{eyebrow}</div>
        <h1 style={{ margin: ".7rem 0 .9rem" }}>{title}</h1>
        {children && <p className="lead" style={{ maxWidth: 640, margin: "0 auto" }}>{children}</p>}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 1 }}>
        <ArchDivider color="var(--bg)" height={80} />
      </div>
    </section>
  );
}
