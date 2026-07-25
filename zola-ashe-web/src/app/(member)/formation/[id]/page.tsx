"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formationApi, resourceApi } from "@/lib/endpoints";
import type { CourseNode, FormationDetail, ModuleNode, ResourceItem } from "@/lib/types";
import { Card, errorMessage } from "@/components/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { MediaModal, type Playback } from "@/components/MediaModal";
import { QuizModal } from "@/components/QuizModal";
import { IconPlay, IconDoc, IconAudio, IconLock, IconCheck } from "@/components/icons";

const RES_ICON = (t: string) =>
  t === "VIDEO" ? <IconPlay className="" /> : t === "AUDIO" ? <IconAudio className="" /> : <IconDoc className="" />;

type Handlers = {
  opening: number | null;
  onResource: (r: ResourceItem) => void;
  onQuiz: (id: number) => void;
};

export default function FormationPage() {
  const { id } = useParams<{ id: string }>();
  const formationId = Number(id);
  const [formation, setFormation] = useState<FormationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState<number | null>(null);
  const [player, setPlayer] = useState<{ resource: ResourceItem; playback: Playback } | null>(null);
  const [quiz, setQuiz] = useState<number | null>(null);

  const load = useCallback(() => {
    formationApi.detail(formationId)
      .then((r) => setFormation(r.data))
      .catch((e) => setMessage(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [formationId]);

  useEffect(() => { load(); }, [load]);

  const openResource = async (resource: ResourceItem) => {
    setMessage("");
    setOpening(resource.id);
    try {
      const { data } = await resourceApi.stream(resource.id);
      setPlayer({ resource, playback: { kind: data.kind, url: data.url } });
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setOpening(null);
    }
  };

  if (loading) return <BrandLoader full={false} />;
  if (!formation) return <Card><p style={{ color: "var(--muted)" }}>{message || "Formation introuvable."}</p></Card>;

  const handlers: Handlers = { opening, onResource: openResource, onQuiz: setQuiz };

  return (
    <div className="fade-up">
      <Link href="/contenu" style={{ fontSize: ".85rem", color: "var(--muted)" }}>← Toutes les formations</Link>
      <div className="eyebrow" style={{ margin: ".5rem 0 .3rem" }}>
        {formation.category === "LIVRE" ? "Bibliothèque" : formation.category === "LIBRE" ? "Accès libre" : "Formation"}
      </div>
      <h1 style={{ fontSize: "clamp(1.7rem, 5vw, 2.3rem)", marginBottom: ".4rem" }}>{formation.title}</h1>
      {formation.description && <p style={{ color: "var(--muted)", marginBottom: "1.2rem" }}>{formation.description}</p>}

      {message && <div className="alert alert-error">{message}</div>}

      {formation.locked && (
        <Card style={{ marginBottom: "1.2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".7rem", flexWrap: "wrap" }}>
            <IconLock className="" />
            <div>
              <strong>Formation réservée aux membres</strong>
              <p style={{ fontSize: ".85rem", color: "var(--muted)", margin: ".2rem 0 0" }}>
                Activez votre adhésion pour débloquer ce contenu.
              </p>
            </div>
            <Link href="/abonnement" className="btn btn-primary press" style={{ marginLeft: "auto" }}>Activer</Link>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gap: ".8rem" }}>
        {formation.modules.map((m) => <ModuleBlock key={m.id} module={m} depth={0} h={handlers} />)}
      </div>

      {/* Examen final */}
      {formation.final_exam && (
        <Card style={{ marginTop: "1.2rem", borderColor: "var(--gold-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".7rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "1.4rem" }}>🏅</span>
            <div>
              <strong>{formation.final_exam.title}</strong>
              <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: ".2rem 0 0" }}>
                {formation.final_exam.question_count} questions — seuil {formation.final_exam.pass_threshold}/20
                {formation.final_exam.validated && " — validé ✓"}
              </p>
            </div>
            <button className="btn btn-primary press" style={{ marginLeft: "auto" }}
                    disabled={formation.final_exam.locked}
                    onClick={() => formation.final_exam && setQuiz(formation.final_exam.id)}>
              {formation.final_exam.locked
                ? (formation.final_exam.lock_reason === "subscription" ? "Réservé" : "Terminez les cours")
                : formation.final_exam.validated ? "Repasser" : "Passer l'examen"}
            </button>
          </div>
        </Card>
      )}

      {player && (
        <MediaModal resource={player.resource} playback={player.playback} onClose={() => setPlayer(null)} />
      )}
      {quiz !== null && (
        <QuizModal quizId={quiz} onClose={() => setQuiz(null)} onValidated={() => { setQuiz(null); load(); }} />
      )}
    </div>
  );
}

function ModuleBlock({ module, depth, h }: { module: ModuleNode; depth: number; h: Handlers }) {
  const locked = module.access.locked;
  return (
    <div className="card" style={{ marginLeft: depth * 14, opacity: locked ? 0.72 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
        {module.completed
          ? <span style={{ color: "var(--gold-2)" }}><IconCheck className="" /></span>
          : locked ? <IconLock className="" /> : <span style={{ width: 18 }} />}
        <strong style={{ fontSize: "1.05rem" }}>{module.title}</strong>
        {locked && (
          <span className="chip-mini" style={{ marginLeft: "auto" }}>
            {module.access.lock_reason === "subscription" ? "Réservé" : "Terminez le précédent"}
          </span>
        )}
      </div>
      {module.description && (
        <p style={{ fontSize: ".85rem", color: "var(--muted)", margin: ".4rem 0 0" }}>{module.description}</p>
      )}

      {/* Cours du module */}
      {module.courses.length > 0 && (
        <div style={{ display: "grid", gap: ".6rem", marginTop: ".7rem" }}>
          {module.courses.map((c) => <CourseBlock key={c.id} course={c} h={h} />)}
        </div>
      )}

      {/* Sous-modules */}
      {module.children.length > 0 && (
        <div style={{ display: "grid", gap: ".6rem", marginTop: ".7rem" }}>
          {module.children.map((c) => <ModuleBlock key={c.id} module={c} depth={depth + 1} h={h} />)}
        </div>
      )}
    </div>
  );
}

function CourseBlock({ course, h }: { course: CourseNode; h: Handlers }) {
  const locked = course.access.locked;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: ".8rem .9rem",
                  opacity: locked ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
        {course.completed
          ? <span style={{ color: "var(--gold-2)" }}><IconCheck className="" /></span>
          : locked ? <IconLock className="" /> : <span style={{ width: 18 }} />}
        <strong style={{ fontSize: ".98rem" }}>{course.title}</strong>
        {locked && (
          <span className="chip-mini" style={{ marginLeft: "auto" }}>
            {course.access.lock_reason === "subscription" ? "Réservé" : "Terminez le précédent"}
          </span>
        )}
      </div>
      {course.description && (
        <p style={{ fontSize: ".83rem", color: "var(--muted)", margin: ".35rem 0 0" }}>{course.description}</p>
      )}

      {!locked && (
        <>
          {course.resources.length > 0 && (
            <div style={{ display: "grid", gap: ".4rem", marginTop: ".6rem" }}>
              {course.resources.map((r) => (
                <button key={r.id} className="press" onClick={() => h.onResource(r)} disabled={h.opening === r.id}
                        style={{ display: "flex", alignItems: "center", gap: ".6rem", textAlign: "left",
                                 padding: ".55rem .75rem", borderRadius: 9, cursor: "pointer",
                                 border: "1px solid var(--line)", background: "transparent", color: "inherit" }}>
                  <span style={{ color: "var(--gold-2)" }}>{RES_ICON(r.resource_type)}</span>
                  <span style={{ fontSize: ".88rem" }}>{r.title}</span>
                  {r.is_youtube && <span className="chip-mini" style={{ marginLeft: "auto" }}>YouTube</span>}
                </button>
              ))}
            </div>
          )}

          {course.quiz && (
            <button className="btn btn-ghost press" style={{ marginTop: ".6rem" }}
                    onClick={() => course.quiz && h.onQuiz(course.quiz.id)}>
              {course.completed ? "Repasser le QCM" : `QCM — ${course.quiz.question_count} questions`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
