import type { ReactNode } from "react";

import { Logo } from "@/components/Logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column",
                   alignItems: "center", justifyContent: "center", padding: "1.5rem", position: "relative", overflow: "hidden" }}>
      <span className="blob blob-bordeaux" style={{ width: 360, height: 360, top: -120, left: -110 }} />
      <span className="blob blob-gold" style={{ width: 300, height: 300, bottom: -110, right: -90 }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Logo size={58} withWord={false} />
        <div className="brand-word" style={{ fontSize: "1.6rem", marginTop: ".45rem" }}>
          ZOLA <span className="text-gold">ASHÉ</span>
        </div>
        <div className="eyebrow" style={{ marginBottom: "1.6rem", marginTop: ".35rem" }}>Administration</div>
      </div>
      <div style={{ width: "100%", maxWidth: 380, position: "relative", zIndex: 1 }}>{children}</div>
    </main>
  );
}
