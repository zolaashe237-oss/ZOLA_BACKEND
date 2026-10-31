"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  asList, courseApi, formationApi, moduleApi, quizApi, resourceApi,
} from "@/lib/endpoints";
import { getMediaUrl } from "@/lib/api";
import type {
  Branche, CourseItem, Formation, FormationAcces, FormationNiveau, FormationStatus,
  ModuleItem, QuizItem, ResourceItem,
} from "@/lib/types";
import { Alert, Button, ConfirmDialog, Input, Select, Textarea, errorMessage } from "@/components/ui";
import { QuizEditor } from "@/components/QuizEditor";
import { FormationCard, COVER_GRAD } from "@/components/FormationCard";
import { AIGenerateModal, AIGenerateResult, AIGenerateTarget } from "@/components/ai/AIGenerateModal";
import { AIReviewPanel } from "@/components/ai/AIReviewPanel";
import { YoutubeChapterImportModal } from "@/components/YoutubeChapterImportModal";
import { useToast } from "@/components/Toast";

type QuizTarget = { quiz: QuizItem | null; course?: number; formation?: number };

const STATUS_LABEL: Record<FormationStatus, string> = {
  DRAFT: "Brouillon", SCHEDULED: "Programmé", PUBLISHED: "Publié",
};
const STATUS_COLOR: Record<FormationStatus, string> = {
  DRAFT: "#a89b86", SCHEDULED: "#d9a441", PUBLISHED: "#5fb98a",
};

// ── Utilitaires YouTube ────────────────────────────────────────────────────────

function extractYoutubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([^&\s]+)/,
    /youtu\.be\/([^?&\s]+)/,
    /\/embed\/([^?&\s]+)/,
    /\/shorts\/([^?&\s]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function ytThumb(url: string): string {
  const id = extractYoutubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : "";
}

type ContentKind = "VIDEO" | "AUDIO" | "PDF";
type PendingEpisode = { moduleId: number; title: string; youtube: string; kind: ContentKind };

// ── Page principale ───────────────────────────────────────────────────────────

export default function FormationBuilderPage() {
  const { toast } = useToast();
  const { id } = useParams<{ id: string }>();
  const fid = Number(id);
  const router = useRouter();

  const [formation,         setFormation]         = useState<Formation | null>(null);
  const [modules,           setModules]           = useState<ModuleItem[]>([]);
  const [coursesByModule,   setCoursesByModule]   = useState<Record<number, CourseItem[]>>({});
  const [resourcesByCourse, setResourcesByCourse] = useState<Record<number, ResourceItem[]>>({});
  const [quizByCourse,      setQuizByCourse]      = useState<Record<number, QuizItem>>({});
  const [finalExam,         setFinalExam]         = useState<QuizItem | null>(null);
  const [quizTarget,        setQuizTarget]        = useState<QuizTarget | null>(null);
  const [aiTarget,          setAiTarget]          = useState<AIGenerateTarget | null>(null);
  const [aiResult,          setAiResult]          = useState<AIGenerateResult | null>(null);
  const [showMeta,          setShowMeta]          = useState(false);
  const [showYtImport,      setShowYtImport]      = useState(false);
  const [publishing,        setPublishing]        = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [showDeleteFormationConfirm, setShowDeleteFormationConfirm] = useState(false);
  const [deletingFormation,          setDeletingFormation]          = useState(false);
  const [showDeleteExamConfirm,      setShowDeleteExamConfirm]      = useState(false);
  const [deletingExam,               setDeletingExam]               = useState(false);

  // Metadata state (lifted)
  const [meta, setMeta] = useState({
    title: "", description: "", category: "FORMATION" as Formation["category"],
    niveau: "" as FormationNiveau | "", branche: "" as Branche | "",
    acces: "MEMBRES" as FormationAcces, status: "DRAFT" as FormationStatus,
    publish_at: "", price: "",
  });
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);

  // Drag state for chapters
  const draggingChapter = useRef<number | null>(null);
  const [dragOverChapter, setDragOverChapter] = useState<number | null>(null);

  // Pending state for real-time playlist preview
  const [pendingChapterTitle, setPendingChapterTitle] = useState("");
  const [pendingEpisode,      setPendingEpisode]      = useState<PendingEpisode | null>(null);

  const flash = (m: string) => { toast(m, "success"); };

  const publishFormation = async () => {
    setPublishing(true);
    try {
      await formationApi.publish(fid);
      flash("Formation publiée avec succès.");
      reload();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setPublishing(false); setShowPublishConfirm(false); }
  };

  const deleteFormation = async () => {
    setDeletingFormation(true);
    try {
      await formationApi.hardDelete(fid);
      router.push("/contenu");
    } catch (e) {
      toast(errorMessage(e), "error");
      setDeletingFormation(false);
      setShowDeleteFormationConfirm(false);
    }
  };

  const deleteExam = async () => {
    if (!finalExam) return;
    setDeletingExam(true);
    try {
      await quizApi.remove(finalExam.id);
      setFinalExam(null);
      flash("Examen final supprimé.");
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setDeletingExam(false); setShowDeleteExamConfirm(false); }
  };

  const reload = useCallback(async () => {
    try {
      const f = (await formationApi.detail(fid)).data;
      setFormation(f);
      setMeta({
        title: f.title,
        description: f.description,
        category: f.category,
        niveau: f.niveau ?? "",
        branche: f.branche ?? "",
        acces: f.is_public ? "PUBLIC" : f.access_subscription_types.length > 0 ? "PAYANTE" : "MEMBRES",
        status: f.status,
        publish_at: f.publish_at ? f.publish_at.slice(0, 16) : "",
        price: f.price ? String(f.price) : "",
      });
      const mods = asList((await moduleApi.list(fid)).data);
      setModules(mods);
      const courseEntries = await Promise.all(
        mods.map(async (m) => [m.id, asList((await courseApi.list(m.id)).data)] as const));
      const cbm = Object.fromEntries(courseEntries);
      setCoursesByModule(cbm);
      const allCourses = Object.values(cbm).flat();
      const resEntries = await Promise.all(
        allCourses.map(async (c) => [c.id, asList((await resourceApi.list(c.id)).data)] as const));
      setResourcesByCourse(Object.fromEntries(resEntries));
      const quizzes = asList((await quizApi.list(fid)).data);
      setQuizByCourse(
        Object.fromEntries(quizzes.filter((q) => q.course).map((q) => [q.course as number, q])));
      setFinalExam(quizzes.find((q) => q.formation) ?? null);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [fid, toast]);

  useEffect(() => { reload(); }, [reload]);

  const saveMeta = async () => {
    if (!formation) return;
    setSavingMeta(true);
    try {
      await formationApi.update(fid, {
        title: meta.title, description: meta.description, category: meta.category,
        // Un prix rend la formation payante (le backend applique la même règle).
        ...accesToApi(isPriced(meta) ? "PAYANTE" : meta.acces),
        price: isPriced(meta) ? Number(meta.price) : null,
        status: meta.status,
        publish_at: (() => {
          if (meta.status !== "SCHEDULED" || !meta.publish_at) return null;
          const d = new Date(meta.publish_at);
          return isNaN(d.getTime()) ? null : d.toISOString();
        })(),
        ...(meta.niveau  ? { niveau: meta.niveau }   : {}),
        ...(meta.branche ? { branche: meta.branche } : {}),
      });
      if (coverFile) {
        await formationApi.uploadCover(fid, coverFile);
        setCoverFile(null);
      }
      toast("Modifications de la formation enregistrées.", "success");
      reload();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setSavingMeta(false); }
  };

  if (!formation) return <p style={{ color: "var(--muted)" }}>Chargement…</p>;

  const hasChanges = formation.title !== meta.title ||
    formation.description !== meta.description ||
    formation.category !== meta.category ||
    (formation.niveau ?? "") !== meta.niveau ||
    (formation.branche ?? "") !== meta.branche ||
    (formation.is_public ? "PUBLIC" : formation.access_subscription_types.length > 0 ? "PAYANTE" : "MEMBRES") !== meta.acces ||
    formation.status !== meta.status ||
    (formation.price ? String(formation.price) : "") !== (meta.acces !== "PUBLIC" ? meta.price : "") ||
    !!coverFile;

  const rootModules = modules
    .filter((m) => m.parent === null)
    .sort((a, b) => a.order - b.order);

  const totalEpisodes = rootModules.reduce(
    (acc, m) => acc + (coursesByModule[m.id]?.length ?? 0), 0);

  const reorderChapters = async (dragId: number, targetId: number) => {
    if (dragId === targetId) return;
    const sorted = [...rootModules];
    const from = sorted.findIndex((m) => m.id === dragId);
    const to   = sorted.findIndex((m) => m.id === targetId);
    if (from === -1 || to === -1) return;
    const reordered = [...sorted];
    reordered.splice(to, 0, reordered.splice(from, 1)[0]);
    // Optimistic local update
    setModules((prev) => {
      const others = prev.filter((m) => m.parent !== null);
      return [...others, ...reordered.map((m, idx) => ({ ...m, order: idx + 1 }))];
    });
    try {
      await Promise.all(reordered.map((m, idx) => moduleApi.update(m.id, { order: idx + 1 })));
    } catch (e) { toast(errorMessage(e), "error"); reload(); }
  };

  return (
    <div className="fade-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <Link href="/contenu" style={{
          fontSize: ".83rem", color: "#8b6a3a", textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: "0.3rem",
        }}>
          ← Toutes les formations
        </Link>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            onClick={() => setShowDeleteFormationConfirm(true)}
            style={{
              background: "rgba(192,64,44,0.07)", color: "#b53a2a",
              border: "1px solid rgba(192,64,44,0.22)", borderRadius: 6,
              fontSize: "0.78rem", fontWeight: 600,
              padding: "0.38rem 0.85rem", cursor: "pointer",
            }}
          >
            🗑 Supprimer
          </button>
          {formation.status !== "PUBLISHED" && (
            <Button
              variant="ghost"
              loading={publishing}
              onClick={() => setShowPublishConfirm(true)}
              style={{ padding: "0.4rem 1.1rem", color: "#2e9460", borderColor: "#2e946040" }}
            >
              ✓ Publier
            </Button>
          )}
          <Button onClick={saveMeta} loading={savingMeta} disabled={!hasChanges} style={{ padding: "0.4rem 1.2rem" }}>
            Enregistrer les modifications
          </Button>
        </div>
      </div>

      {/* ── Header formation ── */}
      <div style={{
        background: "#fff", border: "1px solid #e8dfc8",
        borderRadius: "var(--radius)", padding: "1.4rem 1.6rem",
        marginTop: "0.25rem", marginBottom: "1rem",
      }}>
        <span style={{
          fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: STATUS_COLOR[formation.status],
          background: `${STATUS_COLOR[formation.status]}18`,
          border: `1px solid ${STATUS_COLOR[formation.status]}40`,
          padding: "0.14rem 0.48rem", borderRadius: 99,
        }}>
          {STATUS_LABEL[formation.status]}
        </span>

        <h1 style={{
          fontSize: "1.45rem", fontWeight: 800, color: "#2a1800",
          margin: "0.5rem 0 0.45rem", lineHeight: 1.25,
        }}>
          {formation.title}
        </h1>

        {formation.description && (
          <p style={{ fontSize: "0.88rem", color: "#6b5a3e", lineHeight: 1.65, margin: "0 0 0.85rem" }}>
            {formation.description}
          </p>
        )}

        <div style={{
          display: "flex", flexWrap: "wrap", gap: "1.4rem",
          fontSize: "0.84rem", color: "#3a2510",
          borderTop: "1px solid #f0e8d4", paddingTop: "0.75rem",
        }}>
          {[
            { n: rootModules.length,   label: rootModules.length  !== 1 ? "chapitres" : "chapitre" },
            { n: totalEpisodes,         label: totalEpisodes       !== 1 ? "épisodes"  : "épisode"  },
            { n: formation.nb_gratuits, label: formation.nb_gratuits !== 1 ? "gratuits" : "gratuit" },
          ].map(({ n, label }) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "baseline", gap: "0.35rem" }}>
              <strong style={{ color: "#8b2c2c", fontSize: "1.1rem", fontWeight: 800 }}>{n}</strong>
              <span style={{ color: "#6b5a3e" }}>{label}</span>
            </span>
          ))}
        </div>

        <button
          onClick={() => setShowMeta(!showMeta)}
          style={{
            marginTop: "0.85rem", background: "none",
            border: "1px solid #e8dfc8", borderRadius: 6,
            padding: "0.30rem 0.78rem",
            fontSize: "0.76rem", fontWeight: 600, color: "#8b6a3a",
            cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.38rem",
          }}
        >
          ⚙ Paramètres {showMeta ? "▴" : "▾"}
        </button>

        {showMeta && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid #f0e8d4", paddingTop: "1rem" }}>
            <FormationMeta
              formation={formation}
              meta={meta}
              setMeta={setMeta}
              coverFile={coverFile}
              setCoverFile={setCoverFile}
              onSaved={reload}
              onError={(s) => toast(s, "error")}
              onInfo={flash}
            />
          </div>
        )}
      </div>

      {/* ── Builder + Aperçu Playlist ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 320px",
        gap: "1.1rem", alignItems: "start", marginBottom: "0.9rem",
      }}>
        {/* ── Builder (gauche) ── */}
        <div style={{
          background: "#fff", border: "1px solid #e8dfc8",
          borderRadius: "var(--radius)", overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0.85rem 1.1rem", borderBottom: "1px solid #f0e8d4",
          }}>
            <div>
              <span style={{ fontSize: "1rem", fontWeight: 700, color: "#2a1800" }}>Chapitres & épisodes</span>
              <span style={{ fontSize: "0.84rem", color: "#8b6a3a", marginLeft: "0.5rem" }}>
                · {totalEpisodes} épisode{totalEpisodes !== 1 ? "s" : ""}
              </span>
            </div>
            <span style={{ fontSize: "0.72rem", color: "#a0907a" }}>
              Glisser ⠿ pour réordonner
            </span>
          </div>

          <div style={{ padding: "0.6rem 1rem", borderBottom: "1px solid #f5ede0" }}>
            <AddChapterForm
              formationId={fid} modules={modules}
              onSaved={() => { setPendingChapterTitle(""); reload(); }}
              onError={(s) => toast(s, "error")} onInfo={flash}
              onTitleChange={setPendingChapterTitle}
              onYoutubeImport={() => setShowYtImport(true)}
            />
          </div>

          {rootModules.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem", color: "#a0907a", fontSize: "0.85rem" }}>
              Aucun chapitre. Commencez par en ajouter un ci-dessus.
            </div>
          ) : (
            rootModules.map((m, chapterIdx) => {
              const courses = (coursesByModule[m.id] ?? []).sort((a, b) => a.order - b.order);
              const episodeOffset = rootModules
                .slice(0, chapterIdx)
                .reduce((acc, prev) => acc + (coursesByModule[prev.id]?.length ?? 0), 0);
              const chapterQuiz = courses.map((c) => quizByCourse[c.id]).find(Boolean) ?? null;
              const isDragOver = dragOverChapter === m.id;

              return (
                <div
                  key={m.id}
                  draggable
                  onDragStart={() => { draggingChapter.current = m.id; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverChapter(m.id); }}
                  onDrop={() => {
                    if (draggingChapter.current !== null) reorderChapters(draggingChapter.current, m.id);
                    draggingChapter.current = null; setDragOverChapter(null);
                  }}
                  onDragEnd={() => { draggingChapter.current = null; setDragOverChapter(null); }}
                  style={{
                    borderBottom: chapterIdx === rootModules.length - 1 ? "none" : "1px solid #f0e8d4",
                    borderLeft: isDragOver ? "3px solid #c9a227" : "3px solid transparent",
                    background: isDragOver ? "#fffbf0" : "transparent",
                    transition: "border-color .12s, background .12s",
                  }}
                >
                  <ChapterCard
                    formation={formation}
                    module={m}
                    chapterIndex={chapterIdx + 1}
                    episodeOffset={episodeOffset}
                    courses={courses}
                    chapterQuiz={chapterQuiz}
                    resourcesByCourse={resourcesByCourse}
                    onReload={reload}
                    onError={(s) => toast(s, "error")}
                    onInfo={flash}
                    onQuiz={setQuizTarget}
                    onAiGenerate={setAiTarget}
                    onEpisodeChange={(ep) => setPendingEpisode(ep)}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* ── Aperçu Playlist (droite, sticky) ── */}
        <PlaylistPreview
          formation={formation}
          rootModules={rootModules}
          coursesByModule={coursesByModule}
          resourcesByCourse={resourcesByCourse}
          quizByCourse={quizByCourse}
          totalEpisodes={totalEpisodes}
          finalExam={finalExam}
          pendingChapterTitle={pendingChapterTitle}
          pendingEpisode={pendingEpisode}
        />
      </div>

      {/* ── Examen final ── */}
      <div style={{
        background: "#fff", border: "1px solid #c9a22744",
        borderRadius: "var(--radius)", padding: "0.9rem 1.1rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "0.6rem", flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <span style={{
            width: 34, height: 34, borderRadius: 7,
            background: "#c9a22718", border: "1px solid #c9a22740",
            color: "#c9a227",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem",
            flexShrink: 0,
          }}>🏅</span>
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#2a1800" }}>Examen final</div>
            <div style={{ fontSize: "0.76rem", color: "#8b6a3a" }}>
              {finalExam
                ? `${finalExam.questions.length} question${finalExam.questions.length !== 1 ? "s" : ""} — seuil ${finalExam.pass_threshold}/20`
                : "Aucun examen final défini."}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
          {finalExam && (
            <button
              onClick={() => setShowDeleteExamConfirm(true)}
              style={{
                background: "rgba(192,64,44,0.07)", color: "#b53a2a",
                border: "1px solid rgba(192,64,44,0.22)", borderRadius: 6,
                fontSize: "0.78rem", fontWeight: 600, padding: "0.34rem 0.7rem", cursor: "pointer",
              }}
            >
              🗑
            </button>
          )}
          <button
            onClick={() => setQuizTarget({ quiz: finalExam, formation: fid })}
            style={{
              background: "rgba(201,162,39,0.10)", color: "#7a5a1a",
              border: "1px solid rgba(201,162,39,0.32)", borderRadius: 6,
              fontSize: "0.78rem", fontWeight: 600, padding: "0.34rem 0.82rem", cursor: "pointer",
            }}
          >
            {finalExam ? "Modifier l'examen" : "Ajouter un examen final"}
          </button>
          <button
            onClick={() => formation && setAiTarget({
              formationId: fid,
              formationTitle: formation.title,
              courseId: null,
              contextLabel: "Examen final de la formation",
            })}
            style={{
              background: "rgba(201,162,39,0.18)", color: "#7a5a1a",
              border: "1px solid rgba(201,162,39,0.45)", borderRadius: 6,
              fontSize: "0.78rem", fontWeight: 700, padding: "0.34rem 0.82rem", cursor: "pointer",
            }}
          >
            {finalExam ? "✨ Régénérer" : "✨ Générer quiz"}
          </button>
        </div>
      </div>

      {/* ── Publication ── */}
      <div style={{
        marginTop: "0.75rem",
        padding: "1rem 1.25rem",
        background: formation.status === "PUBLISHED" ? "#f0faf5" : "#fff",
        border: `1px solid ${formation.status === "PUBLISHED" ? "#2e946040" : "#e8dfc8"}`,
        borderRadius: "var(--radius)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: "0.88rem", fontWeight: 700, color: formation.status === "PUBLISHED" ? "#2e9460" : "#2a1800" }}>
            {formation.status === "PUBLISHED" ? "✓ Formation publiée" : formation.status === "SCHEDULED" ? "⏱ Publication programmée" : "Brouillon — non visible par les membres"}
          </div>
          <div style={{ fontSize: "0.74rem", color: "#8b6a3a", marginTop: "0.2rem" }}>
            {formation.status === "PUBLISHED"
              ? "Visible dans le catalogue. Modifiez les paramètres pour dépublier."
              : formation.status === "SCHEDULED" && formation.publish_at
              ? `Mise en ligne prévue le ${new Date(formation.publish_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.`
              : "Cliquez sur « Publier » pour rendre cette formation accessible aux membres."}
          </div>
        </div>
        {formation.status !== "PUBLISHED" && (
          <Button loading={publishing} onClick={() => setShowPublishConfirm(true)}>
            ✓ Publier la formation
          </Button>
        )}
      </div>

      {showYtImport && formation && (
        <YoutubeChapterImportModal
          formationId={fid}
          formationTitle={formation.title}
          onClose={() => setShowYtImport(false)}
          onImported={(msg) => { setShowYtImport(false); flash(msg); reload(); }}
        />
      )}

      {quizTarget && (
        <QuizEditor
          quiz={quizTarget.quiz}
          course={quizTarget.course}
          formation={quizTarget.formation}
          onClose={() => setQuizTarget(null)}
          onSaved={() => { setQuizTarget(null); reload(); }}
        />
      )}

      {aiTarget && !aiResult && formation && (
        <AIGenerateModal
          formations={[formation]}
          preset={aiTarget}
          onClose={() => setAiTarget(null)}
          onGenerated={(result) => { setAiTarget(null); setAiResult(result); }}
        />
      )}

      {aiResult && formation && (
        <AIReviewPanel
          initialQuestions={aiResult.questions}
          config={aiResult.config}
          niveauSuggere={aiResult.niveauSuggere}
          rangSuggere={aiResult.rangSuggere}
          targetFormationId={aiResult.targetFormationId}
          targetCourseId={aiResult.targetCourseId}
          targetBranche={formation.branche ?? null}
          onClose={() => setAiResult(null)}
          onPublished={(msg) => { setAiResult(null); flash(msg); reload(); }}
        />
      )}

      <ConfirmDialog
        open={showPublishConfirm}
        title="Publier cette formation ?"
        body="Elle sera immédiatement visible par les membres. Cette action peut être annulée en repassant la formation en brouillon."
        confirmLabel="Publier"
        loading={publishing}
        onConfirm={publishFormation}
        onCancel={() => setShowPublishConfirm(false)}
      />

      <ConfirmDialog
        open={showDeleteFormationConfirm}
        title={`Supprimer « ${formation.title} » ?`}
        body="Cette action est irréversible. La formation, tous ses chapitres, épisodes, ressources et quiz seront définitivement supprimés."
        confirmLabel="Supprimer définitivement"
        danger
        loading={deletingFormation}
        onConfirm={deleteFormation}
        onCancel={() => setShowDeleteFormationConfirm(false)}
      />

      <ConfirmDialog
        open={showDeleteExamConfirm}
        title="Supprimer l'examen final ?"
        body="Le quiz de l'examen final sera définitivement supprimé. Vous pourrez en créer un nouveau ultérieurement."
        confirmLabel="Supprimer l'examen"
        danger
        loading={deletingExam}
        onConfirm={deleteExam}
        onCancel={() => setShowDeleteExamConfirm(false)}
      />
    </div>
  );
}

// ── Helpers accès ─────────────────────────────────────────────────────────────

/** Prix à l'unité saisi (formation non publique) : la formation sera payante. */
function isPriced(m: { acces: FormationAcces; price: string }) {
  return m.acces !== "PUBLIC" && Number(m.price) > 0;
}

function accesToApi(acces: FormationAcces) {
  return {
    access_subscription_types: (acces === "PAYANTE" ? ["MEMBRE"] : []) as ("MEMBRE")[],
    is_public: acces === "PUBLIC",
  };
}

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
              background: active ? `${o.color}12` : "var(--bg-2)", cursor: "pointer", transition: "all .14s",
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

// ── Paramètres de la formation ────────────────────────────────────────────────

function FormationMeta({
  formation, meta, setMeta, coverFile, setCoverFile, onSaved, onError, onInfo,
}: {
  formation: Formation;
  meta: any;
  setMeta: (m: any) => void;
  coverFile: File | null;
  setCoverFile: (f: File | null) => void;
  onSaved: () => void;
  onError: (s: string) => void;
  onInfo:  (s: string) => void;
}) {
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const coverRef = useRef<HTMLInputElement>(null);

  const pickCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    const url = URL.createObjectURL(file);
    setCoverFile(file); setCoverPreviewUrl(url);
    e.target.value = "";
  };

  const displayCoverUrl = coverPreviewUrl || formation.cover_url;

  const publish = async () => {
    onError("");
    try { await formationApi.publish(formation.id); onInfo("Formation publiée."); onSaved(); }
    catch (e) { onError(errorMessage(e)); }
  };

  const preview: Formation = {
    ...formation,
    title:       meta.title.trim() || "Titre de la formation",
    description: meta.description.trim(),
    category:    meta.category,
    access_subscription_types: accesToApi(meta.acces).access_subscription_types as ("MEMBRE")[],
    is_public:   accesToApi(meta.acces).is_public,
    ...(isPriced(meta) ? accesToApi("PAYANTE") : {}),
    price:       isPriced(meta) ? Number(meta.price) : null,
    cover_url:   displayCoverUrl,
    status:      meta.status,
    publish_at: (() => {
      if (meta.status !== "SCHEDULED" || !meta.publish_at) return null;
      const d = new Date(meta.publish_at);
      return isNaN(d.getTime()) ? null : d.toISOString();
    })(),
    niveau:  meta.niveau  || null,
    branche: meta.branche || null,
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(260px, 300px)", gap: "1.5rem", alignItems: "start" }}>
      <div>
        {/* ── Couverture ── */}
        <div style={{ marginBottom: "0.9rem" }}>
          <div style={{
            fontSize: "0.75rem", fontWeight: 600, color: "#8b6a3a",
            marginBottom: "0.35rem", letterSpacing: "0.04em",
          }}>
            Image de couverture
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div
              onClick={() => coverRef.current?.click()}
              style={{
                width: 120, height: 72, flexShrink: 0,
                borderRadius: 7, overflow: "hidden",
                border: `2px dashed ${displayCoverUrl ? "#c9a22760" : "#d0c8b880"}`,
                background: displayCoverUrl
                  ? `center/cover no-repeat url(${getMediaUrl(displayCoverUrl)})`
                  : "rgba(201,162,39,0.04)",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                position: "relative",
                transition: "border-color .15s",
              }}
            >
              {!displayCoverUrl && (
                <span style={{ fontSize: "1.3rem", opacity: 0.4 }}>🖼</span>
              )}
              {displayCoverUrl && (
                <div style={{
                  position: "absolute", inset: 0,
                  background: "rgba(20,10,0,0.40)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: 0, transition: "opacity .15s",
                }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "0"; }}
                >
                  <span style={{ fontSize: "1rem", color: "#fff" }}>✎</span>
                </div>
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                style={{
                  background: "rgba(139,106,58,0.08)",
                  border: "1px solid #e8dfc8", borderRadius: 6,
                  fontSize: "0.76rem", fontWeight: 600, color: "#8b6a3a",
                  padding: "0.28rem 0.7rem", cursor: "pointer", display: "block",
                  marginBottom: "0.3rem",
                }}
              >
                {displayCoverUrl ? "Changer l'image" : "Ajouter une image"}
              </button>
              <div style={{ fontSize: "0.68rem", color: "#c0a880" }}>
                JPG, PNG, WebP — recommandé 1280×720
              </div>
              {coverFile && (
                <div style={{ fontSize: "0.68rem", color: "#5fb98a", marginTop: "0.2rem" }}>
                  ✓ {coverFile.name} — sera envoyée à l&apos;enregistrement
                </div>
              )}
            </div>
          </div>
          <input ref={coverRef} type="file" accept="image/*"
                 style={{ display: "none" }} onChange={pickCover} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: ".8rem" }}>
          <Input label="Titre" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          <Select label="Catégorie" value={meta.category}
                  onChange={(e) => setMeta({ ...meta, category: e.target.value as Formation["category"] })}>
            <option value="FORMATION">Formation</option>
            <option value="LIVRE">Bibliothèque</option>
            <option value="LIBRE">Accès libre</option>
          </Select>
        </div>
        <Textarea
          label="Description" value={meta.description} maxLength={600}
          placeholder="Présentez le contenu, les objectifs et ce que les membres apprendront…"
          onChange={(e) => setMeta({ ...meta, description: e.target.value })}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".8rem" }}>
          <Select label="Niveau" value={meta.niveau}
                  onChange={(e) => setMeta({ ...meta, niveau: e.target.value as FormationNiveau | "" })}>
            <option value="">— Niveau —</option>
            <option value="DEBUTANT">Débutant</option>
            <option value="INTERMEDIAIRE">Intermédiaire</option>
            <option value="AVANCE">Avancé</option>
          </Select>
          <Select label="Branche" value={meta.branche}
                  onChange={(e) => setMeta({ ...meta, branche: e.target.value as Branche | "" })}>
            <option value="">— Branche —</option>
            <option value="MEMBRE">Membres</option>
            <option value="FEMME">Femme</option>
            <option value="ENFANT">Enfant</option>
          </Select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".8rem" }}>
          <Select label="Publication" value={meta.status}
                  onChange={(e) => setMeta({ ...meta, status: e.target.value as FormationStatus })}>
            <option value="DRAFT">Brouillon</option>
            <option value="SCHEDULED">Programmé</option>
            <option value="PUBLISHED">Publié</option>
          </Select>
          {meta.status === "SCHEDULED" && (
            <Input label="Date de mise en ligne" type="datetime-local" value={meta.publish_at}
                   onChange={(e) => setMeta({ ...meta, publish_at: e.target.value })} />
          )}
        </div>
        <AccesSelector value={meta.acces} onChange={(v) => setMeta({ ...meta, acces: v })} />
        {meta.acces !== "PUBLIC" && (
          <div style={{ marginBottom: "1rem" }}>
            <Input
              label="Prix à l'unité (FCFA)"
              type="number" min={0} step={500} placeholder="Ex. 15000 — vide = non vendue seule"
              value={meta.price}
              onChange={(e) => setMeta({ ...meta, price: e.target.value })}
              style={{ marginBottom: 0 }}
            />
            <p style={{ margin: "-0.5rem 0 0", fontSize: "0.72rem", color: "var(--muted-2)", lineHeight: 1.5 }}>
              {meta.acces === "MEMBRES" && Number(meta.price) > 0 ? (
                <>Mettre un prix passe cette formation en accès <strong>Payant</strong> : les abonnés y gardent
                accès, les autres membres peuvent l&apos;acheter seule.</>
              ) : (
                <>Les membres sans abonnement peuvent acheter cette formation seule et la suivre sans limite de durée.
                Laissez vide pour la réserver aux abonnés.</>
              )}
            </p>
          </div>
        )}
        <div style={{ display: "flex", gap: ".5rem" }}>
          {formation.status !== "PUBLISHED" && (
            <Button variant="ghost" onClick={publish} style={{ fontSize: "0.78rem" }}>Publier maintenant</Button>
          )}
        </div>
      </div>
      <div>
        <div style={{
          fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.12em",
          textTransform: "uppercase", color: "#a0907a",
          marginBottom: "0.55rem", display: "flex", alignItems: "center", gap: "0.4rem",
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#5fb98a", display: "inline-block",
            boxShadow: "0 0 0 3px rgba(95,185,138,0.25)",
          }} />
          Aperçu en temps réel
        </div>
        <FormationCard formation={preview} onPublish={() => {}} onRemove={() => {}} preview />
      </div>
    </div>
  );
}

// ── Ajout de chapitre ─────────────────────────────────────────────────────────

function AddChapterForm({ formationId, modules, onSaved, onError, onInfo, onTitleChange, onYoutubeImport }: {
  formationId: number; modules: ModuleItem[];
  onSaved: () => void; onError: (s: string) => void; onInfo: (s: string) => void;
  onTitleChange?: (title: string) => void;
  onYoutubeImport?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const setTitleAndNotify = (v: string) => {
    setTitle(v);
    onTitleChange?.(v);
  };

  const add = async () => {
    if (!title.trim() || busy) return;
    onError(""); setBusy(true);
    try {
      const order = modules.filter((m) => m.parent === null).length + 1;
      await moduleApi.create({ formation: formationId, title, order, parent: null });
      onInfo(`Chapitre « ${title} » ajouté.`);
      setTitleAndNotify(""); onSaved();
    } catch (e) { onError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
      <input className="input" style={{ flex: 1, fontSize: "0.83rem" }} value={title}
             placeholder="Titre du nouveau chapitre…"
             onChange={(e) => setTitleAndNotify(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
      <Button type="button" variant="ghost" onClick={add} loading={busy} disabled={!title.trim()}>
        + Chapitre
      </Button>
      {onYoutubeImport && (
        <button
          type="button"
          onClick={onYoutubeImport}
          title="Importer un chapitre depuis une playlist YouTube"
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            fontSize: "0.76rem", fontWeight: 600,
            color: "#d4673a", background: "#d4673a0e",
            border: "1px solid #d4673a35", borderRadius: 6,
            padding: "0.32rem 0.7rem", cursor: "pointer", flexShrink: 0,
            transition: "background .12s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#d4673a1a"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#d4673a0e"; }}
        >
          ▶ YouTube
        </button>
      )}
    </div>
  );
}

// ── Section chapitre ──────────────────────────────────────────────────────────

function ChapterCard({
  formation, module, chapterIndex, episodeOffset, courses, chapterQuiz, resourcesByCourse,
  onReload, onError, onInfo, onQuiz, onAiGenerate, onEpisodeChange,
}: {
  formation:         Formation;
  module:            ModuleItem;
  chapterIndex:      number;
  episodeOffset:     number;
  courses:           CourseItem[];
  chapterQuiz:       QuizItem | null;
  resourcesByCourse: Record<number, ResourceItem[]>;
  onReload: () => void; onError: (s: string) => void; onInfo: (s: string) => void;
  onQuiz:         (t: QuizTarget) => void;
  onAiGenerate:   (target: AIGenerateTarget) => void;
  onEpisodeChange?: (ep: PendingEpisode | null) => void;
}) {
  const draggingEp = useRef<number | null>(null);
  const [dragOverEp,            setDragOverEp]            = useState<number | null>(null);
  const [editingTitle,          setEditingTitle]          = useState(false);
  const [chapterTitle,          setChapterTitle]          = useState(module.title);
  const [savingTitle,           setSavingTitle]           = useState(false);
  const [showDelChapterConfirm, setShowDelChapterConfirm] = useState(false);
  const [showDelQuizConfirm,    setShowDelQuizConfirm]    = useState(false);
  const [deletingQuiz,          setDeletingQuiz]          = useState(false);

  const delChapter = async () => {
    try { await moduleApi.remove(module.id); onInfo("Chapitre supprimé."); onReload(); }
    catch (e) { onError(errorMessage(e)); }
    finally { setShowDelChapterConfirm(false); }
  };

  const delChapterQuiz = async () => {
    if (!chapterQuiz) return;
    setDeletingQuiz(true);
    try { await quizApi.remove(chapterQuiz.id); onInfo("Quiz du chapitre supprimé."); onReload(); }
    catch (e) { onError(errorMessage(e)); }
    finally { setDeletingQuiz(false); setShowDelQuizConfirm(false); }
  };

  const saveChapterTitle = async () => {
    if (!chapterTitle.trim() || chapterTitle === module.title) { setEditingTitle(false); return; }
    setSavingTitle(true);
    try {
      await moduleApi.update(module.id, { title: chapterTitle.trim() });
      onReload(); setEditingTitle(false);
    } catch (e) { onError(errorMessage(e)); }
    finally { setSavingTitle(false); }
  };

  const reorderEpisodes = async (dragId: number, targetId: number) => {
    if (dragId === targetId) return;
    const sorted = [...courses];
    const from = sorted.findIndex((c) => c.id === dragId);
    const to   = sorted.findIndex((c) => c.id === targetId);
    if (from === -1 || to === -1) return;
    const reordered = [...sorted];
    reordered.splice(to, 0, reordered.splice(from, 1)[0]);
    try {
      await Promise.all(reordered.map((c, idx) => courseApi.update(c.id, { order: idx + 1 })));
      onReload();
    } catch (e) { onError(errorMessage(e)); }
  };

  return (
    <div>
      {/* Chapter header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.55rem 1.1rem",
        background: "#faf5ec", borderBottom: "1px solid #f0e8d4",
        cursor: editingTitle ? "default" : "grab",
      }}>
        <span style={{ color: "#c8b89a", fontSize: "1rem", lineHeight: 1, flexShrink: 0 }}>⠿</span>
        <span style={{
          fontSize: "0.67rem", fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "#8b6a3a", flexShrink: 0, whiteSpace: "nowrap",
        }}>
          Chap. {chapterIndex} —
        </span>
        {editingTitle ? (
          <input
            autoFocus
            value={chapterTitle}
            onChange={(e) => setChapterTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveChapterTitle(); if (e.key === "Escape") { setChapterTitle(module.title); setEditingTitle(false); } }}
            onBlur={saveChapterTitle}
            disabled={savingTitle}
            style={{
              flex: 1, fontSize: "0.78rem", fontWeight: 700, color: "#8b2c2c",
              letterSpacing: "0.08em", textTransform: "uppercase",
              border: "1px solid #c9a227", borderRadius: 4,
              padding: "0.12rem 0.4rem", outline: "none",
              background: "#fffbf0",
            }}
          />
        ) : (
          <span
            onClick={() => { setChapterTitle(module.title); setEditingTitle(true); }}
            title="Cliquer pour modifier le titre"
            style={{
              flex: 1, fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "#8b2c2c",
              cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              borderBottom: "1px dashed transparent",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "#c9a22770"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "transparent"; }}
          >
            {module.title}
          </span>
        )}
        {/* is_gratuit toggle */}
        <button
          type="button"
          title={module.is_gratuit ? "Aperçu gratuit activé — cliquer pour retirer" : "Proposer ce chapitre en aperçu gratuit"}
          onClick={async () => {
            try { await moduleApi.update(module.id, { is_gratuit: !module.is_gratuit }); onReload(); }
            catch (e) { onError(errorMessage(e)); }
          }}
          style={{
            fontSize: "0.60rem", fontWeight: 700,
            padding: "0.10rem 0.38rem", borderRadius: 4,
            border: module.is_gratuit ? "1px solid #2e946040" : "1px solid rgba(160,144,122,0.22)",
            background: module.is_gratuit ? "#2e946018" : "rgba(160,144,122,0.06)",
            color: module.is_gratuit ? "#2e9460" : "#a0907a",
            cursor: "pointer", flexShrink: 0, transition: "all .14s",
          }}
        >
          {module.is_gratuit ? "✓ GRATUIT" : "Gratuit ?"}
        </button>
        <button
          onClick={() => setShowDelChapterConfirm(true)}
          style={{ background: "none", border: "none", color: "#b0977a", cursor: "pointer", fontSize: "0.73rem", flexShrink: 0 }}
        >
          Supprimer
        </button>
      </div>

      {/* Episodes */}
      <div style={{ padding: "0 0.8rem" }}>
        {courses.length === 0 && (
          <p style={{ fontSize: "0.80rem", color: "#a0907a", padding: "0.5rem 0.2rem", fontStyle: "italic" }}>
            Aucun épisode — ajoutez-en un ci-dessous.
          </p>
        )}
        {courses.map((c, idx) => {
          const isOver = dragOverEp === c.id;
          return (
            <div
              key={c.id}
              draggable
              onDragStart={(e) => { e.stopPropagation(); draggingEp.current = c.id; }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverEp(c.id); }}
              onDrop={(e) => {
                e.stopPropagation();
                if (draggingEp.current !== null) reorderEpisodes(draggingEp.current, c.id);
                draggingEp.current = null; setDragOverEp(null);
              }}
              onDragEnd={(e) => { e.stopPropagation(); draggingEp.current = null; setDragOverEp(null); }}
              style={{
                borderBottom: idx === courses.length - 1 ? "none" : "1px solid #f5ede0",
                borderLeft: isOver ? "2px solid #c9a227" : "2px solid transparent",
                background: isOver ? "#fffbf0" : "transparent",
                transition: "border-color .1s, background .1s",
              }}
            >
              <EpisodeItem
                course={c}
                episodeNumber={episodeOffset + idx + 1}
                resources={resourcesByCourse[c.id] ?? []}
                onReload={onReload}
                onError={onError}
                onInfo={onInfo}
              />
            </div>
          );
        })}

        <AddEpisodeInline
          moduleId={module.id} count={courses.length}
          onSaved={() => { onEpisodeChange?.(null); onReload(); }}
          onError={onError} onInfo={onInfo}
          onEpisodeChange={(title, youtube, kind) =>
            onEpisodeChange?.(title ? { moduleId: module.id, title, youtube, kind } : null)
          }
        />
      </div>

      {/* Passer le quiz du chapitre */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.55rem",
        padding: "0.6rem 1rem",
        background: "#fdf9f0",
        borderTop: "1px solid #f0e8d4",
      }}>
        <span style={{
          width: 30, height: 30, borderRadius: 6, flexShrink: 0,
          background: chapterQuiz ? "#c9a22720" : "rgba(168,155,134,0.10)",
          border: `1px solid ${chapterQuiz ? "#c9a22740" : "rgba(168,155,134,0.20)"}`,
          color: chapterQuiz ? "#c9a227" : "#c0a880",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "0.88rem",
        }}>
          {chapterQuiz ? "◆" : "◇"}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.79rem", fontWeight: 600, color: chapterQuiz ? "#2a1800" : "#a0907a" }}>
            Passer le quiz du chapitre
          </div>
          {chapterQuiz ? (
            <div style={{ fontSize: "0.68rem", color: "#8b6a3a" }}>
              {chapterQuiz.questions.length} question{chapterQuiz.questions.length !== 1 ? "s" : ""}
              {" — "}seuil {chapterQuiz.pass_threshold}/20
            </div>
          ) : (
            <div style={{ fontSize: "0.68rem", color: "#c0a880", fontStyle: "italic" }}>
              Aucun quiz — les membres passent directement au chapitre suivant
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
          {chapterQuiz && (
            <button
              onClick={() => setShowDelQuizConfirm(true)}
              title="Supprimer ce quiz"
              style={{
                background: "rgba(192,64,44,0.07)", color: "#b53a2a",
                border: "1px solid rgba(192,64,44,0.22)", borderRadius: 6,
                width: 28, height: 28, cursor: "pointer", fontSize: "0.78rem",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              🗑
            </button>
          )}
          <button
            onClick={() => {
              if (courses.length === 0) { onInfo("Ajoutez d'abord un épisode avant d'ajouter un quiz."); return; }
              onQuiz({ quiz: chapterQuiz, course: courses[0].id });
            }}
            style={{
              background: chapterQuiz ? "rgba(201,162,39,0.10)" : "rgba(139,106,58,0.08)",
              color: chapterQuiz ? "#7a5a1a" : "#8b6a3a",
              border: `1px solid ${chapterQuiz ? "rgba(201,162,39,0.30)" : "#e8dfc8"}`,
              borderRadius: 6, fontSize: "0.74rem", fontWeight: 600,
              padding: "0.28rem 0.7rem", cursor: "pointer",
            }}
          >
            {chapterQuiz ? "Modifier" : "+ Quiz"}
          </button>
          <button
            onClick={() => {
              if (courses.length === 0) { onInfo("Ajoutez d'abord un épisode avant de générer un quiz IA."); return; }
              onAiGenerate({
                formationId:    formation.id,
                formationTitle: formation.title,
                courseId:       courses[0].id,
                contextLabel:   module.title,
              });
            }}
            style={{
              background: "rgba(201,162,39,0.18)", color: "#7a5a1a",
              border: "1px solid rgba(201,162,39,0.45)", borderRadius: 6,
              fontSize: "0.74rem", fontWeight: 700,
              padding: "0.28rem 0.7rem", cursor: "pointer",
            }}
          >
            {chapterQuiz ? "✨ Régénérer" : "✨ Générer quiz"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showDelQuizConfirm}
        title="Supprimer le quiz du chapitre ?"
        body="Le quiz et toutes ses questions seront définitivement supprimés."
        confirmLabel="Supprimer"
        danger
        loading={deletingQuiz}
        onConfirm={delChapterQuiz}
        onCancel={() => setShowDelQuizConfirm(false)}
      />

      <ConfirmDialog
        open={showDelChapterConfirm}
        title={`Supprimer « ${module.title} » ?`}
        body="Ce chapitre et tous ses épisodes seront définitivement supprimés."
        confirmLabel="Supprimer"
        danger
        onConfirm={delChapter}
        onCancel={() => setShowDelChapterConfirm(false)}
      />
    </div>
  );
}

// ── Épisode (ligne) ───────────────────────────────────────────────────────────

function EpisodeItem({
  course, episodeNumber, resources, onReload, onError, onInfo,
}: {
  course:        CourseItem;
  episodeNumber: number;
  resources:     ResourceItem[];
  onReload: () => void; onError: (s: string) => void; onInfo: (s: string) => void;
}) {
  const [editingTitle,    setEditingTitle]    = useState(false);
  const [newTitle,        setNewTitle]        = useState(course.title);
  const [showAddForm,     setShowAddForm]     = useState(false);
  const [addKind,         setAddKind]         = useState<ContentKind>("VIDEO");
  const [ytUrl,           setYtUrl]           = useState("");
  const [mediaFile,       setMediaFile]       = useState<File | null>(null);
  const [savingUrl,       setSavingUrl]       = useState(false);
  const [showDelEpConfirm, setShowDelEpConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const videoRes  = resources.find((r) => r.resource_type === "VIDEO");
  const audioRes  = resources.find((r) => r.resource_type === "AUDIO");
  const pdfRes    = resources.find((r) => r.resource_type === "PDF");
  const youtubeUrl = videoRes?.video_source === "YOUTUBE" ? videoRes.youtube_url : null;

  const del = async () => {
    try { await courseApi.remove(course.id); onInfo("Épisode supprimé."); onReload(); }
    catch (e) { onError(errorMessage(e)); }
    finally { setShowDelEpConfirm(false); }
  };

  const saveTitle = async () => {
    if (!newTitle.trim() || newTitle === course.title) { setEditingTitle(false); return; }
    try {
      await courseApi.update(course.id, { title: newTitle });
      onReload(); setEditingTitle(false);
    } catch (e) { onError(errorMessage(e)); }
  };

  const saveResource = async () => {
    if (addKind === "VIDEO" && !ytUrl.trim()) return;
    if (addKind !== "VIDEO" && !mediaFile) return;
    setSavingUrl(true);
    try {
      if (addKind === "VIDEO") {
        if (videoRes) {
          await resourceApi.update(videoRes.id, { youtube_url: ytUrl.trim() });
        } else {
          await resourceApi.create({
            course: course.id, resource_type: "VIDEO", title: course.title,
            order: resources.length + 1, video_source: "YOUTUBE",
            youtube_url: ytUrl.trim(), bucket_key: "",
          });
        }
      } else {
        const { data: up } = await resourceApi.upload(mediaFile!, addKind);
        const existing = addKind === "AUDIO" ? audioRes : pdfRes;
        if (existing) {
          await resourceApi.update(existing.id, { bucket_key: up.bucket_key, size_mo: up.size_mo });
        } else {
          await resourceApi.create({
            course: course.id, resource_type: addKind, title: course.title,
            order: resources.length + 1, video_source: "UPLOAD",
            bucket_key: up.bucket_key, size_mo: up.size_mo,
          });
        }
      }
      setShowAddForm(false); setYtUrl(""); setMediaFile(null); onReload();
    } catch (e) { onError(errorMessage(e)); }
    finally { setSavingUrl(false); }
  };

  const openForm = (k: ContentKind) => { setAddKind(k); setShowAddForm(true); };

  return (
    <div style={{ padding: "0.5rem 0.2rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {/* Drag handle */}
        <span style={{ color: "#d0c0a0", fontSize: "0.95rem", cursor: "grab", flexShrink: 0, lineHeight: 1 }}>
          ⠿
        </span>

        {/* Episode number */}
        <span style={{
          width: 24, height: 24, borderRadius: 4,
          background: "#8b2c2c", color: "#fff",
          fontSize: "0.60rem", fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {String(episodeNumber).padStart(2, "0")}
        </span>

        {/* Title (click to edit) */}
        {editingTitle ? (
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
            onBlur={saveTitle}
            style={{
              flex: 1, fontSize: "0.84rem", color: "#2a1800",
              border: "1px solid #c9a227", borderRadius: 4,
              padding: "0.16rem 0.42rem", outline: "none",
              background: "#fffbf0",
            }}
          />
        ) : (
          <span
            onClick={() => { setNewTitle(course.title); setEditingTitle(true); }}
            title="Cliquer pour modifier le titre"
            style={{
              flex: 1, fontSize: "0.84rem", color: "#2a1800", fontWeight: 500,
              cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              borderBottom: "1px dashed transparent",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "#c9a22760"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.borderBottomColor = "transparent"; }}
          >
            {course.title}
          </span>
        )}

        {/* Resource badges — clickable to update */}
        {youtubeUrl && (
          <a href={youtubeUrl} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: "0.66rem", fontWeight: 700, color: "#d4673a",
              background: "#d4673a12", border: "1px solid #d4673a35",
              padding: "0.10rem 0.38rem", borderRadius: 4,
              textDecoration: "none", flexShrink: 0,
              display: "inline-flex", alignItems: "center", gap: "0.2rem",
            }}
          >
            ▶ YT
          </a>
        )}
        {audioRes && (
          <button onClick={() => openForm("AUDIO")} title="Remplacer le fichier audio"
            style={{
              fontSize: "0.66rem", fontWeight: 700, color: "#a0461a",
              background: "#a0461a12", border: "1px solid #a0461a30",
              padding: "0.10rem 0.38rem", borderRadius: 4, cursor: "pointer", flexShrink: 0,
            }}>
            ♪ AUD
          </button>
        )}
        {pdfRes && (
          <button onClick={() => openForm("PDF")} title="Remplacer le PDF"
            style={{
              fontSize: "0.66rem", fontWeight: 700, color: "#2b8a5e",
              background: "#2b8a5e12", border: "1px solid #2b8a5e30",
              padding: "0.10rem 0.38rem", borderRadius: 4, cursor: "pointer", flexShrink: 0,
            }}>
            ☰ PDF
          </button>
        )}

        {/* + Contenu button (when at least one resource type is missing) */}
        {(!youtubeUrl || !audioRes || !pdfRes) && (
          <button
            onClick={() => {
              const k: ContentKind = !youtubeUrl ? "VIDEO" : !audioRes ? "AUDIO" : "PDF";
              openForm(k);
            }}
            style={{
              fontSize: "0.66rem", fontWeight: 600, flexShrink: 0,
              color: "#a0907a", background: "rgba(160,144,122,0.08)",
              border: "1px solid rgba(160,144,122,0.22)", borderRadius: 4,
              padding: "0.10rem 0.38rem", cursor: "pointer",
            }}
          >
            + Contenu
          </button>
        )}

        {/* is_gratuit toggle */}
        <button
          type="button"
          title={course.is_gratuit ? "Aperçu gratuit activé — cliquer pour retirer" : "Proposer cet épisode en aperçu gratuit"}
          onClick={async () => {
            try { await courseApi.update(course.id, { is_gratuit: !course.is_gratuit }); onReload(); }
            catch (e) { onError(errorMessage(e)); }
          }}
          style={{
            fontSize: "0.59rem", fontWeight: 700,
            padding: "0.10rem 0.35rem", borderRadius: 4,
            border: course.is_gratuit ? "1px solid #2e946040" : "1px solid rgba(160,144,122,0.22)",
            background: course.is_gratuit ? "#2e946018" : "rgba(160,144,122,0.06)",
            color: course.is_gratuit ? "#2e9460" : "#a0907a",
            cursor: "pointer", flexShrink: 0, transition: "all .14s",
          }}
        >
          {course.is_gratuit ? "✓ GRATUIT" : "Gratuit ?"}
        </button>

        {/* Delete */}
        <button
          onClick={() => setShowDelEpConfirm(true)}
          style={{
            background: "none", border: "1px solid #f0d8d0", borderRadius: 4,
            color: "#b53a2a", cursor: "pointer", fontSize: "0.68rem",
            padding: "0.16rem 0.38rem", flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Add/replace resource form */}
      {showAddForm && (
        <div style={{ marginTop: "0.35rem", paddingLeft: "3rem" }}>
          {/* Type pills */}
          <div style={{ display: "flex", gap: "0.2rem", marginBottom: "0.35rem" }}>
            {KIND_OPTIONS.map((o) => {
              const active = addKind === o.value;
              return (
                <button key={o.value} type="button"
                  onClick={() => { setAddKind(o.value); setYtUrl(""); setMediaFile(null); }}
                  style={{
                    fontSize: "0.64rem", fontWeight: 700, padding: "0.18rem 0.45rem", borderRadius: 4,
                    border: active ? "1.5px solid #c9a227" : "1px solid rgba(160,144,122,0.22)",
                    background: active ? "#c9a22715" : "rgba(160,144,122,0.05)",
                    color: active ? "#8b6a1a" : "#a0907a", cursor: "pointer",
                  }}>
                  {o.icon} {o.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {addKind === "VIDEO" ? (
              <input
                autoFocus
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveResource(); if (e.key === "Escape") { setShowAddForm(false); setYtUrl(""); } }}
                placeholder="https://www.youtube.com/watch?v=…"
                style={{
                  flex: 1, fontSize: "0.79rem", border: "1px solid #e8dfc8", borderRadius: 5,
                  padding: "0.26rem 0.55rem", outline: "none", background: "#fffbf0",
                }}
              />
            ) : (
              <>
                <button type="button" onClick={() => fileRef.current?.click()} style={{
                  flex: 1, fontSize: "0.78rem", fontWeight: 500, textAlign: "left",
                  border: "1px solid #e8dfc8", borderRadius: 5, padding: "0.28rem 0.55rem",
                  background: mediaFile ? "#2e946012" : "#fffbf0",
                  color: mediaFile ? "#2e9460" : "#a0907a", cursor: "pointer",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {mediaFile ? `✓ ${mediaFile.name}` : `Choisir ${addKind === "AUDIO" ? "un fichier audio" : "un PDF"}…`}
                </button>
                <input
                  ref={fileRef} type="file"
                  accept={KIND_OPTIONS.find((o) => o.value === addKind)?.accept}
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setMediaFile(f); e.target.value = ""; }}
                />
              </>
            )}
            <Button type="button" onClick={saveResource} loading={savingUrl}
              disabled={addKind === "VIDEO" ? !ytUrl.trim() : !mediaFile}>
              OK
            </Button>
            <button
              onClick={() => { setShowAddForm(false); setYtUrl(""); setMediaFile(null); }}
              style={{
                background: "none", border: "1px solid #e8dfc8", borderRadius: 5,
                color: "#8b6a3a", cursor: "pointer", fontSize: "0.76rem", padding: "0.24rem 0.5rem",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDelEpConfirm}
        title={`Supprimer « ${course.title} » ?`}
        body="Cet épisode et ses ressources seront définitivement supprimés."
        confirmLabel="Supprimer"
        danger
        onConfirm={del}
        onCancel={() => setShowDelEpConfirm(false)}
      />
    </div>
  );
}

// ── Ajout épisode (titre + contenu) ──────────────────────────────────────────

const KIND_OPTIONS: { value: ContentKind; icon: string; label: string; accept: string }[] = [
  { value: "VIDEO", icon: "▶", label: "Vidéo", accept: "" },
  { value: "AUDIO", icon: "♪", label: "Audio", accept: ".mp3,.wav,.ogg,.m4a,.aac" },
  { value: "PDF",   icon: "☰", label: "PDF",   accept: ".pdf" },
];

function AddEpisodeInline({ moduleId, count, onSaved, onError, onInfo, onEpisodeChange }: {
  moduleId: number; count: number;
  onSaved: () => void; onError: (s: string) => void; onInfo: (s: string) => void;
  onEpisodeChange?: (title: string, youtube: string, kind: ContentKind) => void;
}) {
  const [title,     setTitle]     = useState("");
  const [youtube,   setYoutube]   = useState("");
  const [kind,      setKind]      = useState<ContentKind>("VIDEO");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [pdfFile,   setPdfFile]   = useState<File | null>(null);
  const [busy,      setBusy]      = useState(false);
  
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const thumbUrl = kind === "VIDEO" ? ytThumb(youtube) : "";

  const switchKind = (k: ContentKind) => {
    setKind(k);
    // On ne reset plus tout, on garde ce qui a été saisi/choisi si possible
    onEpisodeChange?.(title, youtube, k);
  };

  const add = async () => {
    if (!title.trim() || busy) return;
    onError(""); setBusy(true);
    try {
      const courseRes = await courseApi.create({ module: moduleId, title: title.trim(), order: count + 1 });
      const courseId = courseRes.data.id;

      let order = 1;

      // 1. Vidéo YouTube
      if (youtube.trim()) {
        await resourceApi.create({
          course: courseId, resource_type: "VIDEO", title: title.trim(),
          order: order++, video_source: "YOUTUBE", youtube_url: youtube.trim(), bucket_key: "",
        });
      }

      // 2. Audio (primaire ou secondaire)
      const audioToUpload = kind === "AUDIO" ? mediaFile : audioFile;
      if (audioToUpload) {
        const { data: up } = await resourceApi.upload(audioToUpload, "AUDIO");
        await resourceApi.create({
          course: courseId, resource_type: "AUDIO", title: title.trim(),
          order: order++, video_source: "UPLOAD", bucket_key: up.bucket_key, size_mo: up.size_mo,
        });
      }

      // 3. PDF (primaire ou secondaire)
      const pdfToUpload = kind === "PDF" ? mediaFile : pdfFile;
      if (pdfToUpload) {
        const { data: up } = await resourceApi.upload(pdfToUpload, "PDF");
        await resourceApi.create({
          course: courseId, resource_type: "PDF", title: title.trim(),
          order: order++, video_source: "UPLOAD", bucket_key: up.bucket_key, size_mo: up.size_mo,
        });
      }

      onInfo(`Épisode « ${title} » ajouté.`);
      setTitle(""); setYoutube(""); setMediaFile(null); setAudioFile(null); setPdfFile(null);
      onEpisodeChange?.("", "", kind);
      onSaved();
    } catch (e) { onError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: "0.5rem 0.2rem", borderTop: count > 0 ? "1px solid #f5ede0" : "none" }}>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: "2 1 140px", fontSize: "0.81rem" }}
          value={title}
          placeholder="Titre de l'épisode…"
          onChange={(e) => { setTitle(e.target.value); onEpisodeChange?.(e.target.value, youtube, kind); }}
          onKeyDown={(e) => { if (e.key === "Enter" && kind === "VIDEO" && !youtube) add(); }}
        />

        {/* Type pills */}
        <div style={{ display: "flex", gap: "0.2rem", flexShrink: 0 }}>
          {KIND_OPTIONS.map((o) => {
            const active = kind === o.value;
            return (
              <button key={o.value} type="button" onClick={() => switchKind(o.value)} style={{
                fontSize: "0.65rem", fontWeight: 700, padding: "0.20rem 0.48rem", borderRadius: 4,
                border: active ? "1.5px solid #c9a227" : "1px solid rgba(160,144,122,0.22)",
                background: active ? "#c9a22715" : "rgba(160,144,122,0.05)",
                color: active ? "#8b6a1a" : "#a0907a",
                cursor: "pointer", transition: "all .1s",
              }}>
                {o.icon} {o.label}
              </button>
            );
          })}
        </div>

        {/* Main content input */}
        <div style={{ flex: "3 1 200px", display: "flex", gap: "0.4rem" }}>
          {kind === "VIDEO" ? (
            <input
              className="input"
              style={{ flex: 1, fontSize: "0.81rem" }}
              value={youtube}
              placeholder="Lien YouTube (optionnel)"
              onChange={(e) => { setYoutube(e.target.value); onEpisodeChange?.(title, e.target.value, kind); }}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            />
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} style={{
              flex: 1, fontSize: "0.78rem", fontWeight: 500, textAlign: "left",
              border: "1px solid #e8dfc8", borderRadius: 5, padding: "0.30rem 0.55rem",
              background: mediaFile ? "#2e946012" : "#fffbf0",
              color: mediaFile ? "#2e9460" : "#a0907a",
              cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {mediaFile ? `✓ ${mediaFile.name}` : `Choisir ${kind === "AUDIO" ? "un fichier audio" : "un PDF"}…`}
            </button>
          )}

          {/* Optional extra uploads */}
          <div style={{ display: "flex", gap: "0.2rem" }}>
            <button type="button" onClick={() => audioRef.current?.click()} title="Ajouter un fichier audio" style={{
              width: 30, height: 30, borderRadius: 5, border: "1px solid #e8dfc8",
              background: audioFile ? "#a0461a15" : "#fffbf0",
              color: audioFile ? "#a0461a" : "#a0907a", cursor: "pointer",
              fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              ♪
            </button>
            <button type="button" onClick={() => pdfRef.current?.click()} title="Ajouter un PDF" style={{
              width: 30, height: 30, borderRadius: 5, border: "1px solid #e8dfc8",
              background: pdfFile ? "#2b8a5e15" : "#fffbf0",
              color: pdfFile ? "#2b8a5e" : "#a0907a", cursor: "pointer",
              fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              ☰
            </button>
          </div>
        </div>

        {/* Hidden inputs */}
        <input
          ref={fileRef} type="file" accept={KIND_OPTIONS.find((o) => o.value === kind)?.accept}
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setMediaFile(f); e.target.value = ""; }}
        />
        <input
          ref={audioRef} type="file" accept=".mp3,.wav,.ogg,.m4a,.aac"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setAudioFile(f); e.target.value = ""; }}
        />
        <input
          ref={pdfRef} type="file" accept=".pdf"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setPdfFile(f); e.target.value = ""; }}
        />

        <Button type="button" variant="ghost" onClick={add} loading={busy}
                disabled={!title.trim()} style={{ flexShrink: 0 }}>
          + Épisode
        </Button>
      </div>

      {/* YouTube thumbnail */}
      {thumbUrl && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem", paddingLeft: "0.2rem" }}>
          <img src={thumbUrl} alt="miniature"
            style={{ width: 80, height: 45, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span style={{ fontSize: "0.70rem", color: "#8b6a3a" }}>
            Miniature détectée — sera affichée dans la playlist
          </span>
        </div>
      )}

      {/* Files summary */}
      <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.4rem", paddingLeft: "0.2rem" }}>
        {kind !== "VIDEO" && mediaFile && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: kind === "PDF" ? "#2b8a5e" : "#a0461a" }}>
              {kind === "PDF" ? "☰" : "♪"}
            </span>
            <span style={{ fontSize: "0.68rem", color: "#8b6a3a", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {mediaFile.name} ({(mediaFile.size / 1024 / 1024).toFixed(1)} Mo)
            </span>
            <button type="button" onClick={() => setMediaFile(null)}
              style={{ background: "none", border: "none", color: "#b53a2a", cursor: "pointer", fontSize: "0.65rem" }}>
              ✕
            </button>
          </div>
        )}
        {audioFile && (kind !== "AUDIO" || !mediaFile) && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: "#a0461a" }}>♪</span>
            <span style={{ fontSize: "0.68rem", color: "#8b6a3a", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Audio: {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)} Mo)
            </span>
            <button type="button" onClick={() => setAudioFile(null)}
              style={{ background: "none", border: "none", color: "#b53a2a", cursor: "pointer", fontSize: "0.65rem" }}>
              ✕
            </button>
          </div>
        )}
        {pdfFile && (kind !== "PDF" || !mediaFile) && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: "#2b8a5e" }}>☰</span>
            <span style={{ fontSize: "0.68rem", color: "#8b6a3a", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              PDF: {pdfFile.name} ({(pdfFile.size / 1024 / 1024).toFixed(1)} Mo)
            </span>
            <button type="button" onClick={() => setPdfFile(null)}
              style={{ background: "none", border: "none", color: "#b53a2a", cursor: "pointer", fontSize: "0.65rem" }}>
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Aperçu Playlist ───────────────────────────────────────────────────────────

function PlaylistPreview({
  formation, rootModules, coursesByModule, resourcesByCourse,
  quizByCourse, totalEpisodes, finalExam,
  pendingChapterTitle, pendingEpisode,
}: {
  formation:         Formation;
  rootModules:       ModuleItem[];
  coursesByModule:   Record<number, CourseItem[]>;
  resourcesByCourse: Record<number, ResourceItem[]>;
  quizByCourse:      Record<number, QuizItem>;
  totalEpisodes:     number;
  finalExam:         QuizItem | null;
  pendingChapterTitle?: string;
  pendingEpisode?:      PendingEpisode | null;
}) {
  const coverBg = COVER_GRAD[formation.category] ?? COVER_GRAD.FORMATION;
  const hasPendingChapter = !!(pendingChapterTitle?.trim());
  const displayTotal = totalEpisodes + (pendingEpisode ? 1 : 0);
  const displayChapters = rootModules.length + (hasPendingChapter ? 1 : 0);

  return (
    <div style={{
      background: "#fff", border: "1px solid #e8dfc8",
      borderRadius: "var(--radius)", overflow: "hidden",
      position: "sticky", top: "1rem",
      maxHeight: "calc(100vh - 7rem)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.8rem 1rem", borderBottom: "1px solid #f0e8d4", flexShrink: 0,
      }}>
        <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#2a1800" }}>
          Playlist{" "}
          <span style={{ fontWeight: 400, color: "#8b6a3a", fontSize: "0.84rem" }}>
            · {displayTotal} épisode{displayTotal !== 1 ? "s" : ""}
          </span>
        </span>
        <span style={{ fontSize: "0.74rem", color: "#a0907a" }}>
          {displayChapters} chap.
        </span>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {rootModules.length === 0 && !hasPendingChapter ? (
          <div style={{ padding: "2.5rem 1rem", textAlign: "center", color: "#c0a880", fontSize: "0.82rem" }}>
            Ajoutez des chapitres pour voir l&apos;aperçu.
          </div>
        ) : (
          <>
            {rootModules.map((m, chapterIdx) => {
              const courses = (coursesByModule[m.id] ?? []).sort((a, b) => a.order - b.order);
              const hasPendingEpHere = pendingEpisode?.moduleId === m.id && !!(pendingEpisode.title.trim());
              const episodeOffset = rootModules
                .slice(0, chapterIdx)
                .reduce((acc, prev) => acc + (coursesByModule[prev.id]?.length ?? 0), 0);
              const chapterQuiz = courses.map((c) => quizByCourse[c.id]).find(Boolean) ?? null;
              const displayCount = courses.length + (hasPendingEpHere ? 1 : 0);

              return (
                <div key={m.id}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "0.42rem 1rem",
                    background: "#faf5ec",
                    borderTop: chapterIdx > 0 ? "1px solid #f0e8d4" : "none",
                    borderBottom: "1px solid #f0e8d4",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0 }}>
                      <span style={{
                        fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.12em",
                        textTransform: "uppercase", color: "#8b2c2c",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        Chapitre {chapterIdx + 1} — {m.title}
                      </span>
                      {m.is_gratuit && (
                        <span style={{
                          fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.06em",
                          color: "#2e9460", background: "#2e946018",
                          border: "1px solid #2e946040",
                          padding: "0.06rem 0.32rem", borderRadius: 99, flexShrink: 0,
                        }}>
                          GRATUIT
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "0.68rem", color: "#a0907a", flexShrink: 0 }}>{displayCount} ép.</span>
                  </div>

                  {courses.length === 0 && !hasPendingEpHere ? (
                    <div style={{ padding: "0.6rem 1rem", fontSize: "0.78rem", color: "#c0a880", fontStyle: "italic" }}>
                      Aucun épisode
                    </div>
                  ) : (
                    <>
                      {courses.map((c, idx) => {
                        const res = resourcesByCourse[c.id] ?? [];
                        const videoRes = res.find((r) => r.resource_type === "VIDEO");
                        const hasPdf   = res.some((r) => r.resource_type === "PDF");
                        const hasAudio = res.some((r) => r.resource_type === "AUDIO");
                        const thumb = videoRes?.video_source === "YOUTUBE" ? ytThumb(videoRes.youtube_url) : "";

                        return (
                          <div key={c.id} style={{
                            display: "flex", alignItems: "center", gap: "0.6rem",
                            padding: "0.5rem 1rem", borderBottom: "1px solid #f8f2e8",
                          }}>
                            {/* Thumbnail */}
                            {thumb ? (
                              <img
                                src={thumb} alt=""
                                style={{ width: 60, height: 44, objectFit: "cover", borderRadius: 5, flexShrink: 0 }}
                                onError={(e) => {
                                  const el = e.currentTarget as HTMLImageElement;
                                  el.style.display = "none";
                                  const fb = el.nextSibling as HTMLElement;
                                  if (fb) fb.style.display = "flex";
                                }}
                              />
                            ) : null}
                            <div style={{
                              width: 60, height: 44, flexShrink: 0,
                              background: coverBg, borderRadius: 5,
                              display: thumb ? "none" : "flex",
                              alignItems: "center", justifyContent: "center",
                              fontSize: "1.05rem", opacity: 0.65,
                            }}>
                              {videoRes ? "▶" : hasPdf ? "📄" : hasAudio ? "🎵" : "◫"}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                <span style={{
                                  fontSize: "0.80rem", color: "#2a1800", fontWeight: 500,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {String(episodeOffset + idx + 1).padStart(2, "0")}. {c.title}
                                </span>
                                {c.is_gratuit && (
                                  <span style={{
                                    fontSize: "0.56rem", fontWeight: 800, letterSpacing: "0.05em",
                                    color: "#2e9460", background: "#2e946018",
                                    border: "1px solid #2e946040",
                                    padding: "0.04rem 0.28rem", borderRadius: 99, flexShrink: 0,
                                  }}>
                                    GRATUIT
                                  </span>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.14rem" }}>
                                {res.length === 0 ? (
                                  <span style={{ fontSize: "0.66rem", color: "#c0a880", fontStyle: "italic" }}>Vide</span>
                                ) : (
                                  <>
                                    {videoRes?.video_source === "YOUTUBE" && (
                                      <span style={{ fontSize: "0.62rem", color: "#d4673a", fontWeight: 700 }}>YT</span>
                                    )}
                                    {hasPdf   && <span style={{ fontSize: "0.62rem", color: "#2b8a5e", fontWeight: 700 }}>PDF</span>}
                                    {hasAudio && <span style={{ fontSize: "0.62rem", color: "#a0461a", fontWeight: 700 }}>AUD</span>}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {/* Ghost pending episode row */}
                      {hasPendingEpHere && (
                        <div style={{
                          display: "flex", alignItems: "center", gap: "0.6rem",
                          padding: "0.5rem 1rem", borderBottom: "1px solid #f8f2e8",
                          opacity: 0.55,
                        }}>
                          {pendingEpisode!.kind === "VIDEO" && pendingEpisode!.youtube && ytThumb(pendingEpisode!.youtube) ? (
                            <img
                              src={ytThumb(pendingEpisode!.youtube)} alt=""
                              style={{ width: 60, height: 44, objectFit: "cover", borderRadius: 5, flexShrink: 0 }}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div style={{
                              width: 60, height: 44, flexShrink: 0, background: coverBg, borderRadius: 5,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "1.1rem", opacity: 0.65,
                            }}>
                              {pendingEpisode!.kind === "AUDIO" ? "♪" : pendingEpisode!.kind === "PDF" ? "☰" : "▶"}
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: "0.80rem", color: "#8b6a3a", fontWeight: 500,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {String(episodeOffset + courses.length + 1).padStart(2, "0")}. {pendingEpisode!.title}
                            </div>
                            <div style={{ fontSize: "0.66rem", color: "#c0a880", fontStyle: "italic" }}>
                              En cours de saisie…
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Quiz row in preview */}
                  {chapterQuiz ? (
                    <div style={{
                      display: "flex", alignItems: "center", gap: "0.55rem",
                      padding: "0.5rem 1rem",
                      background: "#fdf9f0",
                      borderTop: "1px solid #f5ede0",
                      borderBottom: "1px solid #f0e8d4",
                    }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                        background: "#c9a22718", border: "1px solid #c9a22740",
                        color: "#c9a227", fontSize: "0.85rem",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>◆</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.78rem", color: "#2a1800", fontWeight: 600 }}>Passer le quiz du chapitre</div>
                        <div style={{ fontSize: "0.68rem", color: "#8b6a3a" }}>
                          {chapterQuiz.questions.length} question{chapterQuiz.questions.length !== 1 ? "s" : ""}
                          {" — "}seuil {chapterQuiz.pass_threshold}/20
                        </div>
                      </div>
                      <span style={{ color: "#c9a227", fontSize: "0.85rem" }}>›</span>
                    </div>
                  ) : (
                    <div style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.42rem 1rem",
                      background: "#faf7f2",
                      borderTop: "1px solid #f5ede0",
                      borderBottom: "1px solid #f0e8d4",
                    }}>
                      <span style={{ fontSize: "0.75rem", color: "#c0a880" }}>◇</span>
                      <span style={{ fontSize: "0.72rem", color: "#c0a880", fontStyle: "italic" }}>Pas de quiz</span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Ghost pending chapter row */}
            {hasPendingChapter && (
              <div style={{ opacity: 0.5 }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.42rem 1rem",
                  background: "#faf5ec",
                  borderTop: rootModules.length > 0 ? "1px solid #f0e8d4" : "none",
                  borderBottom: "1px solid #f0e8d4",
                }}>
                  <span style={{
                    fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.12em",
                    textTransform: "uppercase", color: "#8b2c2c",
                  }}>
                    Chapitre {rootModules.length + 1} — {pendingChapterTitle}
                  </span>
                  <span style={{ fontSize: "0.68rem", color: "#c0a880", fontStyle: "italic" }}>En cours…</span>
                </div>
                <div style={{ padding: "0.6rem 1rem", fontSize: "0.78rem", color: "#c0a880", fontStyle: "italic" }}>
                  Aucun épisode
                </div>
              </div>
            )}
          </>
        )}

        {finalExam && (
          <div style={{
            display: "flex", alignItems: "center", gap: "0.55rem",
            padding: "0.6rem 1rem", background: "#fffbf0",
            borderTop: "1px solid #f0e8d4",
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: 6, flexShrink: 0,
              background: "#c9a22730", border: "1px solid #c9a22750",
              color: "#c9a227", fontSize: "0.9rem",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>🏅</span>
            <div>
              <div style={{ fontSize: "0.78rem", color: "#2a1800", fontWeight: 600 }}>Examen final</div>
              <div style={{ fontSize: "0.68rem", color: "#8b6a3a" }}>
                {finalExam.questions.length} questions — seuil {finalExam.pass_threshold}/20
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
