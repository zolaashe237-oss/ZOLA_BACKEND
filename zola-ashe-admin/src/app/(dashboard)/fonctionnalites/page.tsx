"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { featureSettingsApi } from "@/lib/endpoints";
import type { FeatureSettings } from "@/lib/types";
import { Alert, Badge, Card, errorMessage } from "@/components/ui";
import { ConfirmModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

type Patch = Parameters<typeof featureSettingsApi.update>[0];

// ── Interrupteur ──────────────────────────────────────────────────────────────

function Switch({ checked, disabled, onChange, label }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 999, flexShrink: 0, padding: 0, position: "relative",
        border: "1px solid var(--line-med)",
        background: checked ? "var(--ok)" : "var(--line-soft)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background .15s",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 22 : 2, width: 18, height: 18,
        borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)",
        transition: "left .15s",
      }} />
    </button>
  );
}

function Row({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
      padding: "1rem 0", borderBottom: "1px solid var(--line-soft)",
    }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: "block", color: "var(--cream)", fontSize: ".95rem" }}>{title}</strong>
        <p style={{ margin: ".25rem 0 0", color: "var(--muted)", fontSize: ".84rem", lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

const SECTION_HINTS: Record<string, string> = {
  formations:   "Masque l'onglet uniquement : le catalogue public reste accessible.",
  progression:  "Masque l'onglet uniquement.",
  transactions: "Masque l'onglet uniquement : les paiements restent possibles.",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FonctionnalitesPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<FeatureSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmMonthly, setConfirmMonthly] = useState<boolean | null>(null);
  const [confirmQuizOn, setConfirmQuizOn] = useState(false);

  useEffect(() => {
    featureSettingsApi.get()
      .then(({ data }) => setSettings(data))
      .catch((e) => setLoadError(errorMessage(e)));
  }, []);

  async function save(key: string, patch: Patch) {
    setSaving(key);
    try {
      const { data } = await featureSettingsApi.update(patch);
      setSettings(data);
      if (data.members_reactivated !== undefined) {
        toast(`Cotisation mensuelle désactivée · ${data.members_reactivated} membre(s) réactivé(s)`);
      } else if (data.subscriptions_extended !== undefined) {
        toast(`Cotisation mensuelle réactivée · ${data.subscriptions_extended} échéance(s) repoussée(s) à J+7`);
      } else {
        toast("Paramètres enregistrés");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(null);
    }
  }

  function toggleSection(key: string, visible: boolean) {
    if (!settings) return;
    const hidden = visible
      ? settings.hidden_sections.filter((s) => s !== key)
      : [...settings.hidden_sections, key];
    save(`section:${key}`, { hidden_sections: hidden });
  }

  if (loadError) return <Card><p style={{ color: "var(--danger)", margin: 0 }}>{loadError}</p></Card>;
  if (!settings) return <p className="text-muted">Chargement…</p>;

  const hiddenCount = settings.hidden_sections.length;
  const ai = settings.ai_credits;
  const quotaErrorDate = ai.quota_error_at
    ? new Date(ai.quota_error_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const billingLink = ai.billing_url ? (
    <a href={ai.billing_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700 }}>
      console de facturation {ai.provider_label} ↗
    </a>
  ) : <>console de facturation de votre fournisseur IA</>;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Plateforme</div>
        <h1>Fonctionnalités</h1>
        <p>Activez ou désactivez des fonctionnalités pour tous les membres. Les changements s&apos;appliquent dès le prochain chargement de page des membres.</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 820 }}>
        <Card>
          <h3 style={{ margin: "0 0 .25rem" }}>Fonctionnalités globales</h3>

          <Row
            title="Quiz & QCM"
            description={settings.quiz_enabled
              ? "Les membres passent les QCM des cours et les examens finaux."
              : "QCM masqués et inaccessibles. Les cours ne sont plus verrouillés par les quiz : regarder les vidéos suffit pour progresser."}
          >
            <Switch
              label="Quiz & QCM"
              checked={settings.quiz_enabled}
              disabled={saving === "quiz"}
              onChange={(v) => (v ? setConfirmQuizOn(true) : save("quiz", { quiz_enabled: false }))}
            />
          </Row>
          {settings.quiz_enabled && quotaErrorDate && (
            <div style={{ marginTop: "1rem" }}>
              <Alert>
                Crédits IA épuisés : la dernière génération de quiz a échoué le {quotaErrorDate} faute de
                crédits ({ai.provider_label}). Rechargez votre compte sur la {billingLink}.
              </Alert>
            </div>
          )}

          <Row
            title="Cotisation mensuelle"
            description={settings.monthly_subscription_enabled
              ? "Les adhérents règlent une cotisation mensuelle pour garder leur accès."
              : "Aucune cotisation exigée : l'offre mensuelle est masquée, l'accès des adhérents n'expire plus et aucune relance n'est envoyée."}
          >
            <Switch
              label="Cotisation mensuelle"
              checked={settings.monthly_subscription_enabled}
              disabled={saving === "monthly"}
              onChange={(v) => setConfirmMonthly(v)}
            />
          </Row>
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
            <h3 style={{ margin: 0 }}>Sections de l&apos;espace membre</h3>
            {hiddenCount > 0 && <Badge color="var(--terra)">{hiddenCount} masquée{hiddenCount > 1 ? "s" : ""}</Badge>}
          </div>
          <p style={{ margin: ".35rem 0 0", color: "var(--muted)", fontSize: ".84rem" }}>
            Une section masquée disparaît du menu des membres et n&apos;est plus accessible, y compris par lien direct.
          </p>

          {settings.available_sections.map(({ key, label }) => {
            const visible = !settings.hidden_sections.includes(key);
            return (
              <Row
                key={key}
                title={label}
                description={visible ? "Visible" : `Masquée. ${SECTION_HINTS[key] ?? ""}`.trim()}
              >
                <Switch
                  label={label}
                  checked={visible}
                  disabled={saving === `section:${key}`}
                  onChange={(v) => toggleSection(key, v)}
                />
              </Row>
            );
          })}
        </Card>
      </div>

      {confirmQuizOn && (
        <ConfirmModal
          title="Réactiver les quiz ?"
          message={<>
            Les quiz reposent sur l&apos;IA ({ai.provider_label}) pour générer les questions et corriger
            les réponses rédigées des membres. <strong>Pensez à vérifier vos crédits (tokens)</strong> :
            ils ont pu s&apos;épuiser pendant la désactivation. Sans crédits, la génération et la
            correction automatique échoueront. Vérifiez et rechargez sur la {billingLink}.
            {quotaErrorDate && (
              <span style={{ display: "block", marginTop: ".6rem", color: "var(--danger)", fontWeight: 600 }}>
                Dernier échec pour crédits épuisés détecté le {quotaErrorDate}.
              </span>
            )}
            {!ai.enabled && (
              <span style={{ display: "block", marginTop: ".6rem", color: "var(--danger)", fontWeight: 600 }}>
                L&apos;agent IA est désactivé côté serveur (AI_ENABLED=False).
              </span>
            )}
          </>}
          confirmLabel="Réactiver les quiz"
          variant="primary"
          onConfirm={() => save("quiz", { quiz_enabled: true })}
          onClose={() => setConfirmQuizOn(false)}
        />
      )}

      {confirmMonthly !== null && (
        <ConfirmModal
          title={confirmMonthly ? "Réactiver la cotisation mensuelle ?" : "Désactiver la cotisation mensuelle ?"}
          message={confirmMonthly
            ? "Les membres devront de nouveau payer leur cotisation. Les échéances déjà dépassées seront repoussées à J+7 pour leur laisser le temps de régler (avec rappels)."
            : "Plus aucune cotisation ne sera demandée. Les adhérents restreints pour retard de cotisation seront réactivés immédiatement."}
          confirmLabel={confirmMonthly ? "Réactiver" : "Désactiver"}
          variant={confirmMonthly ? "primary" : "danger"}
          onConfirm={() => save("monthly", { monthly_subscription_enabled: confirmMonthly })}
          onClose={() => setConfirmMonthly(null)}
        />
      )}
    </div>
  );
}
