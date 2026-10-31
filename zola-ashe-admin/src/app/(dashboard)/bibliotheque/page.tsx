"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { asList, libraryApi, quizApi } from "@/lib/endpoints";
import { getMediaUrl } from "@/lib/api";
import type { Branche, LibraryCategory, LibraryPdf, PdfAccess, QuizItem } from "@/lib/types";
import { Alert, Button, Input, Select, Textarea, errorMessage } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

// ── Constantes ────────────────────────────────────────────────────────────────

const ACCESS_COLOR: Record<PdfAccess, string> = {
  PUBLIC: "#2e9460",
  MEMBRE: "#c9a227",
  FEMME:  "#b5532a",
  ENFANT: "#3a8a5e",
};
const ACCESS_LABEL: Record<PdfAccess, string> = {
  PUBLIC: "Public",
  MEMBRE: "Membres",
  FEMME:  "Femmes",
  ENFANT: "Enfants",
};
const ACCESS_ICON: Record<PdfAccess, string> = {
  PUBLIC: "🌐",
  MEMBRE: "🔑",
  FEMME:  "♀",
  ENFANT: "◈",
};

const BRANCH_COLS: { key: Branche; label: string; color: string; emoji: string }[] = [
  { key: "MEMBRE",  label: "Espace Membres",  color: "#5b8fd4", emoji: "◉" },
  { key: "FEMME",   label: "Espace Femmes",   color: "#b5532a", emoji: "♀" },
  { key: "ENFANT",  label: "Espace Enfants",  color: "#52b083", emoji: "◈" },
];

const CATEGORIES: LibraryCategory[] = [
  "Spiritualité",
  "Développement personnel",
  "Entrepreneuriat",
  "Création de contenu",
];

function normalizeCategory(raw?: string | null): LibraryCategory | "" {
  if (!raw) return "";
  const clean = raw.trim().toLowerCase();
  if (clean.includes("spirit")) return "Spiritualité";
  if (clean.includes("dév") || clean.includes("dev") || clean.includes("personnel")) return "Développement personnel";
  if (clean.includes("entrepr")) return "Entrepreneuriat";
  if (clean.includes("créa") || clean.includes("crea") || clean.includes("contenu")) return "Création de contenu";
  const found = CATEGORIES.find((c) => c.toLowerCase() === clean);
  if (found) return found;
  return (raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1)) as LibraryCategory;
}

const CAT_ICON: Record<string, string> = {
  "Spiritualité":            "✦",
  "Développement personnel": "◎",
  "Entrepreneuriat":         "◆",
  "Création de contenu":     "◐",
  "":                        "○",
};

const COVER_ACCENT: Record<string, { bg: string; line: string; text: string }> = {
  MEMBRE:   { bg: "#f7f2e8", line: "#c9a227", text: "#8b6a1a" },
  GENERALE: { bg: "#f7f2e8", line: "#c9a227", text: "#8b6a1a" },
  FEMME:    { bg: "#fdf0ec", line: "#b5532a", text: "#8b3520" },
  ENFANT:   { bg: "#eef8f2", line: "#52b083", text: "#2e7050" },
};

// ── Couverture ────────────────────────────────────────────────────────────────

function DocCover({ pdf, size = 72 }: { pdf: LibraryPdf; size?: number }) {
  const height = Math.round(size * 1.38);
  if (pdf.cover_url) {
    return (
      <img
        src={getMediaUrl(pdf.cover_url)} alt={pdf.title}
        style={{
          width: size, height, objectFit: "cover", borderRadius: 5,
          border: "1px solid #e8dfc8", flexShrink: 0, display: "block",
        }}
      />
    );
  }
  const { bg, line, text } = COVER_ACCENT[pdf.branche] ?? COVER_ACCENT.MEMBRE;
  const initials = pdf.title.split(" ").filter((w) => /^[A-ZÀ-Öa-z]/i.test(w))
    .slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return (
    <div style={{
      width: size, height, borderRadius: 5, flexShrink: 0,
      background: bg, border: `1px solid ${line}40`,
      borderLeft: `3px solid ${line}`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      position: "relative", overflow: "hidden",
    }}>
      <span style={{ fontSize: size > 80 ? "1.8rem" : "1.15rem", fontWeight: 800, color: text, letterSpacing: "-1px", lineHeight: 1 }}>
        {initials || "☰"}
      </span>
      {pdf.category && (
        <span style={{
          position: "absolute", bottom: 5,
          fontSize: "0.52rem", fontWeight: 700, letterSpacing: "0.12em",
          textTransform: "uppercase", color: text, opacity: 0.7,
          textAlign: "center", padding: "0 4px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "90%",
        }}>
          {pdf.category}
        </span>
      )}
    </div>
  );
}

// ── Ligne document (avec handle drag-and-drop) ────────────────────────────────

function DocRow({ pdf, onEdit, onToggle, onToggleGratuit, onDelete, onPreview,
                  dragging, dragOver,
                  onDragStart, onDragEnter, onDragEnd }: {
  pdf:             LibraryPdf;
  onEdit:          () => void;
  onToggle:        () => void;
  onToggleGratuit: () => void;
  onDelete:        () => void;
  onPreview:       () => void;
  dragging:        boolean;
  dragOver:        boolean;
  onDragStart:     () => void;
  onDragEnter:     () => void;
  onDragEnd:       () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      style={{
        display: "flex", alignItems: "center", gap: "1rem",
        padding: "0.75rem 1rem",
        background: dragOver ? "rgba(201,162,39,0.07)" : "#fff",
        border: `1px solid ${dragOver ? "#c9a227" : "#e8dfc8"}`,
        borderRadius: "var(--radius)",
        opacity: dragging ? 0.45 : pdf.is_active ? 1 : 0.58,
        transition: "box-shadow .15s, border-color .15s, background .12s",
        cursor: "grab",
      }}
      onMouseEnter={(e) => {
        if (!dragOver) {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "0 4px 18px rgba(100,60,10,0.10)";
          el.style.borderColor = "#d4c4a0";
        }
      }}
      onMouseLeave={(e) => {
        if (!dragOver) {
          const el = e.currentTarget as HTMLDivElement;
          el.style.boxShadow = "";
          el.style.borderColor = "#e8dfc8";
        }
      }}
    >
      {/* Handle drag */}
      <span style={{ fontSize: "0.80rem", color: "#c8b89a", flexShrink: 0, userSelect: "none", cursor: "grab" }}>⠿</span>

      {/* Cover — cliquable */}
      <button onClick={onPreview} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
        <DocCover pdf={pdf} size={54} />
      </button>

      {/* Corps */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
          <span
            onClick={onPreview}
            style={{
              fontSize: "0.90rem", fontWeight: 700, color: "#2a1800", cursor: "pointer",
              lineHeight: 1.3, flex: 1, minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {pdf.title}
          </span>
          <span style={{
            fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em",
            flexShrink: 0,
            color: pdf.is_active ? "#2e9460" : "#a0907a",
            background: pdf.is_active ? "#2e946014" : "rgba(160,144,122,0.10)",
            border: `1px solid ${pdf.is_active ? "#2e946030" : "rgba(160,144,122,0.22)"}`,
            padding: "0.06rem 0.40rem", borderRadius: 99,
          }}>
            {pdf.is_active ? "● Publié" : "○ Masqué"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginTop: "0.18rem" }}>
          {pdf.description && (
            <span style={{
              fontSize: "0.78rem", color: "#7a6248",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380,
            }}>
              {pdf.description}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginTop: "0.28rem" }}>
          {pdf.nb_pages !== null && (
            <span style={{ fontSize: "0.72rem", color: "#a0907a" }}>☰ {pdf.nb_pages} pages</span>
          )}
          {pdf.size_mo !== null && (
            <span style={{ fontSize: "0.72rem", color: "#a0907a" }}>{pdf.size_mo.toFixed(1)} Mo</span>
          )}
          <span style={{
            fontSize: "0.63rem", fontWeight: 700,
            color: ACCESS_COLOR[pdf.access_level],
            background: `${ACCESS_COLOR[pdf.access_level]}12`,
            border: `1px solid ${ACCESS_COLOR[pdf.access_level]}30`,
            padding: "0.04rem 0.38rem", borderRadius: 99,
            display: "inline-flex", alignItems: "center", gap: "0.2rem",
          }}>
            {ACCESS_ICON[pdf.access_level]} {ACCESS_LABEL[pdf.access_level]}
          </span>
          {pdf.access_level !== "PUBLIC" && (
            <button
              type="button"
              title={pdf.is_gratuit ? "Aperçu gratuit activé — cliquer pour retirer" : "Rendre ce document accessible gratuitement"}
              onClick={onToggleGratuit}
              style={{
                fontSize: "0.63rem", fontWeight: 700,
                color: pdf.is_gratuit ? "#2e9460" : "#b8a882",
                background: pdf.is_gratuit ? "rgba(46,148,96,0.10)" : "transparent",
                border: `1px solid ${pdf.is_gratuit ? "rgba(46,148,96,0.30)" : "#e8dfc8"}`,
                padding: "0.04rem 0.38rem", borderRadius: 99,
                cursor: "pointer", letterSpacing: "0.04em",
                transition: "all .14s",
              }}
            >
              {pdf.is_gratuit ? "✓ GRATUIT" : "Gratuit ?"}
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, alignItems: "center" }}>
        <button
          onClick={onEdit}
          title="Modifier"
          style={{
            fontSize: "0.72rem", fontWeight: 600,
            color: "#8b6a3a", background: "rgba(139,106,58,0.08)",
            border: "1px solid #e8dfc8", borderRadius: 5,
            padding: "0.24rem 0.58rem", cursor: "pointer",
            transition: "background .14s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(139,106,58,0.16)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(139,106,58,0.08)"; }}
        >
          ✎ Modifier
        </button>
        <button
          onClick={onToggle}
          style={{
            fontSize: "0.72rem", fontWeight: 600,
            color: pdf.is_active ? "#8b6a1a" : "#2b8a5e",
            background: pdf.is_active ? "rgba(201,162,39,0.08)" : "rgba(46,148,96,0.08)",
            border: `1px solid ${pdf.is_active ? "rgba(201,162,39,0.25)" : "rgba(46,148,96,0.25)"}`,
            borderRadius: 5, padding: "0.24rem 0.58rem", cursor: "pointer",
          }}
        >
          {pdf.is_active ? "Dépublier" : "Publier"}
        </button>
        <button
          onClick={onDelete}
          title="Supprimer"
          style={{
            width: 28, height: 28, borderRadius: 5,
            background: "rgba(192,64,44,0.07)", color: "#b53a2a",
            border: "1px solid rgba(192,64,44,0.20)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: "0.78rem",
          }}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ── Modal aperçu ──────────────────────────────────────────────────────────────

function PdfPreviewModal({ pdf, onClose, onEdit, onToggle }: {
  pdf: LibraryPdf; onClose: () => void; onEdit: () => void; onToggle: () => void;
}) {
  return (
    <Modal title={pdf.title} onClose={onClose} maxWidth={640}>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        <DocCover pdf={pdf} size={120} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
            {pdf.category && (
              <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "#8b6a3a", background: "rgba(201,162,39,0.12)", border: "1px solid rgba(201,162,39,0.25)", padding: "0.06rem 0.38rem", borderRadius: 99 }}>
                {CAT_ICON[pdf.category] || "○"} {pdf.category}
              </span>
            )}
            <span style={{ fontSize: "0.67rem", fontWeight: 700, color: ACCESS_COLOR[pdf.access_level], background: `${ACCESS_COLOR[pdf.access_level]}12`, border: `1px solid ${ACCESS_COLOR[pdf.access_level]}30`, padding: "0.06rem 0.38rem", borderRadius: 99 }}>
              {ACCESS_ICON[pdf.access_level]} {ACCESS_LABEL[pdf.access_level]}
            </span>
            <span style={{ fontSize: "0.67rem", fontWeight: 700, color: pdf.is_active ? "#2e9460" : "#a0907a", background: pdf.is_active ? "#2e946014" : "rgba(160,144,122,0.10)", border: `1px solid ${pdf.is_active ? "#2e946030" : "rgba(160,144,122,0.22)"}`, padding: "0.06rem 0.38rem", borderRadius: 99 }}>
              {pdf.is_active ? "● Publié" : "○ Masqué"}
            </span>
          </div>

          {pdf.description && (
            <p style={{ fontSize: "0.85rem", color: "#7a6248", lineHeight: 1.6, marginBottom: "0.8rem" }}>
              {pdf.description}
            </p>
          )}

          <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", fontSize: "0.80rem", color: "#a0907a", marginBottom: "1rem", paddingTop: "0.7rem", borderTop: "1px solid #f0e8d4" }}>
            {pdf.nb_pages !== null && <span>☰ {pdf.nb_pages} pages</span>}
            {pdf.size_mo  !== null && <span>{pdf.size_mo.toFixed(1)} Mo</span>}
            <span>🗓 {new Date(pdf.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</span>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {pdf.file_url && (
              <a href={pdf.file_url} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ textDecoration: "none" }}>
                Ouvrir le PDF ↗
              </a>
            )}
            <Button variant="ghost" onClick={() => { onClose(); onEdit(); }}>✎ Modifier</Button>
            <Button variant={pdf.is_active ? "danger" : "ghost"} onClick={onToggle}>
              {pdf.is_active ? "Dépublier" : "Republier"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Formulaire (modal) ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  title: "", description: "", category: "" as LibraryCategory, branche: "MEMBRE" as Branche,
  access_level: "MEMBRE" as PdfAccess, bucket_key: "", cover_key: "", cover_url: "",
  nb_pages: null as number | null, size_mo: null as number | null,
  is_active: true, is_gratuit: false, linked_quiz_id: null as number | null,
};

function DocFormModal({ initial, editing, onClose, onSaved, onError }: {
  initial:  typeof EMPTY_FORM;
  editing:  number | null;
  onClose:  () => void;
  onSaved:  () => void;
  onError:  (s: string) => void;
}) {
  const [form,            setForm]            = useState(initial);
  const [uploading,       setUploading]       = useState(false);
  const [coverUploading,  setCoverUploading]  = useState(false);
  const [extractingCover, setExtractingCover] = useState(false);
  const [saving,          setSaving]          = useState(false);
  const [dragOver,        setDragOver]        = useState(false);
  const [previewUrl,      setPreviewUrl]      = useState<string | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(
    initial.cover_url || null
  );
  const [quizOptions, setQuizOptions] = useState<QuizItem[]>([]);
  const router = useRouter();
  const fileRef      = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    quizApi.listAll()
      .then((r) => setQuizOptions(asList(r.data)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  const handleCoverUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) { onError("Seules les images sont acceptées (JPG, PNG, WebP…)."); return; }
    const objectUrl = URL.createObjectURL(file);
    setCoverPreviewUrl(objectUrl);
    setCoverUploading(true);
    try {
      const { data } = await libraryApi.uploadCover(file);
      setForm((prev) => ({ ...prev, cover_key: data.bucket_key }));
    } catch (e) { onError(errorMessage(e)); }
    finally { setCoverUploading(false); }
  };

  const handleExtractFirstPage = async () => {
    if (!form.bucket_key) return;
    setExtractingCover(true);
    try {
      const { data } = await libraryApi.pdfFirstPageCover(form.bucket_key);
      if (coverPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(coverPreviewUrl);
      setCoverPreviewUrl(data.preview_url);
      setForm((prev) => ({ ...prev, cover_key: data.bucket_key, cover_url: "" }));
    } catch (e) { onError(errorMessage(e)); }
    finally { setExtractingCover(false); }
  };

  const handleUpload = async (file: File) => {
    if (!file.type.includes("pdf")) { onError("Seuls les fichiers PDF sont acceptés."); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      const { data } = await libraryApi.upload(file);
      const bucketKey = data.bucket_key;
      setForm((prev) => ({
        ...prev,
        bucket_key: bucketKey,
        size_mo: data.size_mo ?? null,
        nb_pages: data.nb_pages ?? null,
        title: prev.title || file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " "),
      }));

      // Générer automatiquement la couverture depuis la première page
      setExtractingCover(true);
      try {
        const { data: cover } = await libraryApi.pdfFirstPageCover(bucketKey);
        if (coverPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(coverPreviewUrl);
        setCoverPreviewUrl(cover.preview_url);
        setForm((prev) => ({ ...prev, cover_key: cover.bucket_key, cover_url: "" }));
      } catch {
        // Génération silencieuse — l'admin peut toujours le faire manuellement
      } finally {
        setExtractingCover(false);
      }
    } catch (e) { onError(errorMessage(e)); }
    finally { setUploading(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = { ...form, category: normalizeCategory(form.category) };
      if (payload.cover_key) payload.cover_url = "";
      if (editing) await libraryApi.update(editing, payload);
      else         await libraryApi.create(payload);
      onSaved();
    } catch (e) { onError(errorMessage(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={editing ? "Modifier le document" : "Nouveau document"} onClose={onClose} maxWidth={680}>
      {/* Zone PDF */}
      {!editing && (
        <>
          {previewUrl ? (
            <div style={{
              display: "flex", gap: "1rem", marginBottom: "1rem",
              padding: "0.75rem", borderRadius: "var(--radius)",
              background: "rgba(201,162,39,0.05)", border: "1px solid rgba(201,162,39,0.22)",
            }}>
              <div style={{ width: 160, flexShrink: 0, borderRadius: 6, overflow: "hidden", border: "1px solid rgba(201,162,39,0.30)", background: "#f5f5f5", position: "relative" }}>
                {coverPreviewUrl ? (
                  <img
                    src={coverPreviewUrl}
                    alt="Couverture"
                    style={{ width: "100%", height: 220, objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <embed
                    src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`}
                    type="application/pdf"
                    style={{ width: "100%", height: 220, display: "block" }}
                  />
                )}
                {(uploading || extractingCover) && (
                  <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.80)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.78rem", color: "#8b6a3a" }}>
                    {uploading ? "Upload…" : "Couverture…"}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: uploading ? "#c9a227" : "#2b8a5e", marginBottom: "0.45rem" }}>
                    {uploading ? "Upload en cours…" : "✓ Fichier prêt"}
                  </div>
                  {form.nb_pages !== null && <div style={{ fontSize: "0.80rem", color: "#7a6248", marginBottom: "0.20rem" }}>☰ {form.nb_pages} pages</div>}
                  {form.size_mo  !== null && <div style={{ fontSize: "0.80rem", color: "#7a6248" }}>{form.size_mo.toFixed(1)} Mo</div>}
                </div>
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{ fontSize: "0.74rem", fontWeight: 600, color: "#8b6a3a", background: "rgba(139,106,58,0.08)", border: "1px solid #e8dfc8", borderRadius: 5, padding: "0.28rem 0.70rem", cursor: "pointer", alignSelf: "flex-start" }}>
                  ↺ Changer de fichier
                </button>
              </div>
            </div>
          ) : (
            <div
              role="button" tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
              style={{
                border: `2px dashed ${dragOver ? "#c9a227" : "#e8dfc8"}`,
                borderRadius: "var(--radius)", padding: "2rem 1.25rem",
                textAlign: "center", cursor: "pointer", marginBottom: "1rem",
                background: dragOver ? "rgba(201,162,39,0.07)" : "transparent",
                transition: "all .18s",
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem", opacity: 0.35 }}>☰</div>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Glissez un PDF ici ou{" "}
                <span style={{ color: "#c9a227", fontWeight: 600 }}>cliquez pour choisir</span>
              </span>
            </div>
          )}
          <input type="file" accept=".pdf,application/pdf" ref={fileRef} style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
        </>
      )}

      {/* Couverture image */}
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.45rem" }}>
          Image de couverture
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
          <div style={{ width: 72, height: 99, flexShrink: 0, borderRadius: 5, border: "1px solid #e8dfc8", background: coverPreviewUrl ? "transparent" : "#f7f2e8", overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {coverPreviewUrl ? (
              <img src={coverPreviewUrl} alt="Couverture" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <span style={{ fontSize: "1.6rem", opacity: 0.25 }}>🖼</span>
            )}
            {coverUploading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.80)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.70rem", color: "#8b6a3a" }}>↑…</div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.40rem" }}>
            <button type="button" onClick={() => coverFileRef.current?.click()}
              style={{ fontSize: "0.74rem", fontWeight: 600, color: "#8b6a3a", background: "rgba(139,106,58,0.08)", border: "1px solid #e8dfc8", borderRadius: 5, padding: "0.28rem 0.70rem", cursor: "pointer" }}>
              {coverPreviewUrl ? "↺ Changer" : "+ Ajouter une image"}
            </button>
            {form.bucket_key && (
              <button type="button" onClick={handleExtractFirstPage} disabled={extractingCover}
                style={{ fontSize: "0.74rem", fontWeight: 600, color: extractingCover ? "#a0907a" : "#2b6cb0", background: extractingCover ? "rgba(160,144,122,0.06)" : "rgba(43,108,176,0.06)", border: `1px solid ${extractingCover ? "#e8dfc8" : "rgba(43,108,176,0.22)"}`, borderRadius: 5, padding: "0.28rem 0.70rem", cursor: extractingCover ? "wait" : "pointer" }}>
                {extractingCover ? "Extraction…" : "☰ Utiliser la page 1"}
              </button>
            )}
            {coverPreviewUrl && (
              <button type="button" onClick={() => { setCoverPreviewUrl(null); setForm((prev) => ({ ...prev, cover_key: "", cover_url: "" })); }}
                style={{ fontSize: "0.72rem", color: "#b53a2a", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                ✕ Supprimer
              </button>
            )}
            <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>JPG, PNG, WebP — max 5 Mo</span>
          </div>
        </div>
        <input type="file" accept="image/*" ref={coverFileRef} style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCoverUpload(f); e.target.value = ""; }} />
      </div>

      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 0.85rem" }}>
          <Input label="Titre" value={form.title} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Select label="Catégorie" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as LibraryCategory })}>
            <option value="">— Sans catégorie —</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}
          </Select>
        </div>
        <Textarea
          label="Description" value={form.description} minRows={2} maxLength={300}
          placeholder="Résumé bref du document…"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0.85rem" }}>
          <Select label="Branche" value={form.branche} onChange={(e) => setForm({ ...form, branche: e.target.value as Branche })}>
            <option value="MEMBRE">Membres</option>
            <option value="FEMME">Femmes</option>
            <option value="ENFANT">Enfants</option>
          </Select>
          <Select label="Accès" value={form.access_level} onChange={(e) => setForm({ ...form, access_level: e.target.value as PdfAccess })}>
            <option value="PUBLIC">🌐 Public (sans connexion)</option>
            <option value="MEMBRE">🔑 Membres</option>
            <option value="FEMME">♀ Branche Femmes</option>
            <option value="ENFANT">◈ Branche Enfants</option>
          </Select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: editing ? "1fr auto" : "1fr", gap: "0.55rem", alignItems: "flex-end", marginBottom: "1rem" }}>
          <Select label="Quiz associé" value={form.linked_quiz_id ?? ""} onChange={(e) => setForm({ ...form, linked_quiz_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— Aucun quiz associé —</option>
            {quizOptions.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
          </Select>
          {editing && (
            <Button type="button" variant="ghost" onClick={() => router.push(`/quizz?create=1&library_pdf=${editing}`)}>
              + Créer un quiz pour ce livre
            </Button>
          )}
        </div>
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.1rem" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.86rem", color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Visible dans la bibliothèque
          </label>
          {form.access_level !== "PUBLIC" && (
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.86rem", color: form.is_gratuit ? "#2e9460" : "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={!!form.is_gratuit} onChange={(e) => setForm({ ...form, is_gratuit: e.target.checked })} />
              Accès gratuit
            </label>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.55rem" }}>
          <Button type="submit" loading={saving} disabled={!form.bucket_key && !editing}>
            {editing ? "Enregistrer" : "Ajouter"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Groupe catégorie avec drag-and-drop ───────────────────────────────────────

function CategoryGroup({ category, items, setItems, onEdit, onToggle, onToggleGratuit, onDelete, onPreview }: {
  category:        LibraryCategory | "";
  items:           LibraryPdf[];
  setItems:        (updater: (prev: LibraryPdf[]) => LibraryPdf[]) => void;
  onEdit:          (p: LibraryPdf) => void;
  onToggle:        (p: LibraryPdf) => void;
  onToggleGratuit: (p: LibraryPdf) => void;
  onDelete:        (id: number) => void;
  onPreview:       (p: LibraryPdf) => void;
}) {
  const dragId     = useRef<number | null>(null);
  const dragOverId = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverIdState, setDragOverIdState] = useState<number | null>(null);

  const handleDrop = useCallback(async () => {
    if (dragId.current === null || dragOverId.current === null) return;
    if (dragId.current === dragOverId.current) return;

    const fromIdx = items.findIndex((p) => p.id === dragId.current);
    const toIdx   = items.findIndex((p) => p.id === dragOverId.current);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    // Mise à jour optimiste de l'état global
    setItems((prev) => {
      const map = new Map(reordered.map((p, i) => [p.id, i]));
      return prev
        .map((p) => map.has(p.id) ? { ...p, order: map.get(p.id)! } : p)
        .sort((a, b) => a.order - b.order || a.id - b.id);
    });

    dragId.current     = null;
    dragOverId.current = null;
    setDraggingId(null);
    setDragOverIdState(null);

    try {
      await libraryApi.reorder(reordered.map((p) => p.id));
    } catch {
      // On ne rollback pas — le rechargement à la prochaine navigation corrigera
    }
  }, [items, setItems]);

  const label = category || "Sans catégorie";

  return (
    <div style={{ marginBottom: "1rem" }}>
      {/* En-tête catégorie */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.55rem",
        marginBottom: "0.45rem",
        paddingBottom: "0.35rem",
        borderBottom: "1px solid #f0e8d4",
      }}>
        <span style={{ fontSize: "0.78rem", color: "#c9a227" }}>{CAT_ICON[category] || "○"}</span>
        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#8b6a3a", flex: 1 }}>{label}</span>
        <span style={{ fontSize: "0.65rem", color: "#a0907a" }}>
          {items.length} livre{items.length !== 1 ? "s" : ""}
          {items.length > 1 && <span style={{ marginLeft: "0.4rem", opacity: 0.7 }}>· glisser pour réordonner</span>}
        </span>
      </div>

      {/* Liste triable */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {items.map((p) => (
          <DocRow
            key={p.id} pdf={p}
            dragging={draggingId === p.id}
            dragOver={dragOverIdState === p.id}
            onDragStart={() => { dragId.current = p.id; setDraggingId(p.id); }}
            onDragEnter={() => { dragOverId.current = p.id; setDragOverIdState(p.id); }}
            onDragEnd={() => { setDraggingId(null); setDragOverIdState(null); dragId.current = null; dragOverId.current = null; }}
            onPreview={() => onPreview(p)}
            onEdit={() => onEdit(p)}
            onToggle={() => onToggle(p)}
            onToggleGratuit={() => onToggleGratuit(p)}
            onDelete={() => onDelete(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Formulaire vide ───────────────────────────────────────────────────────────

type ViewMode = "liste" | "grille" | "compact";

const VIEW_MODES: { key: ViewMode; icon: string; label: string }[] = [
  { key: "liste",   icon: "≡",  label: "Liste"    },
  { key: "grille",  icon: "⊞",  label: "Grille"   },
  { key: "compact", icon: "≔",  label: "Compact"  },
];

// ── Carte grille ─────────────────────────────────────────────────────────────

function DocCard({ pdf, onEdit, onToggle, onToggleGratuit, onDelete, onPreview }: {
  pdf:             LibraryPdf;
  onEdit:          () => void;
  onToggle:        () => void;
  onToggleGratuit: () => void;
  onDelete:        () => void;
  onPreview:       () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        background: "#fff", border: "1px solid #e8dfc8",
        borderRadius: "var(--radius)", overflow: "hidden",
        opacity: pdf.is_active ? 1 : 0.60,
        display: "flex", flexDirection: "column",
        transition: "box-shadow .18s, border-color .18s",
      }}
      onMouseEnter={(e) => { setHovered(true); const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = "0 6px 24px rgba(100,60,10,0.14)"; el.style.borderColor = "#d4c4a0"; }}
      onMouseLeave={(e) => { setHovered(false); const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = ""; el.style.borderColor = "#e8dfc8"; }}
    >
      <div style={{ position: "relative", cursor: "pointer", flexShrink: 0 }} onClick={onPreview}>
        {pdf.cover_url ? (
          <img src={getMediaUrl(pdf.cover_url)} alt={pdf.title}
            style={{ width: "100%", aspectRatio: "2/3", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", aspectRatio: "2/3", background: (COVER_ACCENT[pdf.branche] ?? COVER_ACCENT.MEMBRE).bg, borderLeft: `4px solid ${(COVER_ACCENT[pdf.branche] ?? COVER_ACCENT.MEMBRE).line}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: "2.4rem", fontWeight: 800, color: (COVER_ACCENT[pdf.branche] ?? COVER_ACCENT.MEMBRE).text, opacity: 0.55, lineHeight: 1 }}>
              {pdf.title.split(" ").filter((w) => /^[A-Za-zÀ-ö]/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "☰"}
            </span>
            {pdf.category && (
              <span style={{ fontSize: "0.55rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: (COVER_ACCENT[pdf.branche] ?? COVER_ACCENT.MEMBRE).text, opacity: 0.55, textAlign: "center", padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "90%" }}>
                {pdf.category}
              </span>
            )}
          </div>
        )}

        <span style={{ position: "absolute", top: 7, right: 7, fontSize: "0.60rem", fontWeight: 700, color: pdf.is_active ? "#2e9460" : "#a0907a", background: "rgba(255,255,255,0.90)", border: `1px solid ${pdf.is_active ? "#2e946040" : "rgba(160,144,122,0.30)"}`, padding: "0.06rem 0.38rem", borderRadius: 99, backdropFilter: "blur(4px)" }}>
          {pdf.is_active ? "● Publié" : "○ Masqué"}
        </span>

        {pdf.is_gratuit && (
          <span style={{ position: "absolute", bottom: 7, left: 7, fontSize: "0.60rem", fontWeight: 700, color: "#2e9460", background: "rgba(255,255,255,0.90)", border: "1px solid rgba(46,148,96,0.35)", padding: "0.06rem 0.38rem", borderRadius: 99, backdropFilter: "blur(4px)" }}>
            ✓ GRATUIT
          </span>
        )}

        {hovered && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(20,10,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", backdropFilter: "blur(1px)" }}>
            <button onClick={(e) => { e.stopPropagation(); onPreview(); }}
              style={{ background: "rgba(255,255,255,0.92)", border: "none", borderRadius: 6, padding: "0.35rem 0.60rem", cursor: "pointer", fontSize: "0.76rem", fontWeight: 700, color: "#3a2510" }}>
              Aperçu
            </button>
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
              style={{ background: "rgba(255,255,255,0.92)", border: "none", borderRadius: 6, padding: "0.35rem 0.60rem", cursor: "pointer", fontSize: "0.76rem", fontWeight: 700, color: "#3a2510" }}>
              ✎
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: "0.65rem 0.70rem 0.55rem", flex: 1, display: "flex", flexDirection: "column", gap: "0.28rem" }}>
        <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#2a1800", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as React.CSSProperties}>
          {pdf.title}
        </div>

        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center" }}>
          {pdf.category && (
            <span style={{ fontSize: "0.60rem", fontWeight: 700, color: "#8b6a3a", background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.22)", padding: "0.02rem 0.30rem", borderRadius: 99 }}>
              {CAT_ICON[pdf.category]} {pdf.category}
            </span>
          )}
          <span style={{ fontSize: "0.60rem", fontWeight: 700, color: ACCESS_COLOR[pdf.access_level], background: `${ACCESS_COLOR[pdf.access_level]}10`, border: `1px solid ${ACCESS_COLOR[pdf.access_level]}28`, padding: "0.02rem 0.30rem", borderRadius: 99 }}>
            {ACCESS_ICON[pdf.access_level]} {ACCESS_LABEL[pdf.access_level]}
          </span>
        </div>

        {pdf.nb_pages !== null && (
          <div style={{ fontSize: "0.70rem", color: "#a0907a" }}>
            ☰ {pdf.nb_pages} pages{pdf.size_mo !== null ? ` · ${pdf.size_mo.toFixed(1)} Mo` : ""}
          </div>
        )}
      </div>

      <div style={{ padding: "0.40rem 0.60rem", borderTop: "1px solid #f5ede0", display: "flex", gap: "0.30rem", justifyContent: "flex-end", alignItems: "center" }}>
        {pdf.access_level !== "PUBLIC" && (
          <button onClick={onToggleGratuit}
            style={{ fontSize: "0.62rem", fontWeight: 700, color: pdf.is_gratuit ? "#2e9460" : "#c8b89a", background: pdf.is_gratuit ? "rgba(46,148,96,0.10)" : "transparent", border: `1px solid ${pdf.is_gratuit ? "rgba(46,148,96,0.28)" : "#e8dfc8"}`, padding: "0.14rem 0.35rem", borderRadius: 99, cursor: "pointer", flex: 1, textAlign: "left" }}>
            {pdf.is_gratuit ? "✓ Gratuit" : "Gratuit ?"}
          </button>
        )}
        <button onClick={onToggle}
          style={{ fontSize: "0.62rem", fontWeight: 700, color: pdf.is_active ? "#8b6a1a" : "#2b8a5e", background: pdf.is_active ? "rgba(201,162,39,0.08)" : "rgba(46,148,96,0.08)", border: `1px solid ${pdf.is_active ? "rgba(201,162,39,0.25)" : "rgba(46,148,96,0.25)"}`, padding: "0.14rem 0.42rem", borderRadius: 5, cursor: "pointer" }}>
          {pdf.is_active ? "↓" : "↑"}
        </button>
        <button onClick={onDelete}
          style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(192,64,44,0.07)", color: "#b53a2a", border: "1px solid rgba(192,64,44,0.20)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "0.70rem" }}>
          🗑
        </button>
      </div>
    </div>
  );
}

// ── Ligne compacte ────────────────────────────────────────────────────────────

function DocCompact({ pdf, onEdit, onToggle, onToggleGratuit, onDelete, onPreview }: {
  pdf:             LibraryPdf;
  onEdit:          () => void;
  onToggle:        () => void;
  onToggleGratuit: () => void;
  onDelete:        () => void;
  onPreview:       () => void;
}) {
  const { line } = COVER_ACCENT[pdf.branche] ?? COVER_ACCENT.MEMBRE;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "8px 1fr auto auto auto auto auto auto", alignItems: "center", gap: "0.65rem", padding: "0.38rem 0.75rem", background: "#fff", borderRadius: 5, border: "1px solid #efe7d5", opacity: pdf.is_active ? 1 : 0.58, transition: "background .12s" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#fdf8ef"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#fff"; }}
    >
      <span style={{ width: 3, height: 20, background: line, borderRadius: 2, display: "block" }} />
      <span onClick={onPreview} style={{ fontSize: "0.82rem", fontWeight: 600, color: "#2a1800", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>
        {pdf.title}
      </span>
      {pdf.category ? (
        <span style={{ fontSize: "0.63rem", fontWeight: 700, color: "#8b6a3a", background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.20)", padding: "0.04rem 0.38rem", borderRadius: 99, whiteSpace: "nowrap" }}>
          {CAT_ICON[pdf.category]} {pdf.category}
        </span>
      ) : <span />}
      <span style={{ fontSize: "0.63rem", fontWeight: 700, color: ACCESS_COLOR[pdf.access_level], background: `${ACCESS_COLOR[pdf.access_level]}10`, border: `1px solid ${ACCESS_COLOR[pdf.access_level]}28`, padding: "0.04rem 0.38rem", borderRadius: 99, whiteSpace: "nowrap" }}>
        {ACCESS_ICON[pdf.access_level]} {ACCESS_LABEL[pdf.access_level]}
      </span>
      <span style={{ fontSize: "0.72rem", color: "#a0907a", whiteSpace: "nowrap" }}>
        {pdf.nb_pages !== null ? `☰ ${pdf.nb_pages}p` : ""}
      </span>
      {pdf.access_level !== "PUBLIC" ? (
        <button onClick={onToggleGratuit} style={{ fontSize: "0.63rem", fontWeight: 700, color: pdf.is_gratuit ? "#2e9460" : "#c8b89a", background: pdf.is_gratuit ? "rgba(46,148,96,0.10)" : "transparent", border: `1px solid ${pdf.is_gratuit ? "rgba(46,148,96,0.28)" : "#e8dfc8"}`, padding: "0.04rem 0.38rem", borderRadius: 99, cursor: "pointer", whiteSpace: "nowrap" }}>
          {pdf.is_gratuit ? "✓ Gratuit" : "Gratuit ?"}
        </button>
      ) : <span />}
      <span style={{ fontSize: "0.63rem", fontWeight: 700, color: pdf.is_active ? "#2e9460" : "#a0907a", whiteSpace: "nowrap" }}>
        {pdf.is_active ? "● Publié" : "○ Masqué"}
      </span>
      <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
        <button onClick={onEdit} title="Modifier" style={{ width: 24, height: 24, borderRadius: 4, background: "rgba(139,106,58,0.08)", color: "#8b6a3a", border: "1px solid #e8dfc8", cursor: "pointer", fontSize: "0.72rem", display: "flex", alignItems: "center", justifyContent: "center" }}>✎</button>
        <button onClick={onToggle} title={pdf.is_active ? "Dépublier" : "Publier"} style={{ width: 24, height: 24, borderRadius: 4, background: pdf.is_active ? "rgba(201,162,39,0.08)" : "rgba(46,148,96,0.08)", color: pdf.is_active ? "#8b6a1a" : "#2b8a5e", border: `1px solid ${pdf.is_active ? "rgba(201,162,39,0.25)" : "rgba(46,148,96,0.25)"}`, cursor: "pointer", fontSize: "0.78rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {pdf.is_active ? "↓" : "↑"}
        </button>
        <button onClick={onDelete} title="Supprimer" style={{ width: 24, height: 24, borderRadius: 4, background: "rgba(192,64,44,0.07)", color: "#b53a2a", border: "1px solid rgba(192,64,44,0.20)", cursor: "pointer", fontSize: "0.68rem", display: "flex", alignItems: "center", justifyContent: "center" }}>🗑</button>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function BibliothequePage() {
  const { toast } = useToast();
  const [items,        setItems]        = useState<LibraryPdf[]>([]);
  const [editTarget,   setEditTarget]   = useState<LibraryPdf | null>(null);
  const [showForm,     setShowForm]     = useState(false);
  const [preview,      setPreview]      = useState<LibraryPdf | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterAccess, setFilterAccess] = useState("ALL");
  const [filterCat,    setFilterCat]    = useState("ALL");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [viewMode,     setViewMode]     = useState<ViewMode>(() => {
    try { return (localStorage.getItem("library_view") as ViewMode) ?? "liste"; } catch { return "liste"; }
  });

  const changeView = (mode: ViewMode) => {
    setViewMode(mode);
    try { localStorage.setItem("library_view", mode); } catch {}
  };

  const load = useCallback(async () => {
    try {
      const { data } = await libraryApi.list();
      const result: LibraryPdf[] = Array.isArray(data) ? data : data.results;
      const normalized: LibraryPdf[] = result.map((item) => ({
        ...item,
        category: normalizeCategory(item.category) as LibraryCategory,
      }));
      setItems(normalized);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const doRemove = async (id: number) => {
    try { await libraryApi.remove(id); setItems((prev) => prev.filter((p) => p.id !== id)); toast("Document supprimé.", "success"); }
    catch (e) { toast(errorMessage(e), "error"); }
  };

  const toggleActive = async (p: LibraryPdf) => {
    const next = !p.is_active;
    setItems((prev) => prev.map((item) => item.id === p.id ? { ...item, is_active: next } : item));
    if (preview?.id === p.id) setPreview({ ...p, is_active: next });
    try { await libraryApi.update(p.id, { is_active: next }); }
    catch { setItems((prev) => prev.map((item) => item.id === p.id ? { ...item, is_active: p.is_active } : item)); }
  };

  const toggleGratuit = async (p: LibraryPdf) => {
    const next = !p.is_gratuit;
    setItems((prev) => prev.map((item) => item.id === p.id ? { ...item, is_gratuit: next } : item));
    if (preview?.id === p.id) setPreview({ ...p, is_gratuit: next });
    try { await libraryApi.update(p.id, { is_gratuit: next }); }
    catch { setItems((prev) => prev.map((item) => item.id === p.id ? { ...item, is_gratuit: p.is_gratuit } : item)); }
  };

  const filtered = items.filter((p) => {
    const normCat = normalizeCategory(p.category) || "";
    const matchAccess = filterAccess === "ALL" || p.access_level === filterAccess;
    const matchCat =
      filterCat === "ALL"
        ? true
        : filterCat === ""
        ? !normCat
        : normCat === filterCat || p.category.toLowerCase() === filterCat.toLowerCase();
    const matchSearch =
      !filterSearch ||
      p.title.toLowerCase().includes(filterSearch.toLowerCase()) ||
      p.category.toLowerCase().includes(filterSearch.toLowerCase()) ||
      normCat.toLowerCase().includes(filterSearch.toLowerCase()) ||
      p.description.toLowerCase().includes(filterSearch.toLowerCase());
    return matchAccess && matchCat && matchSearch;
  });

  const pubCount = items.filter((p) => p.is_active).length;

  const initialForEdit = editTarget ? {
    title: editTarget.title, description: editTarget.description,
    category: editTarget.category as LibraryCategory, branche: editTarget.branche,
    access_level: editTarget.access_level, bucket_key: editTarget.bucket_key,
    cover_key: editTarget.cover_key ?? "",
    cover_url: editTarget.cover_url ?? "",
    nb_pages: editTarget.nb_pages, size_mo: editTarget.size_mo,
    is_active: editTarget.is_active,
    is_gratuit: editTarget.is_gratuit ?? false,
    linked_quiz_id: editTarget.linked_quiz_id ?? null,
  } : { ...EMPTY_FORM };

  return (
    <div className="fade-up">

      {/* ── Header ── */}
      <div className="page-header">
        <div className="eyebrow">Ressources</div>
        <h1>Bibliothèque PDF</h1>
        <p>
          {items.length} document{items.length !== 1 ? "s" : ""}
          {" · "}{pubCount} publié{pubCount !== 1 ? "s" : ""}
        </p>
      </div>

      {/* ── Barre filtres + action ── */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", marginBottom: "1.4rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Input
            label="Rechercher" value={filterSearch}
            placeholder="Titre, catégorie, description…"
            onChange={(e) => setFilterSearch(e.target.value)}
          />
        </div>
        <div style={{ width: 200 }}>
          <Select label="Catégorie" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="ALL">Toutes les catégories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}
            <option value="">Sans catégorie</option>
          </Select>
        </div>
        <div style={{ width: 160 }}>
          <Select label="Accès" value={filterAccess} onChange={(e) => setFilterAccess(e.target.value)}>
            <option value="ALL">Tous les accès</option>
            <option value="PUBLIC">🌐 Public</option>
            <option value="MEMBRE">🔑 Membres</option>
            <option value="FEMME">♀ Femmes</option>
            <option value="ENFANT">◈ Enfants</option>
          </Select>
        </div>
        {/* Toggle mode d'affichage */}
        <div style={{ display: "flex", gap: 0, marginBottom: "0.85rem", border: "1px solid #e8dfc8", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
          {VIEW_MODES.map((m) => (
            <button
              key={m.key}
              title={m.label}
              onClick={() => changeView(m.key)}
              style={{
                width: 34, height: 34, border: "none", cursor: "pointer",
                fontSize: "0.95rem", lineHeight: 1,
                background: viewMode === m.key ? "#c9a227" : "transparent",
                color: viewMode === m.key ? "#fff" : "#a0907a",
                transition: "background .14s, color .14s",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {m.icon}
            </button>
          ))}
        </div>

        <Button style={{ marginBottom: "0.85rem" }} onClick={() => { setEditTarget(null); setShowForm(true); }}>
          + Nouveau document
        </Button>
      </div>

      {/* ── Sections par branche ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
        {BRANCH_COLS.map((col) => {
          const branchItems = filtered.filter((p) => p.branche === col.key);
          return (
            <section key={col.key}>
              {/* En-tête branche */}
              <div style={{
                display: "flex", alignItems: "center", gap: "0.7rem",
                padding: "0.6rem 1rem",
                background: `${col.color}0e`,
                border: `1px solid ${col.color}28`,
                borderLeft: `4px solid ${col.color}`,
                borderRadius: "var(--radius)",
                marginBottom: "1rem",
              }}>
                <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{col.emoji}</span>
                <span style={{ fontSize: "0.90rem", fontWeight: 800, color: col.color, flex: 1 }}>
                  {col.label}
                </span>
                <span style={{ fontSize: "0.70rem", fontWeight: 700, background: `${col.color}1a`, color: col.color, border: `1px solid ${col.color}38`, padding: "0.10rem 0.52rem", borderRadius: 99 }}>
                  {branchItems.length} document{branchItems.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Contenu */}
              {branchItems.length === 0 ? (
                <div style={{ padding: "1.4rem", textAlign: "center", color: "var(--muted)", fontSize: "0.82rem", border: "1px dashed var(--line-soft)", borderRadius: "var(--radius)" }}>
                  Aucun document dans cette section.
                </div>
              ) : viewMode === "grille" ? (
                /* Mode grille : groupes catégorie (sans DnD) */
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  {[...CATEGORIES, "" as LibraryCategory].map((cat) => {
                    const catItems = branchItems.filter((p) => p.category === cat);
                    if (catItems.length === 0) return null;
                    return (
                      <div key={cat || "__none__"}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.55rem", paddingBottom: "0.30rem", borderBottom: "1px solid #f0e8d4" }}>
                          <span style={{ fontSize: "0.75rem", color: "#c9a227" }}>{CAT_ICON[cat] || "○"}</span>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#8b6a3a" }}>{cat || "Sans catégorie"}</span>
                          <span style={{ fontSize: "0.63rem", color: "#a0907a" }}>{catItems.length} livre{catItems.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: "0.75rem" }}>
                          {catItems.map((p) => (
                            <DocCard key={p.id} pdf={p}
                              onPreview={() => setPreview(p)}
                              onEdit={() => { setEditTarget(p); setShowForm(true); }}
                              onToggle={() => toggleActive(p)}
                              onToggleGratuit={() => toggleGratuit(p)}
                              onDelete={() => setDeleteTarget(p.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : viewMode === "compact" ? (
                /* Mode compact : groupes catégorie (sans DnD) */
                <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
                  {[...CATEGORIES, "" as LibraryCategory].map((cat) => {
                    const catItems = branchItems.filter((p) => p.category === cat);
                    if (catItems.length === 0) return null;
                    return (
                      <div key={cat || "__none__"}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem", paddingBottom: "0.25rem", borderBottom: "1px solid #f0e8d4" }}>
                          <span style={{ fontSize: "0.75rem", color: "#c9a227" }}>{CAT_ICON[cat] || "○"}</span>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#8b6a3a" }}>{cat || "Sans catégorie"}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.22rem" }}>
                          {catItems.map((p) => (
                            <DocCompact key={p.id} pdf={p}
                              onPreview={() => setPreview(p)}
                              onEdit={() => { setEditTarget(p); setShowForm(true); }}
                              onToggle={() => toggleActive(p)}
                              onToggleGratuit={() => toggleGratuit(p)}
                              onDelete={() => setDeleteTarget(p.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Mode liste : groupes catégorie avec drag-and-drop */
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  {[...CATEGORIES, "" as LibraryCategory].map((cat) => {
                    const catItems = branchItems.filter((p) => p.category === cat);
                    if (catItems.length === 0) return null;
                    return (
                      <CategoryGroup
                        key={cat || "__none__"}
                        category={cat}
                        items={catItems}
                        setItems={setItems}
                        onPreview={(p) => setPreview(p)}
                        onEdit={(p) => { setEditTarget(p); setShowForm(true); }}
                        onToggle={toggleActive}
                        onToggleGratuit={toggleGratuit}
                        onDelete={(id) => setDeleteTarget(id)}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ── Modal formulaire ── */}
      {showForm && (
        <DocFormModal
          initial={initialForEdit}
          editing={editTarget?.id ?? null}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onSaved={() => {
            toast(editTarget ? "Document mis à jour." : "Document ajouté.", "success");
            setShowForm(false); setEditTarget(null); load();
          }}
          onError={(s) => toast(s, "error")}
        />
      )}

      {/* ── Modal aperçu ── */}
      {preview && (
        <PdfPreviewModal
          pdf={preview}
          onClose={() => setPreview(null)}
          onEdit={() => { setPreview(null); setEditTarget(preview); setShowForm(true); }}
          onToggle={() => toggleActive(preview)}
        />
      )}

      {/* ── Confirmation suppression ── */}
      {deleteTarget !== null && (
        <ConfirmModal
          title="Supprimer le document ?"
          message="Ce document sera définitivement supprimé de la bibliothèque."
          confirmLabel="Supprimer"
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await doRemove(deleteTarget);
            setDeleteTarget(null);
            if (preview?.id === deleteTarget) setPreview(null);
          }}
        />
      )}
    </div>
  );
}
