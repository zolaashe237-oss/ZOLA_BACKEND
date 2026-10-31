"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { financeApi, formationApi, plansApi } from "@/lib/endpoints";
import type { Formation, PlanKind, SubscriptionPlan } from "@/lib/types";
import { Button, Input, Select, errorMessage } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

/** Paiements validables à la main (WhatsApp, espèces…) — dont l'achat d'une formation seule. */
type ManualKind = PlanKind | "FORMATION";

const KIND_LABELS: Record<ManualKind, string> = {
  INSCRIPTION:    "Inscription annuelle",
  COTISATION:     "Inscription mensuelle",
  BRANCHE_FEMME:  "Accès Branche Femme",
  BRANCHE_ENFANT: "Accès Branche Enfant",
  DON:            "Don volontaire",
  FORMATION:      "Achat d'une formation",
};
const KINDS: ManualKind[] = ["INSCRIPTION", "COTISATION", "BRANCHE_FEMME", "BRANCHE_ENFANT", "FORMATION", "DON"];

const asList = <T,>(data: T[] | { results?: T[] }): T[] => (Array.isArray(data) ? data : data.results ?? []);

export default function ManualPaymentModal({ userId, userName, onClose, onDone }: {
  userId: number;
  userName?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind,        setKind]        = useState<ManualKind>("INSCRIPTION");
  const [amount,      setAmount]      = useState("");
  const [plans,       setPlans]       = useState<SubscriptionPlan[]>([]);
  const [formations,  setFormations]  = useState<Formation[]>([]);
  const [formationId, setFormationId] = useState("");
  const [loading,     setLoading]     = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    plansApi.list()
      .then(({ data }) => setPlans(asList<SubscriptionPlan>(data).filter((p) => p.is_active)))
      .catch(() => {});
  }, []);

  // Formations payantes (seules à verrouiller l'accès) : celles vendues à l'unité d'abord.
  useEffect(() => {
    if (kind !== "FORMATION" || formations.length) return;
    formationApi.list()
      .then(({ data }) => setFormations(
        asList<Formation>(data)
          .filter((f) => !f.is_public && f.access_subscription_types.length > 0)
          .sort((a, b) => Number(!!b.price) - Number(!!a.price) || a.title.localeCompare(b.title)),
      ))
      .catch((e) => toast(errorMessage(e), "error"));
  }, [kind, formations.length, toast]);

  const selectedFormation = formations.find((f) => String(f.id) === formationId);

  // Montant pré-rempli : prix du plan, ou prix de la formation choisie.
  useEffect(() => {
    if (kind === "FORMATION") {
      setAmount(selectedFormation?.price ? String(selectedFormation.price) : "");
    } else {
      const plan = plans.find((p) => p.kind === kind);
      setAmount(plan ? String(plan.price_total) : "");
    }
  }, [kind, plans, selectedFormation]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (kind === "FORMATION" && !selectedFormation) {
      toast("Choisissez la formation à débloquer.", "error");
      return;
    }
    setLoading(true);
    try {
      await financeApi.manual({
        user_id: userId,
        kind,
        amount:  amount ? Number(amount) : undefined,
        formation_id: kind === "FORMATION" ? selectedFormation?.id : undefined,
        reason:  kind === "FORMATION"
          ? `Paiement manuel — Formation « ${selectedFormation?.title} »`
          : `Paiement manuel — ${KIND_LABELS[kind]}`,
      });
      onDone(); onClose();
    } catch (err) { toast(errorMessage(err), "error"); }
    finally { setLoading(false); }
  };

  const activePlan = plans.find((p) => p.kind === kind);
  const amountLabel = kind === "FORMATION"
    ? (selectedFormation?.price ? "Montant (FCFA) — prix de la formation" : "Montant encaissé (FCFA)")
    : (activePlan ? "Montant (FCFA) — pré-rempli depuis le plan" : "Montant (FCFA)");

  return (
    <Modal title="Valider un paiement manuel" onClose={onClose} maxWidth={460}>
      {userName && (
        <div style={{ marginBottom: "1rem", padding: "0.55rem 0.75rem", background: "var(--bg-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-soft)", fontSize: ".84rem", color: "var(--muted)" }}>
          Membre : <strong style={{ color: "var(--ink)" }}>{userName}</strong>
        </div>
      )}
      <form onSubmit={submit}>
        <div style={{ marginBottom: "1rem" }}>
          <span className="field-label">Type de paiement</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.4rem" }}>
            {KINDS.map((k) => {
              const p = plans.find((pl) => pl.kind === k);
              const active = kind === k;
              return (
                <label key={k} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: "0.6rem", padding: "0.45rem 0.75rem",
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${active ? "rgba(201,162,39,0.5)" : "var(--line-soft)"}`,
                  background: active ? "rgba(201,162,39,0.07)" : "var(--bg)",
                  cursor: "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input type="radio" name="kind" value={k} checked={active}
                      onChange={() => setKind(k)} style={{ accentColor: "var(--gold-2)" }} />
                    <span style={{ fontSize: "0.84rem", fontWeight: active ? 700 : 400, color: active ? "var(--gold-2)" : "var(--ink)" }}>
                      {KIND_LABELS[k]}
                    </span>
                  </div>
                  {p && <span style={{ fontSize: "0.78rem", color: "var(--muted-2)", whiteSpace: "nowrap" }}>{p.price_total.toLocaleString("fr-FR")} FCFA</span>}
                </label>
              );
            })}
          </div>
        </div>

        {kind === "FORMATION" && (
          <Select label="Formation à débloquer" value={formationId} required
                  onChange={(e) => setFormationId(e.target.value)}>
            <option value="">— Choisir une formation —</option>
            {formations.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}{f.price ? ` — ${f.price.toLocaleString("fr-FR")} FCFA` : " — non vendue seule"}
              </option>
            ))}
          </Select>
        )}

        <Input
          label={amountLabel}
          type="number" min={0} value={amount} placeholder="Montant en FCFA"
          required={kind === "FORMATION" && !selectedFormation?.price}
          onChange={(e) => setAmount(e.target.value)}
        />
        {kind === "FORMATION" && (
          <p style={{ margin: "-0.4rem 0 1rem", fontSize: "0.74rem", color: "var(--muted-2)", lineHeight: 1.5 }}>
            Le membre obtient un accès permanent à cette seule formation, sans abonnement.
          </p>
        )}
        <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={loading}>Confirmer le paiement</Button>
        </div>
      </form>
    </Modal>
  );
}
