import Link from "next/link";

import { HeroSlider } from "@/components/landing/HeroSlider";
import { BlogTeaser } from "@/components/landing/BlogTeaser";
import { Reveal } from "@/components/Reveal";
import { ArchDivider, CurveDivider } from "@/components/Dividers";
import { SunWatermark } from "@/components/SunWatermark";
import { FloatingGlyphs } from "@/components/FloatingGlyphs";
import { SENS, VISION, MISSION, VALEURS, MOT_FONDATEUR, FONDATEUR, RENCONTRE, ADHESION } from "@/lib/livret";

/* Vitrine publique ZOLA ASHÉ — fidèle au livret officiel, esthétique terre & or / africtude. */

const PILIERS = [
  { tag: "Chaque semaine", title: "Enseignements en direct", desc: `Une séance hebdomadaire le ${RENCONTRE.jour.toLowerCase()} de ${RENCONTRE.heure} (${RENCONTRE.zone}) pour apprendre et échanger ensemble.` },
  { tag: "10 ouvrages", title: "Livres & ressources", desc: "Une bibliothèque remise dès l’intégration : spiritualité, discipline, identité, connaissance de soi." },
  { tag: "Une nouvelle / mois", title: "Formations complètes", desc: "Des parcours structurés, dont un programme de 22 modules — enrichi chaque mois." },
  { tag: "À l’inscription", title: "Coaching privé", desc: `30 minutes en tête-à-tête avec le fondateur, ${FONDATEUR}, pour orienter votre cheminement.` },
];

export default function HomePage() {
  return (
    <>
      <HeroSlider />
      <ArchDivider color="var(--bg)" height={100} />

      {/* ---------- Le sens ---------- */}
      <section className="container" style={{ padding: "2.5rem 1.5rem 1rem", textAlign: "center" }}>
        <div className="eyebrow">Zola Ashé</div>
        <p className="quote" style={{ borderLeft: "none", maxWidth: 820, margin: "1rem auto 0", textAlign: "center" }}>
          {SENS}
        </p>
      </section>

      {/* ---------- Mot du fondateur ---------- */}
      <Reveal as="section" className="container" style={{ padding: "4.5rem 1.5rem" }}>
        <div className="split">
          <div className="arch-frame img-cover" style={{ backgroundImage: "url(/img/portrait-femme.jpg)", minHeight: 380 }} />
          <div>
            <div className="eyebrow">Le mot du fondateur</div>
            <h2 style={{ margin: ".5rem 0 1.2rem" }}>Une école de l’esprit et de la conscience</h2>
            <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>{MOT_FONDATEUR[1]}</p>
            <p style={{ color: "var(--muted)", marginBottom: "1.4rem" }}>{MOT_FONDATEUR[2]}</p>
            <Link href="/a-propos" className="btn btn-outline">Découvrir la communauté</Link>
          </div>
        </div>
      </Reveal>

      {/* ---------- Vision & mission ---------- */}
      <CurveDivider color="var(--band)" height={80} />
      <section className="mudcloth-bg" style={{ background: "var(--band)", position: "relative", overflow: "hidden" }}>
        <FloatingGlyphs />
        <Reveal className="container" style={{ padding: "4rem 1.5rem", position: "relative" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.2rem" }} className="vm-grid">
            <div className="card card-lux">
              <div className="eyebrow">Notre vision</div>
              <p style={{ marginTop: ".9rem", fontSize: "1.08rem", color: "var(--cream)", lineHeight: 1.7 }}>{VISION}</p>
            </div>
            <div className="card card-lux">
              <div className="eyebrow">Notre mission</div>
              <p style={{ marginTop: ".9rem", fontSize: "1.08rem", color: "var(--cream)", lineHeight: 1.7 }}>{MISSION}</p>
            </div>
          </div>
        </Reveal>
      </section>
      <CurveDivider color="var(--bg)" height={80} />

      {/* ---------- Ce que vous y trouverez ---------- */}
      <section id="programme" style={{ padding: "2.5rem 0 5.5rem", position: "relative", overflow: "hidden" }}>
        <SunWatermark side="right" top="-6%" size={460} />
        <Reveal className="container" style={{ position: "relative" }}>
          <div className="eyebrow center" style={{ textAlign: "center", display: "block" }}>Ce que vous y trouverez</div>
          <h2 style={{ textAlign: "center", margin: ".7rem 0 2.6rem" }}>Un véritable parcours d’apprentissage</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "1.1rem" }}>
            {PILIERS.map((p, i) => (
              <Reveal key={p.title} delay={i * 90} className="card card-hover card-lux">
                <span className="badge" style={{ marginBottom: ".9rem" }}>{p.tag}</span>
                <h3 style={{ fontSize: "1.25rem", marginBottom: ".5rem" }}>{p.title}</h3>
                <p style={{ color: "var(--muted)", fontSize: "0.94rem" }}>{p.desc}</p>
              </Reveal>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: "2.4rem" }}>
            <Link href="/programme" className="btn btn-ghost">Voir tout le programme →</Link>
          </div>
        </Reveal>
      </section>

      {/* ---------- Les 7 valeurs (aperçu) ---------- */}
      <Reveal as="section" className="container" style={{ padding: "5rem 1.5rem", position: "relative", overflow: "hidden" }}>
        <SunWatermark side="left" top="30%" size={420} opacity={0.06} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap",
                      gap: "1rem", marginBottom: "2rem", position: "relative" }}>
          <div>
            <div className="eyebrow">Notre socle</div>
            <h2 style={{ margin: ".5rem 0 0" }}>Les 7 valeurs qui nous unissent</h2>
          </div>
          <Link href="/valeurs" className="btn btn-ghost">Valeurs & principes →</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          {VALEURS.map((v, idx) => (
            <Reveal key={v.nom} delay={idx * 70} className="card card-hover card-lux"
                    style={{ display: "flex", gap: ".9rem", alignItems: "flex-start" }}>
              <span className="num">{idx + 1}</span>
              <div>
                <h3 style={{ fontSize: "1.1rem", marginBottom: ".3rem" }}>{v.nom}</h3>
                <p style={{ color: "var(--muted)", fontSize: ".88rem" }}>{v.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Reveal>

      {/* ---------- CTA adhésion ---------- */}
      <Reveal as="section" className="container" style={{ padding: "1rem 1.5rem 5.5rem" }}>
        <div className="card card-lux warm-halo" style={{ position: "relative", overflow: "hidden", padding: 0 }}>
          <div className="split" style={{ gap: 0 }}>
            <div className="img-cover" style={{ backgroundImage: "url(/img/unite-mains.jpg)", minHeight: 280 }} />
            <div style={{ padding: "3rem 2.2rem" }}>
              <div className="eyebrow">Rejoindre ZOLA ASHÉ</div>
              <h2 style={{ margin: ".5rem 0 1rem" }}>Faites le premier pas</h2>
              <p className="lead" style={{ marginBottom: "1.4rem" }}>
                Adhésion unique de <strong className="text-gold">{ADHESION.inscription.montant}</strong>{" "}
                <span style={{ color: "var(--muted)" }}>({ADHESION.inscription.equiv})</span>, puis une cotisation
                mensuelle de <strong className="text-gold">{ADHESION.cotisation.montant}</strong> pour soutenir la communauté.
              </p>
              <div style={{ display: "flex", gap: ".8rem", flexWrap: "wrap" }}>
                <Link href="/register" className="btn btn-primary">Devenir membre</Link>
                <Link href="/adhesion" className="btn btn-outline">Voir les conditions</Link>
              </div>
            </div>
          </div>
          <div className="kente-band" style={{ position: "absolute", top: 0, left: 0 }} />
        </div>
      </Reveal>

      {/* ---------- Journal ---------- */}
      <BlogTeaser />
    </>
  );
}
