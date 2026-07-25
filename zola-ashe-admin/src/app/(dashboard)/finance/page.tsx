"use client";

import { useState } from "react";

import { downloadBlob, financeApi } from "@/lib/endpoints";
import { Alert, Button, Card, Input, Select, errorMessage } from "@/components/ui";

export default function FinancePage() {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    setError(""); setInfo("");
    try { await fn(); setInfo(ok); } catch (e) { setError(errorMessage(e)); }
  };

  const [manual, setManual] = useState({ user_id: "", kind: "COTISATION", reason: "" });
  const [refund, setRefund] = useState({ user_id: "", amount: "", reason: "" });
  const [exo, setExo] = useState({ user_id: "", reason: "" });

  return (
    <div>
      <h1 style={{ marginBottom: "1.25rem" }}>Finance</h1>
      <Alert>{error}</Alert>
      <Alert kind="success">{info}</Alert>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <Card>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.85rem" }}>Paiement manuel (RG-06)</h2>
          <Input label="ID membre" value={manual.user_id} onChange={(e) => setManual({ ...manual, user_id: e.target.value })} />
          <Select label="Type" value={manual.kind} onChange={(e) => setManual({ ...manual, kind: e.target.value })}>
            <option value="INSCRIPTION">Droit d&apos;inscription</option>
            <option value="COTISATION">Cotisation mensuelle</option>
            <option value="DON">Don volontaire</option>
          </Select>
          <Input label="Motif" value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} />
          <Button onClick={() => wrap(() => financeApi.manual({
            user_id: Number(manual.user_id), kind: manual.kind, reason: manual.reason }), "Paiement enregistré.")}>
            Valider le paiement
          </Button>
        </Card>

        <Card>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.85rem" }}>Remboursement (RG-39)</h2>
          <Input label="ID membre" value={refund.user_id} onChange={(e) => setRefund({ ...refund, user_id: e.target.value })} />
          <Input label="Montant (FCFA)" type="number" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
          <Input label="Motif" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
          <Button variant="danger" onClick={() => wrap(() => financeApi.refund({
            user_id: Number(refund.user_id), amount: Number(refund.amount), reason: refund.reason }), "Remboursement tracé.")}>
            Enregistrer le remboursement
          </Button>
        </Card>

        <Card>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.85rem" }}>Exonération (RG-40)</h2>
          <Input label="ID membre" value={exo.user_id} onChange={(e) => setExo({ ...exo, user_id: e.target.value })} />
          <Input label="Motif" value={exo.reason} onChange={(e) => setExo({ ...exo, reason: e.target.value })} />
          <Button onClick={() => wrap(() => financeApi.exonerate({
            user_id: Number(exo.user_id), reason: exo.reason }), "Exonération enregistrée.")}>
            Exonérer
          </Button>
        </Card>

        <Card>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.85rem" }}>Exports & relances</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", alignItems: "flex-start" }}>
            <Button variant="ghost" onClick={() => wrap(
              async () => downloadBlob((await financeApi.exportMembers()).data as Blob, "membres.csv"),
              "Export membres téléchargé.")}>⬇ Export membres (CSV)</Button>
            <Button variant="ghost" onClick={() => wrap(
              async () => downloadBlob((await financeApi.exportPayments()).data as Blob, "paiements.csv"),
              "Export paiements téléchargé.")}>⬇ Export paiements (CSV)</Button>
            <Button variant="ghost" onClick={() => wrap(() => financeApi.sendReminders(), "Relances envoyées.")}>
              Relancer les cotisations en retard
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
