"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  asList, courseApi, formationApi, moduleApi, quizApi, resourceApi,
} from "@/lib/endpoints";
import type {
  CourseItem, Formation, FormationStatus, ModuleItem, QuizItem, ResourceItem,
} from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Select, errorMessage } from "@/components/ui";
import { QuizEditor } from "@/components/QuizEditor";

type QuizTarget = { quiz: QuizItem | null; course?: number; formation?: number };

export default function FormationBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const fid = Number(id);

  const [formation, setFormation] = useState<Formation | null>(null);
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [coursesByModule, setCoursesByModule] = useState<Record<number, CourseItem[]>>({});
  const [resourcesByCourse, setResourcesByCourse] = useState<Record<number, ResourceItem[]>>({});
  const [quizByCourse, setQuizByCourse] = useState<Record<number, QuizItem>>({});
  const [finalExam, setFinalExam] = useState<QuizItem | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [quizTarget, setQuizTarget] = useState<QuizTarget | null>(null);
  const flash = (m: string) => { setError(""); setInfo(m); };

  const reload = useCallback(async () => {
    try {
      const f = (await formationApi.detail(fid)).data;
      setFormation(f);
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
      setQuizByCourse(Object.fromEntries(quizzes.filter((q) => q.course).map((q) => [q.course as number, q])));
      setFinalExam(quizzes.find((q) => q.formation) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [fid]);

  useEffect(() => { reload(); }, [reload]);

  if (!formation) return <p style={{ color: "var(--muted)" }}>{error || "Chargement…"}</p>;

  const childrenOf = (parentId: number | null) =>
    modules.filter((m) => m.parent === parentId).sort((a, b) => a.order - b.order);

  return (
    <div>
      <Link href="/contenu" style={{ fontSize: ".85rem", color: "var(--muted)" }}>← Toutes les formations</Link>
      <h1 style={{ marginTop: ".4rem", marginBottom: "1.2rem" }}>{formation.title}</h1>

      <Alert>{error}</Alert>
      <Alert kind="success">{info}</Alert>

      <FormationMeta formation={formation} onSaved={reload} onError={setError} onInfo={flash} />

      {/* Modules */}
      <Card style={{ marginTop: "1.2rem" }}>
        <h2 style={{ fontSize: "1.05rem", marginBottom: ".4rem" }}>Modules & cours</h2>
        <p style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: ".9rem" }}>
          Organisez la formation en modules (et sous-modules), chaque module contient des cours,
          chaque cours ses ressources et un QCM.
        </p>

        <AddModuleForm formationId={fid} modules={modules} onSaved={reload} onError={setError} onInfo={flash} />

        <div style={{ display: "grid", gap: ".7rem", marginTop: "1rem" }}>
          {childrenOf(null).map((m) => (
            <ModuleNode key={m.id} module={m} depth={0} childrenOf={childrenOf}
                        formationId={fid} coursesByModule={coursesByModule}
                        resourcesByCourse={resourcesByCourse} quizByCourse={quizByCourse}
                        onReload={reload} onError={setError} onInfo={flash} onQuiz={setQuizTarget} />
          ))}
          {modules.length === 0 && <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>Aucun module pour l'instant.</p>}
        </div>
      </Card>

      {/* Examen final */}
      <Card style={{ marginTop: "1.2rem", borderColor: "var(--gold)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".6rem", flexWrap: "wrap" }}>
          <div>
            <strong>🏅 Examen final</strong>
            <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: ".2rem 0 0" }}>
              {finalExam ? `${finalExam.questions.length} question(s) — seuil ${finalExam.pass_threshold}/20`
                         : "Aucun examen final défini."}
            </p>
          </div>
          <Button variant="ghost" onClick={() => setQuizTarget({ quiz: finalExam, formation: fid })}>
            {finalExam ? "Modifier l'examen final" : "Ajouter un examen final"}
          </Button>
        </div>
      </Card>

      {quizTarget && (
        <QuizEditor quiz={quizTarget.quiz} course={quizTarget.course} formation={quizTarget.formation}
                    onClose={() => setQuizTarget(null)}
                    onSaved={() => { setQuizTarget(null); reload(); }} />
      )}
    </div>
  );
}

// ─── Méta de la formation ────────────────────────────────────────────────────

function FormationMeta({ formation, onSaved, onError, onInfo }: {
  formation: Formation; onSaved: () => void; onError: (s: string) => void; onInfo: (s: string) => void;
}) {
  const [f, setF] = useState({
    title: formation.title, description: formation.description, category: formation.category,
    reserved: formation.access_subscription_types.length > 0, status: formation.status,
    publish_at: formation.publish_at ? formation.publish_at.slice(0, 16) : "",
  });
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState("");

  const save = async () => {
    setSaving(true); setOk(""); onError("");
    try {
      await formationApi.update(formation.id, {
        title: f.title, description: f.description, category: f.category,
        access_subscription_types: f.reserved ? ["MEMBRE"] : [],
        status: f.status,
        publish_at: f.status === "SCHEDULED" && f.publish_at ? new Date(f.publish_at).toISOString() : null,
      });
      setOk("Modifications enregistrées."); onSaved();
    } catch (e) { onError(errorMessage(e)); }
    finally { setSaving(false); }
  };

  const publish = async () => {
    setSaving(true); onError("");
    try { await formationApi.publish(formation.id); onInfo("Formation publiée."); onSaved(); }
    catch (e) { onError(errorMessage(e)); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <Alert kind="success">{ok}</Alert>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: ".8rem" }}>
        <Input label="Titre" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <Select label="Catégorie" value={f.category}
                onChange={(e) => setF({ ...f, category: e.target.value as Formation["category"] })}>
          <option value="FORMATION">Formation</option>
          <option value="LIVRE">Bibliothèque</option>
          <option value="LIBRE">Accès libre</option>
        </Select>
      </div>
      <Input label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".8rem" }}>
        <Select label="Publication" value={f.status}
                onChange={(e) => setF({ ...f, status: e.target.value as FormationStatus })}>
          <option value="DRAFT">Brouillon</option>
          <option value="SCHEDULED">Programmé</option>
          <option value="PUBLISHED">Publié</option>
        </Select>
        {f.status === "SCHEDULED" && (
          <Input label="Date de mise en ligne" type="datetime-local" value={f.publish_at}
                 onChange={(e) => setF({ ...f, publish_at: e.target.value })} />
        )}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: ".5rem", margin: ".2rem 0 1rem", cursor: "pointer" }}>
        <input type="checkbox" checked={f.reserved} onChange={(e) => setF({ ...f, reserved: e.target.checked })} />
        <span style={{ fontSize: ".9rem" }}>Réservé aux membres</span>
      </label>
      <div style={{ display: "flex", gap: ".5rem" }}>
        <Button onClick={save} loading={saving}>Enregistrer</Button>
        {formation.status !== "PUBLISHED" && <Button variant="ghost" onClick={publish}>Publier maintenant</Button>}
      </div>
    </Card>
  );
}

// ─── Ajout de module ─────────────────────────────────────────────────────────

function AddModuleForm({ formationId, modules, onSaved, onError, onInfo }: {
  formationId: number; modules: ModuleItem[]; onSaved: () => void;
  onError: (s: string) => void; onInfo: (s: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [parent, setParent] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!title.trim() || busy) return;
    onError(""); setBusy(true);
    try {
      const order = modules.filter((m) => String(m.parent ?? "") === parent).length + 1;
      await moduleApi.create({
        formation: formationId, title, order,
        parent: parent ? Number(parent) : null,
      });
      onInfo(`Module « ${title} » ajouté.`);
      setTitle(""); setParent(""); onSaved();
    } catch (e) { onError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", gap: ".5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <Input label="Nouveau module" value={title} placeholder="Titre du module"
               onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 0 }} />
      </div>
      <div style={{ minWidth: 180 }}>
        <Select label="Sous-module de (optionnel)" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">— Module racine —</option>
          {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </Select>
      </div>
      <Button type="button" variant="ghost" onClick={add} loading={busy}
              disabled={!title.trim()} style={{ marginBottom: ".85rem" }}>+ Module</Button>
    </div>
  );
}

// ─── Module (récursif) ───────────────────────────────────────────────────────

function ModuleNode({
  module, depth, childrenOf, formationId, coursesByModule, resourcesByCourse, quizByCourse,
  onReload, onError, onInfo, onQuiz,
}: {
  module: ModuleItem; depth: number; childrenOf: (p: number | null) => ModuleItem[];
  formationId: number;
  coursesByModule: Record<number, CourseItem[]>;
  resourcesByCourse: Record<number, ResourceItem[]>;
  quizByCourse: Record<number, QuizItem>;
  onReload: () => void; onError: (s: string) => void; onInfo: (s: string) => void;
  onQuiz: (t: QuizTarget) => void;
}) {
  const courses = coursesByModule[module.id] ?? [];

  const del = async () => {
    if (!confirm(`Supprimer le module « ${module.title} » et son contenu ?`)) return;
    try { await moduleApi.remove(module.id); onInfo("Module supprimé."); onReload(); }
    catch (e) { onError(errorMessage(e)); }
  };

  return (
    <div style={{ marginLeft: depth * 16, border: "1px solid var(--line)", borderRadius: 10, padding: ".8rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }}>
        <strong style={{ fontSize: ".98rem" }}>{depth > 0 ? "↳ " : ""}{module.title}</strong>
        <button onClick={del} style={{ background: "none", border: "none", color: "var(--terra-2)", cursor: "pointer", fontSize: ".82rem" }}>
          Supprimer le module
        </button>
      </div>

      {/* Cours du module */}
      <div style={{ display: "grid", gap: ".5rem", marginTop: ".6rem" }}>
        {courses.map((c) => (
          <CourseRow key={c.id} course={c} resources={resourcesByCourse[c.id] ?? []}
                     quiz={quizByCourse[c.id] ?? null} onReload={onReload} onError={onError}
                     onInfo={onInfo} onQuiz={onQuiz} />
        ))}
      </div>
      <AddCourseForm moduleId={module.id} count={courses.length} onSaved={onReload}
                     onError={onError} onInfo={onInfo} />

      {/* Sous-modules */}
      {childrenOf(module.id).map((child) => (
        <div key={child.id} style={{ marginTop: ".6rem" }}>
          <ModuleNode module={child} depth={depth + 1} childrenOf={childrenOf} formationId={formationId}
                      coursesByModule={coursesByModule} resourcesByCourse={resourcesByCourse}
                      quizByCourse={quizByCourse} onReload={onReload} onError={onError}
                      onInfo={onInfo} onQuiz={onQuiz} />
        </div>
      ))}
    </div>
  );
}

function AddCourseForm({ moduleId, count, onSaved, onError, onInfo }: {
  moduleId: number; count: number; onSaved: () => void;
  onError: (s: string) => void; onInfo: (s: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim() || busy) return;
    onError(""); setBusy(true);
    try {
      await courseApi.create({ module: moduleId, title, order: count + 1 });
      onInfo(`Cours « ${title} » ajouté.`);
      setTitle(""); onSaved();
    } catch (e) { onError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", gap: ".5rem", alignItems: "center", marginTop: ".5rem" }}>
      <input className="input" style={{ flex: 1 }} value={title} placeholder="Titre du nouveau cours…"
             onChange={(e) => setTitle(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
      <Button type="button" variant="ghost" onClick={add} loading={busy} disabled={!title.trim()}>+ Cours</Button>
    </div>
  );
}

// ─── Cours (ressources + QCM) ────────────────────────────────────────────────

function CourseRow({ course, resources, quiz, onReload, onError, onInfo, onQuiz }: {
  course: CourseItem; resources: ResourceItem[]; quiz: QuizItem | null;
  onReload: () => void; onError: (s: string) => void; onInfo: (s: string) => void;
  onQuiz: (t: QuizTarget) => void;
}) {
  const del = async () => {
    if (!confirm(`Supprimer le cours « ${course.title} » ?`)) return;
    try { await courseApi.remove(course.id); onInfo("Cours supprimé."); onReload(); }
    catch (e) { onError(errorMessage(e)); }
  };
  const delRes = async (r: ResourceItem) => {
    try { await resourceApi.remove(r.id); onInfo("Ressource supprimée."); onReload(); }
    catch (e) { onError(errorMessage(e)); }
  };

  return (
    <div style={{ background: "var(--bg-2)", borderRadius: 9, padding: ".7rem .8rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }}>
        <strong style={{ fontSize: ".9rem" }}>{course.title}</strong>
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
          <Badge color={quiz ? "#5fb98a" : "#a89b86"}>{quiz ? `QCM (${quiz.questions.length})` : "Sans QCM"}</Badge>
          <button onClick={() => onQuiz({ quiz, course: course.id })}
                  style={{ background: "none", border: "none", color: "var(--gold-2)", cursor: "pointer", fontSize: ".8rem" }}>
            {quiz ? "Modifier QCM" : "Ajouter QCM"}
          </button>
          <button onClick={del} style={{ background: "none", border: "none", color: "var(--terra-2)", cursor: "pointer", fontSize: ".8rem" }}>
            Supprimer
          </button>
        </div>
      </div>

      {/* Ressources */}
      {resources.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: ".5rem 0 0", display: "grid", gap: ".3rem" }}>
          {resources.map((r) => (
            <li key={r.id} style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".83rem" }}>
              <Badge>{r.resource_type}</Badge>
              <span>{r.title}</span>
              {r.resource_type === "VIDEO" && r.video_source === "YOUTUBE" && <Badge color="#d4673a">YouTube</Badge>}
              <button onClick={() => delRes(r)}
                      style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <AddResourceForm courseId={course.id} count={resources.length} onSaved={onReload}
                       onError={onError} onInfo={onInfo} />
    </div>
  );
}

// ─── Ajout de ressource (YouTube ou upload) ──────────────────────────────────

function AddResourceForm({ courseId, count, onSaved, onError, onInfo }: {
  courseId: number; count: number; onSaved: () => void;
  onError: (s: string) => void; onInfo: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ResourceItem["resource_type"]>("VIDEO");
  const [source, setSource] = useState<"YOUTUBE" | "UPLOAD">("YOUTUBE");
  const [title, setTitle] = useState("");
  const [youtube, setYoutube] = useState("");
  const [bucketKey, setBucketKey] = useState("");
  const [busy, setBusy] = useState(false);

  const useUpload = type !== "VIDEO" || source === "UPLOAD";

  const onFile = async (file: File) => {
    setBusy(true); onError("");
    try { setBucketKey((await resourceApi.upload(file, type)).data.bucket_key); }
    catch (e) { onError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!title.trim()) return;
    onError("");
    try {
      await resourceApi.create({
        course: courseId, resource_type: type, title, order: count + 1,
        video_source: type === "VIDEO" ? source : "UPLOAD",
        youtube_url: type === "VIDEO" && source === "YOUTUBE" ? youtube : "",
        bucket_key: useUpload ? bucketKey : "",
      });
      onInfo(`Ressource « ${title} » ajoutée.`);
      setTitle(""); setYoutube(""); setBucketKey(""); setOpen(false); onSaved();
    } catch (e) { onError(errorMessage(e)); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              style={{ background: "none", border: "none", color: "var(--gold-2)", cursor: "pointer", fontSize: ".8rem", marginTop: ".5rem" }}>
        + Ajouter une ressource
      </button>
    );
  }

  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: ".6rem", marginTop: ".5rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem" }}>
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as ResourceItem["resource_type"])}>
          <option value="VIDEO">Vidéo</option>
          <option value="PDF">PDF</option>
          <option value="AUDIO">Audio</option>
        </Select>
        {type === "VIDEO" && (
          <Select label="Source vidéo" value={source} onChange={(e) => setSource(e.target.value as "YOUTUBE" | "UPLOAD")}>
            <option value="YOUTUBE">Lien YouTube</option>
            <option value="UPLOAD">Fichier hébergé</option>
          </Select>
        )}
      </div>
      <Input label="Titre de la ressource" value={title} onChange={(e) => setTitle(e.target.value)} />
      {type === "VIDEO" && source === "YOUTUBE" ? (
        <Input label="Lien YouTube" value={youtube} placeholder="https://www.youtube.com/watch?v=…"
               onChange={(e) => setYoutube(e.target.value)} />
      ) : (
        <label style={{ display: "block", marginBottom: ".85rem" }}>
          <span className="field-label">Fichier {busy ? "(envoi…)" : bucketKey ? "✓ envoyé" : ""}</span>
          <input type="file" className="input"
                 onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}
      <div style={{ display: "flex", gap: ".5rem" }}>
        <Button type="button" onClick={add} loading={busy}
                disabled={!title.trim() || (type === "VIDEO" && source === "YOUTUBE" ? !youtube.trim() : !bucketKey)}>
          Ajouter
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
      </div>
    </div>
  );
}
