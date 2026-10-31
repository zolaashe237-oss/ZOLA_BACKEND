"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";
import { BrandLoader } from "@/components/BrandLoader";
import { ToastProvider } from "@/components/Toast";

// ── Structure de navigation groupée ──────────────────────────────────────────

type NavItem = { href: string; label: string; icon: string; exact?: boolean };
type NavGroup = { label: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/",  label: "Tableau de bord", icon: "⊞" },
    ],
  },
  {
    label: "Membres & Contenu",
    items: [
      { href: "/membres",             label: "Membres",          icon: "◎" },
      { href: "/memoires",            label: "Mémoires",         icon: "◳" },
      { href: "/contenu",             label: "Formations",       icon: "◫" },
      { href: "/quizz",               label: "Quiz & QCM",       icon: "◆", exact: true },
      { href: "/quizz/resultats",     label: "Résultats quiz",   icon: "◌" },
      { href: "/lives",               label: "Lives",            icon: "⬤" },
      { href: "/bibliotheque",        label: "Bibliothèque",     icon: "◧" },
      { href: "/audio",               label: "Audio",            icon: "♪" },
    ],
  },
  {
    label: "Intelligence Artificielle",
    items: [
      { href: "/quizz/parcours",      label: "Parcours par branche", icon: "✦" },
      { href: "/quizz/revue-qro",     label: "Revue QRO",            icon: "◐" },
      { href: "/quizz/historique-ia", label: "Historique IA",        icon: "◷" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { href: "/abonnements",  label: "Abonnements",   icon: "◈" },
      { href: "/finance",      label: "Finance",       icon: "◇" },
      { href: "/transactions", label: "Transactions",  icon: "≡" },
      { href: "/affiliation",  label: "Affiliation",   icon: "⋈" },
    ],
  },
  {
    label: "Communauté",
    items: [
      { href: "/communaute",   label: "Communauté",    icon: "◉" },
      { href: "/progression",  label: "Progression",   icon: "▲" },
    ],
  },
  {
    label: "Sécurité",
    items: [
      { href: "/moderation",   label: "Modération",    icon: "⊗" },
      { href: "/audit",        label: "Audit",         icon: "⊕" },
    ],
  },
  {
    label: "Plateforme",
    items: [
      { href: "/fonctionnalites", label: "Fonctionnalités", icon: "⏻" },
    ],
  },
];

// ── Initiales ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return <BrandLoader />;

  return (
    <div style={{ display: "flex", minHeight: "100vh", isolation: "isolate" }}>

      {/* ══════════════════════════════════════════════════════
          SIDEBAR
      ══════════════════════════════════════════════════════ */}
      <aside style={{
        width: "var(--sidebar-w, 252px)",
        background: "var(--sidebar)",
        borderRight: "1px solid var(--line-soft)",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        flexShrink: 0,
      }}>

        {/* Logo */}
        <div style={{
          padding: "1.25rem 1rem 0.85rem",
          borderBottom: "1px solid var(--line-soft)",
          flexShrink: 0,
        }}>
          <Logo href="/" size={28} wordSize="1.15rem" />
          <div className="eyebrow" style={{ marginTop: "0.4rem", fontSize: "0.58rem" }}>
            Back-office
          </div>
        </div>

        {/* Navigation (scrollable) */}
        <nav style={{
          flex: 1,
          overflowY: "auto",
          padding: "0.6rem 0.65rem",
          scrollbarWidth: "none",
        }}>
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi}>
              {/* Label de section */}
              {group.label && (
                <div className="nav-section-label">{group.label}</div>
              )}

              {/* Items */}
              {group.items.map((item) => {
                const active = item.href === "/"
                  ? pathname === "/"
                  : item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item ${active ? "active" : ""}`}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ── Zone utilisateur (bas de sidebar) ── */}
        <div style={{
          borderTop: "1px solid var(--line-soft)",
          padding: "0.75rem 0.65rem 0.85rem",
          flexShrink: 0,
        }}>
          <Link
            href="/compte"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.7rem",
              padding: "0.55rem 0.7rem",
              borderRadius: "var(--radius-sm)",
              background: pathname === "/compte" ? "rgba(201,162,39,0.1)" : "transparent",
              border: `1px solid ${pathname === "/compte" ? "rgba(201,162,39,0.3)" : "transparent"}`,
              transition: "all .15s",
              textDecoration: "none",
            }}
            className="press"
          >
            {/* Avatar */}
            <div style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: user.photo
                ? `center/cover no-repeat url(${user.photo})`
                : "rgba(201,162,39,0.2)",
              border: "1.5px solid rgba(201,162,39,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "var(--gold-2)",
              flexShrink: 0,
            }}>
              {!user.photo && initials(user.full_name || user.email)}
            </div>

            {/* Infos */}
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "var(--cream)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {user.full_name || "Mon compte"}
              </div>
              <div style={{
                fontSize: "0.7rem",
                color: "var(--muted-2)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {user.email}
              </div>
            </div>
          </Link>

          <button
            className="btn btn-ghost"
            style={{ width: "100%", marginTop: "0.5rem", fontSize: "0.82rem", padding: "0.48rem" }}
            onClick={() => logout().then(() => router.replace("/login"))}
          >
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════
          CONTENU PRINCIPAL
      ══════════════════════════════════════════════════════ */}
      <main style={{
        flex: 1,
        minWidth: 0,
        padding: "2rem 2.5rem",
        maxWidth: 1200,
      }}>
        <ToastProvider>
          {children}
        </ToastProvider>
      </main>

    </div>
  );
}
