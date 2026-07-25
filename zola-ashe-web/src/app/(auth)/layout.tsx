import type { ReactNode } from "react";

import { Logo } from "@/components/Logo";

/** Mise en page centrée pour les écrans d'authentification. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column",
                   alignItems: "center", justifyContent: "center", padding: "1.5rem", position: "relative", overflow: "hidden" }}>
      <span className="blob blob-bordeaux" style={{ width: 380, height: 380, top: -120, left: -120 }} />
      <span className="blob blob-gold" style={{ width: 320, height: 320, bottom: -120, right: -100 }} />

      <div className="fade-up" style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Logo size={64} withWord={false} />
        <div className="brand-word fade-up delay-1" style={{ fontSize: "1.7rem", marginTop: ".5rem" }}>
          ZOLA <span className="text-gold">ASHÉ</span>
        </div>
        <p className="fade-up delay-1" style={{ color: "var(--muted)", fontSize: ".88rem", margin: ".3rem 0 1.8rem" }}>
          La force qui éveille votre parcours
        </p>
      </div>
      <div className="fade-up delay-2" style={{ width: "100%", maxWidth: 400, position: "relative", zIndex: 1 }}>{children}</div>
    </main>
  );
}
