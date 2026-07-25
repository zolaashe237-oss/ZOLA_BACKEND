"use client";

import { useCallback, useEffect, useState } from "react";

import { moderationApi } from "@/lib/endpoints";
import type { ReportItem } from "@/lib/types";
import { Alert, Badge, Button, Card, errorMessage } from "@/components/ui";

export default function ModerationPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await moderationApi.reports();
      setReports(data);
    } catch (e) { setError(errorMessage(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(""); setInfo("");
    try { await fn(); setInfo(ok); await load(); } catch (e) { setError(errorMessage(e)); }
  };

  const remove = (r: ReportItem) => {
    const reason = window.prompt("Motif de la suppression ?");
    if (!reason) return;
    const fn = r.target_type === "POST"
      ? () => moderationApi.deletePost(r.target_id, reason)
      : () => moderationApi.deleteComment(r.target_id, reason);
    act(fn, "Contenu supprimé et signalement clôturé.");
  };

  return (
    <div>
      <h1 style={{ marginBottom: "1.25rem" }}>Modération</h1>
      <Alert>{error}</Alert>
      <Alert kind="success">{info}</Alert>

      <div style={{ display: "grid", gap: "0.6rem" }}>
        {reports.map((r) => (
          <Card key={r.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge color={r.target_type === "POST" ? "#6366f1" : "#0ea5e9"}>{r.target_type}</Badge>
                  <strong>#{r.target_id}</strong>
                  {r.signal_count > 1 && <Badge color="#ef4444">{r.signal_count} signalements</Badge>}
                </div>
                <span style={{ opacity: 0.85 }}>{r.reason}</span>
                <span style={{ opacity: 0.55, fontSize: "0.8rem" }}>
                  par {r.reporter} · {new Date(r.created_at).toLocaleString("fr-FR")}
                </span>
              </div>
              <span style={{ display: "inline-flex", gap: 6 }}>
                <Button variant="ghost" onClick={() => act(() => moderationApi.handle(r.id), "Signalement ignoré.")}>
                  Ignorer
                </Button>
                <Button variant="danger" onClick={() => remove(r)}>Supprimer le contenu</Button>
              </span>
            </div>
          </Card>
        ))}
        {reports.length === 0 && <Card><p style={{ opacity: 0.6 }}>Aucun signalement en attente.</p></Card>}
      </div>
    </div>
  );
}
