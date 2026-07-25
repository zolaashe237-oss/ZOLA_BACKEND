"use client";

import { useEffect, useState } from "react";

import { dashboardApi } from "@/lib/endpoints";
import type { DashboardKPIs } from "@/lib/types";
import { Card } from "@/components/ui";

const TILES: { key: keyof DashboardKPIs; label: string; money?: boolean }[] = [
  { key: "members_active", label: "Membres actifs" },
  { key: "members_restricted", label: "Membres restreints" },
  { key: "revenue_month", label: "Revenus du mois", money: true },
  { key: "cotisations_late", label: "Cotisations en retard" },
  { key: "reports_pending", label: "Signalements en attente" },
  { key: "new_members_month", label: "Nouveaux membres" },
  { key: "modules_validated_month", label: "Modules validés (mois)" },
];

export default function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);

  useEffect(() => {
    dashboardApi.kpis().then((r) => setKpis(r.data)).catch(() => setKpis(null));
  }, []);

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>Tableau de bord</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" }}>
        {TILES.map((t) => (
          <Card key={t.key}>
            <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{t.label}</div>
            <div style={{ fontSize: "1.8rem", fontWeight: 700, marginTop: 6 }}>
              {kpis ? (t.money ? `${kpis[t.key].toLocaleString("fr-FR")} F` : kpis[t.key]) : "…"}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
