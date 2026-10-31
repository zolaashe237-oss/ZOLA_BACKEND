"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { dashboardApi, financeApi2, transactionsApi, membersApi } from "@/lib/endpoints";
import { DateRangePicker, type DateRange } from "@/components/DateRangePicker";
import { useAuth } from "@/context/AuthContext";
import type { DashboardKPIs, LateMember, MonthlyRevenue, PaymentBreakdown, PaymentKind, PaymentStatus, Transaction, User } from "@/lib/types";

// ── Constantes transactions ───────────────────────────────────────────────────

const TX_STATUS_COLOR: Record<PaymentStatus, string> = {
  REUSSI: "#5fb98a", EN_ATTENTE: "#d9a441", ECHOUE: "#cf5a3c",
  REMBOURSE: "#b5532a", EXONERE: "#243a85",
};
const TX_STATUS_LABEL: Record<PaymentStatus, string> = {
  REUSSI: "Réussi", EN_ATTENTE: "En attente", ECHOUE: "Échoué",
  REMBOURSE: "Remboursé", EXONERE: "Exonéré",
};
const TX_KIND_COLOR: Record<PaymentKind, string> = {
  COTISATION: "#c9a227", INSCRIPTION: "#5fb98a", DON: "#b5532a", FORMATION: "#5b8fd4",
  CADEAU: "#d9a441", REMBOURSEMENT: "#7d7264", EXONERATION: "#243a85",
};
const TX_KIND_LABEL: Record<PaymentKind, string> = {
  COTISATION: "Cotisation", INSCRIPTION: "Inscription", DON: "Don", FORMATION: "Formation",
  CADEAU: "Cadeau", REMBOURSEMENT: "Remboursement", EXONERATION: "Exonération",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number) { return `${n.toLocaleString("fr-FR")} F`; }
function fmtNum(n: number)   { return n.toLocaleString("fr-FR"); }

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}

// ── SVG Area Chart (revenus mensuels) ─────────────────────────────────────────

function AreaChart({ data }: { data: MonthlyRevenue[] }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", border: "1px dashed var(--line-soft)", borderRadius: "var(--radius)" }}>
        Aucune donnée de revenu disponible
      </div>
    );
  }

  const W = 640, H = 160;
  const PAD = { t: 24, r: 20, b: 30, l: 52 };
  const cW  = W - PAD.l - PAD.r;
  const cH  = H - PAD.t - PAD.b;
  const max = Math.max(...data.map((d) => d.amount), 1);

  const pts = data.map((d, i) => ({
    x:      PAD.l + (i / Math.max(data.length - 1, 1)) * cW,
    y:      PAD.t + (1 - d.amount / max) * cH,
    amount: d.amount,
    label:  d.label,
  }));

  // Smooth cubic bezier between each pair of points
  const linePath = pts.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    const prev = pts[i - 1];
    const cx   = ((prev.x + pt.x) / 2).toFixed(1);
    return `${acc} C ${cx} ${prev.y.toFixed(1)} ${cx} ${pt.y.toFixed(1)} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }, "");

  const bottom   = PAD.t + cH;
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${bottom} L ${pts[0].x.toFixed(1)} ${bottom} Z`;

  const gridLevels = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#c9a227" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#c9a227" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Lignes de grille horizontales */}
      {gridLevels.map((t) => {
        const y   = PAD.t + t * cH;
        const val = Math.round(max * (1 - t));
        return (
          <g key={t}>
            <line
              x1={PAD.l} y1={y} x2={W - PAD.r} y2={y}
              stroke="rgba(160,110,40,0.11)" strokeWidth="1"
            />
            <text
              x={PAD.l - 6} y={y + 3.5}
              textAnchor="end" fontSize="9"
              fill="rgba(120,80,20,0.50)"
              fontFamily="Inter,sans-serif"
            >
              {val >= 1000 ? `${Math.round(val / 1000)}k` : val}
            </text>
          </g>
        );
      })}

      {/* Remplissage gradient */}
      <path d={areaPath} fill="url(#rev-grad)" />

      {/* Courbe */}
      <path
        d={linePath} fill="none"
        stroke="#c9a227" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"
      />

      {/* Points */}
      {pts.map((pt, i) => {
        const isLast = i === pts.length - 1;
        return (
          <circle
            key={i}
            cx={pt.x} cy={pt.y}
            r={isLast ? 4.5 : 3}
            fill={isLast ? "#c9a227" : "white"}
            stroke="#c9a227" strokeWidth="2"
          />
        );
      })}

      {/* Valeur du dernier mois */}
      {pts[pts.length - 1] && (
        <text
          x={pts[pts.length - 1].x}
          y={pts[pts.length - 1].y - 10}
          textAnchor="middle" fontSize="10" fontWeight="700"
          fill="#7a5e00" fontFamily="Inter,sans-serif"
        >
          {Math.round(pts[pts.length - 1].amount / 1000)}k
        </text>
      )}

      {/* Labels mois (axe X) */}
      {pts.map((pt, i) => (
        <text
          key={i}
          x={pt.x} y={H - 3}
          textAnchor="middle" fontSize="9"
          fill={i === pts.length - 1 ? "#7a5e00" : "rgba(120,80,20,0.48)"}
          fontWeight={i === pts.length - 1 ? "700" : "400"}
          fontFamily="Inter,sans-serif"
        >
          {pt.label}
        </text>
      ))}
    </svg>
  );
}

// ── Barres horizontales — répartition types paiement ─────────────────────────

function BreakdownBars({ data }: { data: PaymentBreakdown[] }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: "2rem 0", textAlign: "center", color: "var(--muted)" }}>
        Aucune donnée de répartition disponible ce mois
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.amount), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem", flex: 1 }}>
      {data.map((item) => {
        const pct = Math.round((item.amount / max) * 100);
        return (
          <div key={item.kind}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: "0.32rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: item.color, display: "inline-block", flexShrink: 0,
                }} />
                <span style={{ fontSize: "0.80rem", fontWeight: 600, color: "var(--cream)" }}>
                  {item.label}
                </span>
              </div>
              <span style={{ fontSize: "0.76rem", color: "var(--muted)", fontWeight: 500 }}>
                {item.count} · {fmtMoney(item.amount)}
              </span>
            </div>
            <div style={{
              height: 7, borderRadius: 999,
              background: "var(--bg-3)", overflow: "hidden",
            }}>
              <div style={{
                height: "100%", width: `${pct}%`, borderRadius: 999,
                background: item.color,
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tuile KPI principale ──────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, accent, isAlert = false,
}: {
  label: string; value: string; sub: string;
  icon: string; accent: string; isAlert?: boolean;
}) {
  return (
    <div style={{
      background: "var(--bg-1)",
      border: `1px solid ${isAlert ? "rgba(192,64,44,0.28)" : "var(--line-soft)"}`,
      borderRadius: "var(--radius)",
      padding: "1.2rem 1.3rem",
      position: "relative", overflow: "hidden",
    }}>
      {/* Accent bar top */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: accent, opacity: isAlert ? 1 : 0.75,
      }} />
      {/* Icon badge */}
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${accent}1a`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "1rem", color: accent, marginBottom: "0.8rem",
      }}>
        {icon}
      </div>
      {/* Value */}
      <div style={{
        fontSize: "1.85rem", fontWeight: 800, lineHeight: 1,
        letterSpacing: "-0.5px", fontFamily: "var(--sans)",
        color: isAlert ? accent : "var(--cream)",
      }}>
        {value}
      </div>
      {/* Label */}
      <div style={{
        fontSize: "0.76rem", color: "var(--muted)",
        textTransform: "uppercase", letterSpacing: "0.07em",
        fontWeight: 600, marginTop: "0.38rem",
      }}>
        {label}
      </div>
      {/* Sub */}
      <div style={{
        fontSize: "0.74rem", marginTop: "0.18rem",
        color: isAlert ? accent : "var(--muted-2)",
        fontWeight: isAlert ? 600 : 400,
      }}>
        {sub}
      </div>
    </div>
  );
}

// ── Tuile KPI secondaire (compacte) ──────────────────────────────────────────

function KpiRow({
  label, value, sub, icon, accent, warn = false,
}: {
  label: string; value: string; sub: string;
  icon: string; accent: string; warn?: boolean;
}) {
  return (
    <div style={{
      background: "var(--bg-1)", border: "1px solid var(--line-soft)",
      borderRadius: "var(--radius)", padding: "0.9rem 1.1rem",
      display: "flex", alignItems: "center", gap: "0.85rem",
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12,
        background: `${accent}18`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: accent, fontSize: "1.05rem", flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{
          fontSize: "1.5rem", fontWeight: 800, lineHeight: 1,
          color: warn ? accent : "var(--cream)",
        }}>
          {value}
        </div>
        <div style={{
          fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "0.12rem",
        }}>
          {label}
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--muted-2)", marginTop: "0.08rem" }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();

  const [kpis,        setKpis]        = useState<DashboardKPIs | null>(null);
  const [revenue,     setRevenue]     = useState<MonthlyRevenue[]>([]);
  const [breakdown,   setBreakdown]   = useState<PaymentBreakdown[]>([]);
  const [late,        setLate]        = useState<LateMember[]>([]);
  const [recidivists, setRecidivists] = useState<User[]>([]);
  const [recentTx,    setRecentTx]    = useState<Transaction[]>([]);
  const [range,       setRange]       = useState<DateRange>({ date_from: "", date_to: "" });

  useEffect(() => {
    const params = range.date_from || range.date_to ? {
      date_from: range.date_from || undefined,
      date_to: range.date_to || undefined,
    } : undefined;

    dashboardApi.kpis(params)
      .then((r) => setKpis(r.data))
      .catch(() => {});

    financeApi2.monthlyRevenue(params)
      .then((r) => { if (r.data.length > 0) setRevenue(r.data); })
      .catch(() => {});

    financeApi2.paymentBreakdown(params)
      .then((r) => { if (r.data.length > 0) setBreakdown(r.data); })
      .catch(() => {});

    financeApi2.lateCotisations()
      .then((r) => {
        const arr = Array.isArray(r.data) ? r.data : r.data.results;
        if (arr.length > 0) setLate(arr);
      })
      .catch(() => {});

    membersApi.list()
      .then((r) => {
        const arr = Array.isArray(r.data) ? r.data : r.data.results;
        if (arr.length > 0) setRecidivists(arr.filter((m) => m.nb_warnings >= 2));
      })
      .catch(() => {});

    transactionsApi.list(params ? { date_from: params.date_from, date_to: params.date_to } : undefined)
      .then((r) => {
        const arr = Array.isArray(r.data) ? r.data : (r.data as { results: Transaction[] }).results;
        const sorted = [...arr].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
        if (sorted.length > 0) setRecentTx(sorted);
      })
      .catch(() => {});
  }, [range]);

  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const v = (key: keyof DashboardKPIs) => kpis?.[key] ?? null;

  return (
    <div className="fade-up">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", marginBottom: "2rem",
        gap: "1rem", flexWrap: "wrap",
      }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: "0.3rem" }}>{today}</div>
          <h1 style={{ marginBottom: "0.2rem" }}>Dashboard</h1>
          <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
            {greeting()}{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""} — état de la plateforme Zola Ashé.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <DateRangePicker value={range} onChange={setRange} />
          <Link href="/membres" style={{
          display: "inline-flex", alignItems: "center", gap: "0.45rem",
          padding: "0.5rem 1rem",
          background: "var(--bg-1)", border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius)", color: "var(--cream)",
          fontSize: "0.82rem", fontWeight: 500, textDecoration: "none",
          whiteSpace: "nowrap",
          }}>
            ◎ Gérer les membres
          </Link>
        </div>
      </div>

      {/* ── KPI Row 1 — 4 tuiles principales ──────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
        gap: "1rem", marginBottom: "1rem",
      }}>
        <KpiCard
          icon="◎" accent="var(--ok)"
          label="Membres actifs"
          value={v("members_active") !== null ? fmtNum(v("members_active") as number) : "—"}
          sub={v("new_members_month") !== null ? `+${fmtNum(v("new_members_month") as number)} ce mois` : ""}
        />
        <KpiCard
          icon="◇" accent="var(--gold-2)"
          label="Revenus du mois"
          value={v("revenue_month") !== null ? fmtMoney(v("revenue_month") as number) : "—"}
          sub="Cotisations + inscriptions"
        />
        <KpiCard
          icon="◈" accent="#5b8fd4"
          label="Modules validés"
          value={v("modules_validated_month") !== null ? fmtNum(v("modules_validated_month") as number) : "—"}
          sub="Ce mois-ci"
        />
        <KpiCard
          icon="⚑" accent="var(--bad)"
          label="Signalements"
          value={v("reports_pending") !== null ? fmtNum(v("reports_pending") as number) : "—"}
          sub="En attente de traitement"
          isAlert={(v("reports_pending") as number) > 0}
        />
      </div>

      {/* ── KPI Row 2 — 3 métriques secondaires ───────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: "1rem", marginBottom: "2rem",
      }}>
        <KpiRow
          icon="▲" accent="var(--gold)"
          label="Nouveaux membres"
          value={v("new_members_month") !== null ? fmtNum(v("new_members_month") as number) : "—"}
          sub="30 derniers jours"
        />
        <KpiRow
          icon="⊘" accent="var(--warn)"
          label="Membres restreints"
          value={v("members_restricted") !== null ? fmtNum(v("members_restricted") as number) : "—"}
          sub="Accès limité actif"
          warn={(v("members_restricted") as number) > 0}
        />
        <KpiRow
          icon="⊗" accent="var(--bad)"
          label="Cotisations en retard"
          value={v("cotisations_late") !== null ? fmtNum(v("cotisations_late") as number) : "—"}
          sub="Relance nécessaire"
          warn={(v("cotisations_late") as number) > 0}
        />
      </div>

      {/* ── Taux de cotisations à jour ────────────────────────────────────── */}
      {kpis && (
        <div style={{
          background: "var(--bg-1)", border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius)", padding: "1rem 1.35rem",
          marginBottom: "2rem",
          display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap",
        }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{
              fontSize: "0.72rem", color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 600,
            }}>
              Taux de cotisations à jour
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--gold-2)", lineHeight: 1, marginTop: "0.2rem" }}>
              {kpis.members_active > 0
                ? `${Math.round(((kpis.members_active - (kpis.cotisations_late ?? 0)) / kpis.members_active) * 100)}%`
                : "—"}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{
              height: 10, borderRadius: 999,
              background: "var(--bg-3)", overflow: "hidden",
            }}>
              {kpis.members_active > 0 && (
                <div style={{
                  height: "100%", borderRadius: 999,
                  width: `${Math.round(((kpis.members_active - (kpis.cotisations_late ?? 0)) / kpis.members_active) * 100)}%`,
                  background: (kpis.cotisations_late ?? 0) === 0
                    ? "var(--ok)"
                    : (kpis.cotisations_late ?? 0) / kpis.members_active > 0.2
                    ? "var(--bad)"
                    : "var(--warn)",
                  transition: "width .4s ease",
                }} />
              )}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--muted-2)", marginTop: "0.35rem" }}>
              {kpis.members_active - (kpis.cotisations_late ?? 0)} membres à jour · {kpis.cotisations_late ?? 0} en retard sur {kpis.members_active} actifs
            </div>
          </div>
        </div>
      )}

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.65fr) minmax(0, 1fr)",
        gap: "1rem", marginBottom: "2rem",
      }}>

        {/* Courbe revenus */}
        <div style={{
          background: "var(--bg-1)", border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius)", padding: "1.25rem 1.35rem",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between",
            alignItems: "flex-start", marginBottom: "1rem",
            gap: "0.75rem", flexWrap: "wrap",
          }}>
            <div>
              <div style={{
                fontSize: "0.78rem", color: "var(--muted)",
                textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600,
              }}>
                Revenus mensuels
              </div>
              <div style={{ fontSize: "0.81rem", color: "var(--muted-2)", marginTop: "0.15rem" }}>
                Courbe sur les 12 derniers mois
              </div>
            </div>
            <div style={{
              fontSize: "0.76rem", padding: "0.28rem 0.7rem",
              background: "var(--bg-2)", border: "1px solid var(--line-soft)",
              borderRadius: "var(--radius-sm)", color: "var(--muted)", fontWeight: 500,
            }}>
              12 mois ↓
            </div>
          </div>
          <AreaChart data={revenue} />
          <div style={{
            display: "flex", justifyContent: "flex-end",
            marginTop: "0.75rem",
          }}>
            <span style={{ fontSize: "1rem", fontWeight: 800, color: "var(--gold-2)" }}>
              {revenue[revenue.length - 1]
                ? fmtMoney(revenue[revenue.length - 1].amount)
                : "—"}
            </span>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)", marginLeft: "0.4rem",
                           alignSelf: "flex-end", paddingBottom: "2px" }}>
              ce mois
            </span>
          </div>
        </div>

        {/* Répartition types */}
        <div style={{
          background: "var(--bg-1)", border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius)", padding: "1.25rem 1.35rem",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ marginBottom: "1.2rem" }}>
            <div style={{
              fontSize: "0.78rem", color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600,
            }}>
              Répartition des paiements
            </div>
            <div style={{ fontSize: "0.81rem", color: "var(--muted-2)", marginTop: "0.15rem" }}>
              Par type ce mois-ci
            </div>
          </div>

          <BreakdownBars data={breakdown} />

          <div style={{
            marginTop: "1.2rem", paddingTop: "0.9rem",
            borderTop: "1px solid var(--line-soft)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{
              fontSize: "0.75rem", color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
            }}>
              Total
            </span>
            <span style={{ fontSize: "1rem", fontWeight: 800, color: "var(--gold-2)" }}>
              {fmtMoney(breakdown.reduce((s, d) => s + d.amount, 0))}
            </span>
          </div>
        </div>
      </div>

      {/* ── Alertes ───────────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: "1rem", marginBottom: "2rem",
      }}>

        {/* Cotisations en retard */}
        <div style={{
          background: "var(--bg-1)",
          border: `1px solid ${late.length > 0 ? "rgba(192,64,44,0.22)" : "var(--line-soft)"}`,
          borderRadius: "var(--radius)", padding: "1.2rem 1.3rem",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem",
          }}>
            <span style={{ color: "var(--bad)", fontSize: "0.95rem" }}>⊗</span>
            <span style={{
              fontSize: "0.77rem", fontWeight: 700, color: "var(--cream)",
              textTransform: "uppercase", letterSpacing: "0.08em",
            }}>
              Cotisations en retard
            </span>
            <span style={{
              marginLeft: "auto",
              background: late.length > 0 ? "rgba(192,64,44,0.09)" : "var(--bg-2)",
              color: late.length > 0 ? "var(--bad)" : "var(--muted)",
              fontSize: "0.71rem", fontWeight: 700,
              padding: "0.14rem 0.5rem", borderRadius: 99,
              border: `1px solid ${late.length > 0 ? "rgba(192,64,44,0.24)" : "var(--line-soft)"}`,
            }}>
              {late.length} membre{late.length !== 1 ? "s" : ""}
            </span>
          </div>

          {late.length === 0 ? (
            <p style={{ color: "var(--ok)", fontSize: "0.84rem", textAlign: "center",
                        padding: "1rem 0", fontWeight: 500 }}>
              ✓ Aucun retard de cotisation
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              {late.slice(0, 5).map((m) => (
                <div key={m.id} style={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: "0.5rem",
                }}>
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/membres/${m.id}`} style={{
                      fontWeight: 600, fontSize: "0.85rem", color: "var(--cream)",
                      textDecoration: "none",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      display: "block",
                    }}>
                      {m.full_name}
                    </Link>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted-2)" }}>
                      {m.months_late} mois de retard
                    </div>
                  </div>
                  <div style={{
                    flexShrink: 0, fontSize: "0.82rem", fontWeight: 700, color: "var(--bad)",
                    padding: "0.18rem 0.5rem",
                    background: "rgba(192,64,44,0.07)", borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(192,64,44,0.18)",
                  }}>
                    {fmtMoney(m.amount_due)}
                  </div>
                </div>
              ))}
              {late.length > 5 && (
                <Link href="/transactions" style={{
                  fontSize: "0.78rem", color: "var(--gold-2)",
                  textDecoration: "none", fontWeight: 600,
                  textAlign: "center", padding: "0.3rem 0",
                }}>
                  +{late.length - 5} de plus →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Membres à surveiller (avertissements) */}
        <div style={{
          background: "var(--bg-1)",
          border: `1px solid ${recidivists.length > 0 ? "rgba(154,110,16,0.22)" : "var(--line-soft)"}`,
          borderRadius: "var(--radius)", padding: "1.2rem 1.3rem",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem",
          }}>
            <span style={{ color: "var(--warn)", fontSize: "0.95rem" }}>⚠</span>
            <span style={{
              fontSize: "0.77rem", fontWeight: 700, color: "var(--cream)",
              textTransform: "uppercase", letterSpacing: "0.08em",
            }}>
              Membres à surveiller
            </span>
            <span style={{
              marginLeft: "auto",
              background: recidivists.length > 0 ? "rgba(154,110,16,0.09)" : "var(--bg-2)",
              color: recidivists.length > 0 ? "var(--warn)" : "var(--muted)",
              fontSize: "0.71rem", fontWeight: 700,
              padding: "0.14rem 0.5rem", borderRadius: 99,
              border: `1px solid ${recidivists.length > 0 ? "rgba(154,110,16,0.24)" : "var(--line-soft)"}`,
            }}>
              {recidivists.length} membre{recidivists.length !== 1 ? "s" : ""}
            </span>
          </div>

          {recidivists.length === 0 ? (
            <p style={{ color: "var(--ok)", fontSize: "0.84rem", textAlign: "center",
                        padding: "1rem 0", fontWeight: 500 }}>
              ✓ Aucun avertissement actif
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              {recidivists.slice(0, 5).map((m) => (
                <div key={m.id} style={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: "0.5rem",
                }}>
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/membres/${m.id}`} style={{
                      fontWeight: 600, fontSize: "0.85rem", color: "var(--cream)",
                      textDecoration: "none",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      display: "block",
                    }}>
                      {m.full_name}
                    </Link>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted-2)" }}>
                      {m.status === "BLOQUE" ? "Compte bloqué" : "Accès restreint"}
                    </div>
                  </div>
                  {/* Indicateurs visuels d'avertissements */}
                  <div style={{ display: "flex", gap: "3px", flexShrink: 0, alignItems: "center" }}>
                    {Array.from({ length: Math.min(m.nb_warnings, 5) }).map((_, wi) => (
                      <span key={wi} style={{
                        width: 8, height: 8, borderRadius: "50%", display: "inline-block",
                        background: m.nb_warnings >= 3 ? "var(--bad)" : "var(--warn)",
                      }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Transactions récentes ────────────────────────────────────────── */}
      <div style={{
        background: "var(--bg-1)", border: "1px solid var(--line-soft)",
        borderRadius: "var(--radius)", marginBottom: "2rem", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "1rem 1.3rem", borderBottom: "1px solid var(--line-soft)",
          gap: "0.75rem", flexWrap: "wrap",
        }}>
          <div>
            <div style={{
              fontSize: "0.77rem", fontWeight: 700, color: "var(--cream)",
              textTransform: "uppercase", letterSpacing: "0.08em",
            }}>
              ≡ Transactions récentes
            </div>
            <div style={{ fontSize: "0.76rem", color: "var(--muted-2)", marginTop: "0.12rem" }}>
              5 derniers mouvements financiers
            </div>
          </div>
          <Link href="/transactions" style={{
            fontSize: "0.78rem", color: "var(--gold-2)", fontWeight: 600,
            textDecoration: "none", padding: "0.28rem 0.7rem",
            border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)",
            background: "var(--bg-2)",
          }}>
            Voir tout →
          </Link>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line-soft)" }}>
                {["Membre", "Type", "Montant", "Statut", "Date"].map((h) => (
                  <th key={h} style={{
                    padding: "0.55rem 1rem", textAlign: "left",
                    fontSize: "0.70rem", textTransform: "uppercase", letterSpacing: "0.07em",
                    color: "var(--muted-2)", fontWeight: 700,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentTx.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "1.5rem", textAlign: "center", color: "var(--muted)", fontSize: "0.84rem" }}>
                    Aucune transaction récente
                  </td>
                </tr>
              ) : (
                recentTx.map((t, i) => (
                  <tr key={t.id} style={{
                    borderBottom: i < recentTx.length - 1 ? "1px solid var(--line-soft)" : "none",
                    transition: "background .12s",
                  }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Membre */}
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <div style={{ fontWeight: 600, fontSize: "0.84rem", color: "var(--cream)" }}>
                        {t.user_name}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "var(--muted-2)" }}>{t.user_email}</div>
                    </td>

                    {/* Type */}
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <span style={{
                        fontSize: "0.65rem", fontWeight: 700, borderRadius: 99,
                        padding: "0.1rem 0.48rem",
                        color: TX_KIND_COLOR[t.kind],
                        background: `${TX_KIND_COLOR[t.kind]}14`,
                        border: `1px solid ${TX_KIND_COLOR[t.kind]}28`,
                      }}>
                        {TX_KIND_LABEL[t.kind]}
                      </span>
                    </td>

                    {/* Montant */}
                    <td style={{ padding: "0.65rem 1rem", whiteSpace: "nowrap" }}>
                      <span style={{
                        fontWeight: 700, fontSize: "0.88rem",
                        color: t.status === "REUSSI" ? "var(--gold-2)"
                             : t.status === "REMBOURSE" || t.status === "EXONERE" ? "var(--muted)"
                             : "var(--cream)",
                      }}>
                        {t.status === "REMBOURSE" ? "−" : ""}
                        {t.amount === 0 ? "—" : fmtMoney(t.amount)}
                      </span>
                    </td>

                    {/* Statut */}
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <span style={{
                        fontSize: "0.65rem", fontWeight: 700, borderRadius: 99,
                        padding: "0.1rem 0.48rem",
                        color: TX_STATUS_COLOR[t.status],
                        background: `${TX_STATUS_COLOR[t.status]}14`,
                        border: `1px solid ${TX_STATUS_COLOR[t.status]}28`,
                      }}>
                        {TX_STATUS_LABEL[t.status]}
                      </span>
                    </td>

                    {/* Date */}
                    <td style={{ padding: "0.65rem 1rem", fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {new Date(t.created_at).toLocaleDateString("fr-FR", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Accès rapides ─────────────────────────────────────────────────── */}
      <div>
        <div style={{
          fontSize: "0.76rem", color: "var(--muted)",
          textTransform: "uppercase", letterSpacing: "0.1em",
          fontWeight: 600, marginBottom: "0.85rem",
        }}>
          Accès rapides
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "0.65rem",
        }}>
          {[
            { href: "/membres",      label: "Membres",      icon: "◎", color: "var(--ok)"    },
            { href: "/contenu",      label: "Contenu",      icon: "◫", color: "var(--gold)"  },
            { href: "/finance",      label: "Finance",      icon: "◇", color: "var(--gold-2)"},
            { href: "/moderation",   label: "Modération",   icon: "⊗", color: "var(--bad)"   },
            { href: "/transactions", label: "Transactions", icon: "≡", color: "var(--muted)" },
            { href: "/lives",        label: "Lives",        icon: "⬤", color: "#b5532a"      },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={{
                display: "flex", alignItems: "center", gap: "0.6rem",
                padding: "0.72rem 0.9rem",
                background: "var(--bg-1)", border: "1px solid var(--line-soft)",
                borderRadius: "var(--radius)", color: "var(--cream)",
                fontSize: "0.84rem", fontWeight: 500, textDecoration: "none",
                transition: "all .15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--line-med)";
                (e.currentTarget as HTMLAnchorElement).style.background  = "var(--bg-2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--line-soft)";
                (e.currentTarget as HTMLAnchorElement).style.background  = "var(--bg-1)";
              }}
            >
              <span style={{ color: link.color, fontSize: "0.95rem", flexShrink: 0 }}>
                {link.icon}
              </span>
              {link.label}
            </a>
          ))}
        </div>
      </div>

    </div>
  );
}