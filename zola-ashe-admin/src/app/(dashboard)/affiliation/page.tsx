"use client";

import { useCallback, useEffect, useState } from "react";
import { affiliateAdminApi } from "@/lib/endpoints";
import type { AffiliateConfig, AffiliateStats, Referral, Paginated } from "@/lib/types";
import { Badge, Button, Card, Pagination, errorMessage } from "@/components/ui";

// ── Types locaux ──────────────────────────────────────────────────────────────

type StatusFilter = "" | "PENDING" | "VALIDATED" | "PAID";

const STATUS_COLOR: Record<string, string> = {
  PENDING:   "#d9a441",
  VALIDATED: "#5fb98a",
  PAID:      "#243a85",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING:   "En attente",
  VALIDATED: "Validé",
  PAID:      "Payé",
};

// ── Écran "pas encore déployé" ────────────────────────────────────────────────

function AffiliationComingSoon({ onRetry }: { onRetry: () => void }) {
  const FEATURES = [
    { icon: "⚙️", label: "Configuration", desc: "Définissez le montant de la commission, le seuil minimum de retrait et le numéro WhatsApp de contact." },
    { icon: "📊", label: "Statistiques", desc: "KPIs en temps réel : total parrainages, commissions dues, commissions versées, top parrains." },
    { icon: "👥", label: "Liste des parrainages", desc: "Tableau paginé avec filtre par statut (En attente / Validé / Payé) et recherche par nom ou email." },
    { icon: "✅", label: "Validation des paiements", desc: "Sélection en masse des parrainages validés pour les marquer comme payés en un clic." },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Affiliation &amp; Parrainage
      </h1>
      <p style={{ fontSize: 13, color: "#888", marginBottom: 32 }}>
        Cette fonctionnalité est en cours de déploiement.
      </p>

      {/* Bandeau statut */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        background: "#fffbeb", border: "1px solid #f0c040",
        borderRadius: 8, padding: "14px 18px", marginBottom: 32,
      }}>
        <span style={{ fontSize: 20 }}>🚧</span>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#92400e", marginBottom: 2 }}>
            Module non encore activé sur le serveur
          </p>
          <p style={{ fontSize: 12, color: "#b45309" }}>
            Appliquez les migrations Django (<code style={{ background: "#fef3c7", padding: "1px 4px", borderRadius: 3 }}>python manage.py migrate</code>) pour activer ce module.
          </p>
        </div>
      </div>

      {/* Aperçu des fonctionnalités */}
      <p style={{ fontSize: 12, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        Ce que vous trouverez ici
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 32 }}>
        {FEATURES.map(f => (
          <div key={f.label} style={{
            background: "#fff", border: "1px solid #e8eaed",
            borderRadius: 8, padding: "16px 18px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 18 }}>{f.icon}</span>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>{f.label}</p>
            </div>
            <p style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>{f.desc}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onRetry}
        style={{
          padding: "10px 20px", fontSize: 13, fontWeight: 600,
          background: "#1a1a2e", color: "#fff", border: "none",
          borderRadius: 6, cursor: "pointer",
        }}
      >
        Réessayer la connexion
      </button>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function AffiliationPage() {
  const [config, setConfig] = useState<AffiliateConfig | null>(null);
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [referrals, setReferrals] = useState<Paginated<Referral> | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [configForm, setConfigForm] = useState({
    commission_amount: "",
    min_withdrawal: "",
    whatsapp_number: "",
    is_active: true,
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSuccess, setConfigSuccess] = useState(false);
  const [configError, setConfigError] = useState("");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [markError, setMarkError] = useState("");

  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Chargement initial ────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setUnavailable(false);
    setLoadError(null);
    try {
      const [cfgRes, statsRes] = await Promise.all([
        affiliateAdminApi.getConfig(),
        affiliateAdminApi.getStats(),
      ]);
      setConfig(cfgRes.data);
      setStats(statsRes.data);
      setConfigForm({
        commission_amount: String(cfgRes.data.commission_amount),
        min_withdrawal:    String(cfgRes.data.min_withdrawal),
        whatsapp_number:   cfgRes.data.whatsapp_number ?? "",
        is_active:         cfgRes.data.is_active,
      });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // 404 / 503 / 501 / pas de réponse = endpoint vraiment absent
      if (!status || status === 404 || status === 503 || status === 501) {
        setUnavailable(true);
      } else {
        setLoadError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReferrals = useCallback(async () => {
    try {
      const res = await affiliateAdminApi.listReferrals({
        status:    statusFilter || undefined,
        search:    search || undefined,
        page,
        page_size: 25,
      });
      setReferrals(res.data);
    } catch {
      // silently ignore pagination errors
    }
  }, [statusFilter, search, page]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadReferrals(); }, [loadReferrals]);

  // ── Sauvegarde config ─────────────────────────────────────────────────────

  const saveConfig = async () => {
    setSavingConfig(true);
    setConfigError("");
    setConfigSuccess(false);
    try {
      const res = await affiliateAdminApi.updateConfig({
        commission_amount: parseFloat(configForm.commission_amount),
        min_withdrawal:    parseFloat(configForm.min_withdrawal),
        whatsapp_number:   configForm.whatsapp_number,
        is_active:         configForm.is_active,
      });
      setConfig(res.data);
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 3000);
    } catch (e) {
      setConfigError(errorMessage(e));
    } finally {
      setSavingConfig(false);
    }
  };

  // ── Marquer payé ─────────────────────────────────────────────────────────

  const markPaid = async () => {
    if (!selectedIds.length) return;
    setMarkingPaid(true);
    setMarkError("");
    try {
      await affiliateAdminApi.markPaid(selectedIds);
      setSelectedIds([]);
      await Promise.all([loadReferrals(), loadData()]);
    } catch (e) {
      setMarkError(errorMessage(e));
    } finally {
      setMarkingPaid(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const validated = (referrals?.results ?? [])
      .filter(r => r.status === "VALIDATED")
      .map(r => r.id);
    const allSelected = validated.every(id => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : validated);
  };

  if (loading) return <p style={{ padding: 32 }}>Chargement…</p>;
  if (unavailable) return <AffiliationComingSoon onRetry={loadData} />;
  if (loadError) return (
    <div style={{ padding: 32, maxWidth: 480 }}>
      <p style={{ fontSize: 13, color: "#cf5a3c", marginBottom: 16 }}>{loadError}</p>
      <button
        onClick={loadData}
        style={{
          padding: "10px 20px", fontSize: 13, fontWeight: 600,
          background: "#1a1a2e", color: "#fff", border: "none",
          borderRadius: 6, cursor: "pointer",
        }}
      >
        Réessayer
      </button>
    </div>
  );

  const validatedInPage = (referrals?.results ?? []).filter(r => r.status === "VALIDATED");

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
        Affiliation &amp; Parrainage
      </h1>

      {/* ── KPIs ── */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
          <KpiCard label="Total parrainages" value={stats.total_referrals} />
          <KpiCard label="En attente" value={stats.pending_referrals} color="#d9a441" />
          <KpiCard label="Validés" value={stats.validated_referrals} color="#5fb98a" />
          <KpiCard label="Payés" value={stats.paid_referrals} color="#243a85" />
          <KpiCard label="Commissions dues" value={`${stats.pending_commissions.toLocaleString()} FCFA`} />
          <KpiCard label="Commissions payées" value={`${stats.paid_commissions.toLocaleString()} FCFA`} />
        </div>
      )}

      {/* ── Top parrains ── */}
      {stats?.top_referrers && stats.top_referrers.length > 0 && (
        <Card style={{ marginBottom: 32, padding: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Top parrains</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#888", textAlign: "left" }}>
                <th style={{ padding: "6px 12px" }}>Parrain</th>
                <th style={{ padding: "6px 12px" }}>Filleuls</th>
                <th style={{ padding: "6px 12px" }}>Commission totale</th>
              </tr>
            </thead>
            <tbody>
              {stats.top_referrers.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: "8px 12px" }}>{r.referrer__full_name} <span style={{ color: "#aaa" }}>({r.referrer__email})</span></td>
                  <td style={{ padding: "8px 12px" }}>{r.count}</td>
                  <td style={{ padding: "8px 12px" }}>{r.earned.toLocaleString()} FCFA</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Config ── */}
      <Card style={{ marginBottom: 32, padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Configuration</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
          <label style={labelStyle}>
            Commission par filleul (FCFA)
            <input
              style={inputStyle}
              type="number"
              value={configForm.commission_amount}
              onChange={e => setConfigForm(f => ({ ...f, commission_amount: e.target.value }))}
            />
          </label>
          <label style={labelStyle}>
            Seuil min. de retrait (FCFA)
            <input
              style={inputStyle}
              type="number"
              value={configForm.min_withdrawal}
              onChange={e => setConfigForm(f => ({ ...f, min_withdrawal: e.target.value }))}
            />
          </label>
          <label style={labelStyle}>
            Numéro WhatsApp (retrait)
            <input
              style={inputStyle}
              type="text"
              placeholder="+237600000000"
              value={configForm.whatsapp_number}
              onChange={e => setConfigForm(f => ({ ...f, whatsapp_number: e.target.value }))}
            />
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={configForm.is_active}
              onChange={e => setConfigForm(f => ({ ...f, is_active: e.target.checked }))}
            />
            Programme d&apos;affiliation actif
          </label>
          <Button onClick={saveConfig} disabled={savingConfig}>
            {savingConfig ? "Enregistrement…" : "Enregistrer"}
          </Button>
          {configSuccess && <span style={{ color: "#5fb98a", fontSize: 13 }}>✓ Sauvegardé</span>}
          {configError && <span style={{ color: "#cf5a3c", fontSize: 13 }}>{configError}</span>}
        </div>
      </Card>

      {/* ── Table des parrainages ── */}
      <Card style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Parrainages</h2>
          <input
            style={{ ...inputStyle, width: 220, margin: 0 }}
            type="text"
            placeholder="Rechercher un nom / email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          <select
            style={{ ...inputStyle, width: 160, margin: 0 }}
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
          >
            <option value="">Tous les statuts</option>
            <option value="PENDING">En attente</option>
            <option value="VALIDATED">Validé</option>
            <option value="PAID">Payé</option>
          </select>
          {selectedIds.length > 0 && (
            <Button onClick={markPaid} disabled={markingPaid}>
              {markingPaid ? "Traitement…" : `Marquer payé (${selectedIds.length})`}
            </Button>
          )}
          {markError && <span style={{ color: "#cf5a3c", fontSize: 13 }}>{markError}</span>}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#888", textAlign: "left" }}>
                {validatedInPage.length > 0 && (
                  <th style={{ padding: "6px 10px" }}>
                    <input
                      type="checkbox"
                      checked={validatedInPage.every(r => selectedIds.includes(r.id))}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th style={{ padding: "6px 10px" }}>Parrain</th>
                <th style={{ padding: "6px 10px" }}>Filleul</th>
                <th style={{ padding: "6px 10px" }}>Commission</th>
                <th style={{ padding: "6px 10px" }}>Statut</th>
                <th style={{ padding: "6px 10px" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {(referrals?.results ?? []).map(r => (
                <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                  {validatedInPage.length > 0 && (
                    <td style={{ padding: "8px 10px" }}>
                      {r.status === "VALIDATED" && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(r.id)}
                          onChange={() => toggleSelect(r.id)}
                        />
                      )}
                    </td>
                  )}
                  <td style={{ padding: "8px 10px" }}>
                    {r.referrer.full_name}<br />
                    <span style={{ color: "#aaa", fontSize: 11 }}>{r.referrer.email}</span>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {r.referred?.full_name ?? "—"}<br />
                    <span style={{ color: "#aaa", fontSize: 11 }}>{r.referred?.email ?? ""}</span>
                  </td>
                  <td style={{ padding: "8px 10px" }}>{r.commission.toLocaleString()} FCFA</td>
                  <td style={{ padding: "8px 10px" }}>
                    <Badge color={STATUS_COLOR[r.status] ?? "#888"}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td style={{ padding: "8px 10px", color: "#666" }}>
                    {new Date(r.created_at).toLocaleDateString("fr-FR")}
                  </td>
                </tr>
              ))}
              {!(referrals?.results?.length) && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#aaa" }}>
                    Aucun parrainage trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {referrals && referrals.count > 25 && (
          <div style={{ marginTop: 16 }}>
            <Pagination
              page={page}
              totalPages={Math.ceil(referrals.count / 25)}
              total={referrals.count}
              pageSize={25}
              onPage={setPage}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Helpers visuels ───────────────────────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e8eaed",
      borderRadius: 10,
      padding: "16px 20px",
    }}>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? "#1a1a2e" }}>
        {value}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "#555",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #d0d5dd",
  borderRadius: 6,
  fontSize: 14,
  outline: "none",
};
