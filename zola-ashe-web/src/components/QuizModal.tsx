"use client";

import { useEffect, useState } from "react";

import { quizApi } from "@/lib/endpoints";
import type { QuizPublic, QuizSubmitResult } from "@/lib/types";
import { errorMessage } from "@/components/ui";

/** Passage d'un QCM : énoncé, sélection des réponses, notation côté serveur. */
export function QuizModal({
  quizId,
  onClose,
  onValidated,
}: {
  quizId: number;
  onClose: () => void;
  onValidated?: () => void;
}) {
  const [quiz, setQuiz] = useState<QuizPublic | null>(null);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    quizApi.get(quizId)
      .then((r) => setQuiz(r.data))
      .catch((e) => setMessage(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [quizId]);

  const toggle = (qId: number, cId: number, multiple: boolean) => {
    setAnswers((prev) => {
      const key = String(qId);
      const current = prev[key] ?? [];
      if (multiple) {
        return { ...prev, [key]: current.includes(cId) ? current.filter((x) => x !== cId) : [...current, cId] };
      }
      return { ...prev, [key]: [cId] };
    });
  };

  const submit = async () => {
    if (!quiz) return;
    setSubmitting(true);
    setMessage("");
    try {
      const { data } = await quizApi.submit(quiz.id, answers);
      setResult(data);
      if (data.validated) onValidated?.();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const allAnswered = quiz?.questions.every((q) => (answers[String(q.id)] ?? []).length > 0) ?? false;

  return (
    <div onClick={onClose}
         style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(8,6,5,.8)",
                  backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start",
                  justifyContent: "center", padding: "1.5rem", overflowY: "auto",
                  animation: "fadeUp .25s ease both" }}>
      <div onClick={(e) => e.stopPropagation()} className="card"
           style={{ width: "100%", maxWidth: 720, padding: "1.3rem", borderColor: "var(--line)", margin: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1.3rem", margin: 0 }}>{quiz?.title ?? "QCM"}</h3>
          <button onClick={onClose} aria-label="Fermer"
                  style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--cream)",
                           width: 34, height: 34, borderRadius: 999, cursor: "pointer" }}>✕</button>
        </div>

        {message && <div className="alert alert-error">{message}</div>}
        {loading && <p style={{ color: "var(--muted)" }}>Chargement…</p>}

        {/* Résultat */}
        {result && (
          <div className={`alert ${result.validated ? "alert-success" : "alert-error"}`}
               style={{ marginBottom: "1rem" }}>
            <strong>{result.validated ? "QCM validé 🎉" : "Pas encore validé"}</strong>
            <div style={{ fontSize: ".88rem", marginTop: 4 }}>
              Score : {result.last_score}/20 ({result.correct}/{result.total} bonnes réponses) —
              seuil requis {result.pass_threshold}/20. Meilleur score : {result.score}/20.
            </div>
            {!result.validated && (
              <div style={{ fontSize: ".82rem", marginTop: 4, color: "var(--muted)" }}>
                Tentatives illimitées : revoyez le cours et réessayez.
              </div>
            )}
          </div>
        )}

        {/* Questions */}
        {quiz && !result && quiz.questions.map((q, qi) => (
          <div key={q.id} style={{ marginBottom: "1.1rem" }}>
            <p style={{ fontWeight: 600, marginBottom: ".5rem" }}>
              {qi + 1}. {q.text}
              {q.multiple && <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: ".8rem" }}> (plusieurs réponses)</span>}
            </p>
            <div style={{ display: "grid", gap: ".4rem" }}>
              {q.choices.map((c) => {
                const checked = (answers[String(q.id)] ?? []).includes(c.id);
                return (
                  <label key={c.id}
                         style={{ display: "flex", alignItems: "center", gap: ".6rem", padding: ".6rem .8rem",
                                  borderRadius: 10, cursor: "pointer", border: "1px solid var(--line)",
                                  background: checked ? "rgba(201,162,39,.14)" : "transparent" }}>
                    <input type={q.multiple ? "checkbox" : "radio"} name={`q${q.id}`}
                           checked={checked} onChange={() => toggle(q.id, c.id, q.multiple)} />
                    <span style={{ fontSize: ".9rem" }}>{c.text}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        {/* Actions */}
        {quiz && !result && (
          <button className="btn btn-primary press" disabled={!allAnswered || submitting}
                  onClick={submit} style={{ width: "100%", marginTop: ".5rem" }}>
            {submitting ? "Validation…" : "Valider mes réponses"}
          </button>
        )}
        {result && (
          <button className="btn btn-primary press" onClick={onClose} style={{ width: "100%" }}>
            Fermer
          </button>
        )}
      </div>
    </div>
  );
}
