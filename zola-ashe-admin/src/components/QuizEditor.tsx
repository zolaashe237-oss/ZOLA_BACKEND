"use client";

import { useEffect, useRef, useState } from "react";

import { libraryApi, quizApi } from "@/lib/endpoints";
import type { Formation, LibraryPdf, QuizItem, QuizQuestion } from "@/lib/types";
import { Alert, Button, errorMessage } from "@/components/ui";
import { Modal } from "@/components/Modal";

// ── Helpers ───────────────────────────────────────────────────────────────────

type QType = "QCM" | "QCM_MULTI" | "QRO";

function emptyQuestion(order: number): QuizQuestion {
  return {
    text: "", multiple: false, order, type: "QCM",
    choices: [
      { text: "", is_correct: true,  order: 1 },
      { text: "", is_correct: false, order: 2 },
    ],
  };
}

const DEFAULT_CHOICES = [
  { text: "", is_correct: true,  order: 1 },
  { text: "", is_correct: false, order: 2 },
];

// ── Sous-composant : une question ─────────────────────────────────────────────

function QuestionCard({
  q, qi, total,
  onChange, onRemove,
}: {
  q: QuizQuestion; qi: number; total: number;
  onChange: (patch: Partial<QuizQuestion>) => void;
  onRemove: () => void;
}) {
  const qtype: QType = (q.type as QType) ?? "QCM";
  const isQro = qtype === "QRO";

  const setChoice = (ci: number, patch: Partial<QuizQuestion["choices"][number]>) =>
    onChange({ choices: q.choices.map((c, k) => (k === ci ? { ...c, ...patch } : c)) });

  const addChoice = () =>
    onChange({ choices: [...q.choices, { text: "", is_correct: false, order: q.choices.length + 1 }] });

  const removeChoice = (ci: number) =>
    onChange({ choices: q.choices.filter((_, k) => k !== ci) });

  const markCorrect = (ci: number, checked: boolean) => {
    if (q.multiple) {
      setChoice(ci, { is_correct: checked });
    } else {
      onChange({ choices: q.choices.map((c, k) => ({ ...c, is_correct: k === ci })) });
    }
  };

  function handleTypeChange(t: QType) {
    if (t === "QRO") {
      onChange({ type: "QRO", multiple: false, choices: [], criteria: q.criteria ?? [] });
    } else if (t === "QCM_MULTI") {
      onChange({ type: "QCM_MULTI", multiple: true, criteria: [],
        choices: q.choices.length ? q.choices : DEFAULT_CHOICES.map(c => ({ ...c })) });
    } else {
      onChange({ type: "QCM", multiple: false, criteria: [],
        choices: q.choices.length ? q.choices.map((c, k) => ({ ...c, is_correct: k === 0 })) : DEFAULT_CHOICES.map(c => ({ ...c })) });
    }
  }

  const criteriaText = (q.criteria ?? []).join("\n");
  function handleCriteriaChange(raw: string) {
    const lines = raw.split("\n").map((l) => l.trimStart()).filter(Boolean);
    onChange({ criteria: lines });
  }

  const TYPE_OPTIONS: { value: QType; label: string; hint: string }[] = [
    { value: "QCM",       label: "QCM",            hint: "Une seule bonne réponse" },
    { value: "QCM_MULTI", label: "QCM multi",       hint: "Plusieurs bonnes réponses" },
    { value: "QRO",       label: "Réponse ouverte", hint: "Corrigée par l'IA (Gemini)" },
  ];

  return (
    <div style={{
      border: `1px solid ${isQro ? "rgba(139,92,246,.35)" : "var(--line-soft)"}`,
      borderRadius: "var(--radius)",
      overflow: "hidden",
      marginBottom: ".65rem",
    }}>
      {/* En-tête */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: ".55rem .9rem",
        background: isQro ? "rgba(139,92,246,.06)" : "var(--bg-2)",
        borderBottom: `1px solid ${isQro ? "rgba(139,92,246,.2)" : "var(--line-soft)"}`,
        flexWrap: "wrap", gap: ".4rem",
      }}>
        <span style={{ fontSize: ".75rem", fontWeight: 700, color: "var(--muted)",
                       letterSpacing: ".06em", textTransform: "uppercase" }}>
          Q{qi + 1}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: ".35rem" }}>
          {TYPE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleTypeChange(value)}
              title={TYPE_OPTIONS.find(o => o.value === value)?.hint}
              className={`chip press ${qtype === value ? "on" : ""}`}
              style={{
                fontSize: ".72rem", padding: ".18rem .5rem",
                ...(qtype === value && value === "QRO" ? {
                  background: "rgba(139,92,246,.14)",
                  borderColor: "rgba(139,92,246,.5)",
                  color: "rgb(139,92,246)",
                } : {}),
              }}
            >
              {label}
            </button>
          ))}
          {total > 1 && (
            <button
              onClick={onRemove}
              title="Supprimer cette question"
              style={{ background: "none", border: "none", color: "var(--muted-2)",
                       cursor: "pointer", fontSize: ".9rem", lineHeight: 1, padding: ".15rem", marginLeft: ".1rem" }}
            >
              🗑
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: ".8rem .9rem" }}>
        {/* Texte */}
        <div style={{ marginBottom: ".65rem" }}>
          <div className="field-label">Intitulé de la question</div>
          <textarea
            className="input"
            rows={2}
            placeholder="Rédigez votre question…"
            value={q.text}
            onChange={(e) => onChange({ text: e.target.value })}
            style={{ resize: "vertical", margin: 0 }}
          />
        </div>

        {/* QRO */}
        {isQro ? (
          <div>
            <div className="field-label" style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "rgb(139,92,246)" }} />
              Critères d&apos;évaluation IA
              <span style={{ fontSize: ".7rem", color: "var(--muted-2)", fontWeight: 400 }}>(un par ligne)</span>
            </div>
            <textarea
              className="input"
              rows={3}
              placeholder={"Doit mentionner X\nDoit expliquer Y\nDoit citer Z"}
              value={criteriaText}
              onChange={(e) => handleCriteriaChange(e.target.value)}
              style={{ resize: "vertical", margin: 0, fontFamily: "monospace", fontSize: ".83rem" }}
            />
            <div style={{ fontSize: ".73rem", color: "rgb(139,92,246)", marginTop: ".3rem" }}>
              ✦ Gemini évaluera la réponse selon ces critères.
            </div>
          </div>
        ) : (
          <>
            <div className="field-label" style={{ marginBottom: ".4rem" }}>Réponses</div>
            <div style={{ display: "flex", flexDirection: "column", gap: ".35rem", marginBottom: ".4rem" }}>
              {q.choices.map((c, ci) => (
                <div key={ci} style={{
                  display: "flex", alignItems: "center", gap: ".45rem",
                  padding: ".35rem .5rem",
                  background: c.is_correct ? "rgba(82,176,131,.08)" : "transparent",
                  border: `1px solid ${c.is_correct ? "rgba(82,176,131,.28)" : "var(--line-soft)"}`,
                  borderRadius: "var(--radius-sm)", transition: "all .15s",
                }}>
                  <input
                    className="input"
                    style={{ flex: 1, margin: 0, background: "transparent", border: "none",
                             boxShadow: "none", padding: ".25rem .35rem", fontSize: ".85rem" }}
                    placeholder={`Option ${ci + 1}`}
                    value={c.text}
                    onChange={(e) => setChoice(ci, { text: e.target.value })}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: ".3rem", cursor: "pointer",
                                  fontSize: ".74rem", color: c.is_correct ? "var(--ok)" : "var(--muted-2)",
                                  whiteSpace: "nowrap", flexShrink: 0 }}>
                    <input
                      type={q.multiple ? "checkbox" : "radio"}
                      name={`correct-${qi}`}
                      checked={c.is_correct}
                      onChange={(e) => markCorrect(ci, e.target.checked)}
                      style={{ accentColor: "var(--ok)", width: 14, height: 14 }}
                    />
                    {c.is_correct ? "Correct" : "Réponse"}
                  </label>
                  {q.choices.length > 2 && (
                    <button onClick={() => removeChoice(ci)} title="Retirer cette option"
                            style={{ background: "none", border: "none", color: "var(--muted-2)",
                                     cursor: "pointer", fontSize: ".85rem", lineHeight: 1, flexShrink: 0 }}>
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addChoice}
              style={{ background: "none", border: "none", color: "var(--gold-2)", cursor: "pointer",
                       fontSize: ".8rem", fontWeight: 600, padding: ".15rem 0",
                       display: "flex", alignItems: "center", gap: ".3rem" }}
            >
              + Ajouter une réponse
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────

export function QuizEditor({
  quiz,
  course,
  formation: defaultFormation,
  libraryPdf: defaultLibraryPdf,
  formations = [],
  onClose,
  onSaved,
}: {
  quiz: QuizItem | null;
  course?: number;
  formation?: number;
  libraryPdf?: number;
  formations?: Formation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title,        setTitle]        = useState(quiz?.title ?? "");
  const [threshold,    setThreshold]    = useState(quiz?.pass_threshold ?? 14);
  const [active,       setActive]       = useState(quiz?.active ?? true);
  const [formationId,  setFormationId]  = useState<string>(String(quiz?.formation ?? defaultFormation ?? ""));
  const [libraryPdfId, setLibraryPdfId] = useState<string>(String(quiz?.library_pdf ?? defaultLibraryPdf ?? ""));
  const [pdfOptions,   setPdfOptions]   = useState<LibraryPdf[]>([]);
  const [questions,    setQuestions]    = useState<QuizQuestion[]>(
    quiz?.questions?.length ? quiz.questions : [emptyQuestion(1)],
  );
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    libraryApi.listActive().then(setPdfOptions).catch(() => {});
  }, []);

  const setQ = (i: number, patch: Partial<QuizQuestion>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));

  const addQuestion = () => {
    setQuestions((qs) => [...qs, emptyQuestion(qs.length + 1)]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  };

  const save = async () => {
    setError(""); setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        pass_threshold: threshold,
        active,
        ...(course ? { course } : { formation: formationId ? Number(formationId) : undefined }),
        library_pdf: libraryPdfId ? Number(libraryPdfId) : null,
        questions: questions.map((q, qi) => ({
          text: q.text, multiple: q.multiple, order: qi + 1,
          type: q.type ?? "QCM",
          criteria: q.criteria ?? [],
          ...(q.id ? { id: q.id } : {}),
          choices: (q.type === "QRO" ? [] : q.choices).map((c, ci) => ({
            text: c.text, is_correct: c.is_correct, order: ci + 1,
            ...(c.id ? { id: c.id } : {}),
          })),
        })),
      };
      if (quiz) await quizApi.update(quiz.id, payload);
      else       await quizApi.create(payload);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!quiz) return;
    setDeleting(true);
    try { await quizApi.remove(quiz.id); onSaved(); }
    catch (e) { setError(errorMessage(e)); setDeleting(false); }
  };

  const valid = title.trim().length > 0 &&
    questions.length > 0 &&
    questions.every((q) => {
      if (!q.text.trim()) return false;
      if (q.type === "QRO") return true;
      return q.choices.some((c) => c.is_correct) && q.choices.every((c) => c.text.trim());
    });

  return (
    <Modal
      onClose={onClose}
      title={quiz ? "Modifier le quiz" : "Créer un quiz"}
      maxWidth={640}
    >
      <Alert>{error}</Alert>

      {/* ── Métadonnées ───────────────────────────────────────────────────── */}

      {/* Titre */}
      <div style={{ marginBottom: "1rem" }}>
        <div className="field-label">Titre du quiz</div>
        <input
          className="input"
          placeholder="ex. Examen final — Développement Personnel"
          value={title}
          style={{ margin: 0 }}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Formation */}
      {!course && (
        <div style={{ marginBottom: "1rem" }}>
          <div className="field-label">Formation</div>
          <select className="select" value={formationId} style={{ margin: 0 }}
                  onChange={(e) => setFormationId(e.target.value)}>
            <option value="">— Choisir une formation —</option>
            {formations.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
        </div>
      )}

      {/* Livre PDF */}
      <div style={{ marginBottom: "1.2rem" }}>
        <div className="field-label">Livre PDF associé <span style={{ fontWeight: 400, color: "var(--muted-2)" }}>(optionnel)</span></div>
        <select className="select" value={libraryPdfId} style={{ margin: 0 }}
                onChange={(e) => setLibraryPdfId(e.target.value)}>
          <option value="">— Aucun livre associé —</option>
          {pdfOptions.map((pdf) => <option key={pdf.id} value={pdf.id}>{pdf.title}</option>)}
        </select>
      </div>

      {/* Seuil de réussite (slider) + Statut (chips) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.4rem" }}>

        {/* Seuil */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
            <span className="field-label" style={{ marginBottom: 0 }}>Seuil de réussite</span>
            <span style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--gold-2)" }}>{threshold} / 20</span>
          </div>
          <input
            type="range" min={0} max={20} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--gold)" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".68rem", color: "var(--muted-2)", marginTop: ".15rem" }}>
            <span>0</span><span>20</span>
          </div>
        </div>

        {/* Statut chips */}
        <div>
          <div className="field-label">Statut</div>
          <div style={{ display: "flex", gap: ".5rem" }}>
            <button
              type="button"
              className={`chip press ${active ? "on" : ""}`}
              onClick={() => setActive(true)}
            >
              ● Actif
            </button>
            <button
              type="button"
              className={`chip press ${!active ? "on" : ""}`}
              onClick={() => setActive(false)}
            >
              ● Inactif
            </button>
          </div>
        </div>
      </div>

      {/* ── Section questions ─────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: ".75rem",
        paddingBottom: ".65rem",
        borderBottom: "1px solid var(--line-soft)",
      }}>
        <span style={{ fontSize: ".75rem", fontWeight: 700, letterSpacing: ".08em",
                       textTransform: "uppercase", color: "var(--muted-2)" }}>
          {questions.length} question{questions.length !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: ".72rem", color: "var(--muted-2)" }}>
          {questions.filter(q => q.type === "QRO").length > 0 &&
            `${questions.filter(q => q.type === "QRO").length} QRO · `}
          {questions.filter(q => q.type !== "QRO").length} QCM
        </span>
      </div>

      {questions.map((q, qi) => (
        <QuestionCard
          key={qi}
          q={q} qi={qi} total={questions.length}
          onChange={(patch) => setQ(qi, patch)}
          onRemove={() => setQuestions((qs) => qs.filter((_, idx) => idx !== qi))}
        />
      ))}

      {/* + Ajouter une question */}
      <button
        onClick={addQuestion}
        style={{
          width: "100%", background: "none",
          border: "1.5px dashed var(--line-soft)",
          color: "var(--gold-2)", cursor: "pointer",
          padding: ".55rem", borderRadius: "var(--radius-sm)",
          fontSize: ".84rem", fontWeight: 600,
          display: "flex", alignItems: "center", justifyContent: "center", gap: ".35rem",
          transition: "border-color .15s",
          marginBottom: "1.5rem",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--gold)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; }}
      >
        + Ajouter une question
      </button>

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div ref={bottomRef} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: "1rem",
        borderTop: "1px solid var(--line-soft)",
        gap: ".5rem",
      }}>
        <div>
          {quiz && (
            <Button variant="danger" loading={deleting} onClick={remove}>
              Supprimer
            </Button>
          )}
        </div>
        <div style={{ display: "flex", gap: ".5rem" }}>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={save} loading={saving} disabled={!valid}>
            {quiz ? "Mettre à jour" : "Créer le quiz"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
