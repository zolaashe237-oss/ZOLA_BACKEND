"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { financeApi, formationApi, libraryApi, plansApi } from "@/lib/endpoints";
import type { Formation, LibraryPdf, PlanKind, SubscriptionPlan } from "@/lib/types";
import { Button, Input, Select, errorMessage } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

/** Paiements validables à la main (WhatsApp, espèces…) — dont l'achat d'une formation ou d'un livre seul. */
type ItemKind = "FORMATION" | "LIVRE";
type ManualKind = PlanKind | ItemKind;

const KIND_LABELS: Record<ManualKind, string> = {
  INSCRIPTION:    "Inscription annuelle",
  COTISATION:     "Inscription mensuelle",
  BRANCHE_FEMME:  "Accès Branche Femme",
  BRANCHE_ENFANT: "Accès Branche Enfant",
  DON:            "Don volontaire",
  FORMATION:      "Achat d'une formation",
  LIVRE:          "Achat d'un livre",
};
const KINDS: ManualKind[] = ["INSCRIPTION", "COTISATION", "BRANCHE_FEMME", "BRANCHE_ENFANT", "FORMATION", "LIVRE", "DON"];

/** Contenu vendable à l'unité, ramené à une forme commune pour la sélection. */
type Item = { id: number; title: string; price: number | null };

const ITEM_TEXT: Record<ItemKind, { select: string; placeholder: string; notForSale: string; noun: string }> = {
  FORMATION: { select: "Formation à débloquer", placeholder: "— Choisir une formation —",
               notForSale: "non vendue seule", noun: "cette seule formation" },
  LIVRE:     { select: "Livre à débloquer", placeholder: "— Choisir un livre —",
               notForSale: "non vendu seul", noun: "ce seul livre" },
};

const asList = <T,>(data: T[] | { results?: T[] }): T[] => (Array.isArray(data) ? data : data.results ?? []);
const isItemKind = (k: ManualKind): k is ItemKind => k === "FORMATION" || k === "LIVRE";
// Vendus à l'unité d'abord, puis par titre.
const byPriceThenTitle = (a: Item, b: Item) => Number(!!b.price) - Number(!!a.price) || a.title.localeCompare(b.title);

export default function ManualPaymentModal({ userId, userName, onClose, onDone }: {
  userId: number;
  userName?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind,    setKind]    = useState<ManualKind>("INSCRIPTION");
  const [amount,  setAmount]  = useState("");
  const [plans,   setPlans]   = useState<SubscriptionPlan[]>([]);
  const [items,   setItems]   = useState<Partial<Record<ItemKind, Item[]>>>({});
  const [itemId,  setItemId]  = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    plansApi.list()
      .then(({ data }) => setPlans(asList<SubscriptionPlan>(data).filter((p) => p.is_active)))
      .catch(() => {});
  }, []);

  // Contenus réservés (seuls à verrouiller l'accès), chargés à la première sélection du type.
  useEffect(() => {
    if (!isItemKind(kind) || items[kind]) return;
    const load: Promise<Item[]> = kind === "FORMATION"
      ? formationApi.list().then(({ data }) => asList<Formation>(data)
          .filter((f) => !f.is_public && f.access_subscription_types.length > 0)
          .map((f) => ({ id: f.id, title: f.title, price: f.price ?? null })))
      : libraryApi.list().then(({ data }) => asList<LibraryPdf>(data)
          .filter((p) => p.access_level !== "PUBLIC" && !p.is_gratuit)
          .map((p) => ({ id: p.id, title: p.title, price: p.price ?? null })));
    load
      .then((list) => setItems((prev) => ({ ...prev, [kind]: list.sort(byPriceThenTitle) })))
      .catch((e) => toast(errorMessage(e), "error"));
  }, [kind, items, toast]);

  const itemKind = isItemKind(kind) ? kind : null;
  const selectedItem = itemKind ? items[itemKind]?.find((i) => String(i.id) === itemId) : undefined;

  // Changer de type de paiement réinitialise le contenu choisi.
  const changeKind = (k: ManualKind) => { setKind(k); setItemId(""); };

  // Montant pré-rempli : prix du plan, ou prix du contenu choisi.
  useEffect(() => {
    if (itemKind) {
      setAmount(selectedItem?.price ? String(selectedItem.price) : "");
    } else {
      const plan = plans.find((p) => p.kind === kind);
      setAmount(plan ? String(plan.price_total) : "");
    }
  }, [kind, itemKind, plans, selectedItem]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (itemKind && !selectedItem) {
      toast(`Choisissez ${itemKind === "FORMATION" ? "la formation" : "le livre"} à débloquer.`, "error");
      return;
    }
    setLoading(true);
    try {
      await financeApi.manual({
        user_id: userId,
        kind,
        amount:  amount ? Number(amount) : undefined,
        formation_id:   kind === "FORMATION" ? selectedItem?.id : undefined,
        library_pdf_id: kind === "LIVRE" ? selectedItem?.id : undefined,
        reason:  itemKind
          ? `Paiement manuel — ${itemKind === "FORMATION" ? "Formation" : "Livre"} « ${selectedItem?.title} »`
          : `Paiement manuel — ${KIND_LABELS[kind]}`,
      });
      onDone(); onClose();
    } catch (err) { toast(errorMessage(err), "error"); }
    finally { setLoading(false); }
  };

  const activePlan = plans.find((p) => p.kind === kind);
  const amountLabel = itemKind
    ? (selectedItem?.price ? "Montant (FCFA) — prix de vente" : "Montant encaissé (FCFA)")
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
                      onChange={() => changeKind(k)} style={{ accentColor: "var(--gold-2)" }} />
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

        {itemKind && (
          <Select label={ITEM_TEXT[itemKind].select} value={itemId} required
                  onChange={(e) => setItemId(e.target.value)}>
            <option value="">{ITEM_TEXT[itemKind].placeholder}</option>
            {(items[itemKind] ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}{i.price ? ` — ${i.price.toLocaleString("fr-FR")} FCFA` : ` — ${ITEM_TEXT[itemKind].notForSale}`}
              </option>
            ))}
          </Select>
        )}

        <Input
          label={amountLabel}
          type="number" min={0} value={amount} placeholder="Montant en FCFA"
          required={!!itemKind && !selectedItem?.price}
          onChange={(e) => setAmount(e.target.value)}
        />
        {itemKind && (
          <p style={{ margin: "-0.4rem 0 1rem", fontSize: "0.74rem", color: "var(--muted-2)", lineHeight: 1.5 }}>
            Le membre obtient un accès permanent à {ITEM_TEXT[itemKind].noun}, sans abonnement.
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
