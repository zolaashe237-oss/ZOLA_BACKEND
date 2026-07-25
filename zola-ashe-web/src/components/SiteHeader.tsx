"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/Logo";

const NAV = [
  { href: "/", label: "Accueil" },
  { href: "/a-propos", label: "La communauté" },
  { href: "/programme", label: "Enseignements" },
  { href: "/valeurs", label: "Valeurs" },
  { href: "/adhesion", label: "Adhésion" },
  { href: "/blog", label: "Journal" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="glass" style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid var(--line-soft)" }}>
      <div className="container" style={{ display: "flex", alignItems: "center", gap: "1.25rem", height: 70 }}>
        <Logo href="/" size={38} />

        <nav className="site-nav" style={{ display: "flex", gap: "1.4rem", flex: 1, marginLeft: "1rem" }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`nav-link ${isActive(n.href) ? "active" : ""}`}>
              {n.label}
            </Link>
          ))}
        </nav>

        <Link href="/login" className="nav-link site-desktop">Se connecter</Link>
        <Link href="/register" className="btn btn-primary site-desktop">Devenir membre</Link>

        <button className="btn btn-ghost site-burger" aria-label="Menu" onClick={() => setOpen((v) => !v)}
                style={{ display: "none", padding: ".4rem .7rem" }}>
          ☰
        </button>
      </div>

      {open && (
        <div className="site-mobile" style={{ borderTop: "1px solid var(--line-soft)", padding: "0.6rem 1.5rem 1rem" }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                  className={`nav-link ${isActive(n.href) ? "active" : ""}`}
                  style={{ display: "block", padding: ".55rem 0" }}>
              {n.label}
            </Link>
          ))}
          <div style={{ display: "flex", gap: ".7rem", marginTop: ".6rem" }}>
            <Link href="/login" className="btn btn-ghost" onClick={() => setOpen(false)}>Se connecter</Link>
            <Link href="/register" className="btn btn-primary" onClick={() => setOpen(false)}>Devenir membre</Link>
          </div>
        </div>
      )}
      <div className="kente-band" />
    </header>
  );
}
