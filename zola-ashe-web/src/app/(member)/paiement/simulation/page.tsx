"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { billingApi } from "@/lib/endpoints";
import { Alert, Button, Card, errorMessage } from "@/components/ui";

const LABEL: Record<string, string> = {
  INSCRIPTION: "Droit d'inscription", COTISATION: "Cotisation mensuelle", DON: "Don volontaire",
};
const fmt = (n: string) => Number(n || 0).toLocaleString("fr-FR");

function SimulationInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { refreshUser } = useAuth();
  const ref = params.get("ref") ?? "";
  const kind = params.get("kind") ?? "";
  const amount = params.get("amount") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const confirm = async () => {
    setError(""); setBusy(true);
    try {
      await billingApi.mockConfirm(ref);
      await refreshUser();
      setDone(true);
      setTimeout(() => router.replace("/dashboard"), 1400);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="fade-up" style={{ maxWidth: 460, margin: "2rem auto" }}>
      <Card className="card-lux">
        <div className="eyebrow" style={{ marginBottom: ".5rem" }}>Paiement — simulation</div>
        <p style={{ color: "var(--muted)", fontSize: ".88rem", marginBottom: "1rem" }}>
          Mode démo (sans passerelle réelle). Confirmez pour simuler le règlement.
        </p>

        <div style={{ display: "flex", justifyContent: "space-between", padding: ".8rem 0",
                      borderTop: "1px solid var(--line-soft)", borderBottom: "1px solid var(--line-soft)", margin: ".4rem 0 1.2rem" }}>
          <span>{LABEL[kind] ?? kind}</span>
          <strong className="text-gold">{fmt(amount)} FCFA</strong>
        </div>

        {error && <Alert>{error}</Alert>}

        {done ? (
          <Alert kind="success">Paiement confirmé. Redirection vers votre espace…</Alert>
        ) : (
          <>
            <Button onClick={confirm} loading={busy} block>Confirmer le paiement</Button>
            <Link href="/abonnement" className="btn btn-ghost press" style={{ width: "100%", marginTop: ".6rem" }}>
              Annuler
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}

export default function SimulationPage() {
  return <Suspense fallback={null}><SimulationInner /></Suspense>;
}
