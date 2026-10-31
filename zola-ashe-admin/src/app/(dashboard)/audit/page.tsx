"use client";

import { useCallback, useEffect, useState } from "react";

import { auditApi } from "@/lib/endpoints";
import type { AuditEntry } from "@/lib/types";
import { Badge, Button, Card, Pagination, errorMessage, usePagination } from "@/components/ui";
import { useToast } from "@/components/Toast";

// ── Constantes ────────────────────────────────────────────────────────────────

// Clés = valeurs exactes de AuditAction (backend apps/audit/models.py)
const ACTION_COLOR: Record<string, string> = {
  BLOCK_USER:         "var(--danger)",
  UNBLOCK_USER:       "var(--ok)",
  WARN_USER:          "var(--warn)",
  DELETE_POST:        "#c0402c",
  DELETE_COMMENT:     "#c0402c",
  RESOLVE_REPORT:     "#9a6e10",
  MANUAL_PAYMENT:     "#c9a227",
  CLOSE_SUBSCRIPTION: "#7d7264",
  DELETE_ACCOUNT:     "var(--danger)",
  GRANT_BRANCH:       "#5b8fd4",
  REVOKE_BRANCH:      "#b5532a",
  RESET_QUIZ:         "var(--gold)",
  UPDATE_CONTENT:     "#5b8fd4",
  DELETE_CONTENT:     "#b5532a",
  EXPORT_DATA:        "#243a85",
  SEND_REMINDER:      "#7d7264",
};

const ACTION_LABEL: Record<string, string> = {
  BLOCK_USER:         "Blocage membre",
  UNBLOCK_USER:       "Déblocage membre",
  WARN_USER:          "Avertissement",
  DELETE_POST:        "Suppression post",
  DELETE_COMMENT:     "Suppression commentaire",
  RESOLVE_REPORT:     "Résolution signalement",
  MANUAL_PAYMENT:     "Paiement manuel",
  CLOSE_SUBSCRIPTION: "Clôture adhésion",
  DELETE_ACCOUNT:     "Suppression compte",
  GRANT_BRANCH:       "Attribution branche",
  REVOKE_BRANCH:      "Révocation branche",
  RESET_QUIZ:         "Reset quiz",
  UPDATE_CONTENT:     "Modification contenu",
  DELETE_CONTENT:     "Suppression contenu",
  EXPORT_DATA:        "Export données",
  SEND_REMINDER:      "Envoi relance",
};

const KNOWN_ACTIONS = Object.keys(ACTION_LABEL);

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const { toast } = useToast();
  const [entries,    setEntries]    = useState<AuditEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filterAction, setFilterAction] = useState("");
  const [filterFrom,   setFilterFrom]   = useState("");
  const [filterTo,     setFilterTo]     = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await auditApi.list({
        action:    filterAction || undefined,
        date_from: filterFrom   || undefined,
        date_to:   filterTo     || undefined,
        page_size: 500,
      });
      const list = Array.isArray(data) ? data : (data as { results: AuditEntry[] }).results ?? [];
      setEntries(list);
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setLoading(false); }
  }, [filterAction, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);

  const filtered = entries;

  const filterKey = `${filterAction}|${filterFrom}|${filterTo}`;
  const { page, totalPages, paged, total, pageSize, setPageSize, go } =
    usePagination(filtered, 20, filterKey);

  const hasFilters = !!(filterAction || filterFrom || filterTo);
  const resetFilters = () => { setFilterAction(""); setFilterFrom(""); setFilterTo(""); };

  const fmtDate = (s: string) =>
    new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <div className="eyebrow">Sécurité</div>
        <h1>Journal d&apos;audit</h1>
        <p>
          Toutes les actions administratives tracées sur la plateforme.{" "}
          <strong>{total}</strong> entrée{total !== 1 ? "s" : ""}
          {hasFilters && <span style={{ color: "var(--muted)" }}> (filtrées)</span>}.
        </p>
      </div>

      {/* Filtres */}
      <Card style={{ padding: "0.85rem 1.1rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", alignItems: "flex-end" }}>

          {/* Action — select parmi les actions connues */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "0 1 220px" }}>
            <span className="field-label">Type d&apos;action</span>
            <select className="select" value={filterAction} style={{ margin: 0 }}
              onChange={(e) => setFilterAction(e.target.value)}>
              <option value="">Toutes les actions</option>
              {KNOWN_ACTIONS.map((a) => (
                <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>
              ))}
            </select>
          </label>

          {/* Date de début */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "0 1 150px" }}>
            <span className="field-label">Du</span>
            <input type="date" className="input" value={filterFrom} style={{ margin: 0 }}
              onChange={(e) => setFilterFrom(e.target.value)} />
          </label>

          {/* Date de fin */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "0 1 150px" }}>
            <span className="field-label">Au</span>
            <input type="date" className="input" value={filterTo} style={{ margin: 0 }}
              onChange={(e) => setFilterTo(e.target.value)} />
          </label>

          {hasFilters && (
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <Button variant="ghost" onClick={resetFilters}>Réinitialiser</Button>
            </div>
          )}
        </div>
      </Card>

      {/* Tableau */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%", minWidth: 680 }}>
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap" }}>Date</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Cible</th>
                <th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((a) => (
                <tr key={a.id}>
                  {/* Date */}
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: "0.80rem" }}>
                    {fmtDate(a.created_at)}
                  </td>

                  {/* Acteur */}
                  <td style={{ fontSize: "0.83rem", color: "var(--muted-2)" }}>
                    {a.actor_email ?? <span style={{ color: "var(--muted-2)", fontStyle: "italic" }}>système</span>}
                  </td>

                  {/* Action */}
                  <td>
                    <Badge color={ACTION_COLOR[a.action] ?? "var(--muted-2)"}>
                      {ACTION_LABEL[a.action] ?? a.action}
                    </Badge>
                  </td>

                  {/* Cible */}
                  <td style={{ whiteSpace: "nowrap" }}>
                    {a.target_type ? (
                      <span style={{
                        fontSize: "0.78rem", fontFamily: "monospace",
                        color: "var(--muted-2)", background: "var(--bg-2)",
                        padding: "0.1rem 0.4rem", borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--line-soft)",
                      }}>
                        {a.target_type} #{a.target_id}
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted-2)" }}>—</span>
                    )}
                  </td>

                  {/* Motif */}
                  <td style={{ fontSize: "0.83rem", color: "var(--muted)", maxWidth: 300 }}>
                    {a.reason || <span style={{ color: "var(--muted-2)", fontStyle: "italic" }}>—</span>}
                  </td>
                </tr>
              ))}

              {loading && (
                <tr>
                  <td colSpan={5} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                    Chargement…
                  </td>
                </tr>
              )}
              {!loading && paged.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                    Aucune entrée trouvée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={total}
          pageSize={pageSize} onPage={go} onPageSize={setPageSize} />
      </Card>
    </div>
  );
}
