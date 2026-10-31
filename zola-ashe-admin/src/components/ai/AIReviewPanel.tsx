"use client";

import { useState } from "react";

import { Modal } from "@/components/Modal";
import { Alert, Button, Textarea } from "@/components/ui";
import { aiQuizApi, quizApi } from "@/lib/endpoints";
import type {
  AIDifficulty, AIGeneratedQuestion, AIGenerationConfig, Branche, QuizChoice, QuizItem,
} from "@/lib/types";
import { NIVEAU_LABEL, NiveauBadge } from "./AIBadges";
import { AIThinkingInline } from "./AIThinking";

const NIVEAUX: AIDifficulty[] = ["FACILE", "INTERMEDIAIRE", "DIFFICILE"];

// ── Une question générée, éditable inline ─────────────────────────────────────

function AIQuestionCard({
  q, index, onChange, onRemove, onRegenerate, regenerating,
}: {
  q: AIGeneratedQuestion;
  index: number;
  onChange: (patch: Partial<AIGeneratedQuestion>) => void;
  onRemove: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const isQcm      = q.type === "QCM";
  const isQcmMulti = q.type === "QCM_MULTI";
  const hasChoices  = isQcm || isQcmMulti;

  const setChoice = (ci: number, patch: Partial<QuizChoice>) =>
    onChange({ choices: q.choices.map((c, k) => (k === ci ? { ...c, ...patch } : c)) });

  // Radio (QCM) — only one correct
  const markCorrect = (ci: number) =>
    onChange({ choices: q.choices.map((c, k) => ({ ...c, is_correct: k === ci })) });

  // Checkbox (QCM_MULTI) — toggle individual correctness
  const toggleCorrect = (ci: number) =>
    onChange({ choices: q.choices.map((c, k) => (k === ci ? { ...c, is_correct: !c.is_correct } : c)) });

  const addChoice = () =>
    onChange({ choices: [...q.choices, { text: "", is_correct: false, order: q.choices.length + 1 }] });

  const removeChoice = (ci: number) =>
    onChange({ choices: q.choices.filter((_, k) => k !== ci) });

  const setCriterion = (ci: number, text: string) =>
    onChange({ criteria: q.criteria.map((c, k) => (k === ci ? text : c)) });

  const addCriterion = () => onChange({ criteria: [...q.criteria, ""] });
  const removeCriterion = (ci: number) => onChange({ criteria: q.criteria.filter((_, k) => k !== ci) });

  return (
    <div className="ai-card-in" style={{
      border: "1px solid var(--line-soft)", borderRadius: "var(--radius)",
      overflow: "hidden", marginBottom: ".75rem",
      animationDelay: `${Math.min(index, 8) * 45}ms`,
    }}>
      {/* En-tête */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: ".65rem 1rem", background: "var(--bg-2)", borderBottom: "1px solid var(--line-soft)", gap: ".5rem", flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".55rem" }}>
          <span style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--muted)", letterSpacing: ".04em", textTransform: "uppercase" }}>
            Question {index + 1}
          </span>
          <span style={{
            fontSize: ".66rem", fontWeight: 800, borderRadius: 999, padding: ".14rem .55rem",
            color: isQcmMulti ? "#8b5cf6" : isQcm ? "var(--gold-2)" : "#2d61b0",
            background: isQcmMulti ? "rgba(139,92,246,.1)" : isQcm ? "var(--gold-bg)" : "var(--info-bg)",
            border: `1px solid ${isQcmMulti ? "rgba(139,92,246,.35)" : isQcm ? "rgba(201,162,39,.35)" : "rgba(45,97,176,.3)"}`,
          }}>
            {isQcmMulti ? "QCM ☑" : isQcm ? "QCM" : "QRO"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".65rem" }}>
          {regenerating ? (
            <AIThinkingInline label="Régénération…" />
          ) : (
            <button onClick={onRegenerate} className="press" style={{
              background: "none", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)",
              color: "var(--gold-2)", cursor: "pointer", fontSize: ".76rem", fontWeight: 600,
              padding: ".28rem .6rem", display: "flex", alignItems: "center", gap: ".3rem",
            }}>
              ✨ Régénérer
            </button>
          )}
          <button onClick={onRemove} title="Supprimer cette question"
            style={{ background: "none", border: "none", color: "var(--muted-2)", cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>
            🗑
          </button>
        </div>
      </div>

      <div style={{ padding: ".9rem 1rem", opacity: regenerating ? 0.5 : 1, pointerEvents: regenerating ? "none" : "auto", transition: "opacity .2s" }}>
        <Textarea
          label="Énoncé de la question"
          rows={2}
          value={q.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Texte de la question générée…"
        />

        {hasChoices ? (
          <>
            <div className="field-label" style={{ marginBottom: ".35rem" }}>
              Choix de réponse
              {isQcmMulti && (
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#8b5cf6", fontSize: ".78rem", marginLeft: ".4rem" }}>
                  — cochez toutes les bonnes réponses (2 ou 3)
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", marginBottom: ".45rem" }}>
              {q.choices.map((c, ci) => (
                <div key={ci} style={{
                  display: "flex", alignItems: "center", gap: ".5rem", padding: ".4rem .55rem",
                  background: c.is_correct ? "rgba(82,176,131,.08)" : "transparent",
                  border: `1px solid ${c.is_correct ? "rgba(82,176,131,.25)" : "var(--line-soft)"}`,
                  borderRadius: "var(--radius-sm)", transition: "all .15s",
                }}>
                  <input
                    className="input"
                    style={{ flex: 1, margin: 0, background: "transparent", border: "none", boxShadow: "none", padding: ".3rem .4rem", fontSize: ".86rem" }}
                    placeholder={`Option ${ci + 1}`}
                    value={c.text}
                    onChange={(e) => setChoice(ci, { text: e.target.value })}
                  />
                  <label title={isQcmMulti ? "Bonne réponse (plusieurs possibles)" : "Bonne réponse"} style={{ display: "flex", alignItems: "center", gap: ".3rem", cursor: "pointer", fontSize: ".75rem", color: c.is_correct ? "var(--ok)" : "var(--muted-2)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {isQcmMulti ? (
                      <input type="checkbox" checked={c.is_correct} onChange={() => toggleCorrect(ci)} style={{ accentColor: "#8b5cf6", width: 15, height: 15 }} />
                    ) : (
                      <input type="radio" name={`ai-correct-${index}`} checked={c.is_correct} onChange={() => markCorrect(ci)} style={{ accentColor: "var(--ok)", width: 15, height: 15 }} />
                    )}
                    {c.is_correct ? "Correct" : "Réponse"}
                  </label>
                  {q.choices.length > 2 && (
                    <button onClick={() => removeChoice(ci)} title="Retirer" style={{ background: "none", border: "none", color: "var(--muted-2)", cursor: "pointer", fontSize: ".9rem", flexShrink: 0 }}>🗑</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addChoice} style={{ background: "none", border: "none", color: "var(--gold-2)", cursor: "pointer", fontSize: ".82rem", fontWeight: 600, padding: ".2rem 0" }}>
              + Ajouter une réponse
            </button>
          </>
        ) : (
          <>
            <div className="field-label" style={{ marginBottom: ".45rem" }}>
              Critères d&apos;évaluation IA <span style={{ color: "var(--muted-2)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>- utilisés par Gemini pour noter la réponse ouverte</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", marginBottom: ".45rem" }}>
              {q.criteria.map((c, ci) => (
                <div key={ci} style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  <span style={{ color: "var(--gold-2)", fontSize: ".8rem" }}>✓</span>
                  <input
                    className="input" style={{ flex: 1, margin: 0, fontSize: ".86rem" }}
                    placeholder={`Critère ${ci + 1}`} value={c}
                    onChange={(e) => setCriterion(ci, e.target.value)}
                  />
                  {q.criteria.length > 1 && (
                    <button onClick={() => removeCriterion(ci)} title="Retirer" style={{ background: "none", border: "none", color: "var(--muted-2)", cursor: "pointer", fontSize: ".9rem" }}>🗑</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addCriterion} style={{ background: "none", border: "none", color: "var(--gold-2)", cursor: "pointer", fontSize: ".82rem", fontWeight: 600, padding: ".2rem 0" }}>
              + Ajouter un critère
            </button>

            {/* Aperçu de la zone de réponse membre */}
            <div style={{ marginTop: ".9rem", padding: ".75rem", background: "var(--bg-2)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--line-soft)" }}>
              <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: ".4rem" }}>
                Aperçu — zone de réponse membre
              </div>
              <textarea
                disabled
                placeholder="Le membre rédigera sa réponse ici…"
                rows={4}
                style={{
                  width: "100%", resize: "vertical", boxSizing: "border-box",
                  background: "var(--bg-1)", border: "1px solid var(--line-soft)",
                  borderRadius: "var(--radius-sm)", padding: ".6rem .75rem",
                  fontSize: ".86rem", color: "var(--muted)", fontFamily: "var(--sans)",
                  cursor: "not-allowed", opacity: 0.7,
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Panneau principal ─────────────────────────────────────────────────────────

export function AIReviewPanel({
  initialQuestions, config, niveauSuggere, rangSuggere,
  targetFormationId, targetCourseId, targetBranche,
  targetLibraryPdfId,
  onClose, onPublished,
}: {
  initialQuestions: AIGeneratedQuestion[];
  config: AIGenerationConfig;
  niveauSuggere: AIDifficulty | null;
  rangSuggere: number | null;
  targetFormationId: number | null;
  targetCourseId: number | null;
  targetBranche?: Branche | null;
  targetLibraryPdfId?: number | null;
  onClose: () => void;
  onPublished: (message: string) => void;
}) {
  const [questions, setQuestions] = useState<AIGeneratedQuestion[]>(initialQuestions);
  const [title, setTitle] = useState(
    `${config.module_title || config.formation_title || "Module"} - Quiz généré par IA`,
  );
  const [threshold, setThreshold] = useState(14);
  const [niveau, setNiveau]       = useState<AIDifficulty>(niveauSuggere ?? config.difficulty);
  const [rang, setRang]           = useState<number>(rangSuggere ?? 1);
  const [regenerating, setRegenerating] = useState<string | null>(null); // client_id en cours
  const [saving, setSaving]       = useState<"DRAFT" | "PUBLISHED" | null>(null);
  const [error, setError]         = useState("");

  const setQ = (clientId: string, patch: Partial<AIGeneratedQuestion>) =>
    setQuestions((qs) => qs.map((q) => (q.client_id === clientId ? { ...q, ...patch } : q)));

  const removeQ = (clientId: string) =>
    setQuestions((qs) => qs.filter((q) => q.client_id !== clientId));

  const regenerate = async (q: AIGeneratedQuestion) => {
    setRegenerating(q.client_id);
    try {
      const question = await aiQuizApi.regenerateQuestion(config, q.type, q.suggested_rank);
      setQuestions((qs) => qs.map((it) => (it.client_id === q.client_id ? { ...question, client_id: q.client_id } : it)));
    } catch {
      setError("La régénération de cette question a échoué. Réessayez.");
    } finally {
      setRegenerating(null);
    }
  };

  const valid = title.trim().length > 0 &&
    questions.length > 0 &&
    questions.every((q) => {
      if (!q.text.trim()) return false;
      if (q.type === "QCM") {
        return q.choices.length >= 2 && q.choices.some((c) => c.is_correct) && q.choices.every((c) => c.text.trim());
      }
      if (q.type === "QCM_MULTI") {
        return q.choices.length >= 2 && q.choices.filter((c) => c.is_correct).length >= 2 && q.choices.every((c) => c.text.trim());
      }
      return q.criteria.length >= 1 && q.criteria.every((c) => c.trim());
    });

  const persist = async (status: "DRAFT" | "PUBLISHED") => {
    setError("");
    setSaving(status);
    try {
      const payload: Partial<QuizItem> = {
        title: title.trim(),
        pass_threshold: threshold,
        active: status === "PUBLISHED",
        ...(targetCourseId ? { course: targetCourseId, formation: undefined } : { formation: targetFormationId ?? undefined }),
        ...(targetLibraryPdfId ? { library_pdf: targetLibraryPdfId } : {}),
        questions: questions.map((q, qi) => ({
          text: q.text,
          multiple: q.type === "QCM_MULTI",
          order: qi + 1,
          type: q.type,
          criteria: q.type === "QRO" ? q.criteria.filter((c) => c.trim()) : [],
          choices: (q.type === "QCM" || q.type === "QCM_MULTI")
            ? q.choices.map((c, ci) => ({ text: c.text, is_correct: c.is_correct, order: ci + 1 }))
            : [],
        })),
        generated_by_ai: true,
        ai_source: config.source,
        niveau, rang,
        branche: targetBranche ?? null,
        status,
      };
      await quizApi.create(payload);
      onPublished(status === "PUBLISHED"
        ? `Quiz « ${title.trim()} » publié avec succès.`
        : `Quiz « ${title.trim()} » enregistré comme brouillon.`);
    } catch {
      setError("Impossible d'enregistrer le quiz. Vérifiez les champs et réessayez.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal onClose={onClose} title="Aperçu et édition - quiz généré par l'IA" maxWidth={720}>
      <Alert>{error}</Alert>

      {/* ── Infos quiz + niveau/rang (G-04) ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: ".75rem",
        marginBottom: "1rem", alignItems: "end",
      }}>
        <label style={{ display: "block" }}>
          <span className="field-label">Titre du quiz</span>
          <input className="input" style={{ margin: 0 }} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={{ display: "block" }}>
          <span className="field-label">Seuil de réussite</span>
          <input className="input" style={{ margin: 0 }} type="number" min={0} max={20} value={threshold}
                 onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
        <label style={{ display: "block" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".25rem" }}>
            <span className="field-label" style={{ marginBottom: 0 }}>Rang</span>
            {rangSuggere !== null && rangSuggere !== undefined && (
              <span style={{ fontSize: ".68rem", color: "var(--muted-2)" }} title="Rang suggéré par l'IA">
                (IA: {rangSuggere})
              </span>
            )}
          </div>
          <input className="input" style={{ margin: 0 }} type="number" min={1} value={rang}
                 onChange={(e) => setRang(Number(e.target.value))} />
        </label>
      </div>

      <div style={{ marginBottom: "1.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".35rem" }}>
          <span className="field-label" style={{ marginBottom: 0 }}>Niveau suggéré par l&apos;IA :</span>
          <NiveauBadge niveau={niveauSuggere} />
        </div>
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
          {NIVEAUX.map((n) => (
            <button key={n} type="button" className={`chip press ${niveau === n ? "on" : ""}`} onClick={() => setNiveau(n)}>
              {NIVEAU_LABEL[n]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Séparateur ── */}
      <div style={{ borderTop: "1px solid var(--line-soft)", margin: "0 0 1rem", display: "flex", alignItems: "center" }}>
        <span style={{
          fontSize: ".72rem", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
          color: "var(--muted-2)", background: "var(--bg-1)", padding: "0 .5rem", marginTop: "-1px",
        }}>
          {questions.length} question{questions.length !== 1 ? "s" : ""} générée{questions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Questions éditables ── */}
      {questions.map((q, i) => (
        <AIQuestionCard
          key={q.client_id}
          q={q}
          index={i}
          onChange={(patch) => setQ(q.client_id, patch)}
          onRemove={() => removeQ(q.client_id)}
          onRegenerate={() => regenerate(q)}
          regenerating={regenerating === q.client_id}
        />
      ))}

      {questions.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--muted)", padding: "1.5rem 0" }}>
          Toutes les questions ont été supprimées.
        </p>
      )}

      {/* ── Footer actions ── */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: ".5rem", marginTop: "1.3rem", flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <div style={{ display: "flex", gap: ".5rem" }}>
          <Button variant="ghost" loading={saving === "DRAFT"} disabled={!valid || !!saving} onClick={() => persist("DRAFT")}>
            Enregistrer en brouillon
          </Button>
          <Button loading={saving === "PUBLISHED"} disabled={!valid || !!saving} onClick={() => persist("PUBLISHED")}>
            Publier le quiz
          </Button>
        </div>
      </div>
    </Modal>
  );
}
