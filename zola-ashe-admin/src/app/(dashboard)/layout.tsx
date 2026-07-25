"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";
import { BrandLoader } from "@/components/BrandLoader";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/membres", label: "Membres" },
  { href: "/contenu", label: "Contenu" },
  { href: "/blog", label: "Blog" },
  { href: "/finance", label: "Finance" },
  { href: "/moderation", label: "Modération" },
  { href: "/audit", label: "Audit" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return <BrandLoader />;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 234, background: "var(--sidebar)", borderRight: "1px solid var(--line-soft)",
                      padding: "1.4rem 0.85rem", display: "flex", flexDirection: "column", gap: "0.2rem",
                      position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "0 0.6rem 0.3rem" }}>
          <Logo href="/" size={32} wordSize="1.3rem" />
        </div>
        <div className="eyebrow" style={{ padding: "0 0.6rem 1.1rem", fontSize: "0.62rem" }}>Back-office</div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`nav-item ${pathname === n.href ? "active" : ""}`}>
            {n.label}
          </Link>
        ))}
        <div style={{ marginTop: "auto", padding: "0.6rem", fontSize: "0.78rem", color: "var(--muted)" }}>
          {user.email}
        </div>
        <button className="btn btn-ghost" onClick={() => logout().then(() => router.replace("/login"))}>
          Déconnexion
        </button>
      </aside>
      <main style={{ flex: 1, padding: "2rem 2.25rem", maxWidth: 1180 }}>{children}</main>
    </div>
  );
}
