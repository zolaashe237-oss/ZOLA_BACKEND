import Link from "next/link";

import { Logo } from "@/components/Logo";
import { SENS, RENCONTRE } from "@/lib/livret";

export function SiteFooter() {
  return (
    <footer style={{ borderTop: "1px solid var(--line-soft)", marginTop: "1rem" }}>
      <div className="kente-band" style={{ opacity: 0.5 }} />
      <div className="container" style={{ padding: "3rem 1.5rem 1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: "2rem" }} className="footer-grid">
          <div>
            <div style={{ marginBottom: ".8rem" }}>
              <Logo size={40} />
            </div>
            <p style={{ color: "var(--muted)", fontSize: ".92rem", maxWidth: 360, fontStyle: "italic" }}>{SENS}</p>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: ".9rem" }}>Explorer</div>
            <div style={{ display: "grid", gap: ".5rem" }}>
              <Link href="/a-propos" className="nav-link">La communauté</Link>
              <Link href="/programme" className="nav-link">Enseignements</Link>
              <Link href="/valeurs" className="nav-link">Valeurs & principes</Link>
              <Link href="/adhesion" className="nav-link">Adhésion</Link>
              <Link href="/blog" className="nav-link">Journal</Link>
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: ".9rem" }}>Rejoindre</div>
            <div style={{ display: "grid", gap: ".5rem", color: "var(--muted)", fontSize: ".9rem" }}>
              <span>Séance hebdomadaire</span>
              <strong style={{ color: "var(--cream)" }}>{RENCONTRE.jour} · {RENCONTRE.heure}</strong>
              <span style={{ color: "var(--muted-2)", fontSize: ".82rem" }}>{RENCONTRE.zone}</span>
              <div style={{ display: "flex", gap: ".6rem", marginTop: ".6rem" }}>
                <Link href="/login" className="nav-link">Connexion</Link>
                <Link href="/register" className="nav-link">Inscription</Link>
              </div>
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--line-soft)", marginTop: "2rem", paddingTop: "1.2rem",
                      color: "var(--muted-2)", fontSize: ".82rem", textAlign: "center" }}>
          © {new Date().getFullYear()} ZOLA ASHÉ — Tous droits réservés.
        </div>
      </div>
    </footer>
  );
}
