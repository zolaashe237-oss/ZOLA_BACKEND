"use client";

import { useCallback, useEffect, useState } from "react";

import { qroReviewApi } from "@/lib/endpoints";
import type { AIQROReviewItem } from "@/lib/types";
import { Alert, Card, Pagination, usePagination } from "@/components/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { useToast } from "@/components/Toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function scoreColor(score: number) {
  if (score >= 14) return "#2e9460";
  if (score >= 10) return "#9a6e10";
  return "#c0402c";
}

// ── Tuile stat ────────────────────────────────────────────────────────────────

function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "0.6rem 1.1rem", borderRadius: "var(--radius-sm)",
      background: `${color}0f`, border: `1px solid ${color}28`, minWidth: 108,
    }}>
      <span style={{ fontSize: "1.4rem", fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.25rem", fontWeight: 600,
                     textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>{label}</span>
    </div>
  );
}

// ── Carte réponse QRO ─────────────────────────────────────────────────────────

function QROCard({
  item, busy, onValidate, onInvalidate,
}: {
  item: AIQROReviewItem;
  busy: boolean;
  onValidate: () => void;
  onInvalidate: () => void;
}) {
  const color = scoreColor(item.ai_score);
  return (
    <div style={{
      background: "var(--bg-1)", border: "1px solid var(--line-soft)",
      borderLeft: "3px solid var(--warn)", borderRadius: "var(--radius)",
      padding: "1rem 1.2rem",
    }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap", marginBottom: ".65rem" }}>
        <div>
          <strong style={{ fontSize: ".9rem", color: "var(--cream)" }}>{item.quiz_title}</strong>
          <div style={{ fontSize: ".76rem", color: "var(--muted-2)", marginTop: ".15rem" }}>{item.chapter_context}</div>
        </div>
        <span
          className="ai-badge-pulse"
          style={{
            fontSize: ".66rem", fontWeight: 800, borderRadius: 99, padding: ".18rem .6rem",
            color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid rgba(154,110,16,.3)",
            whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          ⚑ À revoir manuellement
        </span>
      </div>

      {/* Question */}
      <div style={{ fontSize: ".84rem", color: "var(--muted)", fontStyle: "italic", marginBottom: ".55rem" }}>
        « {item.question_text} »
      </div>

      {/* Réponse membre */}
      <div style={{
        padding: ".6rem .8rem", background: "var(--bg-2)", borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line-soft)", fontSize: ".86rem", color: "var(--cream)", lineHeight: 1.55,
        marginBottom: ".65rem",
      }}>
        <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: ".3rem" }}>
          Réponse de {item.member_name}
        </div>
        {item.member_answer}
      </div>

      {/* Verdict IA */}
      <div style={{ display: "flex", alignItems: "center", gap: ".65rem", marginBottom: ".65rem", flexWrap: "wrap" }}>
        <span style={{
          display: "flex", alignItems: "center", gap: ".3rem", fontSize: ".82rem", fontWeight: 800,
          color, background: `${color}14`, border: `1px solid ${color}40`, borderRadius: 999, padding: ".2rem .65rem",
        }}>
          Score IA : {item.ai_score}/20
        </span>
        <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>{item.ai_justification}</span>
      </div>

      {/* Actions + date */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".5rem" }}>
        <span style={{ fontSize: ".74rem", color: "var(--muted-2)" }}>{fmtDate(item.created_at)}</span>
        <div style={{ display: "flex", gap: ".45rem" }}>
          <button
            disabled={busy}
            onClick={onInvalidate}
            className="btn btn-danger btn-sm"
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            ✕ Invalider
          </button>
          <button
            disabled={busy}
            onClick={onValidate}
            className="btn btn-primary btn-sm"
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            ✓ Valider
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RevueQROPage() {
  const { toast } = useToast();
  const [items,     setItems]     = useState<AIQROReviewItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [busyId,    setBusyId]    = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await qroReviewApi.list();
      setItems(data);
    } catch {
      setItems([]);
      toast("Impossible de charger la file de revue QRO.", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const decide = async (item: AIQROReviewItem, decision: "VALIDER" | "INVALIDER") => {
    setBusyId(item.id);
    try {
      await qroReviewApi.decide(item.id, decision);
      setItems((prev) => prev.filter((i) => i.id !== item.id));

      toast(decision === "VALIDER"
        ? `Réponse de ${item.member_name} validée.`
        : `Réponse de ${item.member_name} invalidée.`, "success");
    } catch {
      toast("Impossible d'enregistrer la décision. Réessayez.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const { page, totalPages, paged, total, pageSize, setPageSize, go } = usePagination(items, 8);

  const avgScore = items.length
    ? Math.round((items.reduce((s, i) => s + i.ai_score, 0) / items.length) * 10) / 10
    : 0;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Intelligence Artificielle</div>
        <h1>Revue des réponses QRO</h1>
        <p>Réponses ouvertes que Gemini n&apos;a pas pu trancher automatiquement - décision humaine requise.</p>
      </div>

      <div style={{ display: "flex", gap: ".65rem", marginBottom: "1.3rem", flexWrap: "wrap", alignItems: "center" }}>
        <StatTile label="En attente" value={items.length} color="var(--warn)" />
        <StatTile label="Score IA moyen" value={`${avgScore}/20`} color="var(--gold-2)" />
      </div>

      {loading ? (
        <BrandLoader label="Chargement de la file de revue…" full={false} />
      ) : paged.length === 0 ? (
        <Card>
          <p style={{ textAlign: "center", color: "var(--ok)", fontWeight: 600, padding: "1.5rem 0" }}>
            ✓ Aucune réponse en attente de revue.
          </p>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".7rem", marginBottom: "1rem" }}>
          {paged.map((item) => (
            <QROCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onValidate={() => decide(item, "VALIDER")}
              onInvalidate={() => decide(item, "INVALIDER")}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={go} onPageSize={setPageSize} />
        </Card>
      )}
    </div>
  );
}
