"use client";

import { useState } from "react";

import { youtubeImportApi } from "@/lib/endpoints";
import type { YoutubeImportPreview } from "@/lib/types";
import { Alert, Badge, Button, Input, errorMessage } from "@/components/ui";
import { Modal } from "@/components/Modal";

function duration(sec: number | null) {
  if (sec === null) return "durée inconnue";
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function validYoutubeUrl(url: string) {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

export function YoutubeChapterImportModal({
  formationId,
  formationTitle,
  onClose,
  onImported,
}: {
  formationId: number;
  formationTitle: string;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<YoutubeImportPreview | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const analyze = async () => {
    setError(""); setPreview(null);
    if (!validYoutubeUrl(url)) {
      setError("Veuillez saisir une URL YouTube valide (playlist ou vidéo unique).");
      return;
    }
    setLoading(true);
    try {
      const res = await youtubeImportApi.preview(url.trim());
      setPreview(res.preview); setSimulated(res.simulated);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  };

  const confirm = async () => {
    setError(""); setConfirming(true);
    try {
      const res = await youtubeImportApi.confirmChapter(url.trim(), formationId);
      onImported(
        `Chapitre « ${res.module_title} » importé (${res.courses_created} épisode${res.courses_created !== 1 ? "s" : ""}).`,
      );
    } catch (e) { setError(errorMessage(e)); }
    finally { setConfirming(false); }
  };

  const totalCourses = preview?.modules.reduce((acc, m) => acc + m.courses.length, 0) ?? 0;

  return (
    <Modal title="Importer un chapitre depuis YouTube" onClose={onClose} maxWidth={680}>
      {/* Contexte */}
      <div style={{
        fontSize: "0.80rem", color: "var(--muted)", marginBottom: "0.85rem",
        padding: "0.5rem 0.75rem", background: "var(--bg-2)",
        borderRadius: "var(--radius)", border: "1px solid var(--line-soft)",
      }}>
        Formation cible :{" "}
        <strong style={{ color: "var(--cream)" }}>{formationTitle}</strong>
        {" "}— la playlist deviendra un nouveau chapitre de cette formation.
      </div>

      <Alert>{error}</Alert>

      <Input
        label="URL YouTube (playlist ou vidéo unique)"
        value={url}
        placeholder="https://www.youtube.com/playlist?list=… ou https://youtu.be/…"
        onChange={(e) => setUrl(e.target.value)}
      />

      <div style={{ display: "flex", gap: "0.55rem", marginBottom: "1rem" }}>
        <Button type="button" loading={loading} onClick={analyze}>
          Analyser
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
      </div>

      {preview && (
        <div style={{
          border: "1px solid var(--line-soft)", borderRadius: "var(--radius)",
          padding: "1rem", background: "var(--bg-2)", marginBottom: "1rem",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between",
            alignItems: "flex-start", gap: "0.75rem", marginBottom: "0.75rem",
          }}>
            <div>
              <div className="field-label">Chapitre proposé</div>
              <strong style={{ color: "var(--cream)" }}>{preview.formation_title}</strong>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                {preview.total_videos} vidéo{preview.total_videos !== 1 ? "s" : ""}
                {" "}→ {totalCourses} épisode{totalCourses !== 1 ? "s" : ""}
                {preview.truncated && preview.preview_count != null && (
                  <span style={{ marginLeft: "0.4rem", color: "var(--warn)" }}>
                    — aperçu des {preview.preview_count} premières
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {preview.truncated && <Badge color="#c87c00">Aperçu limité</Badge>}
              {simulated && <Badge color="#d9a441">Aperçu simulé</Badge>}
            </div>
          </div>

          {preview.modules.map((m, i) => (
            <div key={`${m.title}-${i}`} style={{ marginTop: "0.8rem" }}>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--muted)", fontSize: "0.84rem" }}>
                {m.courses.slice(0, 8).map((c, j) => (
                  <li key={`${c.title}-${j}`}>{c.title} · {duration(c.duration_sec)}</li>
                ))}
                {m.courses.length > 8 && (
                  <li style={{ fontStyle: "italic", color: "var(--muted)" }}>
                    … et {m.courses.length - 8} autre{m.courses.length - 8 > 1 ? "s" : ""} épisode{m.courses.length - 8 > 1 ? "s" : ""}
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Button type="button" loading={confirming} onClick={confirm}>
          Importer ce chapitre
        </Button>
      )}
    </Modal>
  );
}
