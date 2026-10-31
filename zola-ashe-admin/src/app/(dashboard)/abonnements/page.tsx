"use client";

import { useCallback, useEffect, useState } from "react";

import { plansApi } from "@/lib/endpoints";
import type { PlanBilling, PlanKind, Paginated, SubscriptionPlan } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Select, Textarea, errorMessage } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

// ── Constantes ────────────────────────────────────────────────────────────────

const ACCESS_OPTIONS = [
  { value: "MEMBRE",  label: "Espace Membre",  color: "#c9a227" },
  { value: "FEMME",   label: "Branche Femme",  color: "#b5532a" },
  { value: "ENFANT",  label: "Branche Enfant", color: "#52b083" },
];

const BILLING_LABEL: Record<PlanBilling, string> = {
  ANNUEL:   "Paiement annuel unique",
  TRANCHES: "Paiement en tranches",
  MENSUEL:  "Cotisation mensuelle",
};

const BILLING_COLOR: Record<PlanBilling, string> = {
  ANNUEL:   "#5b8fd4",
  TRANCHES: "#c9a227",
  MENSUEL:  "#52b083",
};

function fmtF(n: number) {
  return n.toLocaleString("fr-FR") + " FCFA";
}

// ── Formulaire plan (modal) ───────────────────────────────────────────────────

const KIND_OPTIONS: { value: PlanKind; label: string; hint: string }[] = [
  { value: "INSCRIPTION",    label: "Droit d'inscription",  hint: "Adhésion permanente au réseau" },
  { value: "COTISATION",     label: "Cotisation mensuelle", hint: "Maintien de l'accès actif" },
  { value: "BRANCHE_FEMME",  label: "Accès Branche Femme",  hint: "Paiement unique — accès permanent" },
  { value: "BRANCHE_ENFANT", label: "Accès Branche Enfant", hint: "Paiement unique — accès permanent" },
  { value: "DON",            label: "Don volontaire",        hint: "Contribution libre" },
];

const EMPTY: {
  kind: PlanKind;
  name: string; billing: PlanBilling;
  price_total: number; nb_tranches: number; tranche_amount: number;
  description: string; is_active: boolean; access_levels: string[];
} = {
  kind: "COTISATION",
  name: "", billing: "ANNUEL",
  price_total: 0, nb_tranches: 6, tranche_amount: 0,
  description: "", is_active: true, access_levels: ["MEMBRE"],
};

function PlanFormModal({
  initial, editing, onClose, onSaved,
}: {
  initial: typeof EMPTY; editing: number | null;
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [form,    setForm]    = useState(initial);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const toggleAccess = (level: string) =>
    setForm((prev) => ({
      ...prev,
      access_levels: prev.access_levels.includes(level)
        ? prev.access_levels.filter((l) => l !== level)
        : [...prev.access_levels, level],
    }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) { await plansApi.update(editing, form); onSaved("Plan mis à jour."); }
      else         { await plansApi.create(form);          onSaved("Plan créé."); }
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  const isTranches = form.billing === "TRANCHES";

  return (
    <Modal title={editing ? "Modifier le plan" : "Nouveau plan"} onClose={onClose} maxWidth={620}>
      <form onSubmit={submit}>
        {/* Type de plan */}
        <div style={{ marginBottom: "1rem" }}>
          <span className="field-label">Type de plan</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}>
            {KIND_OPTIONS.map((k) => {
              const active = form.kind === k.value;
              return (
                <label key={k.value} style={{
                  display: "flex", alignItems: "center", gap: "0.6rem",
                  padding: "0.5rem 0.75rem", borderRadius: "var(--radius-sm)",
                  border: `1px solid ${active ? "var(--gold-2)" : "var(--line-soft)"}`,
                  background: active ? "var(--gold-bg)" : "var(--bg)",
                  cursor: editing ? "default" : "pointer",
                  opacity: editing ? 0.6 : 1,
                }}>
                  <input
                    type="radio" name="kind" value={k.value}
                    checked={active}
                    disabled={!!editing}
                    onChange={() => setForm({ ...form, kind: k.value })}
                    style={{ accentColor: "var(--gold-2)" }}
                  />
                  <div>
                    <div style={{ fontSize: "0.84rem", fontWeight: active ? 700 : 400, color: active ? "var(--gold-2)" : "var(--ink)" }}>
                      {k.label}
                    </div>
                    <div style={{ fontSize: "0.71rem", color: "var(--muted-2)" }}>{k.hint}</div>
                  </div>
                </label>
              );
            })}
          </div>
          {editing && (
            <p style={{ fontSize: "0.72rem", color: "var(--muted-2)", marginTop: "0.35rem" }}>
              Le type ne peut pas être modifié après création.
            </p>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 1rem" }}>
          <Input
            label="Nom du plan" value={form.name} required
            placeholder="ex : Espace Membre — Annuel"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select
            label="Type de facturation" value={form.billing}
            onChange={(e) => setForm({ ...form, billing: e.target.value as PlanBilling })}
          >
            <option value="ANNUEL">Annuel (paiement unique)</option>
            <option value="TRANCHES">En tranches (mensualités)</option>
            <option value="MENSUEL">Mensuel (récurrent)</option>
          </Select>
        </div>

        {/* Prix selon le type */}
        {isTranches ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 1rem" }}>
            <Input
              label="Prix total (FCFA)" type="number" min={0} value={form.price_total}
              onChange={(e) => setForm({ ...form, price_total: +e.target.value })}
            />
            <Input
              label="Nombre de tranches" type="number" min={2} max={24} value={form.nb_tranches}
              onChange={(e) => setForm({ ...form, nb_tranches: +e.target.value })}
            />
            <Input
              label="Montant / tranche (FCFA)" type="number" min={0} value={form.tranche_amount}
              onChange={(e) => setForm({ ...form, tranche_amount: +e.target.value })}
            />
          </div>
        ) : (
          <div style={{ maxWidth: 200 }}>
            <Input
              label={form.billing === "MENSUEL" ? "Montant mensuel (FCFA)" : "Prix annuel (FCFA)"}
              type="number" min={0} value={form.price_total}
              onChange={(e) => setForm({ ...form, price_total: +e.target.value })}
            />
          </div>
        )}

        <Textarea
          label="Description (visible à l'inscription)"
          value={form.description} minRows={2} maxLength={300}
          placeholder="Ce que le membre obtient avec ce plan…"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />

        <div style={{ marginBottom: "1rem" }}>
          <span className="field-label">Niveaux d&apos;accès inclus</span>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
            {ACCESS_OPTIONS.map((ao) => (
              <label key={ao.value} style={{
                display: "flex", gap: "0.4rem", alignItems: "center",
                cursor: "pointer", fontSize: "0.85rem",
                color: form.access_levels.includes(ao.value) ? ao.color : "var(--muted)",
                fontWeight: form.access_levels.includes(ao.value) ? 600 : 400,
              }}>
                <input
                  type="checkbox"
                  checked={form.access_levels.includes(ao.value)}
                  onChange={() => toggleAccess(ao.value)}
                />
                {ao.label}
              </label>
            ))}
          </div>
        </div>

        <label style={{ display: "flex", gap: ".5rem", alignItems: "center", marginBottom: "1.25rem", fontSize: ".88rem", color: "var(--muted)" }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Plan actif (visible lors de l&apos;inscription)
        </label>

        <div style={{ display: "flex", gap: ".6rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>Annuler</Button>
          <Button type="submit" loading={loading}>
            {editing ? "Enregistrer" : "Créer le plan"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Carte plan ────────────────────────────────────────────────────────────────

function PlanCard({ p, onEdit, onToggle, onDelete }: {
  p: SubscriptionPlan;
  onEdit: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const billingColor = BILLING_COLOR[p.billing];

  return (
    <div style={{
      background: "var(--bg-1)",
      border: "1px solid var(--line-soft)",
      borderTop: `3px solid ${p.is_active ? billingColor : "var(--line-med)"}`,
      borderRadius: "var(--radius)",
      padding: "1.2rem",
      display: "flex", flexDirection: "column",
      opacity: p.is_active ? 1 : 0.65,
      transition: "box-shadow .16s",
      boxShadow: "var(--shadow-sm)",
    }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-sm)"; }}
    >
      {/* En-tête */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.9rem", gap: "0.5rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.96rem", fontWeight: 700, color: "var(--ink)", marginBottom: "0.22rem", lineHeight: 1.3 }}>
            {p.name}
          </div>
          <span style={{
            display: "inline-block", fontSize: "0.62rem", fontWeight: 700,
            letterSpacing: "0.06em", textTransform: "uppercase",
            color: billingColor, background: `${billingColor}14`,
            border: `1px solid ${billingColor}30`,
            padding: "0.06rem 0.5rem", borderRadius: 99,
          }}>
            {BILLING_LABEL[p.billing]}
          </span>
        </div>
        <span style={{
          flexShrink: 0, fontSize: "0.65rem", fontWeight: 700,
          color: p.is_active ? "#2e9460" : "var(--muted)",
          background: p.is_active ? "rgba(46,148,96,0.10)" : "rgba(154,146,132,0.10)",
          border: `1px solid ${p.is_active ? "rgba(46,148,96,0.28)" : "rgba(154,146,132,0.22)"}`,
          padding: "0.12rem 0.55rem", borderRadius: 99,
        }}>
          {p.is_active ? "● Actif" : "○ Inactif"}
        </span>
      </div>

      {/* Prix */}
      <div style={{ marginBottom: "0.85rem", padding: "0.85rem", background: "var(--bg-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-soft)" }}>
        {p.billing === "MENSUEL" ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.3rem" }}>
            <span style={{ fontSize: "1.9rem", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px", lineHeight: 1 }}>
              {p.price_total.toLocaleString("fr-FR")}
            </span>
            <span style={{ fontSize: "0.80rem", color: "var(--muted)", fontWeight: 600 }}>FCFA / mois</span>
          </div>
        ) : p.billing === "TRANCHES" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}>
              <span style={{ fontSize: "1.05rem", fontWeight: 800, color: "var(--ink)" }}>
                {p.nb_tranches} × {(p.tranche_amount ?? 0).toLocaleString("fr-FR")} FCFA
              </span>
              <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>/mois</span>
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{ color: "var(--muted-2)" }}>Total :</span>
              <span style={{ fontWeight: 600 }}>{fmtF(p.price_total)}</span>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.3rem" }}>
              <span style={{ fontSize: "1.9rem", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px", lineHeight: 1 }}>
                {p.price_total.toLocaleString("fr-FR")}
              </span>
              <span style={{ fontSize: "0.80rem", color: "var(--muted)", fontWeight: 600 }}>FCFA / an</span>
            </div>
          </>
        )}
      </div>

      {/* Description */}
      {p.description && (
        <p style={{ fontSize: "0.83rem", color: "var(--muted)", marginBottom: "0.8rem", lineHeight: 1.55, flex: 1 }}>
          {p.description}
        </p>
      )}

      {/* Accès */}
      {p.access_levels.length > 0 && (
        <div style={{ display: "flex", gap: "0.38rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
          {p.access_levels.map((al) => {
            const found = ACCESS_OPTIONS.find((a) => a.value === al);
            return (
              <span key={al} style={{
                fontSize: "0.65rem", fontWeight: 700,
                color: found?.color ?? "#a89b86",
                background: `${found?.color ?? "#a89b86"}12`,
                border: `1px solid ${found?.color ?? "#a89b86"}28`,
                padding: "0.08rem 0.45rem", borderRadius: 99,
              }}>
                {found?.label ?? al}
              </span>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div style={{ marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--line-soft)", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={onEdit} style={{ fontSize: "0.80rem", padding: "0.38rem 0.7rem" }}>✎ Éditer</Button>
        <Button variant="ghost" onClick={onToggle} style={{ fontSize: "0.80rem", padding: "0.38rem 0.7rem", color: p.is_active ? "var(--warn)" : "var(--ok)" }}>
          {p.is_active ? "Désactiver" : "Activer"}
        </Button>
        <Button variant="danger" onClick={onDelete} style={{ fontSize: "0.80rem", padding: "0.38rem 0.7rem", marginLeft: "auto" }}>Supprimer</Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const GROUPS: { key: PlanBilling; label: string; desc: string }[] = [
  { key: "ANNUEL",   label: "Abonnements annuels",    desc: "Paiement unique — accès 12 mois" },
  { key: "TRANCHES", label: "Paiement en tranches",   desc: "Mensualités sur une période définie" },
  { key: "MENSUEL",  label: "Cotisations mensuelles", desc: "Renouvellement automatique chaque mois" },
];

export default function AbonnementsPage() {
  const { toast } = useToast();
  const [items,      setItems]      = useState<SubscriptionPlan[]>([]);
  const [formTarget, setFormTarget] = useState<{ plan: SubscriptionPlan | null } | null>(null);
  const [deleteId,   setDeleteId]   = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await plansApi.list();
      setItems(Array.isArray(data) ? data : (data as Paginated<SubscriptionPlan>).results);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (p: SubscriptionPlan) => {
    try { await plansApi.toggle(p.id); await load(); }
    catch (e) { toast(errorMessage(e), "error"); }
  };

  const activeCount = items.filter((p) => p.is_active).length;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Facturation</div>
        <h1>Plans d&apos;abonnement</h1>
        <p>{items.length} plan{items.length !== 1 ? "s" : ""} · {activeCount} actif{activeCount !== 1 ? "s" : ""}</p>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1.5rem" }}>
        <Button onClick={() => setFormTarget({ plan: null })}>+ Nouveau plan</Button>
      </div>

      {/* Plans groupés par type de facturation */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {GROUPS.map((g) => {
          const groupItems = items.filter((p) => p.billing === g.key);
          if (groupItems.length === 0) return null;
          return (
            <section key={g.key}>
              {/* En-tête de groupe */}
              <div style={{
                display: "flex", alignItems: "center", gap: "0.75rem",
                padding: "0.55rem 1rem",
                background: `${BILLING_COLOR[g.key]}0d`,
                border: `1px solid ${BILLING_COLOR[g.key]}28`,
                borderLeft: `4px solid ${BILLING_COLOR[g.key]}`,
                borderRadius: "var(--radius)", marginBottom: "0.85rem",
              }}>
                <span style={{ fontSize: "0.88rem", fontWeight: 800, color: BILLING_COLOR[g.key], flex: 1 }}>{g.label}</span>
                <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{g.desc}</span>
                <span style={{
                  fontSize: "0.65rem", fontWeight: 700,
                  color: BILLING_COLOR[g.key],
                  background: `${BILLING_COLOR[g.key]}1a`,
                  border: `1px solid ${BILLING_COLOR[g.key]}38`,
                  padding: "0.08rem 0.45rem", borderRadius: 99,
                }}>
                  {groupItems.length} plan{groupItems.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.85rem" }}>
                {groupItems.map((p) => (
                  <PlanCard
                    key={p.id}
                    p={p}
                    onEdit={() => setFormTarget({ plan: p })}
                    onToggle={() => toggle(p)}
                    onDelete={() => setDeleteId(p.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {items.length === 0 && (
        <Card>
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.25rem 0" }}>
            Aucun plan d&apos;abonnement défini.
          </p>
        </Card>
      )}

      {/* Modale formulaire */}
      {formTarget && (
        <PlanFormModal
          initial={
            formTarget.plan
              ? {
                  kind:           formTarget.plan.kind,
                  name:           formTarget.plan.name,
                  billing:        formTarget.plan.billing,
                  price_total:    formTarget.plan.price_total,
                  nb_tranches:    formTarget.plan.nb_tranches,
                  tranche_amount: formTarget.plan.tranche_amount ?? 0,
                  description:    formTarget.plan.description,
                  is_active:      formTarget.plan.is_active,
                  access_levels:  formTarget.plan.access_levels,
                }
              : { ...EMPTY }
          }
          editing={formTarget.plan?.id ?? null}
          onClose={() => setFormTarget(null)}
          onSaved={(msg) => { toast(msg, "success"); setFormTarget(null); load(); }}
        />
      )}

      {/* Modale confirmation suppression */}
      {deleteId !== null && (
        <ConfirmModal
          title="Supprimer le plan ?"
          message="Ce plan sera définitivement supprimé. Les membres déjà abonnés ne seront pas affectés."
          confirmLabel="Supprimer"
          onClose={() => setDeleteId(null)}
          onConfirm={async () => {
            await plansApi.remove(deleteId);
            toast("Plan supprimé.", "success");
            setDeleteId(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
