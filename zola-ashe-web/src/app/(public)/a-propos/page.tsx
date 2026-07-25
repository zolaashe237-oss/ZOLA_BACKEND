import Link from "next/link";

import { PageHero } from "@/components/PageHero";
import { CurveDivider } from "@/components/Dividers";
import { SunWatermark } from "@/components/SunWatermark";
import { FloatingGlyphs } from "@/components/FloatingGlyphs";
import { SENS, VISION, MISSION, MOT_FONDATEUR, FONDATEUR, ACTIVITES, RENCONTRE } from "@/lib/livret";

export const metadata = { title: "La communauté — ZOLA ASHÉ" };

export default function CommunautePage() {
  return (
    <>
      <PageHero image="/img/communaute-danse.jpg" eyebrow="Qui nous sommes"
                title={<>Une communauté de <span className="grad-gold">personnes nées pour aider</span></>}>
        ZOLA ASHÉ est un espace de réveil, de formation et de transformation dédié aux Africains qui
        souhaitent retrouver leur souveraineté spirituelle, par le retour aux sources et la connexion
        à leurs ancêtres méritants.
      </PageHero>

      {/* Sens */}
      <section className="container-sm" style={{ padding: "4rem 1.5rem 1rem", textAlign: "center" }}>
        <p className="quote" style={{ borderLeft: "none", textAlign: "center" }}>{SENS}</p>
      </section>

      {/* Mot du fondateur complet */}
      <section className="container" style={{ padding: "3rem 1.5rem" }}>
        <div className="split">
          <div>
            <div className="eyebrow">Le mot du fondateur</div>
            <h2 style={{ margin: ".5rem 0 1.2rem" }}>Pourquoi ZOLA ASHÉ existe</h2>
            {MOT_FONDATEUR.map((p, i) => (
              <p key={i} style={{ color: "var(--muted)", marginBottom: "1rem" }}>{p}</p>
            ))}
            <p style={{ fontFamily: "var(--serif)", color: "var(--gold-2)", fontSize: "1.1rem", marginTop: ".4rem" }}>
              — {FONDATEUR}, fondateur
            </p>
          </div>
          <div className="arch-frame img-cover" style={{ backgroundImage: "url(/img/portrait-femme.jpg)", minHeight: 380 }} />
        </div>
      </section>

      {/* Vision & mission */}
      <CurveDivider color="var(--band)" height={80} />
      <section className="mudcloth-bg" style={{ background: "var(--band)", position: "relative", overflow: "hidden" }}>
        <FloatingGlyphs />
        <div className="container" style={{ padding: "4rem 1.5rem", position: "relative" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.2rem" }} className="vm-grid">
            <div className="card card-lux">
              <div className="eyebrow">Notre vision</div>
              <p style={{ marginTop: ".9rem", fontSize: "1.06rem", color: "var(--cream)", lineHeight: 1.7 }}>{VISION}</p>
            </div>
            <div className="card card-lux">
              <div className="eyebrow">Notre mission</div>
              <p style={{ marginTop: ".9rem", fontSize: "1.06rem", color: "var(--cream)", lineHeight: 1.7 }}>{MISSION}</p>
            </div>
          </div>
        </div>
      </section>
      <CurveDivider color="var(--bg)" height={80} />

      {/* Activités */}
      <section className="container" style={{ padding: "4rem 1.5rem", position: "relative", overflow: "hidden" }}>
        <SunWatermark side="left" top="20%" size={400} />
        <div className="eyebrow center" style={{ textAlign: "center", display: "block", position: "relative" }}>La vie de la communauté</div>
        <h2 style={{ textAlign: "center", margin: ".6rem 0 2.4rem", position: "relative" }}>Apprendre, échanger, agir</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "1.1rem" }}>
          {ACTIVITES.map((a) => (
            <div key={a.titre} className="card card-hover">
              <h3 style={{ fontSize: "1.2rem", marginBottom: ".5rem" }}>{a.titre}</h3>
              <p style={{ color: "var(--muted)", fontSize: ".93rem" }}>{a.desc}</p>
            </div>
          ))}
        </div>
        <p style={{ textAlign: "center", color: "var(--muted)", marginTop: "2rem" }}>
          Séance hebdomadaire&nbsp;: <strong className="text-gold">{RENCONTRE.jour} · {RENCONTRE.heure}</strong> ({RENCONTRE.zone}).
        </p>
        <div style={{ textAlign: "center", marginTop: "1.6rem" }}>
          <Link href="/register" className="btn btn-primary">Rejoindre la communauté</Link>
        </div>
      </section>
    </>
  );
}
