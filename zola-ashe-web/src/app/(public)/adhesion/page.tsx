import Link from "next/link";

import { PageHero } from "@/components/PageHero";
import { CurveDivider } from "@/components/Dividers";
import { FloatingGlyphs } from "@/components/FloatingGlyphs";
import { DEVENIR, AVANTAGES, ADHESION, USAGE_COTISATION } from "@/lib/livret";

export const metadata = { title: "Adhésion — Rejoindre ZOLA ASHÉ" };

const TARIFS = [ADHESION.inscription, ADHESION.cotisation, ADHESION.don];

export default function AdhesionPage() {
  return (
    <>
      <PageHero image="/img/groupe.jpg" eyebrow="Rejoindre la communauté"
                title={<>Investir dans <span className="grad-gold">votre évolution</span></>}>
        Rejoindre ZOLA ASHÉ, ce n’est pas payer pour intégrer un groupe : c’est accéder à un véritable
        écosystème de formation, de connaissance et d’accompagnement.
      </PageHero>

      {/* Ce que vous devenez */}
      <section className="container" style={{ padding: "4rem 1.5rem" }}>
        <div className="eyebrow" style={{ textAlign: "center" }}>Ce que vous devenez</div>
        <h2 style={{ textAlign: "center", margin: ".6rem 0 2.4rem" }}>En rejoignant la communauté</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
          {DEVENIR.map((d) => (
            <div key={d.titre} className="card card-hover">
              <h3 style={{ fontSize: "1.15rem", marginBottom: ".4rem" }}>{d.titre}</h3>
              <p style={{ color: "var(--muted)", fontSize: ".92rem" }}>{d.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Avantages */}
      <CurveDivider color="var(--band)" height={80} />
      <section className="mudcloth-bg" style={{ background: "var(--band)", position: "relative", overflow: "hidden" }}>
        <FloatingGlyphs />
        <div className="container" style={{ padding: "4rem 1.5rem", position: "relative" }}>
          <div className="eyebrow center" style={{ textAlign: "center", display: "block" }}>Vos avantages</div>
          <h2 style={{ textAlign: "center", margin: ".6rem 0 2.4rem" }}>Tout ce que vous recevez</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
            {AVANTAGES.map((a) => (
              <div key={a.titre} className="card card-hover" style={{ display: "flex", gap: ".8rem", alignItems: "flex-start" }}>
                <span style={{ color: "var(--gold)", fontSize: "1.2rem", lineHeight: 1.2 }}>✦</span>
                <div>
                  <h3 style={{ fontSize: "1.08rem", marginBottom: ".3rem" }}>{a.titre}</h3>
                  <p style={{ color: "var(--muted)", fontSize: ".9rem" }}>{a.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <CurveDivider color="var(--bg)" height={80} />

      {/* Conditions d'adhésion */}
      <section id="conditions" className="container" style={{ padding: "4.5rem 1.5rem" }}>
        <div className="eyebrow" style={{ textAlign: "center" }}>Conditions d’adhésion</div>
        <h2 style={{ textAlign: "center", margin: ".6rem 0 2.4rem" }}>Des conditions claires</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.1rem" }}>
          {TARIFS.map((t, i) => {
            const featured = i === 0;
            return (
              <div key={t.label} className="card card-hover"
                   style={{ display: "flex", flexDirection: "column", gap: ".5rem",
                            borderColor: featured ? "var(--gold)" : undefined,
                            boxShadow: featured ? "0 22px 60px -22px rgba(201,162,39,0.4)" : undefined }}>
                {featured && <span className="badge" style={{ alignSelf: "flex-start" }}>Pour démarrer</span>}
                <h3 style={{ fontSize: "1.2rem", margin: 0 }}>{t.label}</h3>
                <div className="price">
                  <span className="price-num grad-gold">{t.montant}</span>
                </div>
                <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>{t.equiv}</div>
                <p style={{ color: "var(--muted)", fontSize: ".9rem", flex: 1, marginTop: ".3rem" }}>{t.note}</p>
              </div>
            );
          })}
        </div>

        <div className="card" style={{ marginTop: "1.6rem" }}>
          <div className="eyebrow" style={{ marginBottom: ".9rem" }}>À quoi servent vos cotisations</div>
          <ul className="check-list">
            {USAGE_COTISATION.map((u) => <li key={u}>{u}</li>)}
          </ul>
          <p style={{ color: "var(--muted-2)", fontSize: ".85rem", marginTop: "1.1rem", fontStyle: "italic" }}>
            Les contributions servent au fonctionnement et au développement de la communauté, et non à
            l’enrichissement personnel du fondateur. Le don volontaire reste entièrement facultatif.
          </p>
        </div>

        <div style={{ textAlign: "center", marginTop: "2.6rem" }}>
          <Link href="/register" className="btn btn-primary">Devenir membre maintenant</Link>
        </div>
      </section>
    </>
  );
}
