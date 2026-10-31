"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { asList, quizResultsApi, resetQuizApi, quizApi, setQuizScoreApi } from "@/lib/endpoints";
import type { QuizItem, QuizResult, QuizResultAnswers } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Pagination, Select, errorMessage, usePagination } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";

import { BrandLoader } from "@/components/BrandLoader";
import { useToast } from "@/components/Toast";

export default function QuizResultsPage() {
  const { toast } = useToast();
  const [results,      setResults]      = useState<QuizResult[]>([]);
  const [quizzes,      setQuizzes]      = useState<QuizItem[]>([]);
  const [filterQuiz,   setFilterQuiz]   = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [resetting,    setResetting]    = useState<number | null>(null);
  const [resetTarget,  setResetTarget]  = useState<QuizResult | null>(null);
  const [scoreTarget,  setScoreTarget]  = useState<QuizResult | null>(null);
  const [answersTarget, setAnswersTarget] = useState<QuizResult | null>(null);
  const [loading,      setLoading]      = useState(true);

  const load = useCallback(async () => {
    try {
      const [resData, qData] = await Promise.all([
        quizResultsApi.list({
          quiz_id:    filterQuiz   ? Number(filterQuiz) : undefined,
          search:     filterSearch || undefined,
        }),
        quizApi.listAll(),
      ]);
      setResults(asList(resData.data));
      setQuizzes(asList(qData.data));
    } catch (e) {
      toast("Impossible de charger les résultats des quiz.", "error");
    } finally {
      setLoading(false);
    }
  }, [filterQuiz, filterSearch, toast]);

  useEffect(() => { load(); }, [load]);

  const doReset = async (r: QuizResult, reason: string) => {
    setResetting(r.id);
    try {
      await resetQuizApi({ user_id: r.user_id, quiz_id: r.quiz_id, reason });
      toast(`Quiz réinitialisé pour ${r.user_name}.`, "success");
      await load();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setResetting(null); }
  };

  const filtered = results.filter((r) => {
    if (filterQuiz   && String(r.quiz_id) !== filterQuiz) return false;
    if (filterSearch && !r.user_name.toLowerCase().includes(filterSearch.toLowerCase())
                     && !r.user_email.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    if (filterStatus === "VALIDE"    && !r.validated)  return false;
    if (filterStatus === "ECHOUE"    &&  r.validated)  return false;
    return true;
  });

  const filterKey = `${filterSearch}|${filterQuiz}|${filterStatus}`;
  const { page, totalPages, paged, total, pageSize, setPageSize, go } = usePagination(filtered, 20, filterKey);

  const scoreColor = (score: number, max: number) => {
    const pct = (score / max) * 100;
    if (pct >= 70) return "#5fb98a";
    if (pct >= 50) return "#d9a441";
    return "#cf5a3c";
  };

  if (loading) {
    return <BrandLoader label="Chargement des résultats..." />;
  }

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Quiz & QCM</div>
        <h1>Résultats des quiz</h1>
        <p>
          {results.length} résultat{results.length !== 1 ? "s" : ""} · {" "}
          {results.filter((r) => r.validated).length} validé{results.filter((r) => r.validated).length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: ".75rem", alignItems: "flex-end", marginBottom: "1.1rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Input
            label="Rechercher (nom / email)"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Nom ou email du membre…"
          />
        </div>
        <div style={{ width: 230 }}>
          <Select label="Quiz" value={filterQuiz} onChange={(e) => setFilterQuiz(e.target.value)}>
            <option value="">Tous les quiz</option>
            {quizzes.map((q) => (
              <option key={q.id} value={q.id}>{q.title}</option>
            ))}
          </Select>
        </div>
        <div style={{ width: 160 }}>
          <Select label="Résultat" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Tous</option>
            <option value="VALIDE">Validés</option>
            <option value="ECHOUE">Non validés</option>
          </Select>
        </div>
        <Link href="/quizz" style={{ marginBottom: ".85rem" }}>
          <Button variant="ghost">← Retour aux quiz</Button>
        </Link>
      </div>

      {/* Tableau */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Membre</th>
              <th>Quiz</th>
              <th style={{ textAlign: "right" }}>Score</th>
              <th>Résultat</th>
              <th>Tentatives</th>
              <th>Passé le</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/membres/${r.user_id}`} style={{ textDecoration: "none" }}>
                    <div style={{ fontWeight: 600, fontSize: ".875rem", color: "var(--gold-2)" }}>
                      {r.user_name}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: ".78rem" }}>{r.user_email}</div>
                  </Link>
                </td>
                <td style={{ fontSize: ".83rem", color: "var(--muted)", maxWidth: 220 }}>
                  {r.quiz_title}
                </td>
                <td style={{ textAlign: "right" }}>
                  <span style={{ fontWeight: 700, color: scoreColor(r.score, r.max_score) }}>
                    {r.score}
                  </span>
                  <span style={{ color: "var(--muted-2)", fontSize: ".8rem" }}>
                    &nbsp;/ {r.max_score}
                  </span>
                </td>
                <td>
                  <Badge color={r.validated ? "var(--ok)" : "var(--danger)"}>
                    {r.validated ? "Validé" : "Non validé"}
                  </Badge>
                </td>
                <td style={{ color: "var(--muted)", fontSize: ".83rem", textAlign: "center" }}>
                  {r.attempts}
                </td>
                <td style={{ color: "var(--muted)", fontSize: ".78rem", whiteSpace: "nowrap" }}>
                  {r.passed_at
                    ? new Date(r.passed_at).toLocaleDateString("fr-FR")
                    : <span style={{ color: "var(--muted-2)" }}>—</span>}
                </td>
                <td>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: ".45rem" }}>
                    <Button
                      className="btn-sm"
                      variant="ghost"
                      onClick={() => setAnswersTarget(r)}
                    >
                      Voir les réponses
                    </Button>
                    <Button
                      className="btn-sm"
                      variant="ghost"
                      onClick={() => setScoreTarget(r)}
                    >
                      Saisir score
                    </Button>
                    <Button
                      className="btn-sm"
                      variant="danger"
                      loading={resetting === r.id}
                      onClick={() => setResetTarget(r)}
                    >
                      Réinitialiser
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                  Aucun résultat trouvé.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={page} totalPages={totalPages} total={total}
          pageSize={pageSize} onPage={go} onPageSize={setPageSize}
        />
      </Card>

      {resetTarget && (
        <ConfirmModal
          title="Réinitialiser le quiz"
          message={`Remettre à zéro le résultat de ${resetTarget.user_name} pour « ${resetTarget.quiz_title} » ?`}
          withReason
          reasonLabel="Motif de la réinitialisation"
          confirmLabel="Réinitialiser"
          onClose={() => setResetTarget(null)}
          onConfirm={async (reason) => {
            await doReset(resetTarget, reason);
            setResetTarget(null);
          }}
        />
      )}

      {scoreTarget && (
        <ManualScoreModal
          result={scoreTarget}
          onClose={() => setScoreTarget(null)}
          onSaved={load}
        />
      )}

      {answersTarget && (
        <QuizAnswersModal
          result={answersTarget}
          onClose={() => setAnswersTarget(null)}
        />
      )}
    </div>
  );
}

function QuizAnswersModal({
  result,
  onClose,
}: {
  result: QuizResult;
  onClose: () => void;
}) {
  const [data, setData]     = useState<QuizResultAnswers | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    quizResultsApi.answers(result.id)
      .then((r) => setData(r.data))
      .catch(() => toast("Impossible de charger les réponses.", "error"))
      .finally(() => setLoading(false));
  }, [result.id, toast]);

  const scoreColor = (score: number, max: number) => {
    const pct = (score / max) * 100;
    if (pct >= 70) return "#5fb98a";
    if (pct >= 50) return "#d9a441";
    return "#cf5a3c";
  };

  return (
    <Modal
      onClose={onClose}
      title={`Réponses — ${result.user_name}`}
      maxWidth={680}
    >
      {loading && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>
          Chargement…
        </p>
      )}
      {data && !loading && (
        <>
          {/* En-tête résumé */}
          <div style={{
            display: "flex", gap: "1.5rem", flexWrap: "wrap",
            padding: ".75rem 1rem", background: "var(--bg-2)",
            borderRadius: "var(--radius)", marginBottom: "1.2rem",
            border: "1px solid var(--line-soft)", fontSize: ".83rem",
          }}>
            <div>
              <span style={{ color: "var(--muted-2)" }}>Quiz</span>
              <div style={{ fontWeight: 600, color: "var(--cream)" }}>{data.quiz_title}</div>
            </div>
            <div>
              <span style={{ color: "var(--muted-2)" }}>Score</span>
              <div style={{ fontWeight: 700, color: scoreColor(data.score, data.max_score) }}>
                {data.score} / {data.max_score}
              </div>
            </div>
            <div>
              <span style={{ color: "var(--muted-2)" }}>Résultat</span>
              <div>
                <Badge color={data.validated ? "var(--ok)" : "var(--danger)"}>
                  {data.validated ? "Validé" : "Non validé"}
                </Badge>
              </div>
            </div>
            <div>
              <span style={{ color: "var(--muted-2)" }}>Tentatives</span>
              <div style={{ fontWeight: 600 }}>{data.attempts}</div>
            </div>
          </div>

          {!data.has_answers ? (
            <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.5rem 0", fontSize: ".86rem" }}>
              Les réponses ne sont pas disponibles pour cette tentative.<br />
              <span style={{ fontSize: ".78rem", color: "var(--muted-2)" }}>
                (Les réponses sont enregistrées à partir de maintenant)
              </span>
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
              {data.questions.map((q, i) => (
                <div key={q.id} style={{
                  border: "1px solid var(--line-soft)",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                }}>
                  {/* En-tête question */}
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: ".6rem",
                    padding: ".6rem .85rem", background: "var(--bg-2)",
                    borderBottom: "1px solid var(--line-soft)",
                  }}>
                    <span style={{
                      flexShrink: 0, marginTop: ".1rem",
                      fontSize: ".68rem", fontWeight: 800, borderRadius: 999,
                      padding: ".12rem .45rem", whiteSpace: "nowrap",
                      color: q.type === "QRO" ? "#2d61b0" : q.type === "QCM_MULTI" ? "#8b5cf6" : "var(--gold-2)",
                      background: q.type === "QRO" ? "var(--info-bg)" : q.type === "QCM_MULTI" ? "rgba(139,92,246,.1)" : "var(--gold-bg)",
                      border: `1px solid ${q.type === "QRO" ? "rgba(45,97,176,.3)" : q.type === "QCM_MULTI" ? "rgba(139,92,246,.35)" : "rgba(201,162,39,.35)"}`,
                    }}>
                      Q{i + 1} · {q.type}
                    </span>
                    <span style={{ fontSize: ".87rem", fontWeight: 500, color: "var(--cream)", lineHeight: 1.4 }}>
                      {q.text}
                    </span>
                    {q.type !== "QRO" && (
                      <span style={{
                        marginLeft: "auto", flexShrink: 0,
                        fontSize: ".72rem", fontWeight: 700,
                        color: q.is_correct ? "var(--ok)" : "var(--danger)",
                      }}>
                        {q.is_correct ? "✓ Juste" : "✗ Faux"}
                      </span>
                    )}
                  </div>

                  <div style={{ padding: ".6rem .85rem" }}>
                    {q.type === "QRO" ? (
                      <>
                        {q.criteria.length > 0 && (
                          <div style={{ marginBottom: ".5rem" }}>
                            <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: ".3rem" }}>
                              Critères d&apos;évaluation
                            </div>
                            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                              {q.criteria.map((c, ci) => (
                                <li key={ci} style={{ fontSize: ".8rem", color: "var(--muted)", marginBottom: ".2rem" }}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: ".35rem" }}>
                          Réponse du membre
                        </div>
                        <div style={{
                          background: "var(--bg-2)", borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--line-soft)", padding: ".6rem .75rem",
                          fontSize: ".85rem", color: q.user_answer ? "var(--cream)" : "var(--muted-2)",
                          fontStyle: q.user_answer ? "normal" : "italic", lineHeight: 1.5, minHeight: "3rem",
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                        }}>
                          {q.user_answer || "Aucune réponse saisie"}
                        </div>
                      </>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: ".3rem" }}>
                        {q.choices.map((c) => {
                          const sel = c.selected;
                          const cor = c.is_correct;
                          let bg = "transparent";
                          let border = "var(--line-soft)";
                          let textColor = "var(--muted)";
                          if (sel && cor)  { bg = "rgba(82,176,131,.1)";  border = "rgba(82,176,131,.4)";  textColor = "#5fb98a"; }
                          if (sel && !cor) { bg = "rgba(201,80,58,.08)";  border = "rgba(201,80,58,.35)";  textColor = "#cf5a3c"; }
                          if (!sel && cor) { bg = "rgba(82,176,131,.05)"; border = "rgba(82,176,131,.25)"; textColor = "var(--muted)"; }
                          return (
                            <div key={c.id} style={{
                              display: "flex", alignItems: "center", gap: ".55rem",
                              padding: ".38rem .65rem", borderRadius: "var(--radius-sm)",
                              background: bg, border: `1px solid ${border}`, transition: "all .1s",
                            }}>
                              <span style={{
                                fontSize: ".75rem", width: 16, height: 16, flexShrink: 0,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                borderRadius: "50%", border: `1.5px solid ${border}`,
                                background: sel ? border : "transparent",
                                color: sel ? "#fff" : "transparent",
                                fontWeight: 900,
                              }}>
                                {sel ? (cor ? "✓" : "✗") : ""}
                              </span>
                              <span style={{ fontSize: ".85rem", color: textColor, flex: 1 }}>{c.text}</span>
                              {cor && !sel && (
                                <span style={{ fontSize: ".7rem", color: "#5fb98a", fontWeight: 700, flexShrink: 0 }}>
                                  ← bonne réponse
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function ManualScoreModal({
  result,
  onClose,
  onSaved,
}: {
  result: QuizResult;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [score, setScore] = useState(String(result.score));
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(score);
    if (isNaN(val) || val < 0 || val > 20) {
      toast("Le score doit être un nombre entre 0 et 20.", "error");
      return;
    }
    setLoading(true);
    try {
      await setQuizScoreApi({
        user_id: result.user_id,
        quiz_id: result.quiz_id,
        score: val,
      });
      onSaved();
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Saisir un score" onClose={onClose} maxWidth={400}>
      <form onSubmit={submit}>
        <div style={{ marginBottom: "1rem", fontSize: ".85rem", color: "var(--muted)" }}>
          Membre : <strong>{result.user_name}</strong>
          <br />
          Quiz : <strong>{result.quiz_title}</strong>
        </div>
        <Input
          label="Score sur 20"
          type="number"
          min={0}
          max={20}
          value={score}
          onChange={(e) => setScore(e.target.value)}
          required
        />
        <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
