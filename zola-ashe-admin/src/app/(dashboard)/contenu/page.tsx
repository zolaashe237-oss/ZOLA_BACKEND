"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { asList, formationApi } from "@/lib/endpoints";
import type { Branche, Formation, FormationAcces, FormationNiveau, FormationStatus } from "@/lib/types";
import { getMediaUrl } from "@/lib/api";
import { Alert, Button, Input, Select, Textarea, errorMessage } from "@/components/ui";
import { ConfirmModal } from "@/components/Modal";
import { FormationCard } from "@/components/FormationCard";
import { YoutubeImportModal } from "@/components/YoutubeImportModal";
import { useToast } from "@/components/Toast";

// ── Groupement par branche ────────────────────────────────────────────────────

const BRANCH_COLS: { key: Branche; label: string; color: string; emoji: string }[] = [
  { key: "MEMBRE",  label: "Espace Membres",  color: "#5b8fd4", emoji: "◉" },
  { key: "FEMME",   label: "Espace Femmes",   color: "#b5532a", emoji: "♀" },
  { key: "ENFANT",  label: "Espace Enfants",  color: "#52b083", emoji: "◈" },
];

const EMPTY = {
  title: "", description: "",
  category: "FORMATION" as Formation["category"],
  niveau: "" as FormationNiveau | "",
  branche: "" as Branche | "",
  acces: "MEMBRES" as FormationAcces,
  status: "DRAFT" as FormationStatus,
  publish_at: "",
  price: "",
};

type FormState = typeof EMPTY;

/** Prix à l'unité envoyé à l'API (formation non publique). Un prix rend la formation payante. */
function priceToApi(f: FormState): number | null {
  return f.acces !== "PUBLIC" && Number(f.price) > 0 ? Number(f.price) : null;
}

/** Accès effectif : « Membres » + prix → « Payant » (même règle que le backend). */
function effectiveAcces(f: FormState): FormationAcces {
  return priceToApi(f) !== null ? "PAYANTE" : f.acces;
}

function accesToApi(acces: FormationAcces) {
  return {
    access_subscription_types: (acces === "PAYANTE" ? ["MEMBRE"] : []) as ("MEMBRE")[],
    is_public: acces === "PUBLIC",
  };
}

function buildPreview(f: FormState, coverUrl: string): Formation {
  return {
    id: 0,
    title:       f.title.trim() || "Titre de la formation",
    description: f.description.trim(),
    category:    f.category,
    ...accesToApi(effectiveAcces(f)),
    price: priceToApi(f),
    cover_url: coverUrl, cover_key: "",
    status: f.status,
    publish_at: f.status === "SCHEDULED" && f.publish_at
      ? new Date(f.publish_at).toISOString() : null,
    order: 0, module_count: 0,
    niveau:      f.niveau  || null,
    branche:     f.branche || null,
    nb_episodes: 0, nb_gratuits: 0,
    modules_preview: [],
    created_at: "", updated_at: "",
  };
}

// ── Sélecteur d'accès (Public / Membres / Payant) ────────────────────────────

const ACCES_OPTIONS: { value: FormationAcces; label: string; sub: string; color: string }[] = [
  { value: "PUBLIC",  label: "Public",   sub: "Visiteurs non connectés (landing)",  color: "#2e9460" },
  { value: "MEMBRES", label: "Membres",  sub: "Tous les membres connectés",          color: "#5b8fd4" },
  { value: "PAYANTE", label: "Payant",   sub: "Abonnement actif requis",             color: "#c9a227" },
];

function AccesSelector({ value, onChange }: {
  value: FormationAcces;
  onChange: (v: FormationAcces) => void;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <span className="field-label">Accès à la formation</span>
      <div style={{ display: "flex", gap: "0.45rem", marginTop: "0.38rem" }}>
        {ACCES_OPTIONS.map((o) => {
          const active = value === o.value;
          return (
            <button key={o.value} type="button" onClick={() => onChange(o.value)} style={{
              flex: 1, textAlign: "left", padding: "0.55rem 0.7rem", borderRadius: 7,
              border: active ? `2px solid ${o.color}` : "1.5px solid var(--line-soft)",
              background: active ? `${o.color}12` : "var(--bg-2)",
              cursor: "pointer", transition: "all .14s",
            }}>
              <div style={{ fontSize: "0.80rem", fontWeight: 800, color: active ? o.color : "var(--cream)" }}>
                {o.label}
              </div>
              <div style={{ fontSize: "0.67rem", color: active ? o.color : "var(--muted-2)", marginTop: "0.14rem" }}>
                {o.sub}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Sélecteur d'image de couverture ──────────────────────────────────────────

function CoverPicker({ previewUrl, onFile }: {
  previewUrl: string;
  onFile: (file: File, url: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onFile(file, url);
    e.target.value = "";
  };

  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <div style={{
        fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)",
        marginBottom: "0.35rem", letterSpacing: "0.04em",
      }}>
        Image de couverture
      </div>
      <div
        onClick={() => ref.current?.click()}
        style={{
          height: 140,
          borderRadius: 8,
          border: `2px dashed ${previewUrl ? "#c9a22760" : "#d0c8b880"}`,
          background: previewUrl
            ? `center/cover no-repeat url(${previewUrl})`
            : "rgba(201,162,39,0.04)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          transition: "border-color .15s, background .15s",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = "#c9a22799";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = previewUrl ? "#c9a22760" : "#d0c8b880";
        }}
      >
        {previewUrl ? (
          /* Overlay on hover */
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(20,10,0,0.42)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: 0,
            transition: "opacity .15s",
          }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "0"; }}
          >
            <span style={{
              color: "#fff", fontSize: "0.78rem", fontWeight: 700,
              background: "rgba(0,0,0,0.35)", padding: "0.3rem 0.7rem", borderRadius: 6,
            }}>
              Changer l&apos;image
            </span>
          </div>
        ) : (
          <div style={{ textAlign: "center", pointerEvents: "none" }}>
            <div style={{ fontSize: "1.6rem", marginBottom: "0.35rem", opacity: 0.45 }}>🖼</div>
            <div style={{ fontSize: "0.78rem", color: "#a0907a", fontWeight: 500 }}>
              Cliquer pour ajouter une couverture
            </div>
            <div style={{ fontSize: "0.68rem", color: "#c0a880", marginTop: "0.18rem" }}>
              JPG, PNG, WebP — recommandé 1280×720
            </div>
          </div>
        )}
      </div>
      <input
        ref={ref} type="file" accept="image/*"
        style={{ display: "none" }} onChange={pick}
      />
    </div>
  );
}

// ── Liste draggable par branche ───────────────────────────────────────────────

function statusLabel(s: FormationStatus) {
  if (s === "PUBLISHED") return { text: "Publié",    color: "var(--ok)" };
  if (s === "SCHEDULED") return { text: "Programmé", color: "var(--warn)" };
  return                        { text: "Brouillon", color: "var(--muted)" };
}

function DraggableBranchList({
  items,
  colColor,
  onReorder,
  onPublish,
  onUnpublish,
  onRemove,
  publishingId,
}: {
  items: Formation[];
  colColor: string;
  onReorder: (next: Formation[]) => void;
  onPublish: (f: Formation) => void;
  onUnpublish: (f: Formation) => void;
  onRemove: (f: Formation) => void;
  publishingId?: number | null;
}) {
  const [dragId,    setDragId]    = useState<number | null>(null);
  const [overId,    setOverId]    = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, id: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragId) setOverId(id);
  };

  const handleDrop = (e: React.DragEvent, dropId: number) => {
    e.preventDefault();
    if (dragId === null || dragId === dropId) { reset(); return; }
    const fromIdx = items.findIndex((f) => f.id === dragId);
    const toIdx   = items.findIndex((f) => f.id === dropId);
    if (fromIdx === -1 || toIdx === -1) { reset(); return; }
    const next = [...items];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorder(next);
    reset();
  };

  const reset = () => { setDragId(null); setOverId(null); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      {items.map((f, idx) => {
        const st    = statusLabel(f.status);
        const cover = f.cover_url || undefined;
        const isDragging = f.id === dragId;
        const isOver     = f.id === overId;
        return (
          <div
            key={f.id}
            draggable
            onDragStart={(e) => handleDragStart(e, f.id)}
            onDragOver={(e)  => handleDragOver(e, f.id)}
            onDrop={(e)      => handleDrop(e, f.id)}
            onDragEnd={reset}
            style={{
              display: "flex", alignItems: "center", gap: "0.65rem",
              padding: "0.6rem 0.75rem",
              background: isDragging ? "var(--bg-2)" : "var(--bg-1)",
              border: `1px solid ${isOver ? colColor : "var(--line-soft)"}`,
              borderLeft: `3px solid ${isOver ? colColor : isDragging ? "var(--muted)" : "transparent"}`,
              borderRadius: "var(--radius-sm)",
              opacity: isDragging ? 0.45 : 1,
              cursor: "grab",
              transition: "border-color .1s, opacity .1s",
              userSelect: "none",
            }}
          >
            {/* Drag handle */}
            <span style={{ color: "var(--muted)", fontSize: "1.1rem", lineHeight: 1, flexShrink: 0 }}>⠿</span>

            {/* Order badge */}
            <span style={{
              fontSize: "0.64rem", fontWeight: 800, minWidth: "1.5rem",
              textAlign: "center", padding: "0.1rem 0.3rem", borderRadius: 99,
              color: colColor, background: `${colColor}18`, border: `1px solid ${colColor}30`,
              flexShrink: 0,
            }}>
              {idx + 1}
            </span>

            {/* Miniature */}
            {cover && (
              <img src={getMediaUrl(cover)} alt="" style={{ width: 38, height: 38, objectFit: "cover", flexShrink: 0, borderRadius: 3 }} />
            )}

            {/* Titre + statut */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.86rem", color: "var(--cream)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.title}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.1rem" }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: st.color }}>{st.text}</span>
                <span style={{ fontSize: "0.65rem", color: "var(--muted)" }}>·</span>
                <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>{f.module_count} module{f.module_count !== 1 ? "s" : ""}</span>
                <span style={{ fontSize: "0.65rem", color: "var(--muted)" }}>·</span>
                <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>{f.category}</span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
              <a
                href={`/contenu/${f.id}`}
                style={{
                  fontSize: "0.70rem", padding: "0.22rem 0.6rem",
                  border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)",
                  color: "var(--muted)", background: "var(--bg-2)",
                  textDecoration: "none", cursor: "pointer",
                  display: "inline-flex", alignItems: "center",
                }}
              >
                ✎ Éditer
              </a>
              {f.status === "PUBLISHED" ? (
                <Button variant="ghost" style={{ fontSize: "0.70rem", padding: "0.22rem 0.6rem" }} onClick={() => onUnpublish(f)}>
                  Dépublier
                </Button>
              ) : (
                <Button style={{ fontSize: "0.70rem", padding: "0.22rem 0.6rem" }} loading={publishingId === f.id} onClick={() => onPublish(f)}>
                  Publier
                </Button>
              )}
              <Button variant="danger" style={{ fontSize: "0.70rem", padding: "0.22rem 0.45rem" }} onClick={() => onRemove(f)}>
                ✕
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Vue tableau ──────────────────────────────────────────────────────────────

function FormationsTable({
  items, colColor, onPublish, onUnpublish, onRemove, publishingId,
}: {
  items: Formation[];
  colColor: string;
  onPublish: (f: Formation) => void;
  onUnpublish: (f: Formation) => void;
  onRemove: (f: Formation) => void;
  publishingId?: number | null;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th style={{ width: 44 }}></th>
            <th>Titre</th>
            <th>Catégorie</th>
            <th>Statut</th>
            <th>Modules</th>
            <th>Créée le</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((f, idx) => {
            const st = statusLabel(f.status);
            return (
              <tr key={f.id}>
                <td style={{ color: colColor, fontWeight: 700, fontSize: "0.75rem" }}>{idx + 1}</td>
                <td>
                  {f.cover_url && (
                    <img src={getMediaUrl(f.cover_url)} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 3, display: "block" }} />
                  )}
                </td>
                <td style={{ fontWeight: 600, fontSize: "0.86rem", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.title}
                </td>
                <td style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{f.category}</td>
                <td>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: st.color }}>{st.text}</span>
                </td>
                <td style={{ fontSize: "0.78rem", color: "var(--muted)", textAlign: "center" }}>{f.module_count}</td>
                <td style={{ fontSize: "0.74rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                  {new Date(f.created_at).toLocaleDateString("fr-FR")}
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.3rem", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                    <a href={`/contenu/${f.id}`} style={{
                      fontSize: "0.70rem", padding: "0.22rem 0.6rem",
                      border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)",
                      color: "var(--muted)", background: "var(--bg-2)", textDecoration: "none",
                      display: "inline-flex", alignItems: "center",
                    }}>✎ Éditer</a>
                    {f.status === "PUBLISHED" ? (
                      <Button variant="ghost" style={{ fontSize: "0.70rem", padding: "0.22rem 0.6rem" }} onClick={() => onUnpublish(f)}>Dépublier</Button>
                    ) : (
                      <Button style={{ fontSize: "0.70rem", padding: "0.22rem 0.6rem" }} loading={publishingId === f.id} onClick={() => onPublish(f)}>Publier</Button>
                    )}
                    <Button variant="danger" style={{ fontSize: "0.70rem", padding: "0.22rem 0.45rem" }} onClick={() => onRemove(f)}>✕</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function ContenuPage() {
  const { toast } = useToast();
  const [items,        setItems]        = useState<Formation[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [form,         setForm]         = useState({ ...EMPTY });
  const [coverFile,    setCoverFile]    = useState<File | null>(null);
  const [coverUrl,     setCoverUrl]     = useState("");
  const [showForm,     setShowForm]     = useState(false);
  const [showYoutubeImport, setShowYoutubeImport] = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Formation | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCat,    setFilterCat]    = useState("");
  const [reordering,   setReordering]   = useState(false);
  const [viewMode,     setViewMode]     = useState<"list" | "grid" | "table">("list");
  const [publishingId, setPublishingId] = useState<number | null>(null);

  // Libérer l'URL objet quand on change d'image ou qu'on ferme le formulaire
  const setCover = (file: File, url: string) => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setCoverFile(file);
    setCoverUrl(url);
  };

  const resetForm = () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    setForm({ ...EMPTY });
    setCoverFile(null);
    setCoverUrl("");
  };

  const load = useCallback(() => {
    setLoading(true);
    formationApi.list()
      .then((r) => setItems(asList(r.data)))
      .catch((e) => toast(errorMessage(e), "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await formationApi.create({
        title: form.title, description: form.description, category: form.category,
        ...accesToApi(effectiveAcces(form)),
        price: priceToApi(form),
        status: form.status,
        publish_at: form.status === "SCHEDULED" && form.publish_at
          ? new Date(form.publish_at).toISOString() : null,
        ...(form.niveau  ? { niveau:  form.niveau  } : {}),
        ...(form.branche ? { branche: form.branche } : {}),
      });
      if (coverFile) {
        try {
          await formationApi.uploadCover(res.data.id, coverFile);
        } catch {
          // La formation est créée — l'image peut être rajoutée depuis les paramètres
          toast("Formation créée (l'image de couverture n'a pas pu être envoyée).", "info");
          resetForm(); setShowForm(false); load(); return;
        }
      }
      toast("Formation créée. Ouvrez-la pour ajouter des chapitres et épisodes.", "success");
      resetForm(); setShowForm(false); load();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const publish = async (f: Formation) => {
    setPublishingId(f.id);
    try { await formationApi.publish(f.id); load(); }
    catch (e) { toast(errorMessage(e), "error"); }
    finally { setPublishingId(null); }
  };

  const unpublish = async (f: Formation) => {
    try { await formationApi.update(f.id, { status: "DRAFT" }); load(); }
    catch (e) { toast(errorMessage(e), "error"); }
  };

  const doRemove = async (f: Formation) => {
    try { await formationApi.hardDelete(f.id); load(); toast("Formation supprimée définitivement.", "success"); }
    catch (e) { toast(errorMessage(e), "error"); }
  };

  const handleReorder = async (branche: string, next: Formation[]) => {
    // Mise à jour optimiste locale
    setItems((prev) => {
      const others = branche === "PUBLIC"
        ? prev.filter((f) => !f.is_public)
        : prev.filter((f) => {
            if (f.is_public) return true;
            const b = f.branche === "GENERALE" ? "MEMBRE" : (f.branche ?? "MEMBRE");
            return b !== branche;
          });
      return [...others, ...next];
    });
    setReordering(true);
    try {
      await formationApi.reorder(next.map((f, i) => ({ id: f.id, order: i })));
    } catch (e) {
      toast(errorMessage(e), "error");
      load(); // rollback
    } finally {
      setReordering(false);
    }
  };

  const filtered = items.filter((f) => {
    if (filterStatus && f.status !== filterStatus) return false;
    if (filterCat    && f.category !== filterCat)  return false;
    return true;
  });

  const published = items.filter((f) => f.status === "PUBLISHED").length;

  return (
    <div className="fade-up">

      {/* ── Header ── */}
      <div className="page-header">
        <div className="eyebrow">Contenu pédagogique</div>
        <h1>Catalogue des formations</h1>
        <p>
          {items.length} formation{items.length !== 1 ? "s" : ""} ·{" "}
          {published} publiée{published !== 1 ? "s" : ""}
        </p>
      </div>

      {reordering && (
        <div style={{ fontSize: "0.76rem", color: "var(--muted)", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: "2px solid var(--muted)", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
          Sauvegarde de l'ordre…
        </div>
      )}

      {/* ── Barre filtres + action ── */}
      <div style={{
        display: "flex", gap: ".75rem", alignItems: "flex-end",
        marginBottom: "1.25rem", flexWrap: "wrap",
      }}>
        <div style={{ width: 170 }}>
          <Select label="Statut" value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            <option value="PUBLISHED">Publié</option>
            <option value="SCHEDULED">Programmé</option>
            <option value="DRAFT">Brouillon</option>
          </Select>
        </div>
        <div style={{ width: 185 }}>
          <Select label="Catégorie" value={filterCat}
                  onChange={(e) => setFilterCat(e.target.value)}>
            <option value="">Toutes catégories</option>
            <option value="FORMATION">Formation</option>
            <option value="LIVRE">Bibliothèque</option>
            <option value="LIBRE">Accès libre</option>
          </Select>
        </div>
        {/* ── Toggle vue ── */}
        <div style={{ display: "flex", gap: "0.2rem", marginBottom: ".85rem", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)", padding: "0.18rem" }}>
          {(["list", "grid", "table"] as const).map((m) => {
            const icons = { list: "≡", grid: "⊞", table: "⊟" };
            const labels = { list: "Liste", grid: "Grille", table: "Tableau" };
            return (
              <button key={m} onClick={() => setViewMode(m)} title={labels[m]} style={{
                background: viewMode === m ? "var(--gold)" : "transparent",
                color: viewMode === m ? "#1a130a" : "var(--muted)",
                border: "none", borderRadius: 5, padding: "0.25rem 0.55rem",
                cursor: "pointer", fontSize: "1rem", lineHeight: 1,
                fontWeight: viewMode === m ? 700 : 400,
                transition: "background .14s, color .14s",
              }}>{icons[m]}</button>
            );
          })}
        </div>

        <Button
          variant="ghost"
          style={{ marginBottom: ".85rem" }}
          onClick={() => { setShowYoutubeImport(true); }}
        >
          ⬇ Importer depuis YouTube
        </Button>
        <Button
          style={{ marginBottom: ".85rem" }}
          onClick={() => {
            if (showForm) resetForm();
            setShowForm(!showForm);
          }}
        >
          {showForm ? "✕ Annuler" : "+ Nouvelle formation"}
        </Button>
      </div>

      {showYoutubeImport && (
        <YoutubeImportModal
          onClose={() => setShowYoutubeImport(false)}
          onImported={(message) => { toast(message, "success"); setShowYoutubeImport(false); load(); }}
        />
      )}

      {/* ── Formulaire création avec aperçu live ── */}
      {showForm && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr minmax(280px, 320px)",
          gap: "1.25rem",
          alignItems: "start",
          marginBottom: "1.75rem",
        }}>
          {/* ── Panneau formulaire ── */}
          <div style={{
            background: "var(--bg-1)", border: "1px solid var(--line-soft)",
            borderRadius: "var(--radius)", padding: "1.4rem 1.5rem",
          }}>
            <h2 style={{
              fontSize: "1rem", fontWeight: 700,
              color: "var(--cream)", marginBottom: "1.1rem",
            }}>
              Nouvelle formation
            </h2>
            <form onSubmit={create}>
              {/* ── Couverture ── */}
              <CoverPicker previewUrl={coverUrl} onFile={setCover} />

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: ".8rem" }}>
                <Input label="Titre" value={form.title} required
                       onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <Select label="Catégorie" value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value as Formation["category"] })}>
                  <option value="FORMATION">Formation</option>
                  <option value="LIVRE">Bibliothèque</option>
                  <option value="LIBRE">Accès libre</option>
                </Select>
              </div>
              <Textarea
                label="Description" value={form.description} maxLength={600}
                placeholder="Présentez le contenu, les objectifs et ce que les membres apprendront…"
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".8rem" }}>
                <Select label="Niveau" value={form.niveau}
                        onChange={(e) => setForm({ ...form, niveau: e.target.value as FormationNiveau | "" })}>
                  <option value="">— Niveau —</option>
                  <option value="DEBUTANT">Débutant</option>
                  <option value="INTERMEDIAIRE">Intermédiaire</option>
                  <option value="AVANCE">Avancé</option>
                </Select>
                <Select label="Branche" value={form.branche}
                        onChange={(e) => setForm({ ...form, branche: e.target.value as Branche | "" })}>
                  <option value="">— Branche —</option>
                  <option value="MEMBRE">Membres</option>
                  <option value="FEMME">Femme</option>
                  <option value="ENFANT">Enfant</option>
                </Select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".8rem" }}>
                <Select label="Publication" value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value as FormationStatus })}>
                  <option value="DRAFT">Brouillon</option>
                  <option value="SCHEDULED">Programmé (différé)</option>
                  <option value="PUBLISHED">Publier maintenant</option>
                </Select>
                {form.status === "SCHEDULED" && (
                  <Input label="Date de mise en ligne" type="datetime-local"
                         value={form.publish_at}
                         onChange={(e) => setForm({ ...form, publish_at: e.target.value })} />
                )}
              </div>
              <AccesSelector
                value={form.acces}
                onChange={(v) => setForm({ ...form, acces: v })}
              />
              {form.acces !== "PUBLIC" && (
                <div style={{ marginBottom: "1rem" }}>
                  <Input
                    label="Prix à l'unité (FCFA) — optionnel"
                    type="number" min={0} step={500} placeholder="Ex. 15000 — vide = réservée aux abonnés"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    style={{ marginBottom: 0 }}
                  />
                  <p style={{ margin: "-0.5rem 0 0", fontSize: "0.72rem", color: "var(--muted-2)", lineHeight: 1.5 }}>
                    {form.acces === "MEMBRES" && Number(form.price) > 0 ? (
                      <>Mettre un prix passe cette formation en accès <strong>Payant</strong> : les abonnés y gardent
                accès, les autres membres peuvent l&apos;acheter seule.</>
                    ) : "Les membres sans abonnement pourront acheter cette formation seule."}
                  </p>
                </div>
              )}
              <Button type="submit" loading={saving}>Créer la formation</Button>
            </form>
          </div>

          {/* ── Panneau aperçu live ── */}
          <div>
            <div style={{
              fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "var(--muted)",
              marginBottom: "0.55rem",
              display: "flex", alignItems: "center", gap: "0.4rem",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#5fb98a",
                display: "inline-block",
                boxShadow: "0 0 0 3px rgba(95,185,138,0.25)",
              }} />
              Aperçu en temps réel
            </div>
            <FormationCard
              formation={buildPreview(form, coverUrl)}
              onPublish={() => {}}
              onRemove={() => {}}
              preview
            />
          </div>
        </div>
      )}

      {/* ── Catalogue — sections par branche (horizontal → vertical) ── */}
      {loading && items.length === 0 ? (
        <div style={{
          padding: "3rem", textAlign: "center",
          color: "var(--muted)", fontSize: "0.88rem",
          background: "var(--bg-1)", border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius)",
        }}>
          Chargement du catalogue...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {BRANCH_COLS.map((col) => {
            const colItems = filtered.filter((f) => {
              if (f.is_public) return false;
              const b = f.branche === "GENERALE" ? "MEMBRE" : (f.branche ?? "MEMBRE");
              return b === col.key;
            });
            return (
              <section key={col.key}>
                {/* ── En-tête de section ── */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "0.7rem",
                  padding: "0.6rem 1rem",
                  background: `${col.color}0e`,
                  border: `1px solid ${col.color}28`,
                  borderLeft: `4px solid ${col.color}`,
                  borderRadius: "var(--radius)",
                  marginBottom: "0.9rem",
                }}>
                  <span style={{ fontSize: "1.15rem", lineHeight: 1 }}>{col.emoji}</span>
                  <span style={{ fontSize: "0.90rem", fontWeight: 800, color: col.color, flex: 1, letterSpacing: "0.02em" }}>
                    {col.label}
                  </span>
                  <span style={{
                    fontSize: "0.70rem", fontWeight: 700,
                    background: `${col.color}1a`, color: col.color,
                    border: `1px solid ${col.color}38`,
                    padding: "0.10rem 0.52rem", borderRadius: 99,
                  }}>
                    {colItems.length} formation{colItems.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* ── Contenu selon le mode d'affichage ── */}
                {colItems.length === 0 ? (
                  <div style={{
                    padding: "1.6rem", textAlign: "center",
                    color: "var(--muted)", fontSize: "0.82rem",
                    border: "1px dashed var(--line-soft)", borderRadius: "var(--radius)",
                  }}>
                    Aucune formation dans cette section.
                  </div>
                ) : viewMode === "list" ? (
                  <DraggableBranchList
                    items={colItems}
                    colColor={col.color}
                    onReorder={(next) => handleReorder(col.key, next)}
                    onPublish={publish}
                    onUnpublish={unpublish}
                    onRemove={setRemoveTarget}
                    publishingId={publishingId}
                  />
                ) : viewMode === "grid" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "1rem" }}>
                    {colItems.map((f) => (
                      <FormationCard key={f.id} formation={f} onPublish={publish} onUnpublish={unpublish} onRemove={setRemoveTarget} publishingId={publishingId} />
                    ))}
                  </div>
                ) : (
                  <FormationsTable items={colItems} colColor={col.color} onPublish={publish} onUnpublish={unpublish} onRemove={setRemoveTarget} publishingId={publishingId} />
                )}
              </section>
            );
          })}

          {/* ── Section formations publiques ── */}
          {(() => {
            const publicItems = filtered.filter((f) => f.is_public);
            const publicColor = "#2e9460";
            return (
              <section>
                <div style={{
                  display: "flex", alignItems: "center", gap: "0.7rem",
                  padding: "0.6rem 1rem",
                  background: `${publicColor}0e`,
                  border: `1px solid ${publicColor}28`,
                  borderLeft: `4px solid ${publicColor}`,
                  borderRadius: "var(--radius)",
                  marginBottom: "0.9rem",
                }}>
                  <span style={{ fontSize: "1.15rem", lineHeight: 1 }}>🌐</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: "0.90rem", fontWeight: 800, color: publicColor, letterSpacing: "0.02em" }}>
                      Formations publiques
                    </span>
                    <div style={{ fontSize: "0.70rem", color: "var(--muted)", marginTop: "0.1rem" }}>
                      Accessibles à tous — aucun abonnement requis, pas de prérequis séquentiel
                    </div>
                  </div>
                  <span style={{
                    fontSize: "0.70rem", fontWeight: 700,
                    background: `${publicColor}1a`, color: publicColor,
                    border: `1px solid ${publicColor}38`,
                    padding: "0.10rem 0.52rem", borderRadius: 99,
                  }}>
                    {publicItems.length} formation{publicItems.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {publicItems.length === 0 ? (
                  <div style={{
                    padding: "1.6rem", textAlign: "center",
                    color: "var(--muted)", fontSize: "0.82rem",
                    border: "1px dashed var(--line-soft)", borderRadius: "var(--radius)",
                  }}>
                    Aucune formation publique. Créez une formation avec l'accès "Public".
                  </div>
                ) : viewMode === "grid" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "1rem" }}>
                    {publicItems.map((f) => (
                      <FormationCard key={f.id} formation={f} onPublish={publish} onUnpublish={unpublish} onRemove={setRemoveTarget} publishingId={publishingId} />
                    ))}
                  </div>
                ) : viewMode === "table" ? (
                  <FormationsTable items={publicItems} colColor={publicColor} onPublish={publish} onUnpublish={unpublish} onRemove={setRemoveTarget} publishingId={publishingId} />
                ) : (
                  <DraggableBranchList
                    items={publicItems}
                    colColor={publicColor}
                    onReorder={(next) => handleReorder("PUBLIC", next)}
                    onPublish={publish}
                    onUnpublish={unpublish}
                    onRemove={setRemoveTarget}
                    publishingId={publishingId}
                  />
                )}
              </section>
            );
          })()}
        </div>
      )}

      {/* ── Confirmation suppression définitive ── */}
      {removeTarget && (
        <ConfirmModal
          title="Supprimer cette formation ?"
          message={`« ${removeTarget.title} » sera supprimée définitivement avec tous ses chapitres, épisodes et quiz. Cette action est irréversible.`}
          confirmLabel="Supprimer définitivement"
          onClose={() => setRemoveTarget(null)}
          onConfirm={async () => {
            await doRemove(removeTarget);
            setRemoveTarget(null);
          }}
        />
      )}
    </div>
  );
}