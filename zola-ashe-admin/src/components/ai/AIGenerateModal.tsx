"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { Alert, Button } from "@/components/ui";
import { useAIGeneration } from "@/hooks/useAIGeneration";
import { audioApi, courseApi, libraryApi, moduleApi, resourceApi, asList } from "@/lib/endpoints";
import type {
  AIDifficulty, AIGeneratedQuestion, AIGenerationConfig, AISourceType,
  AudioItem, Formation, LibraryPdf, ModuleItem,
} from "@/lib/types";
import { AIThinking } from "./AIThinking";

// ── Constantes ────────────────────────────────────────────────────────────────

const DIFFICULTIES: { value: AIDifficulty; label: string; hint: string }[] = [
  { value: "FACILE",        label: "Facile",        hint: "Rappel de notions de base" },
  { value: "INTERMEDIAIRE", label: "Intermédiaire", hint: "Application et analyse" },
  { value: "DIFFICILE",     label: "Difficile",     hint: "Réflexion et synthèse" },
];

const FORMATION_SOURCES: { value: AISourceType; label: string; hint: string; icon: string }[] = [
  { value: "SCRIPT", label: "Script vidéo", hint: "Transcription YouTube du module", icon: "▶" },
  { value: "PDF",    label: "Document PDF", hint: "Contenu extrait du PDF associé",  icon: "▤" },
];

type ContentKind = "FORMATION" | "LIVRE" | "AUDIO";

const CONTENT_KINDS: { value: ContentKind; label: string; icon: string }[] = [
  { value: "FORMATION", label: "Formation",  icon: "🎓" },
  { value: "LIVRE",     label: "Livre",      icon: "📚" },
  { value: "AUDIO",     label: "Audio",      icon: "🎵" },
];

// ── Types exportés ────────────────────────────────────────────────────────────

export interface AIGenerateTarget {
  formationId: number;
  formationTitle: string;
  moduleId?: number | null;
  courseId?: number | null;
  contextLabel: string;
}

export interface AIGenerateResult {
  questions: AIGeneratedQuestion[];
  config: AIGenerationConfig;
  niveauSuggere: AIDifficulty | null;
  rangSuggere: number | null;
  targetFormationId: number | null;
  targetCourseId: number | null;
  targetLibraryPdfId?: number | null;
  targetAudioId?: number | null;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function AIGenerateModal({
  formations,
  preset,
  onClose,
  onGenerated,
}: {
  formations: Formation[];
  preset?: AIGenerateTarget | null;
  onClose: () => void;
  onGenerated: (result: AIGenerateResult) => void;
}) {
  // Mode imposé par le preset (raccourci ligne tableau) → toujours FORMATION
  const forcedKind: ContentKind = "FORMATION";
  const [contentKind, setContentKind] = useState<ContentKind>(preset ? forcedKind : "FORMATION");

  // ── États FORMATION ──────────────────────────────────────────────────────
  const [formationId, setFormationId] = useState<string>(preset ? String(preset.formationId) : "");
  const [modules,      setModules]     = useState<ModuleItem[]>([]);
  const [moduleId,     setModuleId]    = useState<string>(preset?.moduleId ? String(preset.moduleId) : "");
  const [loadingMods,  setLoadingMods] = useState(false);
  const [youtubeUrl,   setYoutubeUrl]     = useState("");
  const [pdfResourceId, setPdfResourceId] = useState("");
  const [loadingResources, setLoadingResources] = useState(false);
  const [allChapterUrls,   setAllChapterUrls]   = useState<string[]>([]);
  const [loadingFinalExam, setLoadingFinalExam] = useState(false);
  const [formationSource, setFormationSource] = useState<AISourceType>("SCRIPT");

  // ── États LIVRE ──────────────────────────────────────────────────────────
  const [libraryPdfs,    setLibraryPdfs]    = useState<LibraryPdf[]>([]);
  const [selectedPdfId,  setSelectedPdfId]  = useState("");
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  // ── États AUDIO ──────────────────────────────────────────────────────────
  const [audios,          setAudios]          = useState<AudioItem[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [loadingAudio,    setLoadingAudio]    = useState(false);

  // ── Paramètres communs ───────────────────────────────────────────────────
  const [nbQuestions, setNbQuestions] = useState(8);
  const [nbQcm,       setNbQcm]       = useState(4);
  const [nbQcmMulti,  setNbQcmMulti]  = useState(2);
  const [difficulty,  setDifficulty]  = useState<AIDifficulty>("INTERMEDIAIRE");
  const [formError,   setFormError]   = useState("");

  const gen = useAIGeneration();

  // ── Examen final : quand preset.courseId === null ────────────────────────
  const isFinalExam = !!(preset && preset.courseId === null);

  // ── Chargements FORMATION ─────────────────────────────────────────────────

  useEffect(() => {
    if (contentKind !== "FORMATION") return;
    const targetId = preset ? preset.formationId : (formationId ? Number(formationId) : null);
    if (!targetId) { setModules([]); setModuleId(""); return; }
    setLoadingMods(true);
    moduleApi.list(targetId)
      .then((r) => {
        const mods = asList(r.data);
        setModules(mods);
        if (preset?.moduleId) setModuleId(String(preset.moduleId));
        else if (mods.length > 0) setModuleId(String(mods[0].id));
      })
      .catch(() => setModules([]))
      .finally(() => setLoadingMods(false));
  }, [formationId, preset, contentKind]);

  useEffect(() => {
    if (contentKind !== "FORMATION") return;
    if (!isFinalExam || modules.length === 0) return;
    setLoadingFinalExam(true);
    setAllChapterUrls([]);
    Promise.all(
      modules.map(async (m) => {
        try {
          const courses = asList((await courseApi.list(m.id)).data);
          if (!courses.length) return null;
          const resources = asList((await resourceApi.list(courses[0].id)).data);
          const v = resources.find((r) => r.resource_type === "VIDEO" && r.video_source === "YOUTUBE");
          return v?.youtube_url ?? null;
        } catch { return null; }
      }),
    )
      .then((urls) => setAllChapterUrls(urls.filter(Boolean) as string[]))
      .finally(() => setLoadingFinalExam(false));
  }, [isFinalExam, modules, contentKind]);

  useEffect(() => {
    if (contentKind !== "FORMATION" || isFinalExam || !moduleId) {
      setYoutubeUrl(""); setPdfResourceId(""); return;
    }
    setLoadingResources(true);
    setYoutubeUrl(""); setPdfResourceId("");
    courseApi.list(Number(moduleId))
      .then(async (res) => {
        const courses = asList(res.data);
        if (courses.length > 0) {
          const resList = asList((await resourceApi.list(courses[0].id)).data);
          const vid = resList.find((r) => r.resource_type === "VIDEO" && r.video_source === "YOUTUBE");
          if (vid?.youtube_url) setYoutubeUrl(vid.youtube_url);
          const pdf = resList.find((r) => r.resource_type === "PDF");
          if (pdf?.id) setPdfResourceId(String(pdf.id));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingResources(false));
  }, [isFinalExam, moduleId, contentKind]);

  // ── Chargements LIVRE ─────────────────────────────────────────────────────

  useEffect(() => {
    if (contentKind !== "LIVRE" || libraryPdfs.length > 0) return;
    setLoadingLibrary(true);
    libraryApi.listActive()
      .then((pdfs) => { setLibraryPdfs(pdfs); if (pdfs.length > 0) setSelectedPdfId(String(pdfs[0].id)); })
      .catch(() => setLibraryPdfs([]))
      .finally(() => setLoadingLibrary(false));
  }, [contentKind, libraryPdfs.length]);

  // ── Chargements AUDIO ─────────────────────────────────────────────────────

  useEffect(() => {
    if (contentKind !== "AUDIO" || audios.length > 0) return;
    setLoadingAudio(true);
    audioApi.list()
      .then((r) => {
        const list = asList(r.data);
        setAudios(list);
        if (list.length > 0) setSelectedAudioId(String(list[0].id));
      })
      .catch(() => setAudios([]))
      .finally(() => setLoadingAudio(false));
  }, [contentKind, audios.length]);

  // ── Dérivés ───────────────────────────────────────────────────────────────

  const nbQro = nbQuestions - nbQcm - nbQcmMulti;
  const totalQcm = nbQcm + nbQcmMulti;
  const questionsValid = nbQuestions >= 5 && nbQuestions <= 20 && totalQcm >= 0 && totalQcm <= nbQuestions && nbQro >= 0;

  const formationTitle = preset?.formationTitle ?? formations.find((f) => String(f.id) === formationId)?.title ?? "";
  const moduleTitle    = preset?.contextLabel   ?? modules.find((m) => String(m.id) === moduleId)?.title ?? "";

  const isSourceMissing = !isFinalExam &&
    ((formationSource === "SCRIPT" && !youtubeUrl) || (formationSource === "PDF" && !pdfResourceId));

  const canSubmit: boolean = (() => {
    if (!questionsValid) return false;
    if (contentKind === "FORMATION") {
      if (isFinalExam) return !loadingFinalExam && allChapterUrls.length > 0;
      return !!formationTitle && !!moduleId && !loadingResources && !isSourceMissing;
    }
    if (contentKind === "LIVRE")  return !!selectedPdfId  && !loadingLibrary;
    if (contentKind === "AUDIO")  return !!selectedAudioId && !loadingAudio;
    return false;
  })();

  // ── Construction config ───────────────────────────────────────────────────

  const buildConfig = (): AIGenerationConfig => {
    const ratio = nbQuestions > 0 ? (nbQcm + nbQcmMulti) / nbQuestions : 0.6;
    const base = { nb_questions: nbQuestions, nb_qcm: nbQcm, nb_qcm_multi: nbQcmMulti, nb_qro: nbQro, difficulty, ratio_qcm_qro: ratio };

    if (contentKind === "LIVRE") {
      const pdf = libraryPdfs.find((p) => String(p.id) === selectedPdfId);
      return {
        ...base, source: "LIBRARY_PDF",
        formation: null, course: null, moduleId: null,
        formation_title: pdf?.title ?? "", module_title: pdf?.title ?? "",
        source_ref: selectedPdfId, source_text: "",
        library_pdf: Number(selectedPdfId),
      };
    }

    if (contentKind === "AUDIO") {
      const audio = audios.find((a) => String(a.id) === selectedAudioId);
      return {
        ...base, source: "AUDIO",
        formation: null, course: null, moduleId: null,
        formation_title: audio?.title ?? "", module_title: audio?.title ?? "",
        source_ref: selectedAudioId, source_text: "",
        audio_id: Number(selectedAudioId),
      };
    }

    // FORMATION
    if (isFinalExam) {
      return {
        ...base, source: "MULTI_YOUTUBE",
        formation: preset!.formationId, course: null,
        formation_title: formationTitle, module_title: `Examen final — ${formationTitle}`,
        moduleId: modules[0]?.id ?? null,
        source_ref: allChapterUrls.join(","), source_text: "",
      };
    }
    return {
      ...base, source: formationSource,
      formation: preset ? preset.formationId : (formationId ? Number(formationId) : undefined),
      course: preset ? (preset.courseId ?? null) : null,
      formation_title: formationTitle, module_title: moduleTitle,
      moduleId: Number(moduleId),
      source_ref: formationSource === "SCRIPT" ? youtubeUrl : pdfResourceId,
      source_text: "",
    };
  };

  // ── Soumission ────────────────────────────────────────────────────────────

  const submit = async () => {
    setFormError("");
    if (contentKind === "FORMATION") {
      if (!formationTitle) { setFormError("Choisissez une formation cible."); return; }
      if (isSourceMissing) {
        setFormError(formationSource === "SCRIPT"
          ? "Le module sélectionné n'a pas de vidéo YouTube."
          : "Le module sélectionné n'a pas de document PDF.");
        return;
      }
    }
    if (contentKind === "LIVRE" && !selectedPdfId)  { setFormError("Sélectionnez un livre."); return; }
    if (contentKind === "AUDIO" && !selectedAudioId) { setFormError("Sélectionnez un audio."); return; }
    await gen.start(buildConfig());
  };

  // Remonte le résultat au parent dès que le job est DONE.
  useEffect(() => {
    if (gen.phase !== "done") return;
    const config = buildConfig();
    onGenerated({
      questions:          gen.questions,
      config,
      niveauSuggere:      gen.niveauSuggere,
      rangSuggere:        gen.rangSuggere,
      targetFormationId:  contentKind === "FORMATION" ? (config.formation ?? Number(formationId) ?? null) : null,
      targetCourseId:     config.course ?? null,
      targetLibraryPdfId: contentKind === "LIVRE"  ? Number(selectedPdfId)   : null,
      targetAudioId:      contentKind === "AUDIO"  ? Number(selectedAudioId) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen.phase]);

  const generating = gen.phase === "generating";

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <Modal onClose={onClose} title="Générer un quiz avec l'IA" maxWidth={580}>
      {gen.phase === "error" ? (
        <div>
          <Alert>{gen.error}</Alert>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button onClick={submit}>Réessayer</Button>
          </div>
        </div>
      ) : generating ? (
        <AIThinking progress={gen.progress} />
      ) : (
        <div>
          <Alert>{formError}</Alert>

          {/* ── Sélecteur de type de contenu (masqué en mode preset) ── */}
          {!preset && (
            <div style={{ marginBottom: "1.2rem" }}>
              <span className="field-label">Type de contenu source</span>
              <div style={{ display: "flex", gap: ".5rem" }}>
                {CONTENT_KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    className={`chip press ${contentKind === k.value ? "on" : ""}`}
                    onClick={() => { setContentKind(k.value); setFormError(""); }}
                  >
                    {k.icon} {k.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ────────── FORMATION ────────── */}
          {contentKind === "FORMATION" && (
            <>
              {preset ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap",
                  padding: ".65rem .85rem", marginBottom: "1.1rem",
                  background: "var(--bg-2)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)",
                }}>
                  <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>Cible :</span>
                  <strong style={{ fontSize: ".85rem", color: "var(--cream)" }}>{preset.formationTitle}</strong>
                  <span style={{ fontSize: ".78rem", color: "var(--muted-2)" }}>— {preset.contextLabel}</span>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".75rem", marginBottom: "1.1rem" }}>
                  <label style={{ display: "block" }}>
                    <span className="field-label">Formation cible</span>
                    <select className="select" value={formationId}
                            onChange={(e) => { setFormationId(e.target.value); setModuleId(""); }}>
                      <option value="">— Choisir une formation —</option>
                      {formations.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block" }}>
                    <span className="field-label">Module (optionnel)</span>
                    <select className="select" value={moduleId} onChange={(e) => setModuleId(e.target.value)}
                            disabled={!formationId || loadingMods}>
                      <option value="">{loadingMods ? "Chargement…" : "Formation entière (examen)"}</option>
                      {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {/* Source d'extraction */}
              <div style={{ marginBottom: "1.4rem" }}>
                <span className="field-label">Source d&apos;extraction</span>
                {isFinalExam ? (
                  <div style={{
                    marginTop: ".4rem", padding: ".55rem .75rem",
                    background: "var(--bg-2)", border: "1px solid var(--line-soft)",
                    borderRadius: "var(--radius-sm)", fontSize: ".82rem",
                  }}>
                    {loadingFinalExam ? (
                      <span style={{ color: "var(--gold-2)" }}>Collecte des vidéos de la formation…</span>
                    ) : allChapterUrls.length > 0 ? (
                      <span style={{ color: "var(--ok)" }}>
                        ✓ {allChapterUrls.length} vidéo{allChapterUrls.length > 1 ? "s" : ""} collectée{allChapterUrls.length > 1 ? "s" : ""}
                        {" "}<span style={{ color: "var(--muted)" }}>sur {modules.length} chapitre{modules.length > 1 ? "s" : ""}</span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--bad)" }}>⚠️ Aucune vidéo YouTube trouvée dans cette formation.</span>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                      {FORMATION_SOURCES.map((s) => (
                        <button key={s.value} type="button"
                                className={`chip press ${formationSource === s.value ? "on" : ""}`}
                                onClick={() => setFormationSource(s.value)}
                                title={s.hint} disabled={loadingResources}>
                          {s.icon} {s.label}
                        </button>
                      ))}
                    </div>
                    {loadingResources && (
                      <p style={{ color: "var(--gold-2)", fontSize: ".78rem", marginTop: ".35rem" }}>Chargement des ressources…</p>
                    )}
                    {!loadingResources && formationSource === "SCRIPT" && !youtubeUrl && moduleId && (
                      <p style={{ color: "var(--bad)", fontSize: ".78rem", marginTop: ".35rem" }}>⚠️ Aucun script vidéo (YouTube) trouvé pour ce module.</p>
                    )}
                    {!loadingResources && formationSource === "PDF" && !pdfResourceId && moduleId && (
                      <p style={{ color: "var(--bad)", fontSize: ".78rem", marginTop: ".35rem" }}>⚠️ Aucun document PDF trouvé pour ce module.</p>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* ────────── LIVRE ────────── */}
          {contentKind === "LIVRE" && (
            <div style={{ marginBottom: "1.2rem" }}>
              <label style={{ display: "block" }}>
                <span className="field-label">Livre source</span>
                {loadingLibrary ? (
                  <p style={{ color: "var(--gold-2)", fontSize: ".82rem" }}>Chargement des livres…</p>
                ) : libraryPdfs.length === 0 ? (
                  <p style={{ color: "var(--bad)", fontSize: ".82rem" }}>⚠️ Aucun livre actif trouvé dans la bibliothèque.</p>
                ) : (
                  <select className="select" value={selectedPdfId} onChange={(e) => setSelectedPdfId(e.target.value)}>
                    {libraryPdfs.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                )}
              </label>
              {selectedPdfId && (
                <p style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: ".35rem" }}>
                  📚 L&apos;IA utilisera la transcription du PDF pour générer les questions.
                </p>
              )}
            </div>
          )}

          {/* ────────── AUDIO ────────── */}
          {contentKind === "AUDIO" && (
            <div style={{ marginBottom: "1.2rem" }}>
              <label style={{ display: "block" }}>
                <span className="field-label">Audio source</span>
                {loadingAudio ? (
                  <p style={{ color: "var(--gold-2)", fontSize: ".82rem" }}>Chargement des audios…</p>
                ) : audios.length === 0 ? (
                  <p style={{ color: "var(--bad)", fontSize: ".82rem" }}>⚠️ Aucun audio trouvé dans l&apos;audiothèque.</p>
                ) : (
                  <select className="select" value={selectedAudioId} onChange={(e) => setSelectedAudioId(e.target.value)}>
                    {audios.map((a) => (
                      <option key={a.id} value={a.id}>{a.title}</option>
                    ))}
                  </select>
                )}
              </label>
              {selectedAudioId && (
                <p style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: ".35rem" }}>
                  🎵 L&apos;IA utilisera la transcription de cet audio pour générer les questions.
                </p>
              )}
            </div>
          )}

          {/* ────────── Paramètres communs ────────── */}

          {/* Nombre de questions */}
          <div style={{ marginBottom: "1.1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
              <span className="field-label" style={{ marginBottom: 0 }}>Nombre de questions</span>
              <span style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--gold-2)" }}>{nbQuestions}</span>
            </div>
            <input
              type="range" min={5} max={20} value={nbQuestions}
              onChange={(e) => {
                const n = Number(e.target.value);
                setNbQuestions(n);
                setNbQcm((prev) => Math.min(prev, n));
                setNbQcmMulti((prev) => Math.min(prev, Math.max(0, n - nbQcm)));
              }}
              style={{ width: "100%", accentColor: "var(--gold)" }}
            />
          </div>

          {/* Répartition QCM / QCM multi / QRO */}
          <div style={{ marginBottom: "1.2rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".35rem" }}>
              <span className="field-label" style={{ marginBottom: 0 }}>Répartition</span>
              <span style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--gold-2)" }}>
                {nbQcm} QCM
                {nbQcmMulti > 0 && <> + <span style={{ color: "#8b5cf6" }}>{nbQcmMulti} QCM ☑</span></>}
                {" "}+ {nbQro} QRO
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".35rem" }}>
              <span style={{ fontSize: ".73rem", color: "var(--muted-2)", minWidth: 90 }}>QCM (1 réponse)</span>
              <input type="range" min={0} max={Math.max(0, nbQuestions - nbQcmMulti)} value={nbQcm}
                     onChange={(e) => setNbQcm(Number(e.target.value))}
                     style={{ flex: 1, accentColor: "var(--terra-2)" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <span style={{ fontSize: ".73rem", color: "#8b5cf6", minWidth: 90 }}>QCM multi ☑</span>
              <input type="range" min={0} max={Math.max(0, nbQuestions - nbQcm)} value={nbQcmMulti}
                     onChange={(e) => setNbQcmMulti(Number(e.target.value))}
                     style={{ flex: 1, accentColor: "#8b5cf6" }} />
            </div>
          </div>

          {/* Difficulté */}
          <div style={{ marginBottom: "1.4rem" }}>
            <span className="field-label">Niveau de difficulté</span>
            <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              {DIFFICULTIES.map((d) => (
                <button key={d.value} type="button"
                        className={`chip press ${difficulty === d.value ? "on" : ""}`}
                        onClick={() => setDifficulty(d.value)} title={d.hint}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem" }}>
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button onClick={submit} disabled={!canSubmit}>✨ Générer le quiz</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
