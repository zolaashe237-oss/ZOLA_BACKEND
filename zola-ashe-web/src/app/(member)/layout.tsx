"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";
import { BrandLoader } from "@/components/BrandLoader";
import { IconHome, IconLibrary, IconCommunity, IconUser } from "@/components/icons";

const NAV = [
  { href: "/dashboard", label: "Accueil", Icon: IconHome },
  { href: "/contenu", label: "Contenus", Icon: IconLibrary },
  { href: "/communaute", label: "Communauté", Icon: IconCommunity },
  { href: "/profil", label: "Profil", Icon: IconUser },
];

export default function MemberLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return <div className="app-dark"><BrandLoader /></div>;

  const firstName = user.full_name?.split(" ")[0] ?? "";

  return (
    <div className="app-dark" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header className="member-top glass">
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", height: 64,
                      maxWidth: 1000, width: "100%", margin: "0 auto", padding: "0 1.1rem" }}>
          <Logo href="/dashboard" size={34} wordSize="1.2rem" />
          <nav className="member-top-links" style={{ display: "flex", gap: "1.4rem", flex: 1, marginLeft: ".8rem" }}>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`nav-link ${pathname === n.href ? "active" : ""}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <span className="member-top-logout" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: ".9rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{user.full_name}</span>
            <button className="btn btn-ghost press" style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}
                    onClick={() => logout().then(() => router.replace("/login"))}>
              Déconnexion
            </button>
          </span>
          {/* Sur mobile : prénom à droite (la déconnexion est dans le profil) */}
          <span style={{ marginLeft: "auto", fontSize: ".85rem", color: "var(--muted)" }} className="member-top-hello">
            Bonjour {firstName}
          </span>
        </div>
      </header>

      <div className="member-content" style={{ flex: 1, maxWidth: 1000, width: "100%", margin: "0 auto", padding: "1.6rem 1.1rem" }}>
        {children}
      </div>

      {/* Barre d'onglets mobile */}
      <nav className="member-bottom-nav" aria-label="Navigation">
        {NAV.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={pathname === href ? "active" : ""}>
            <Icon />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
