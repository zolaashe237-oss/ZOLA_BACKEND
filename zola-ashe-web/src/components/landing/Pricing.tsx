"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { billingApi } from "@/lib/endpoints";

type Plan = { kind: string; label: string; amount: number };

// Repli si l'API n'est pas joignable au chargement (cohérent avec le livret).
const FALLBACK: Plan[] = [
  { kind: "INSCRIPTION", label: "Droit d'inscription", amount: 10000 },
  { kind: "COTISATION", label: "Cotisation mensuelle", amount: 2000 },
  { kind: "DON", label: "Don volontaire", amount: 0 },
];

const NOTE: Record<string, string> = {
  INSCRIPTION: "Paiement unique — intégration officielle, accès aux ressources, livres et formations.",
  COTISATION: "Maintient votre accès actif mois après mois et soutient la communauté.",
  DON: "Un geste de gratitude, libre et facultatif.",
};

const fmt = (n: number) => n.toLocaleString("fr-FR");

export function Pricing() {
  const [plans, setPlans] = useState<Plan[]>(FALLBACK);

  useEffect(() => {
    billingApi.subscriptionTypes().then((r) => setPlans(r.data)).catch(() => {});
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.1rem" }}>
      {plans.map((p, i) => {
        const featured = p.kind === "INSCRIPTION";
        return (
          <div
            key={p.kind}
            className={`card card-hover fade-up delay-${(i % 3) + 1}`}
            style={{
              display: "flex", flexDirection: "column", gap: "0.6rem",
              borderColor: featured ? "var(--gold)" : undefined,
              boxShadow: featured ? "0 22px 60px -22px rgba(201,162,39,0.45)" : undefined,
            }}
          >
            {featured && <span className="badge" style={{ alignSelf: "flex-start" }}>Le plus choisi</span>}
            <h3 style={{ fontSize: "1.35rem", margin: 0 }}>{p.label}</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="grad-gold" style={{ fontFamily: "var(--serif)", fontSize: "2.1rem", fontWeight: 700 }}>
                {fmt(p.amount)}
              </span>
              <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>FCFA</span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.92rem", flex: 1 }}>{NOTE[p.kind] ?? ""}</p>
            <Link href="/register" className={`btn ${featured ? "btn-primary" : "btn-outline"} btn-block`}>
              Choisir
            </Link>
          </div>
        );
      })}
    </div>
  );
}
