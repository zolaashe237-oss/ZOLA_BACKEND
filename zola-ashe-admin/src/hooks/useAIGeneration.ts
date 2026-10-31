"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { aiQuizApi } from "@/lib/endpoints";
import type { AIGenerationConfig, AIGeneratedQuestion, AIDifficulty } from "@/lib/types";

export type AIGenerationPhase = "idle" | "generating" | "done" | "error";

interface State {
  phase: AIGenerationPhase;
  progress: number;
  questions: AIGeneratedQuestion[];
  niveauSuggere: AIDifficulty | null;
  rangSuggere: number | null;
  error: string;
}

const INITIAL: State = {
  phase: "idle", progress: 0, questions: [], niveauSuggere: null, rangSuggere: null,
  error: "",
};

const POLL_MS = 550;
/** Blips réseau transitoires tolérés avant d'abandonner le polling (utile une fois branché sur l'API réelle). */
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

/** Orchestre le cycle POST generate-ai/ → polling GET generate-ai/{job_id}/ (G-01/G-02). */
export function useAIGeneration() {
  const [state, setState] = useState<State>(INITIAL);
  const timer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobId      = useRef<string | null>(null);
  const stopped    = useRef(false);
  const failCount  = useRef(0);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const poll = useCallback(() => {
    if (!jobId.current || stopped.current) return;
    aiQuizApi.status(jobId.current)
      .then((job) => {
        if (stopped.current) return;
        failCount.current = 0;
        if (job.status === "DONE") {
          setState({
            phase: "done", progress: 100,
            questions: job.questions ?? [],
            niveauSuggere: job.niveau_suggere ?? null,
            rangSuggere: job.rang_suggere ?? null,
            error: "",
          });
          return;
        }
        if (job.status === "FAILED") {
          setState((s) => ({ ...s, phase: "error", error: job.error || "La génération IA a échoué." }));
          return;
        }
        setState((s) => ({ ...s, progress: job.progress }));
        timer.current = setTimeout(poll, POLL_MS);
      })
      .catch((e) => {
        if (stopped.current) return;
        failCount.current += 1;
        // Blip réseau isolé : on retente silencieusement plutôt que d'abandonner la génération.
        if (failCount.current < MAX_CONSECUTIVE_POLL_FAILURES) {
          timer.current = setTimeout(poll, POLL_MS);
          return;
        }
        setState((s) => ({ ...s, phase: "error", error: e?.message || "Impossible de suivre la génération." }));
      });
  }, []);

  const start = useCallback(async (config: AIGenerationConfig) => {
    stopped.current = false;
    failCount.current = 0;
    clearTimer();
    setState({ ...INITIAL, phase: "generating" });
    try {
      const { job_id } = await aiQuizApi.generate(config);
      jobId.current = job_id;
      timer.current = setTimeout(poll, POLL_MS);
    } catch {
      setState((s) => ({ ...s, phase: "error", error: "Impossible de démarrer la génération IA." }));
    }
  }, [poll]);

  const reset = useCallback(() => {
    stopped.current = true;
    clearTimer();
    jobId.current = null;
    setState(INITIAL);
  }, []);

  // Coupe le polling si le composant se démonte pendant une génération
  // (ex. l'admin ferme la modal) - évite un setState après démontage.
  useEffect(() => () => {
    stopped.current = true;
    clearTimer();
  }, []);

  return { ...state, start, reset };
}
