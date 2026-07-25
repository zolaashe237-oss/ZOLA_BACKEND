"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { billingApi } from "@/lib/endpoints";
import { Alert, Badge, Button, Card, Input, errorMessage } from "@/components/ui";

type Plan = { kind: string; label: string; amount: number };

const NOTE: Record<string, string> = {
  INSCRIPTION: "Paiement unique — ouvre votre adhésion et active votre accès.",
  COTISATION: "Mensuelle — maintient votre accès actif.",
  DON: "Libre et facultatif — soutien à la communauté.",
};
const fmt = (n: number) => n.toLocaleString("fr-FR");

export default function AbonnementPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [donAmount, setDonAmount] = useState("2000");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    billingApi.subscriptionTypes().then((r) => setPlans(r.data)).catch(() => setPlans([]));
  }, []);

  const pay = async (kind: string) => {
    setError(""); setBusy(kind);
    try {
      const amount = kind === "DON" ? Number(donAmount) : undefined;
      const { data } = await billingApi.initiate(kind, amount);
      // Mode mock → page de simulation ; sinon → page de paiement Swinmo.
      window.location.href = data.checkout_url;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  if (!user) return null;

  return (
    <div className="fade-up">
      <div className="eyebrow" style={{ marginBottom: ".3rem" }}>Mon adhésion</div>
      <h1 style={{ marginBottom: ".4rem", fontSize: "clamp(1.7rem,5vw,2.3rem)" }}>Abonnement & cotisation</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.4rem" }}>
        Statut actuel&nbsp;: <Badge tone={user.status === "ACTIF" ? "gold" : "terra"}>{user.status}</Badge>
      </p>

      {error && <Alert>{error}</Alert>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
        {plans.map((p) => {
          const featured = p.kind === "INSCRIPTION";
          return (
            <Card key={p.kind} hover className="card-lux"
                  style={{ display: "flex", flexDirection: "column", gap: ".5rem",
                           borderColor: featured ? "var(--gold)" : undefined }}>
              {featured && <span className="badge" style={{ alignSelf: "flex-start" }}>Pour démarrer</span>}
              <h3 style={{ fontSize: "1.2rem" }}>{p.label}</h3>
              <div className="price">
                <span className="price-num grad-gold">{p.kind === "DON" ? "Libre" : fmt(p.amount)}</span>
                {p.kind !== "DON" && <span style={{ color: "var(--muted)", fontSize: ".85rem" }}>FCFA</span>}
              </div>
              <p style={{ color: "var(--muted)", fontSize: ".88rem", flex: 1 }}>{NOTE[p.kind] ?? ""}</p>
              {p.kind === "DON" && (
                <Input label="Montant du don (FCFA)" type="number" value={donAmount}
                       onChange={(e) => setDonAmount(e.target.value)} />
              )}
              <Button onClick={() => pay(p.kind)} loading={busy === p.kind}
                      variant={featured ? "primary" : "outline"} block>
                {p.kind === "DON" ? "Faire un don" : "Payer"}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
