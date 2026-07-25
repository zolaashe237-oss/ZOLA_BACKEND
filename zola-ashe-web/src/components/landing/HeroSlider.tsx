"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Parallax } from "@/components/Parallax";
import { SunMark } from "@/components/AfricanMotifs";

type Slide = { eyebrow: string; title: React.ReactNode; text: string; cta: string; href: string; image: string };

const SLIDES: Slide[] = [
  {
    eyebrow: "Communauté · École de conscience · Retour aux sources",
    title: (<>L’amour qui devient <br /><span className="grad-gold">une force de transformation.</span></>),
    text: "ZOLA ASHÉ est une école de formation de l’esprit, du caractère et de la conscience — pour les Africains qui veulent retrouver leur identité, leur sagesse et leur souveraineté spirituelle.",
    cta: "Rejoindre la communauté",
    href: "/register",
    image: "/img/hero-savane.jpg",
  },
  {
    eyebrow: "Apprendre · Se découvrir · S’élever",
    title: (<>Une génération <br /><span className="grad-gold">consciente et enracinée.</span></>),
    text: "Enseignements hebdomadaires, formations, livres et coaching : un parcours progressif pour mieux se connaître, se discipliner et impacter positivement son entourage.",
    cta: "Découvrir les enseignements",
    href: "/programme",
    image: "/img/communaute-danse.jpg",
  },
  {
    eyebrow: "Né pour aider",
    title: (<>Une communauté <br /><span className="grad-gold">de personnes qui s’élèvent.</span></>),
    text: "Rejoignez des hommes et des femmes déterminés à apprendre, à grandir et à utiliser la connaissance pour construire une vie alignée et utile à la société.",
    cta: "Pourquoi rejoindre ?",
    href: "/adhesion",
    image: "/img/djembe.jpg",
  },
];

export function HeroSlider() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((p) => (p + 1) % SLIDES.length), 6500);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="warm-halo"
             style={{ position: "relative", overflow: "hidden" }}>
      {/* Soleil rayonnant en parallaxe (motif du logo) */}
      <Parallax speed={0.25} className="sun-spin"
                style={{ position: "absolute", top: "-12%", right: "-10%", color: "var(--gold-2)",
                         opacity: 0.18, zIndex: 0, pointerEvents: "none" }}>
        <SunMark size={520} />
      </Parallax>
      <div className="container" style={{ position: "relative", zIndex: 1, height: "min(86vh, 680px)", minHeight: 500 }}>
        {SLIDES.map((s, idx) => (
          <div key={idx} className={`slide ${idx === i ? "active" : ""}`}>
            <div aria-hidden style={{
              position: "absolute", inset: 0, zIndex: -1,
              backgroundImage:
                `linear-gradient(rgba(15,13,11,0.72), rgba(15,13,11,0.92)), radial-gradient(800px 420px at 80% 8%, rgba(110,31,31,0.45), transparent 60%), url(${s.image})`,
              backgroundSize: "cover", backgroundPosition: "center",
            }} />
            <div className="eyebrow" style={{ marginBottom: "1rem" }}>{s.eyebrow}</div>
            <h1 style={{ margin: "0 auto 1.3rem", maxWidth: 900 }}>{s.title}</h1>
            <p className="lead" style={{ maxWidth: 620, margin: "0 auto 2.2rem" }}>{s.text}</p>
            <div style={{ display: "flex", gap: "0.9rem", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href={s.href} className="btn btn-primary">{s.cta}</Link>
              <Link href="/a-propos" className="btn btn-ghost">Découvrir ZOLA ASHÉ</Link>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", bottom: "1.8rem", left: 0, right: 0, zIndex: 2 }}>
        <div className="slider-dots">
          {SLIDES.map((_, idx) => (
            <button key={idx} aria-label={`Vue ${idx + 1}`}
                    className={`slider-dot ${idx === i ? "on" : ""}`} onClick={() => setI(idx)} />
          ))}
        </div>
      </div>
    </section>
  );
}
