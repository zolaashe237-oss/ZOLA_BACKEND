"use client";

import { useCallback, useEffect, useState } from "react";

import { formationApi, quizApi, asList } from "@/lib/endpoints";
import type { Branche, Formation, QuizItem } from "@/lib/types";
import { Alert, Card } from "@/components/ui";
import { NiveauBadge } from "@/components/ai/AIBadges";
import { BrandLoader } from "@/components/BrandLoader";
import { useToast } from "@/components/Toast";

// ── Constantes ────────────────────────────────────────────────────────────────

const BRANCHES: { value: Branche; label: string; color: string; icon: string }[] = [
  { value: "MEMBRE",  label: "Membres",        color: "#5b8fd4", icon: "◉" },
  { value: "FEMME",   label: "Espace Femmes",  color: "#b5532a", icon: "♀" },
  { value: "ENFANT",  label: "Espace Enfants", color: "#52b083", icon: "◈" },
];

// ── Carte quiz (glissable) ────────────────────────────────────────────────────

function ParcoursCard({
  quiz, rank, formationTitle, dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  quiz: QuizItem;
  rank: number;
  formationTitle: string;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className="ai-drag-item press"
      data-dragging={dragging || undefined}
      data-drop-target={dropTarget || undefined}
      style={{
        display: "flex", alignItems: "center", gap: ".9rem",
        background: "var(--bg-1)", border: "1px solid var(--line-soft)",
        borderRadius: "var(--radius)", padding: ".8rem 1rem",
        marginBottom: ".6rem", cursor: "grab",
      }}
    >
      {/* Poignée */}
      <span style={{ color: "var(--muted-2)", fontSize: "1rem", lineHeight: 1, cursor: "grab" }}>⠿</span>

      {/* Rang */}
      <div style={{
        width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
        background: "var(--gold-bg)", border: "1px solid rgba(201,162,39,.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: ".82rem", fontWeight: 800, color: "var(--gold-2)",
      }}>
        {rank}
      </div>

      {/* Titre + formation */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".4rem", flexWrap: "wrap" }}>
          <strong style={{ fontSize: ".88rem", color: "var(--cream)" }}>{quiz.title}</strong>
          {quiz.generated_by_ai && (
            <span style={{
              fontSize: ".62rem", fontWeight: 800, borderRadius: 999, padding: ".06rem .4rem",
              color: "var(--gold-2)", background: "var(--gold-bg)", border: "1px solid rgba(201,162,39,.35)",
            }}>
              ✨ IA
            </span>
          )}
        </div>
        <div style={{ fontSize: ".76rem", color: "var(--muted-2)", marginTop: ".1rem" }}>{formationTitle}</div>
      </div>

      {/* Statut */}
      <span style={{
        fontSize: ".68rem", fontWeight: 700, borderRadius: 999, padding: ".16rem .55rem", flexShrink: 0,
        color: quiz.status === "PUBLISHED" || quiz.active ? "var(--ok)" : "var(--muted)",
        background: quiz.status === "PUBLISHED" || quiz.active ? "var(--ok-bg)" : "var(--bg-2)",
        border: `1px solid ${quiz.status === "PUBLISHED" || quiz.active ? "rgba(46,148,96,.3)" : "var(--line-soft)"}`,
      }}>
        {quiz.status === "PUBLISHED" || quiz.active ? "Publié" : "Brouillon"}
      </span>

      {/* Niveau */}
      <div style={{ flexShrink: 0 }}><NiveauBadge niveau={quiz.niveau} /></div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ParcoursIAPage() {
  const { toast } = useToast();
  const [branche,    setBranche]    = useState<Branche>("MEMBRE");
  const [items,       setItems]      = useState<QuizItem[]>([]);
  const [formations,  setFormations] = useState<Formation[]>([]);
  const [loading,     setLoading]    = useState(true);

  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  useEffect(() => {
    formationApi.list().then((r) => setFormations(asList(r.data))).catch(() => {});
  }, []);

  const load = useCallback(async (b: Branche) => {
    setLoading(true);
    try {
      const data = await quizApi.listByBranch(b);
      setItems([...data].sort((a, c) => (a.rang ?? 999) - (c.rang ?? 999)));
    } catch {
      setItems([]);
      toast("Impossible de charger le parcours de cette branche.", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(branche); }, [branche, load]);

  const formationTitle = (id: number | null) =>
    id ? (formations.find((f) => f.id === id)?.title ?? `Formation #${id}`) : "-";

  const reorder = async (fromId: number, toId: number) => {
    if (fromId === toId) return;
    const fromIdx = items.findIndex((i) => i.id === fromId);
    const toIdx   = items.findIndex((i) => i.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const previous = items;
    const next = [...items];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const withRanks = next.map((q, i) => ({ ...q, rang: i + 1 }));
    setItems(withRanks); // optimiste

    try {
      const changed = withRanks.filter((q, i) => previous[i]?.id !== q.id);
      await Promise.all(changed.map((q) => quizApi.update(q.id, { rang: q.rang })));
      toast("Ordre du parcours mis à jour.", "success");
    } catch {
      setItems(previous);
      toast("Impossible d'enregistrer le nouvel ordre. Réessayez.", "error");
    }
  };

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Intelligence Artificielle</div>
        <h1>Parcours progressif par branche</h1>
        <p>Ordre des quiz proposé par l&apos;IA pour chaque branche - glissez pour réorganiser.</p>
      </div>

      {/* Sélecteur de branche */}
      <div style={{ display: "flex", gap: ".5rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        {BRANCHES.map((b) => (
          <button
            key={b.value}
            onClick={() => setBranche(b.value)}
            className="press"
            style={{
              display: "flex", alignItems: "center", gap: ".45rem",
              fontSize: ".84rem", fontWeight: 700, padding: ".5rem 1rem",
              borderRadius: 999, border: "1px solid",
              cursor: "pointer", transition: "all .15s",
              background: branche === b.value ? `${b.color}14` : "var(--bg-1)",
              borderColor: branche === b.value ? b.color : "var(--line-soft)",
              color: branche === b.value ? b.color : "var(--muted)",
            }}
          >
            <span>{b.icon}</span> {b.label}
          </button>
        ))}
      </div>

      {loading ? (
        <BrandLoader label="Chargement du parcours…" full={false} />
      ) : items.length === 0 ? (
        <Card>
          <p style={{ textAlign: "center", color: "var(--muted)", padding: "1.5rem 0" }}>
            Aucun quiz généré pour cette branche pour le moment.
          </p>
        </Card>
      ) : (
        <div>
          {items.map((q, i) => (
            <ParcoursCard
              key={q.id}
              quiz={q}
              rank={i + 1}
              formationTitle={formationTitle(q.formation)}
              dragging={draggingId === q.id}
              dropTarget={dragOverId === q.id}
              onDragStart={() => setDraggingId(q.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(q.id); }}
              onDrop={() => {
                if (draggingId !== null) reorder(draggingId, q.id);
                setDraggingId(null); setDragOverId(null);
              }}
              onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
