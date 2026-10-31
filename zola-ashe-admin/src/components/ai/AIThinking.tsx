"use client";

import { BrandLoader } from "@/components/BrandLoader";

const STEPS = [
  { label: "Lecture du contenu source",       threshold: 0 },
  { label: "Analyse sémantique du module",    threshold: 25 },
  { label: "Génération des questions",        threshold: 55 },
  { label: "Vérification de cohérence",       threshold: 85 },
];

/**
 * Visualisation animée de la génération IA - réutilise le loader de marque de
 * l'application (même logo, même animation partout) + texte scintillant + étapes.
 * Utilisée pendant le polling du job (G-01/G-02) et lors d'une régénération.
 */
export function AIThinking({ progress, statusLabel }: { progress: number; statusLabel?: string }) {
  return (
    <div style={{ padding: "1.75rem 1rem 1.25rem", textAlign: "center" }}>
      <BrandLoader label="" full={false} />

      <div className="ai-shimmer-text" style={{ fontSize: "0.95rem", marginTop: "1.15rem" }}>
        {statusLabel ?? "L'agent IA Gemini 3.5 analyse le contenu…"}
      </div>

      <div style={{ maxWidth: 320, margin: "1.1rem auto 0" }}>
        <div className="ai-progress-track">
          <div className="ai-progress-fill" style={{ width: `${Math.max(4, progress)}%` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: ".4rem" }}>
          <span style={{ fontSize: ".72rem", color: "var(--muted-2)" }}>Génération en cours</span>
          <span style={{ fontSize: ".72rem", color: "var(--muted-2)", fontVariantNumeric: "tabular-nums" }}>
            {progress}%
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 300, margin: "1.5rem auto 0", textAlign: "left" }}>
        {STEPS.map((step, i) => {
          const nextThreshold = STEPS[i + 1]?.threshold ?? 100;
          const state = progress >= nextThreshold ? "done" : progress >= step.threshold ? "active" : "pending";
          return (
            <div key={step.label} className="ai-step" data-state={state}>
              <span className="ai-step__dot" />
              {state === "done" ? `✓ ${step.label}` : step.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mini-variante inline pour une régénération de question isolée (G-03). */
export function AIThinkingInline({ label = "Régénération…" }: { label?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: ".45rem", color: "var(--gold-2)", fontSize: ".82rem", fontWeight: 600 }}>
      <span className="ai-typing"><span /><span /><span /></span>
      {label}
    </span>
  );
}
