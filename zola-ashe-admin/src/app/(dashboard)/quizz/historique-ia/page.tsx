"use client";

import { useCallback, useEffect, useState } from "react";

import { quizHistoryApi } from "@/lib/endpoints";
import type { AIQuizHistoryEntry } from "@/lib/types";
import { Alert, Card, Pagination, usePagination } from "@/components/ui";
import { NiveauBadge, SourceIcon } from "@/components/ai/AIBadges";
import { BrandLoader } from "@/components/BrandLoader";
import { useToast } from "@/components/Toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

type Filter = "ALL" | "AI" | "MANUAL";

export default function HistoriqueIAPage() {
  const { toast } = useToast();
  const [items,     setItems]     = useState<AIQuizHistoryEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState<Filter>("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await quizHistoryApi.list();
      setItems([...data].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    } catch {
      setItems([]);
      toast("Impossible de charger l'historique des générations.", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter((it) => {
    if (filter === "AI")     return it.generated_by_ai;
    if (filter === "MANUAL") return !it.generated_by_ai;
    return true;
  });

  const { page, totalPages, paged, total, pageSize, setPageSize, go } = usePagination(filtered, 12, filter);

  const aiCount     = items.filter((i) => i.generated_by_ai).length;
  const manualCount = items.length - aiCount;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Intelligence Artificielle</div>
        <h1>Historique des générations IA</h1>
        <p>Quiz générés par l&apos;agent IA Gemini 3.5 comparés aux quiz créés manuellement.</p>
      </div>

      {/* Filtres + demo badge */}
      <div style={{ display: "flex", gap: ".5rem", alignItems: "center", marginBottom: "1.1rem", flexWrap: "wrap" }}>
        {([
          { key: "ALL" as Filter,    label: `Tous (${items.length})` },
          { key: "AI" as Filter,     label: `✨ Générés par IA (${aiCount})` },
          { key: "MANUAL" as Filter, label: `Créés manuellement (${manualCount})` },
        ]).map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            fontSize: "0.78rem", fontWeight: 700, padding: "0.32rem 0.8rem",
            borderRadius: 99, border: "1px solid", cursor: "pointer", transition: "all .12s",
            background: filter === f.key ? "var(--gold-bg)" : "var(--bg-1)",
            borderColor: filter === f.key ? "var(--gold-2)" : "var(--line-soft)",
            color: filter === f.key ? "var(--gold-2)" : "var(--muted)",
          }}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <BrandLoader label="Chargement de l'historique…" full={false} />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%", minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Quiz</th>
                  <th>Source</th>
                  <th>Extraction</th>
                  <th>Niveau</th>
                  <th>Validé par</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((it) => (
                  <tr key={it.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: ".82rem" }}>{fmtDate(it.created_at)}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                        <strong style={{ fontSize: ".85rem", color: "var(--cream)" }}>{it.quiz_title}</strong>
                        {it.generated_by_ai && (
                          <span style={{
                            fontSize: ".62rem", fontWeight: 800, borderRadius: 999, padding: ".06rem .4rem",
                            color: "var(--gold-2)", background: "var(--gold-bg)", border: "1px solid rgba(201,162,39,.35)",
                          }}>
                            ✨ IA
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: ".82rem", color: "var(--muted)" }}>{it.source_title || "-"}</td>
                    <td><SourceIcon source={it.ai_source} /></td>
                    <td><NiveauBadge niveau={it.niveau} /></td>
                    <td style={{ fontSize: ".82rem", color: "var(--muted)" }}>{it.validated_by ?? "-"}</td>
                    <td>
                      <span style={{
                        fontSize: ".68rem", fontWeight: 700, borderRadius: 999, padding: ".16rem .55rem",
                        color: it.status === "PUBLISHED" ? "var(--ok)" : "var(--muted)",
                        background: it.status === "PUBLISHED" ? "var(--ok-bg)" : "var(--bg-2)",
                        border: `1px solid ${it.status === "PUBLISHED" ? "rgba(46,148,96,.3)" : "var(--line-soft)"}`,
                      }}>
                        {it.status === "PUBLISHED" ? "Publié" : "Brouillon"}
                      </span>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: "3rem", textAlign: "center", color: "var(--muted)" }}>
                      Aucune génération trouvée pour ce filtre.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={go} onPageSize={setPageSize} />
        </Card>
      )}
    </div>
  );
}
