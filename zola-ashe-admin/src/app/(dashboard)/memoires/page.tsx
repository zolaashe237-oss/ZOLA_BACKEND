"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { adminMemoirApi } from "@/lib/endpoints";
import type { MemoirAnswerEntry, MemoirEditorialStatus, MemoirSubmission, MemoirSubmissionDetail } from "@/lib/types";
import { Alert, Button, Card, errorMessage } from "@/components/ui";
import { useToast } from "@/components/Toast";

// ── Données statiques ──────────────────────────────────────────────────────────

const EDITORIAL_STATUSES: {
  value: MemoirEditorialStatus;
  label: string;
  color: string;
  bg: string;
}[] = [
  { value: "pending",     label: "En attente",            color: "var(--muted)",  bg: "rgba(107,92,66,0.08)" },
  { value: "in_progress", label: "En cours de rédaction", color: "var(--warn)",   bg: "var(--warn-bg)" },
  { value: "review",      label: "En relecture",          color: "var(--info)",   bg: "var(--info-bg)" },
  { value: "completed",   label: "Terminé",               color: "var(--ok)",     bg: "var(--ok-bg)" },
  { value: "archived",    label: "Archivé",               color: "var(--bad)",    bg: "var(--bad-bg)" },
];

const CHAPTERS: Record<string, string> = {
  "1":  "Identité",
  "2":  "Arbre généalogique",
  "3":  "Vie de famille et conjugale",
  "4":  "Enfance et jeunesse",
  "5":  "Scolarité",
  "6":  "Vie professionnelle",
  "7":  "Foi et spiritualité",
  "8":  "Engagements et associatif",
  "9":  "Voyages et découvertes",
  "10": "Santé et épreuves",
  "11": "Passions et loisirs",
  "12": "Rencontres marquantes",
  "13": "Regard sur le monde",
  "14": "Legs et valeurs",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("fr-FR", { dateStyle: "medium" });
}

function fmtDateTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function getStatus(value: MemoirEditorialStatus) {
  return EDITORIAL_STATUSES.find((s) => s.value === value) ?? EDITORIAL_STATUSES[0];
}

function hasContent(a: MemoirAnswerEntry): boolean {
  const s = a.structured ?? {};
  return !!(
    a.text?.trim()
    || a.audioTranscript?.trim()
    || a.notApplicable
    || a.imageCaptions?.length
    || Object.values(s).some((v) => (Array.isArray(v) ? v.length : v))
  );
}

function groupByChapter(answers: Record<string, MemoirAnswerEntry>) {
  const chapters: Record<string, { key: string; answer: MemoirAnswerEntry }[]> = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (!hasContent(answer)) continue;
    const chap = key.split("_")[0];
    if (!chapters[chap]) chapters[chap] = [];
    chapters[chap].push({ key, answer });
  }
  // Sort keys by question number within each chapter
  for (const chap of Object.keys(chapters)) {
    chapters[chap].sort((a, b) => {
      const na = parseInt(a.key.split("_")[1] ?? "0", 10);
      const nb = parseInt(b.key.split("_")[1] ?? "0", 10);
      return na - nb;
    });
  }
  return chapters;
}

// ── Composants petits ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MemoirEditorialStatus }) {
  const s = getStatus(status);
  return (
    <span style={{
      fontSize: "0.68rem", fontWeight: 700, padding: "0.15rem 0.65rem",
      borderRadius: 99, color: s.color, background: s.bg,
      border: `1px solid ${s.color}30`, whiteSpace: "nowrap",
    }}>
      {s.label}
    </span>
  );
}

function KpiChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem",
      padding: "0.65rem 1.25rem", borderRadius: "var(--radius-sm)",
      background: "var(--bg-1)", border: "1px solid var(--line-soft)",
      minWidth: 100,
    }}>
      <span style={{ fontSize: "1.6rem", fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: "0.66rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
    </div>
  );
}

// ── Bloc réponse individuelle ──────────────────────────────────────────────────

function AnswerBlock({ qkey, answer }: { qkey: string; answer: MemoirAnswerEntry }) {
  const [chapNum, qNum] = qkey.split("_");
  const label = `Q${chapNum}.${(qNum ?? "00").padStart(2, "0")}`;
  const structured = answer.structured ?? {};
  const structuredEntries = Object.entries(structured).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : String(v).trim()
  );

  return (
    <div style={{
      padding: "0.75rem 0.9rem",
      background: "var(--bg-2)",
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--line-soft)",
      marginBottom: "0.45rem",
    }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.45rem" }}>
        <span style={{
          fontSize: "0.66rem", fontWeight: 800, color: "var(--gold-2)",
          background: "var(--gold-bg)", border: "1px solid var(--line)",
          borderRadius: 4, padding: "0.1rem 0.4rem",
        }}>{label}</span>
        {answer.notApplicable && (
          <span style={{ fontSize: "0.66rem", color: "var(--muted-2)", fontStyle: "italic" }}>Non concerné</span>
        )}
        {answer.audioTranscript && (
          <span style={{ fontSize: "0.62rem", color: "var(--info)", fontWeight: 700 }}>🎙 Audio transcrit</span>
        )}
        {((answer.imageUrls?.length ?? answer.imageCaptions?.length ?? 0) > 0) && (
          <span style={{ fontSize: "0.62rem", color: "var(--muted-2)" }}>📷 {(answer.imageUrls?.length ?? answer.imageCaptions?.length ?? 0)} photo{(answer.imageUrls?.length ?? answer.imageCaptions?.length ?? 0) > 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Champs structurés */}
      {structuredEntries.length > 0 && (
        <div style={{ marginBottom: answer.text ? "0.55rem" : 0 }}>
          <table style={{ fontSize: "0.78rem", borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {structuredEntries.map(([k, v]) => (
                <tr key={k}>
                  <td style={{
                    color: "var(--muted-2)", paddingRight: "0.65rem", paddingBottom: "0.15rem",
                    verticalAlign: "top", whiteSpace: "nowrap", fontWeight: 600,
                    fontSize: "0.72rem",
                  }}>
                    {k.replace(/_/g, " ")}
                  </td>
                  <td style={{ color: "var(--ink)", paddingBottom: "0.15rem" }}>
                    {Array.isArray(v) ? v.join(", ") : v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Texte libre */}
      {answer.text && (
        <p style={{ fontSize: "0.83rem", color: "var(--ink)", lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0 }}>
          {answer.text}
        </p>
      )}

      {/* Transcription audio */}
      {answer.audioTranscript && (
        <div style={{ marginTop: answer.text ? "0.5rem" : 0, paddingTop: answer.text ? "0.5rem" : 0,
                      borderTop: answer.text ? "1px dashed var(--line-soft)" : "none" }}>
          <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "var(--info)", marginBottom: "0.2rem", letterSpacing: "0.05em" }}>
            TRANSCRIPTION AUDIO
          </div>
          <p style={{ fontSize: "0.83rem", color: "var(--ink)", lineHeight: 1.6, fontStyle: "italic", margin: 0 }}>
            {answer.audioTranscript}
          </p>
        </div>
      )}

      {/* Photos */}
      {(answer.imageUrls?.length ?? 0) > 0 && (
        <div style={{ marginTop: "0.45rem" }}>
          <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "var(--muted-2)", marginBottom: "0.35rem", letterSpacing: "0.05em" }}>
            PHOTOS
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "0.5rem" }}>
            {answer.imageUrls!.map((url, i) => (
              <div key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={answer.imageCaptions?.[i] || `Photo ${i + 1}`}
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-soft)" }}
                />
                {answer.imageCaptions?.[i] && (
                  <p style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.2rem", textAlign: "center", margin: 0 }}>
                    {answer.imageCaptions[i]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Légendes seules si pas d'URL (ancien format) */}
      {!(answer.imageUrls?.length) && (answer.imageCaptions?.length ?? 0) > 0 && (
        <div style={{ marginTop: "0.45rem" }}>
          <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "var(--muted-2)", marginBottom: "0.2rem", letterSpacing: "0.05em" }}>
            PHOTOS (légendes)
          </div>
          <ul style={{ margin: 0, paddingLeft: "1rem" }}>
            {answer.imageCaptions.map((c, i) => (
              <li key={i} style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{c || `Photo ${i + 1}`}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Workflow éditorial ────────────────────────────────────────────────────────

const WORKFLOW_STEPS = ["pending", "in_progress", "review", "completed"] as const;
type WorkflowStep = typeof WORKFLOW_STEPS[number];

const NEXT_STEP_LABEL: Partial<Record<MemoirEditorialStatus, string>> = {
  in_progress: "Prendre en charge",
  review:      "Envoyer en relecture",
  completed:   "Valider & clore",
};

// ── Panneau latéral de détail ──────────────────────────────────────────────────

function DetailDrawer({
  detail,
  onClose,
  onUpdate,
}: {
  detail: MemoirSubmissionDetail;
  onClose: () => void;
  onUpdate: (updated: MemoirSubmission) => void;
}) {
  const [editStatus, setEditStatus]     = useState<MemoirEditorialStatus>(detail.editorial_status);
  const [editNotes, setEditNotes]       = useState(detail.editorial_notes);
  const [statusSaving, setStatusSaving] = useState(false);
  const [notesSaving, setNotesSaving]   = useState(false);
  const [saveErr, setSaveErr]           = useState<string | null>(null);
  const [notesSaved, setNotesSaved]     = useState(false);
  const [downloading, setDownloading]   = useState(false);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Workflow derived
  const isArchived  = editStatus === "archived";
  const workflowIdx = WORKFLOW_STEPS.indexOf(editStatus as WorkflowStep);
  const nextStatus: MemoirEditorialStatus | null =
    !isArchived && workflowIdx >= 0 && workflowIdx < WORKFLOW_STEPS.length - 1
      ? WORKFLOW_STEPS[workflowIdx + 1] as MemoirEditorialStatus
      : null;

  async function handleDownloadDocx() {
    setDownloading(true);
    try {
      const { data } = await adminMemoirApi.downloadDocx(detail.id);
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement("a");
      const name = detail.user_name.replace(/\s+/g, "_");
      a.href = url;
      a.download = `memoire_${name}_${detail.id}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    } finally {
      setDownloading(false);
    }
  }

  const chapters = groupByChapter(detail.answers ?? {});
  const chapNums = Object.keys(chapters).sort((a, b) => parseInt(a) - parseInt(b));
  const totalAnswered = chapNums.reduce((sum, c) => sum + chapters[c].length, 0);

  async function changeStatus(newStatus: MemoirEditorialStatus) {
    setStatusSaving(true);
    setSaveErr(null);
    try {
      const { data } = await adminMemoirApi.update(detail.id, { editorial_status: newStatus });
      setEditStatus(newStatus);
      onUpdate(data);
    } catch (e) {
      setSaveErr(errorMessage(e));
    } finally {
      setStatusSaving(false);
    }
  }

  async function saveNotes(notes: string) {
    setNotesSaving(true);
    setSaveErr(null);
    try {
      const { data } = await adminMemoirApi.update(detail.id, { editorial_notes: notes });
      onUpdate(data);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2500);
    } catch (e) {
      setSaveErr(errorMessage(e));
    } finally {
      setNotesSaving(false);
    }
  }

  function handleNotesChange(v: string) {
    setEditNotes(v);
    setNotesSaved(false);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => saveNotes(v), 2000);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 40,
        }}
      />

      {/* Panneau */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: "min(680px, 92vw)",
        background: "var(--bg)", borderLeft: "1px solid var(--line-soft)",
        boxShadow: "var(--shadow-lg)",
        zIndex: 50, display: "flex", flexDirection: "column",
        overflowY: "auto",
      }}>

        {/* En-tête */}
        <div style={{
          padding: "1.25rem 1.5rem 1rem",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--bg-1)",
          position: "sticky", top: 0, zIndex: 1,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--ink)", marginBottom: "0.15rem" }}>
                {detail.user_name}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                {detail.user_email}
                {detail.user_phone && <> · {detail.user_phone}</>}
                {detail.user_country && <> · {detail.user_country}</>}
              </div>
              <div style={{ fontSize: "0.74rem", color: "var(--muted-2)", marginTop: "0.25rem" }}>
                Soumis le {fmtDateTime(detail.submitted_at)}
                &ensp;·&ensp;
                <strong style={{ color: "var(--ink)" }}>{totalAnswered}</strong> réponses complétées
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
              <button
                onClick={handleDownloadDocx}
                disabled={downloading}
                style={{
                  display: "flex", alignItems: "center", gap: "0.4rem",
                  fontSize: "0.75rem", fontWeight: 700,
                  color: downloading ? "var(--muted)" : "var(--gold-2)",
                  background: "var(--gold-bg)", border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)", padding: "0.35rem 0.75rem",
                  cursor: downloading ? "default" : "pointer", transition: "opacity 0.15s",
                }}
                title="Télécharger le mémoire en Word"
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a1 1 0 001 1h16a1 1 0 001-1v-3" />
                </svg>
                {downloading ? "…" : ".docx"}
              </button>
              <button
                onClick={onClose}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "1.25rem", color: "var(--muted)", lineHeight: 1,
                  padding: "0.25rem",
                }}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        {/* Section éditoriale */}
        <div style={{
          padding: "1rem 1.5rem",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--bg-1)",
        }}>

          {/* ── Stepper ── */}
          <div style={{ marginBottom: "0.9rem" }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--muted-2)",
                          textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>
              Statut éditorial
            </div>

            <div style={{ display: "flex", alignItems: "flex-start" }}>
              {WORKFLOW_STEPS.flatMap((step, idx) => {
                const s       = getStatus(step as MemoirEditorialStatus);
                const isPast  = !isArchived && workflowIdx > idx;
                const isCurr  = !isArchived && editStatus === step;
                const isLast  = idx === WORKFLOW_STEPS.length - 1;
                const label   = step === "in_progress" ? "En cours" : s.label;

                const items: React.ReactNode[] = [
                  <div key={`s-${step}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.28rem", flexShrink: 0 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: "50%",
                      background: isPast ? "var(--ok)" : isCurr ? s.color : "var(--bg-2)",
                      border: `2px solid ${isPast ? "var(--ok)" : isCurr ? s.color : "var(--line-med)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "0.6rem", fontWeight: 800,
                      color: (isPast || isCurr) ? "#fff" : "var(--muted-2)",
                      transition: "background .2s, border-color .2s",
                    }}>
                      {isPast ? "✓" : idx + 1}
                    </div>
                    <span style={{
                      fontSize: "0.57rem", fontWeight: isCurr ? 700 : 400,
                      color: isCurr ? s.color : isPast ? "var(--ok)" : "var(--muted-2)",
                      whiteSpace: "nowrap",
                    }}>
                      {label}
                    </span>
                  </div>,
                ];

                if (!isLast) {
                  items.push(
                    <div key={`l-${idx}`} style={{
                      flex: 1, height: 2, marginTop: 13,
                      background: isPast ? "var(--ok)" : "var(--line-soft)",
                      transition: "background .2s",
                    }} />
                  );
                }
                return items;
              })}
            </div>

            {isArchived && (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.7rem",
                padding: "0.38rem 0.75rem", background: "var(--bad-bg)",
                borderRadius: "var(--radius-sm)", border: "1px solid rgba(192,64,44,0.28)",
              }}>
                <span style={{ fontSize: "0.75rem", color: "var(--bad)", fontWeight: 700 }}>Archivé</span>
                <span style={{ fontSize: "0.73rem", color: "var(--muted)" }}>Ce mémoire a été archivé.</span>
              </div>
            )}

            {editStatus === "completed" && (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.7rem",
                padding: "0.38rem 0.75rem", background: "var(--ok-bg)",
                borderRadius: "var(--radius-sm)", border: "1px solid rgba(46,148,96,0.28)",
              }}>
                <span style={{ fontSize: "0.75rem", color: "var(--ok)", fontWeight: 700 }}>✓ Terminé</span>
                <span style={{ fontSize: "0.73rem", color: "var(--muted)" }}>Ce mémoire a été validé et clôturé.</span>
              </div>
            )}
          </div>

          {/* ── Boutons d'action ── */}
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1.1rem", alignItems: "center" }}>
            {nextStatus && (
              <button
                onClick={() => changeStatus(nextStatus)}
                disabled={statusSaving}
                style={{
                  padding: "0.44rem 1rem", fontSize: "0.79rem", fontWeight: 700,
                  background: "var(--gold-2)", color: "#fff",
                  border: "none", borderRadius: "var(--radius-sm)",
                  cursor: statusSaving ? "default" : "pointer",
                  opacity: statusSaving ? 0.65 : 1,
                  display: "flex", alignItems: "center", gap: "0.35rem",
                }}
              >
                {statusSaving ? "…" : `${NEXT_STEP_LABEL[nextStatus]} →`}
              </button>
            )}

            {!isArchived && editStatus !== "completed" && (
              <button
                onClick={() => changeStatus("archived")}
                disabled={statusSaving}
                style={{
                  padding: "0.44rem 0.9rem", fontSize: "0.78rem", fontWeight: 600,
                  background: "none", color: "var(--bad)",
                  border: "1px solid rgba(192,64,44,0.4)", borderRadius: "var(--radius-sm)",
                  cursor: statusSaving ? "default" : "pointer",
                  opacity: statusSaving ? 0.65 : 1,
                }}
              >
                Archiver
              </button>
            )}

            {isArchived && (
              <button
                onClick={() => changeStatus("pending")}
                disabled={statusSaving}
                style={{
                  padding: "0.44rem 0.9rem", fontSize: "0.78rem", fontWeight: 600,
                  background: "none", color: "var(--muted)",
                  border: "1px solid var(--line-med)", borderRadius: "var(--radius-sm)",
                  cursor: statusSaving ? "default" : "pointer",
                  opacity: statusSaving ? 0.65 : 1,
                }}
              >
                ↩ Restaurer
              </button>
            )}

            {saveErr && (
              <span style={{ fontSize: "0.73rem", color: "var(--bad)" }}>{saveErr}</span>
            )}
          </div>

          {/* ── Notes internes ── */}
          <div>
            <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--muted-2)",
                            textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "0.35rem" }}>
              Notes internes
            </label>
            <textarea
              value={editNotes}
              onChange={(e) => handleNotesChange(e.target.value)}
              rows={2}
              placeholder="Remarques pour l'équipe éditoriale…"
              style={{
                width: "100%", padding: "0.45rem 0.7rem", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--line-med)", background: "var(--bg)",
                fontSize: "0.82rem", color: "var(--ink)", resize: "vertical",
                fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
            <div style={{ height: "1.1rem", marginTop: "0.2rem" }}>
              {notesSaving && (
                <span style={{ fontSize: "0.71rem", color: "var(--muted)" }}>Sauvegarde…</span>
              )}
              {notesSaved && !notesSaving && (
                <span style={{ fontSize: "0.71rem", color: "var(--ok)", fontWeight: 600 }}>✓ Notes sauvegardées</span>
              )}
            </div>
          </div>
        </div>

        {/* Réponses par chapitre */}
        <div style={{ padding: "1.25rem 1.5rem", flex: 1 }}>
          {chapNums.length === 0 && (
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", fontStyle: "italic" }}>
              Aucune réponse enregistrée dans cette soumission.
            </p>
          )}

          {chapNums.map((chap) => (
            <div key={chap} style={{ marginBottom: "1.5rem" }}>
              {/* Titre du chapitre */}
              <div style={{
                display: "flex", alignItems: "center", gap: "0.6rem",
                marginBottom: "0.75rem",
              }}>
                <span style={{
                  fontSize: "0.62rem", fontWeight: 800, color: "var(--gold-2)",
                  background: "var(--gold-bg)", border: "1px solid var(--line)",
                  borderRadius: 4, padding: "0.1rem 0.5rem",
                }}>
                  CH. {chap}
                </span>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--ink)" }}>
                  {CHAPTERS[chap] ?? `Chapitre ${chap}`}
                </span>
                <span style={{ fontSize: "0.7rem", color: "var(--muted-2)" }}>
                  — {chapters[chap].length} réponse{chapters[chap].length > 1 ? "s" : ""}
                </span>
              </div>

              {/* Réponses */}
              {chapters[chap].map(({ key, answer }) => (
                <AnswerBlock key={key} qkey={key} answer={answer} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Page principale ────────────────────────────────────────────────────────────

export default function MemoiresPage() {
  const { toast } = useToast();
  const [submissions, setSubmissions] = useState<MemoirSubmission[]>([]);
  const [loading, setLoading]         = useState(true);

  const [selectedId, setSelectedId]       = useState<number | null>(null);
  const [detail, setDetail]               = useState<MemoirSubmissionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState<MemoirEditorialStatus | "all">("all");
  const [search, setSearch]             = useState("");

  // Charger la liste
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminMemoirApi.list();
      setSubmissions(Array.isArray(data) ? data : []);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Charger le détail
  async function openDetail(id: number) {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const { data } = await adminMemoirApi.detail(id);
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
  }

  function handleUpdate(updated: MemoirSubmission) {
    setSubmissions((prev) =>
      prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
    );
    if (detail && detail.id === updated.id) {
      setDetail((d) => d ? { ...d, ...updated } : d);
    }
  }

  // Filtrage
  const filtered = submissions.filter((s) => {
    const matchStatus = statusFilter === "all" || s.editorial_status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || s.user_name.toLowerCase().includes(q) || s.user_email.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  // KPIs
  const kpiByStatus = (v: MemoirEditorialStatus) => submissions.filter((s) => s.editorial_status === v).length;

  return (
    <div>
      {/* ── En-tête ── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.45rem", fontWeight: 800, color: "var(--ink)", margin: 0 }}>
          Mémoires
        </h1>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.2rem 0 0" }}>
          Demandes de rédaction autobiographique soumises par les membres
        </p>
      </div>

      {/* ── KPI chips ── */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <KpiChip label="Total reçus"      value={submissions.length}     color="var(--ink)" />
        <KpiChip label="En attente"       value={kpiByStatus("pending")}     color="var(--muted)" />
        <KpiChip label="En cours"         value={kpiByStatus("in_progress")} color="var(--warn)" />
        <KpiChip label="En relecture"     value={kpiByStatus("review")}      color="var(--info)" />
        <KpiChip label="Terminés"         value={kpiByStatus("completed")}   color="var(--ok)" />
      </div>

      {/* ── Filtres ── */}
      <Card style={{ padding: "0.85rem 1rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="search"
            placeholder="Rechercher par nom ou e-mail…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: 200, padding: "0.45rem 0.75rem",
              border: "1px solid var(--line-med)", borderRadius: "var(--radius-sm)",
              fontSize: "0.83rem", background: "var(--bg)", color: "var(--ink)",
            }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as MemoirEditorialStatus | "all")}
            style={{
              padding: "0.45rem 0.75rem", border: "1px solid var(--line-med)",
              borderRadius: "var(--radius-sm)", fontSize: "0.83rem",
              background: "var(--bg)", color: "var(--ink)", cursor: "pointer",
            }}
          >
            <option value="all">Tous les statuts</option>
            {EDITORIAL_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <Button onClick={load} variant="ghost" style={{ fontSize: "0.8rem" }}>
            Actualiser
          </Button>
        </div>
      </Card>

      {/* ── Tableau ── */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
            Chargement…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
            {submissions.length === 0
              ? "Aucune soumission reçue pour l'instant."
              : "Aucun résultat pour ces filtres."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
              <thead>
                <tr style={{ background: "var(--bg-2)", borderBottom: "1px solid var(--line-soft)" }}>
                  {["Membre", "Contact", "Soumis le", "Réponses", "Statut", "Action"].map((h) => (
                    <th key={h} style={{
                      padding: "0.65rem 1rem", textAlign: "left",
                      fontSize: "0.68rem", fontWeight: 700, color: "var(--muted-2)",
                      textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr
                    key={s.id}
                    style={{
                      borderBottom: "1px solid var(--line-soft)",
                      background: s.id === selectedId ? "var(--gold-bg)" : i % 2 === 0 ? "var(--bg-1)" : "var(--bg-2)",
                      transition: "background 0.15s",
                      cursor: "pointer",
                    }}
                    onClick={() => openDetail(s.id)}
                    onMouseEnter={(e) => {
                      if (s.id !== selectedId)
                        (e.currentTarget as HTMLTableRowElement).style.background = "var(--bg-3)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        s.id === selectedId ? "var(--gold-bg)" : i % 2 === 0 ? "var(--bg-1)" : "var(--bg-2)";
                    }}
                  >
                    {/* Membre */}
                    <td style={{ padding: "0.7rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "var(--ink)" }}>{s.user_name}</div>
                      {s.user_country && (
                        <div style={{ fontSize: "0.72rem", color: "var(--muted-2)" }}>{s.user_country}</div>
                      )}
                    </td>

                    {/* Contact */}
                    <td style={{ padding: "0.7rem 1rem" }}>
                      <div style={{ color: "var(--muted)" }}>{s.user_email}</div>
                      {s.user_phone && (
                        <div style={{ fontSize: "0.74rem", color: "var(--muted-2)" }}>{s.user_phone}</div>
                      )}
                    </td>

                    {/* Soumis le */}
                    <td style={{ padding: "0.7rem 1rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {fmtDate(s.submitted_at)}
                    </td>

                    {/* Réponses */}
                    <td style={{ padding: "0.7rem 1rem" }}>
                      <span style={{
                        fontWeight: 700,
                        color: s.answers_count >= 50 ? "var(--ok)" : s.answers_count >= 20 ? "var(--warn)" : "var(--muted)",
                      }}>
                        {s.answers_count}
                      </span>
                      <span style={{ color: "var(--muted-2)", fontSize: "0.72rem" }}> rép.</span>
                    </td>

                    {/* Statut */}
                    <td style={{ padding: "0.7rem 1rem" }}>
                      <StatusBadge status={s.editorial_status} />
                    </td>

                    {/* Action */}
                    <td style={{ padding: "0.7rem 1rem" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); openDetail(s.id); }}
                        style={{
                          fontSize: "0.75rem", fontWeight: 600, color: "var(--gold-2)",
                          background: "var(--gold-bg)", border: "1px solid var(--line)",
                          borderRadius: "var(--radius-sm)", padding: "0.3rem 0.75rem",
                          cursor: "pointer", transition: "opacity 0.15s",
                        }}
                      >
                        {detailLoading && selectedId === s.id ? "…" : "Consulter"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Panneau de détail ── */}
      {selectedId !== null && detail && (
        <DetailDrawer
          detail={detail}
          onClose={closeDetail}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
