"use client";

import { useCallback, useEffect, useState } from "react";

import { downloadBlob, transactionsApi } from "@/lib/endpoints";
import type {
  Paginated,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  Transaction,
  TransactionKPIs,
} from "@/lib/types";
import { Alert, Badge, Button, Card, Pagination, errorMessage } from "@/components/ui";
import { useToast } from "@/components/Toast";

// ── Constantes de présentation ────────────────────────────────────────────────

const STATUS_COLOR: Record<PaymentStatus, string> = {
  REUSSI:     "#5fb98a",
  EN_ATTENTE: "#d9a441",
  ECHOUE:     "#cf5a3c",
  REMBOURSE:  "#b5532a",
  EXONERE:    "#243a85",
};
const STATUS_LABEL: Record<PaymentStatus, string> = {
  REUSSI:     "Réussi",
  EN_ATTENTE: "En attente",
  ECHOUE:     "Échoué",
  REMBOURSE:  "Remboursé",
  EXONERE:    "Exonéré",
};

const KIND_LABEL: Record<PaymentKind, string> = {
  COTISATION:   "Cotisation",
  INSCRIPTION:  "Inscription",
  DON:          "Don",
  FORMATION:    "Formation",
  CADEAU:       "Cadeau",
  REMBOURSEMENT:"Remboursement",
  EXONERATION:  "Exonération",
};
const KIND_COLOR: Record<PaymentKind, string> = {
  COTISATION:   "#c9a227",
  INSCRIPTION:  "#5fb98a",
  DON:          "#b5532a",
  FORMATION:    "#5b8fd4",
  CADEAU:       "#d9a441",
  REMBOURSEMENT:"#7d7264",
  EXONERATION:  "#243a85",
};

const METHOD_LABEL: Record<string, string> = {
  MTN_MOBILE_MONEY: "MTN Mobile Money",
  ORANGE_MONEY:     "Orange Money",
  MANUEL:           "Manuel",
  VIREMENT:         "Virement",
};

// ── Tuile KPI ─────────────────────────────────────────────────────────────────

function KpiTile({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card>
      <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem",
                    textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, fontFamily: "var(--serif)",
                    lineHeight: 1, color: accent ?? "var(--cream)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "0.74rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function TransactionsPage() {
  const { toast } = useToast();
  const [kpis,   setKpis]   = useState<TransactionKPIs | null>(null);
  const [items,  setItems]  = useState<Transaction[]>([]);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Filtres
  const [fStatus,   setFStatus]   = useState("ALL");
  const [fKind,     setFKind]     = useState("ALL");
  const [fMethod,   setFMethod]   = useState("ALL");
  const [fSearch,   setFSearch]   = useState("");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo,   setFDateTo]   = useState("");

  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // ── Chargements ──────────────────────────────────────────────────────────

  const loadKpis = useCallback(async () => {
    try {
      const { data } = await transactionsApi.kpis();
      setKpis(data);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [toast]);

  const loadItems = useCallback(async () => {
    try {
      const params: Record<string, string | number> = {
        page,
        page_size: pageSize,
      };
      if (fStatus   !== "ALL") params.status    = fStatus;
      if (fKind     !== "ALL") params.kind      = fKind;
      if (fMethod   !== "ALL") params.method    = fMethod;
      if (fSearch)             params.search    = fSearch;
      if (fDateFrom)           params.date_from = fDateFrom;
      if (fDateTo)             params.date_to   = fDateTo;
      const { data } = await transactionsApi.list(params);
      if (Array.isArray(data)) {
        setItems(data);
        setTotalCount(data.length);
      } else {
        const p = data as Paginated<Transaction>;
        setItems(p.results);
        setTotalCount(p.count);
      }
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [fStatus, fKind, fMethod, fSearch, fDateFrom, fDateTo, page, pageSize, toast]);

  useEffect(() => { loadKpis(); }, [loadKpis]);
  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    setPage(1);
  }, [fStatus, fKind, fMethod, fSearch, fDateFrom, fDateTo]);

  // ── Export ───────────────────────────────────────────────────────────────

  const exportCsv = async () => {
    try {
      const { data } = await transactionsApi.export();
      downloadBlob(data as Blob, "transactions.csv");
      toast("Export téléchargé.", "success");
    } catch (e) { toast(errorMessage(e), "error"); }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const fmtAmount  = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
  const fmtDate    = (s: string | null) =>
    s ? new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="fade-up">
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.75rem" }}>
        <div>
          <div className="eyebrow">Finance</div>
          <h1 style={{ margin: 0 }}>Historique des transactions</h1>
          <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginTop: "0.3rem" }}>
            Tous les mouvements financiers de la plateforme.
          </p>
        </div>
        <Button variant="ghost" onClick={exportCsv}>⬇ Exporter CSV</Button>
      </div>

      {/* ── KPIs ── */}
      {kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))",
                      gap: "0.85rem", marginBottom: "2rem" }}>
          <KpiTile
            label="Revenus du mois"
            value={fmtAmount(kpis.revenue_month)}
            accent="var(--gold-2)"
          />
          <KpiTile
            label="Revenus totaux"
            value={fmtAmount(kpis.revenue_total)}
            sub={`${kpis.count_total} transactions`}
          />
          <KpiTile
            label="En attente"
            value={String(kpis.count_pending)}
            accent="#d9a441"
            sub="paiements à confirmer"
          />
          <KpiTile
            label="Remboursements"
            value={String(kpis.count_refunded)}
            accent="#b5532a"
          />
          <KpiTile
            label="Échoués"
            value={String(kpis.count_failed)}
            accent="#cf5a3c"
            sub="à investiguer"
          />
        </div>
      )}

      {/* ── Barre de filtres ── */}
      <Card style={{ marginBottom: "1.25rem", padding: "1rem 1.25rem" }}>
        <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          {/* Recherche */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "1 1 200px" }}>
            <span className="field-label">Membre / référence</span>
            <input className="input" placeholder="Nom, email, réf…"
                   value={fSearch} style={{ margin: 0 }}
                   onChange={(e) => setFSearch(e.target.value)} />
          </label>

          {/* Statut */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "0 1 150px" }}>
            <span className="field-label">Statut</span>
            <select className="select" value={fStatus} style={{ margin: 0 }}
                    onChange={(e) => setFStatus(e.target.value)}>
              <option value="ALL">Tous</option>
              <option value="REUSSI">Réussi</option>
              <option value="EN_ATTENTE">En attente</option>
              <option value="ECHOUE">Échoué</option>
              <option value="REMBOURSE">Remboursé</option>
              <option value="EXONERE">Exonéré</option>
            </select>
          </label>

          {/* Type */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "0 1 155px" }}>
            <span className="field-label">Type</span>
            <select className="select" value={fKind} style={{ margin: 0 }}
                    onChange={(e) => setFKind(e.target.value)}>
              <option value="ALL">Tous</option>
              <option value="COTISATION">Cotisation</option>
              <option value="INSCRIPTION">Inscription</option>
              <option value="DON">Don</option>
              <option value="FORMATION">Formation</option>
              <option value="CADEAU">Cadeau</option>
              <option value="REMBOURSEMENT">Remboursement</option>
              <option value="EXONERATION">Exonération</option>
            </select>
          </label>

          {/* Méthode */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "0 1 170px" }}>
            <span className="field-label">Méthode</span>
            <select className="select" value={fMethod} style={{ margin: 0 }}
                    onChange={(e) => setFMethod(e.target.value)}>
              <option value="ALL">Toutes</option>
              <option value="MTN_MOBILE_MONEY">MTN Mobile Money</option>
              <option value="ORANGE_MONEY">Orange Money</option>
              <option value="MANUEL">Manuel</option>
              <option value="VIREMENT">Virement</option>
            </select>
          </label>

          {/* Plage de dates */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "0 1 150px" }}>
            <span className="field-label">Du</span>
            <input type="date" className="input" value={fDateFrom} style={{ margin: 0 }}
                   onChange={(e) => setFDateFrom(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: "0 1 150px" }}>
            <span className="field-label">Au</span>
            <input type="date" className="input" value={fDateTo} style={{ margin: 0 }}
                   onChange={(e) => setFDateTo(e.target.value)} />
          </label>

          {/* Reset filtres */}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="ghost"
                    onClick={() => { setFStatus("ALL"); setFKind("ALL"); setFMethod("ALL");
                                     setFSearch(""); setFDateFrom(""); setFDateTo(""); }}>
              Réinitialiser
            </Button>
          </div>
        </div>
      </Card>

      {/* Compteur */}
      <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.65rem" }}>
        {totalCount} transaction{totalCount !== 1 ? "s" : ""}
        {totalCount !== items.length && ` · ${items.length} filtrées`}
      </div>

      {/* ── Table ── */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%", minWidth: 780 }}>
            <thead>
              <tr>
                <th>Référence</th>
                <th>Membre</th>
                <th>Type</th>
                <th>Méthode</th>
                <th style={{ textAlign: "right" }}>Montant</th>
                <th>Statut</th>
                <th>Date paiement</th>
                <th>Créé le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  {/* Référence */}
                  <td style={{ fontSize: "0.78rem", color: "var(--muted-2)",
                               fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {t.reference ?? `#${t.id}`}
                  </td>

                  {/* Membre */}
                  <td>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{t.user_name}</div>
                    <div style={{ fontSize: "0.74rem", color: "var(--muted-2)" }}>{t.user_email}</div>
                  </td>

                  {/* Type */}
                  <td>
                    <Badge color={KIND_COLOR[t.kind]}>{KIND_LABEL[t.kind]}</Badge>
                  </td>

                  {/* Méthode */}
                  <td style={{ fontSize: "0.82rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {t.payment_method ? METHOD_LABEL[t.payment_method] ?? t.payment_method : "—"}
                  </td>

                  {/* Montant */}
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{
                      fontWeight: 700,
                      fontSize: "0.92rem",
                      color: t.status === "REMBOURSE" || t.status === "EXONERE"
                        ? "var(--muted)"
                        : t.status === "REUSSI"
                        ? "var(--gold-2)"
                        : "var(--cream)",
                    }}>
                      {t.status === "REMBOURSE" ? "−" : ""}{fmtAmount(t.amount)}
                    </span>
                  </td>

                  {/* Statut */}
                  <td>
                    <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                  </td>

                  {/* Date paiement */}
                  <td style={{ fontSize: "0.8rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {fmtDate(t.paid_at)}
                  </td>

                  {/* Date création */}
                  <td style={{ fontSize: "0.8rem", color: "var(--muted-2)", whiteSpace: "nowrap" }}>
                    {fmtDate(t.created_at)}
                  </td>

                  {/* Détail */}
                  <td>
                    <Button variant="ghost"
                            onClick={() => setDetail(detail?.id === t.id ? null : t)}>
                      Détail
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {items.length === 0 && (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.5rem 0" }}>
            Aucune transaction trouvée.
          </p>
        )}
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
          total={totalCount}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(size) => { setPageSize(size); setPage(1); }}
        />
      </Card>

      {/* ── Panneau de détail inline ── */}
      {detail && (
        <Card style={{ marginTop: "1rem",
                       borderLeft: `3px solid ${STATUS_COLOR[detail.status]}`,
                       paddingLeft: "1.4rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between",
                        alignItems: "flex-start", marginBottom: "1rem" }}>
            <h3 style={{ fontFamily: "var(--serif)", fontSize: "1.1rem", margin: 0 }}>
              Détail de la transaction
            </h3>
            <Button variant="ghost" onClick={() => setDetail(null)}>✕ Fermer</Button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))",
                        gap: "0.85rem" }}>
            {[
              { label: "Référence",   value: detail.reference ?? `#${detail.id}` },
              { label: "Membre",      value: `${detail.user_name} (${detail.user_email})` },
              { label: "Type",        value: detail.formation_title
                                              ? `${KIND_LABEL[detail.kind]} · ${detail.formation_title}`
                                              : KIND_LABEL[detail.kind] },
              { label: "Méthode",     value: detail.payment_method
                                              ? (METHOD_LABEL[detail.payment_method] ?? detail.payment_method)
                                              : "—" },
              { label: "Montant",     value: fmtAmount(detail.amount) },
              { label: "Devise",      value: detail.currency || "XAF" },
              { label: "Statut",      value: STATUS_LABEL[detail.status] },
              { label: "Payé le",     value: fmtDate(detail.paid_at) },
              { label: "Créé le",     value: fmtDate(detail.created_at) },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em",
                              color: "var(--muted-2)", marginBottom: "0.2rem" }}>
                  {label}
                </div>
                <div style={{ fontSize: "0.88rem", color: "var(--cream)", fontWeight: 500 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {detail.reason && (
            <div style={{ marginTop: "0.85rem", padding: "0.65rem 0.85rem",
                          background: "var(--bg-2)", borderRadius: "var(--radius-sm)",
                          fontSize: "0.85rem", color: "var(--muted)" }}>
              <span style={{ color: "var(--muted-2)", fontSize: "0.72rem",
                             textTransform: "uppercase", letterSpacing: "0.08em",
                             display: "block", marginBottom: "0.25rem" }}>
                Motif
              </span>
              {detail.reason}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
