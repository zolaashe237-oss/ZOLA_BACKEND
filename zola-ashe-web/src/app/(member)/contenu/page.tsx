"use client";

import { useEffect, useMemo, useState } from "react";

import { formationApi } from "@/lib/endpoints";
import type { FormationListItem } from "@/lib/types";
import { Card } from "@/components/ui";
import { FormationCard } from "@/components/FormationCard";
import { BrandLoader } from "@/components/BrandLoader";

const FILTERS = [
  { value: "ALL", label: "Tout" },
  { value: "FORMATION", label: "Formations" },
  { value: "LIVRE", label: "Bibliothèque" },
  { value: "LIBRE", label: "Accès libre" },
];

export default function ContenuPage() {
  const [formations, setFormations] = useState<FormationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    formationApi.list()
      .then((r) => setFormations(r.data.results))
      .catch(() => setFormations([]))
      .finally(() => setLoading(false));
  }, []);

  // Filtres réellement présents dans le catalogue.
  const available = useMemo(() => {
    const cats = new Set<string>(formations.map((f) => f.category));
    return FILTERS.filter((f) => f.value === "ALL" || cats.has(f.value));
  }, [formations]);

  const shown = filter === "ALL" ? formations : formations.filter((f) => f.category === filter);

  if (loading) return <BrandLoader full={false} />;

  return (
    <div className="fade-up">
      <div className="eyebrow" style={{ marginBottom: ".3rem" }}>Bibliothèque & formations</div>
      <h1 style={{ marginBottom: "1.1rem", fontSize: "clamp(1.8rem, 5vw, 2.4rem)" }}>Formations</h1>

      {available.length > 1 && (
        <div className="chip-row">
          {available.map((f) => (
            <button key={f.value} className={`chip-f ${filter === f.value ? "on" : ""}`}
                    onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Card><p style={{ color: "var(--muted)" }}>Aucune formation dans cette catégorie.</p></Card>
      ) : (
        <div className="media-grid">
          {shown.map((f) => <FormationCard key={f.id} formation={f} />)}
        </div>
      )}
    </div>
  );
}
