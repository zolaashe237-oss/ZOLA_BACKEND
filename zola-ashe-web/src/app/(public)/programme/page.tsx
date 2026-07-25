import Link from "next/link";

import { PageHero } from "@/components/PageHero";
import { CurveDivider } from "@/components/Dividers";
import { FloatingGlyphs } from "@/components/FloatingGlyphs";
import { LIVRES, FORMATIONS, RENCONTRE, FONDATEUR } from "@/lib/livret";

export const metadata = { title: "Enseignements & formations — ZOLA ASHÉ" };

export default function ProgrammePage() {
  return (
    <>
      <PageHero image="/img/savoir-bougie.jpg" eyebrow="Le programme d’enseignement"
                title={<>La connaissance, <span className="grad-gold">chemin de libération</span></>}>
        Un programme progressif qui explore la spiritualité africaine, la connaissance de soi, les lois
        de la vie, la discipline et le leadership — pour agir avec plus de clarté et d’impact.
      </PageHero>

      {/* Chiffres clés */}
      <section className="container" style={{ padding: "3.5rem 1.5rem 1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1.1rem" }}>
          {[
            { n: "10", l: "livres offerts" },
            { n: "8+", l: "formations complètes" },
            { n: "22", l: "modules — Dominer son année" },
            { n: "1 / mois", l: "nouvelle formation" },
          ].map((s) => (
            <div key={s.l} className="card stat">
              <div className="stat-num grad-gold">{s.n}</div>
              <div className="stat-label">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Séances hebdo */}
      <section className="container" style={{ padding: "2.5rem 1.5rem" }}>
        <div className="card warm-halo" style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
          <div>
            <div className="eyebrow">Rendez-vous hebdomadaire</div>
            <h2 style={{ margin: ".4rem 0 .3rem", fontSize: "1.7rem" }}>Les séances en direct</h2>
            <p style={{ color: "var(--muted)" }}>
              Chaque semaine, la communauté se réunit pour enseigner, partager et répondre aux questions.
            </p>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--serif)", fontSize: "2rem", fontWeight: 700 }} className="text-gold">
              {RENCONTRE.jour}
            </div>
            <div style={{ color: "var(--cream)" }}>{RENCONTRE.heure}</div>
            <div style={{ color: "var(--muted-2)", fontSize: ".82rem" }}>{RENCONTRE.zone}</div>
          </div>
        </div>
      </section>

      {/* Livres */}
      <CurveDivider color="var(--band)" height={80} />
      <section className="mudcloth-bg" style={{ background: "var(--band)", position: "relative", overflow: "hidden" }}>
        <FloatingGlyphs />
        <div className="container" style={{ padding: "4rem 1.5rem", position: "relative" }}>
          <div className="eyebrow center" style={{ textAlign: "center", display: "block" }}>La bibliothèque du membre</div>
          <h2 style={{ textAlign: "center", margin: ".6rem 0 2.4rem" }}>10 ouvrages remis dès l’intégration</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
            {LIVRES.map((b, idx) => (
              <div key={b.titre} className="card card-hover" style={{ display: "flex", gap: ".9rem", alignItems: "flex-start" }}>
                <span className="num">{String(idx + 1).padStart(2, "0")}</span>
                <div>
                  <h3 style={{ fontSize: "1.08rem", marginBottom: ".3rem" }}>{b.titre}</h3>
                  <p style={{ color: "var(--muted)", fontSize: ".88rem" }}>{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <CurveDivider color="var(--bg)" height={80} />

      {/* Formations */}
      <section className="container" style={{ padding: "4rem 1.5rem" }}>
        <div className="eyebrow" style={{ textAlign: "center" }}>Parcours de formation</div>
        <h2 style={{ textAlign: "center", margin: ".6rem 0 2.4rem" }}>Des formations complètes & pratiques</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
          {FORMATIONS.map((f, idx) => {
            const featured = idx === FORMATIONS.length - 1;
            return (
              <div key={f.titre} className="card card-hover"
                   style={{ borderColor: featured ? "var(--gold)" : undefined }}>
                {featured && <span className="badge" style={{ marginBottom: ".7rem" }}>Programme phare</span>}
                <h3 style={{ fontSize: "1.12rem", marginBottom: ".4rem" }}>{f.titre}</h3>
                <p style={{ color: "var(--muted)", fontSize: ".9rem" }}>{f.desc}</p>
              </div>
            );
          })}
        </div>
        <p style={{ textAlign: "center", color: "var(--muted)", marginTop: "2rem" }}>
          Et une <strong className="text-gold">nouvelle formation chaque mois</strong>, plus 30 min de coaching privé
          avec {FONDATEUR} à l’inscription.
        </p>
        <div style={{ textAlign: "center", marginTop: "1.6rem" }}>
          <Link href="/adhesion" className="btn btn-primary">Accéder aux formations</Link>
        </div>
      </section>
    </>
  );
}
