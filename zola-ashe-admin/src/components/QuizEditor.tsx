"use client";

import { useState } from "react";

import { quizApi } from "@/lib/endpoints";
import type { QuizItem, QuizQuestion } from "@/lib/types";
import { Alert, Button, Input, errorMessage } from "@/components/ui";

function emptyQuestion(order: number): QuizQuestion {
  return {
    text: "", multiple: false, order,
    choices: [
      { text: "", is_correct: true, order: 1 },
      { text: "", is_correct: false, order: 2 },
    ],
  };
}

/** Éditeur de QCM (modale) : questions + options, rattaché à un cours OU à une formation. */
export function QuizEditor({
  quiz,
  course,
  formation,
  onClose,
  onSaved,
}: {
  quiz: QuizItem | null;
  course?: number;
  formation?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(quiz?.title ?? (formation ? "Examen final" : "QCM"));
  const [threshold, setThreshold] = useState(quiz?.pass_threshold ?? 15);
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    quiz?.questions?.length ? quiz.questions : [emptyQuestion(1)],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setQ = (i: number, patch: Partial<QuizQuestion>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));

  const setChoice = (qi: number, ci: number, patch: Partial<QuizQuestion["choices"][number]>) =>
    setQuestions((qs) => qs.map((q, idx) => idx !== qi ? q : {
      ...q, choices: q.choices.map((c, k) => (k === ci ? { ...c, ...patch } : c)),
    }));

  const addQuestion = () => setQuestions((qs) => [...qs, emptyQuestion(qs.length + 1)]);
  const removeQuestion = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const addChoice = (qi: number) => setQuestions((qs) => qs.map((q, idx) => idx !== qi ? q : {
    ...q, choices: [...q.choices, { text: "", is_correct: false, order: q.choices.length + 1 }],
  }));
  const removeChoice = (qi: number, ci: number) => setQuestions((qs) => qs.map((q, idx) => idx !== qi ? q : {
    ...q, choices: q.choices.filter((_, k) => k !== ci),
  }));

  const save = async () => {
    setError(""); setSaving(true);
    try {
      const payload = {
        title, pass_threshold: threshold,
        ...(course ? { course } : { formation }),
        questions: questions.map((q, qi) => ({
          text: q.text, multiple: q.multiple, order: qi + 1,
          choices: q.choices.map((c, ci) => ({ text: c.text, is_correct: c.is_correct, order: ci + 1 })),
        })),
      };
      if (quiz) await quizApi.update(quiz.id, payload);
      else await quizApi.create(payload);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!quiz || !confirm("Supprimer ce QCM ?")) return;
    setSaving(true);
    try { await quizApi.remove(quiz.id); onSaved(); }
    catch (e) { setError(errorMessage(e)); setSaving(false); }
  };

  const valid = title.trim() && questions.length > 0 &&
    questions.every((q) => q.text.trim() && q.choices.some((c) => c.is_correct) &&
      q.choices.every((c) => c.text.trim()));

  return (
    <div onClick={onClose}
         style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(8,6,5,.8)",
                  backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start",
                  justifyContent: "center", padding: "1.5rem", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card"
           style={{ width: "100%", maxWidth: 760, margin: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.15rem", margin: 0 }}>{formation ? "Examen final" : "QCM du cours"}</h2>
          <button onClick={onClose} aria-label="Fermer"
                  style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--cream)",
                           width: 32, height: 32, borderRadius: 999, cursor: "pointer" }}>✕</button>
        </div>

        <Alert>{error}</Alert>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: ".8rem" }}>
          <Input label="Titre du QCM" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input label="Seuil de réussite (/20)" type="number" min={0} max={20} value={threshold}
                 onChange={(e) => setThreshold(Number(e.target.value))} />
        </div>

        {questions.map((q, qi) => (
          <div key={qi} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: ".8rem", marginBottom: ".8rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: ".9rem" }}>Question {qi + 1}</strong>
              <button onClick={() => removeQuestion(qi)}
                      style={{ background: "none", border: "none", color: "var(--terra-2)", cursor: "pointer" }}>
                Supprimer
              </button>
            </div>
            <Input value={q.text} placeholder="Énoncé de la question"
                   onChange={(e) => setQ(qi, { text: e.target.value })} />
            <label style={{ display: "flex", alignItems: "center", gap: ".4rem", fontSize: ".82rem", marginBottom: ".5rem", cursor: "pointer" }}>
              <input type="checkbox" checked={q.multiple} onChange={(e) => setQ(qi, { multiple: e.target.checked })} />
              Plusieurs bonnes réponses possibles
            </label>
            <div style={{ display: "grid", gap: ".4rem" }}>
              {q.choices.map((c, ci) => (
                <div key={ci} style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  <input type="checkbox" title="Bonne réponse" checked={c.is_correct}
                         onChange={(e) => setChoice(qi, ci, { is_correct: e.target.checked })} />
                  <input className="input" style={{ flex: 1 }} value={c.text} placeholder={`Option ${ci + 1}`}
                         onChange={(e) => setChoice(qi, ci, { text: e.target.value })} />
                  {q.choices.length > 2 && (
                    <button onClick={() => removeChoice(qi, ci)}
                            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => addChoice(qi)}
                    style={{ background: "none", border: "none", color: "var(--gold-2)", cursor: "pointer", fontSize: ".82rem", marginTop: ".4rem" }}>
              + Ajouter une option
            </button>
          </div>
        ))}

        <Button variant="ghost" onClick={addQuestion} className="">+ Ajouter une question</Button>

        <div style={{ display: "flex", gap: ".5rem", marginTop: "1rem" }}>
          <Button onClick={save} loading={saving} disabled={!valid}>Enregistrer le QCM</Button>
          {quiz && <Button variant="danger" onClick={remove}>Supprimer</Button>}
        </div>
        {!valid && (
          <p style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: ".5rem" }}>
            Chaque question doit avoir un énoncé, des options renseignées et au moins une bonne réponse.
          </p>
        )}
      </div>
    </div>
  );
}
