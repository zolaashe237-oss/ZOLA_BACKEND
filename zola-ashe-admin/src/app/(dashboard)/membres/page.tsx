"use client";

import { useCallback, useEffect, useState } from "react";

import { membersApi } from "@/lib/endpoints";
import type { User } from "@/lib/types";
import { Badge, Button, Card, Input, Select, STATUS_COLOR, errorMessage } from "@/components/ui";

export default function MembresPage() {
  const [members, setMembers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await membersApi.list({ search: search || undefined, status: status || undefined });
      setMembers(data.results);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [search, status]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e) { setError(errorMessage(e)); }
  };

  const block = (m: User) => {
    const reason = window.prompt("Motif du blocage ?") ?? "";
    act(() => membersApi.block(m.id, reason));
  };
  const warn = (m: User) => {
    const reason = window.prompt("Motif de l'avertissement ?");
    if (reason) act(() => membersApi.warn(m.id, reason));
  };

  return (
    <div>
      <h1 style={{ marginBottom: "1.25rem" }}>Membres</h1>
      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      <div style={{ display: "flex", gap: "1rem", alignItems: "end", marginBottom: "1rem" }}>
        <div style={{ flex: 1 }}>
          <Input label="Recherche (nom / email)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ width: 200 }}>
          <Select label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            <option value="ACTIF">Actif</option>
            <option value="RESTREINT">Restreint</option>
            <option value="BLOQUE">Bloqué</option>
          </Select>
        </div>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #1e293b" }}>
              <th style={{ padding: "0.7rem" }}>Membre</th>
              <th>Statut</th>
              <th>Avertis.</th>
              <th style={{ textAlign: "right", padding: "0.7rem" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "0.7rem" }}>
                  <div>{m.full_name}</div>
                  <div style={{ opacity: 0.6, fontSize: "0.8rem" }}>{m.email}</div>
                </td>
                <td><Badge color={STATUS_COLOR[m.status]}>{m.status}</Badge></td>
                <td>{m.nb_warnings}{m.nb_warnings >= 3 ? " ⚠️" : ""}</td>
                <td style={{ textAlign: "right", padding: "0.7rem" }}>
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <Button variant="ghost" onClick={() => warn(m)}>Avertir</Button>
                    {m.status === "BLOQUE" ? (
                      <Button onClick={() => act(() => membersApi.unblock(m.id))}>Débloquer</Button>
                    ) : (
                      <Button variant="danger" onClick={() => block(m)}>Bloquer</Button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr><td colSpan={4} style={{ padding: "1rem", opacity: 0.6 }}>Aucun membre.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
