"use client";

import { useCallback, useEffect, useState } from "react";

import { auditApi } from "@/lib/endpoints";
import type { AuditEntry, Paginated } from "@/lib/types";
import { Badge, Card, Input, errorMessage } from "@/components/ui";

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await auditApi.list({ action: action || undefined });
      setEntries((data as Paginated<AuditEntry>).results);
    } catch (e) { setError(errorMessage(e)); }
  }, [action]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h1 style={{ marginBottom: "1.25rem" }}>Journal d&apos;audit</h1>
      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      <div style={{ width: 280, marginBottom: "1rem" }}>
        <Input label="Filtrer par action" value={action} placeholder="ex. MEMBER_BLOCK"
               onChange={(e) => setAction(e.target.value.toUpperCase())} />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #1e293b" }}>
              <th style={{ padding: "0.7rem" }}>Date</th>
              <th>Acteur</th>
              <th>Action</th>
              <th>Cible</th>
              <th style={{ padding: "0.7rem" }}>Motif</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "0.7rem", whiteSpace: "nowrap", opacity: 0.7 }}>
                  {new Date(a.created_at).toLocaleString("fr-FR")}
                </td>
                <td style={{ opacity: 0.85 }}>{a.actor_email ?? "—"}</td>
                <td><Badge color="#334155">{a.action}</Badge></td>
                <td style={{ opacity: 0.7 }}>{a.target_type ? `${a.target_type}#${a.target_id}` : "—"}</td>
                <td style={{ padding: "0.7rem" }}>{a.reason || "—"}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "1rem", opacity: 0.6 }}>Aucune entrée.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
