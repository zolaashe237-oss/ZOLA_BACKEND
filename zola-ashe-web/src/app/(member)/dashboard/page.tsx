"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { billingApi, formationApi } from "@/lib/endpoints";
import type { FormationListItem, Paginated, Subscription } from "@/lib/types";
import { Badge, Card } from "@/components/ui";
import { FormationCard } from "@/components/FormationCard";
import { IconLibrary, IconCommunity, IconUser } from "@/components/icons";
import { SunWatermark } from "@/components/SunWatermark";

type Tone = "gold" | "terra" | "locked";
const STATUS_TONE: Record<string, Tone> = { ACTIF: "gold", RESTREINT: "terra", BLOQUE: "locked" };
const STATUS_LABEL: Record<string, string> = { ACTIF: "Actif", RESTREINT: "Restreint", BLOQUE: "Bloqué" };

const SHORTCUTS = [
  { href: "/contenu", label: "Contenus", desc: "Livres & formations", Icon: IconLibrary },
  { href: "/communaute", label: "Communauté", desc: "Le fil d’échanges", Icon: IconCommunity },
  { href: "/profil", label: "Profil", desc: "Gérer mon compte", Icon: IconUser },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [formations, setFormations] = useState<FormationListItem[]>([]);

  useEffect(() => {
    billingApi
      .mySubscriptions()
      .then((r) => setSubs(Array.isArray(r.data) ? r.data : (r.data as Paginated<Subscription>).results))
      .catch(() => setSubs([]));
    formationApi
      .list()
      .then((r) => setFormations(r.data.results.slice(0, 4)))
      .catch(() => setFormations([]));
  }, []);

  if (!user) return null;
  const firstName = user.full_name?.split(" ")[0] ?? "";

  return (
    <div className="fade-up">
      {/* Carte d'accueil */}
      <div className="card card-lux warm-halo" style={{ position: "relative", overflow: "hidden",
            background: "linear-gradient(135deg, rgba(110,31,31,0.74), rgba(181,83,42,0.40) 55%, rgba(10,8,6,0.72)), center/cover no-repeat url(/img/hero-savane.jpg)",
            padding: "1.8rem 1.5rem", marginBottom: "1.2rem" }}>
        <span className="blob blob-gold" style={{ width: 220, height: 220, top: -90, right: -70, opacity: .4 }} />
        <SunWatermark side="right" top="-30%" size={300} opacity={0.14} color="var(--gold-2)" speed={0.08} />
        <div className="kente-band" style={{ position: "absolute", top: 0, left: 0 }} />
        <div className="eyebrow" style={{ marginBottom: ".3rem", position: "relative" }}>Votre espace</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "clamp(1.7rem, 5vw, 2.4rem)", margin: 0 }}>Bonjour {firstName}</h1>
          <Badge tone={STATUS_TONE[user.status] ?? "locked"}>{STATUS_LABEL[user.status] ?? user.status}</Badge>
        </div>
        {user.status === "RESTREINT" && (
          <p style={{ marginTop: ".7rem", fontSize: "0.9rem", color: "var(--terra-2)" }}>
            Votre accès est restreint. Réglez votre cotisation pour débloquer les contenus.
          </p>
        )}
        <div style={{ marginTop: "1rem", position: "relative" }}>
          <Link href="/abonnement" className="btn btn-primary press">
            {user.status === "ACTIF" ? "Gérer mon adhésion" : "Activer mon adhésion"}
          </Link>
        </div>
      </div>

      {/* Accès rapides */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: ".8rem", marginBottom: "1.6rem" }}>
        {SHORTCUTS.map(({ href, label, desc, Icon }) => (
          <Link key={href} href={href} className="card card-hover press"
                style={{ display: "flex", flexDirection: "column", gap: ".5rem", padding: "1.2rem 1.1rem" }}>
            <span style={{ display: "inline-flex", width: 42, height: 42, borderRadius: 12, alignItems: "center",
                           justifyContent: "center", color: "var(--gold-2)", background: "rgba(201,162,39,.12)" }}>
              <Icon className="" />
            </span>
            <strong style={{ fontSize: "1.05rem" }}>{label}</strong>
            <span style={{ fontSize: ".84rem", color: "var(--muted)" }}>{desc}</span>
          </Link>
        ))}
      </div>

      {/* Formations */}
      {formations.length > 0 && (
        <div style={{ marginBottom: "1.6rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "0.9rem" }}>
            <h2 style={{ fontSize: "1.3rem", margin: 0 }}>Continuer mon apprentissage</h2>
            <Link href="/contenu" style={{ fontSize: ".85rem", color: "var(--gold-2)" }}>Tout voir</Link>
          </div>
          <div className="media-grid">
            {formations.map((f) => <FormationCard key={f.id} formation={f} />)}
          </div>
        </div>
      )}

      {/* Abonnements */}
      <h2 style={{ fontSize: "1.3rem", marginBottom: "0.9rem" }}>Mon adhésion</h2>
      {subs.length === 0 ? (
        <Card><p style={{ color: "var(--muted)" }}>Aucune adhésion active.</p></Card>
      ) : (
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {subs.map((s) => (
            <Card key={s.id} hover>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem" }}>
                <strong style={{ fontSize: "1.02rem" }}>{s.type === "MEMBRE" ? "Membre" : s.type}</strong>
                <Badge tone={s.active ? "gold" : "locked"}>{s.active ? "active" : "inactive"}</Badge>
              </div>
              <div style={{ fontSize: "0.83rem", color: "var(--muted)", marginTop: 6 }}>
                Depuis le {s.start} {s.end ? `— jusqu’au ${s.end}` : "(permanente)"}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
