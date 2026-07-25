import Link from "next/link";

import { PageHero } from "@/components/PageHero";
import { VALEURS, PRINCIPES, SERMENT, SERMENT_FINAL, ENGAGEMENTS } from "@/lib/livret";

export const metadata = { title: "Valeurs & principes — ZOLA ASHÉ" };

export default function ValeursPage() {
  return (
    <>
      <PageHero image="/img/unite-mains.jpg" eyebrow="Notre socle moral & spirituel"
                title={<>Les valeurs qui <span className="grad-gold">nous unissent</span></>}>
        Sept valeurs et sept principes fondateurs guident les attitudes, les décisions et les actions
        de chaque membre de la communauté.
      </PageHero>

      {/* 7 valeurs */}
      <section className="container" style={{ padding: "4rem 1.5rem 2rem" }}>
        <div className="eyebrow" style={{ textAlign: "center" }}>Les 7 valeurs</div>
        <h2 style={{ textAlign: "center", margin: ".6rem 0 2.4rem" }}>Ce que nous incarnons</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
          {VALEURS.map((v, idx) => (
            <div key={v.nom} className="card card-hover" style={{ display: "flex", gap: ".9rem", alignItems: "flex-start" }}>
              <span className="num">{idx + 1}</span>
              <div>
                <h3 style={{ fontSize: "1.12rem", marginBottom: ".3rem" }}>{v.nom}</h3>
                <p style={{ color: "var(--muted)", fontSize: ".9rem" }}>{v.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 7 principes */}
      <section className="band-dark">
        <div className="container" style={{ padding: "4rem 1.5rem" }}>
          <div className="eyebrow" style={{ textAlign: "center" }}>Les 7 principes fondateurs</div>
          <h2 style={{ textAlign: "center", margin: ".6rem 0 2.4rem" }}>Notre philosophie</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
            {PRINCIPES.map((p, idx) => (
              <div key={p.nom} className="card card-hover" style={{ display: "flex", gap: ".9rem", alignItems: "flex-start" }}>
                <span className="num">{idx + 1}</span>
                <div>
                  <h3 style={{ fontSize: "1.12rem", marginBottom: ".3rem" }}>{p.nom}</h3>
                  <p style={{ color: "var(--muted)", fontSize: ".9rem" }}>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Serment */}
      <section className="container" style={{ padding: "4.5rem 1.5rem" }}>
        <div className="card warm-halo" style={{ position: "relative", overflow: "hidden",
              background: "linear-gradient(135deg, rgba(110,31,31,0.22), rgba(201,162,39,0.10))",
              padding: "3rem 2.4rem" }}>
          <div className="kente-band" style={{ position: "absolute", top: 0, left: 0 }} />
          <div className="eyebrow">Le serment du membre</div>
          <div style={{ display: "grid", gap: "1rem", marginTop: "1.4rem", maxWidth: 760 }}>
            {SERMENT.map((line, i) => (
              <p key={i} className="quote" style={{ fontSize: "clamp(1.1rem, 2.2vw, 1.45rem)" }}>{line}</p>
            ))}
          </div>
          <p style={{ fontFamily: "var(--serif)", color: "var(--gold-2)", fontSize: "1.25rem", marginTop: "1.6rem" }}>
            {SERMENT_FINAL}
          </p>
        </div>
      </section>

      {/* Engagements */}
      <section className="container-sm" style={{ padding: "0 1.5rem 4.5rem" }}>
        <div className="eyebrow" style={{ textAlign: "center" }}>Les engagements du membre</div>
        <h2 style={{ textAlign: "center", margin: ".6rem 0 2rem" }}>Préserver l’esprit de la communauté</h2>
        <ul className="check-list" style={{ fontSize: "1rem" }}>
          {ENGAGEMENTS.map((e) => <li key={e}>{e}</li>)}
        </ul>
        <div style={{ textAlign: "center", marginTop: "2.4rem" }}>
          <Link href="/register" className="btn btn-primary">Prêter serment, devenir membre</Link>
        </div>
      </section>
    </>
  );
}
