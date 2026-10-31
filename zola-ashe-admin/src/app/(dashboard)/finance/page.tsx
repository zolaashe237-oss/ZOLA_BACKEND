"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  asList, billingPaymentsApi, dashboardApi, downloadBlob,
  financeApi, financeApi2, membersApi, transactionsApi,
} from "@/lib/endpoints";
import { DateRangePicker, type DateRange } from "@/components/DateRangePicker";
import type {
  DashboardKPIs, LateMember, MonthlyRevenue, Paginated, PaymentBreakdown, PaymentKind, PaymentStatus, Transaction, TransactionKPIs, User,
} from "@/lib/types";
import { Badge, Button, Card, Input, Pagination, Select, STATUS_COLOR, errorMessage } from "@/components/ui";
import { useToast } from "@/components/Toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000).toLocaleString("fr-FR")} k`;
  return n.toLocaleString("fr-FR");
}

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  REUSSI: "Réussi",
  EN_ATTENTE: "En attente",
  ECHOUE: "Échoué",
  REMBOURSE: "Remboursé",
  EXONERE: "Exonéré",
};

const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  REUSSI: "#2e9460",
  EN_ATTENTE: "#9a6e10",
  ECHOUE: "#c0402c",
  REMBOURSE: "#b5532a",
  EXONERE: "#243a85",
};

const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  COTISATION: "Cotisation",
  INSCRIPTION: "Inscription",
  DON: "Don",
  FORMATION: "Formation",
  CADEAU: "Cadeau",
  REMBOURSEMENT: "Remboursement",
  EXONERATION: "Exonération",
};

function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString("fr-FR") : "—";
}

type MemberWithLateFields = User & {
  months_late?: number;
  amount_due?: number;
  cotisation_unpaid?: boolean;
};

function extractLateMembers(data: User[] | Paginated<User>): LateMember[] {
  const members = asList(data) as MemberWithLateFields[];
  return members
    .filter((m) => Boolean(m.cotisation_unpaid) || (m.amount_due ?? 0) > 0 || (m.months_late ?? 0) > 0)
    .map((m) => ({
      ...m,
      months_late: m.months_late ?? 0,
      amount_due: m.amount_due ?? 0,
    }));
}

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return `M ${pts[0]?.[0] ?? 0},${pts[0]?.[1] ?? 0}`;
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

// ── KPI Tile ──────────────────────────────────────────────────────────────────

function KpiTile({ label, value, unit, sub, accent, trendPct, trendLabel }: {
  label: string; value: string; unit?: string; sub?: string;
  accent?: string; trendPct?: number; trendLabel?: string;
}) {
  const up = (trendPct ?? 0) >= 0;
  return (
    <div className="kpi-tile" style={{ "--tile-accent": accent ?? "var(--gold)" } as React.CSSProperties}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ display: "flex", alignItems: "baseline", gap: "0.25rem", flexWrap: "wrap" }}>
        <span>{value}</span>
        {unit && <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--muted)" }}>{unit}</span>}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {trendPct !== undefined && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.3rem" }}>
          <span style={{
            fontSize: "0.70rem", fontWeight: 700,
            color: up ? "var(--ok)" : "var(--bad)",
            background: up ? "var(--ok-bg)" : "var(--bad-bg)",
            padding: "0.06rem 0.38rem", borderRadius: 99,
          }}>
            {up ? "↑" : "↓"} {Math.abs(trendPct).toFixed(1)} %
          </span>
          {trendLabel && <span style={{ fontSize: "0.67rem", color: "var(--muted-2)" }}>{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ── Graphique courbe + aire (SVG) ─────────────────────────────────────────────

function LineAreaChart({ data }: { data: MonthlyRevenue[] }) {
  if (!data || data.length < 2) {
    return (
      <div style={{ height: 210, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", border: "1px dashed var(--line-soft)", borderRadius: "var(--radius)" }}>
        Données insuffisantes pour tracer la courbe de revenus
      </div>
    );
  }

  const W = 700, H = 210;
  const ML = 58, MR = 22, MT = 22, MB = 32;
  const PW = W - ML - MR;
  const PH = H - MT - MB;
  const max = Math.max(...data.map((d) => d.amount), 1);
  const avg = data.reduce((s, d) => s + d.amount, 0) / data.length;

  const px = (i: number) => ML + (i / (data.length - 1)) * PW;
  const py = (v: number) => MT + PH * (1 - v / max);

  const pts: [number, number][] = data.map((d, i) => [px(i), py(d.amount)]);
  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L ${pts[pts.length - 1][0]},${MT + PH} L ${pts[0][0]},${MT + PH} Z`;

  // 5 niveaux de grille
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.85rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ fontSize: "1rem" }}>Revenus mensuels — 12 mois glissants</h2>
        <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.80rem" }}>
          <span style={{ color: "var(--muted)" }}>
            Total : <strong style={{ color: "var(--gold-2)" }}>
              {data.reduce((s, d) => s + d.amount, 0).toLocaleString("fr-FR")} FCFA
            </strong>
          </span>
          <span style={{ color: "var(--muted)" }}>
            Moy. : <strong style={{ color: "var(--ink)" }}>
              {Math.round(avg).toLocaleString("fr-FR")} FCFA
            </strong>
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        <defs>
          <linearGradient id="finGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#c9a227" stopOpacity="0.22" />
            <stop offset="88%" stopColor="#c9a227" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grille horizontale */}
        {gridLevels.map((r, i) => {
          const v = max * r;
          const y = py(v);
          return (
            <g key={i}>
              <line x1={ML} x2={W - MR} y1={y} y2={y}
                stroke="rgba(160,130,70,0.13)" strokeWidth="1" strokeDasharray="4 4" />
              <text x={ML - 6} y={y + 4} textAnchor="end"
                fontSize="9" fill="#9e8e74" fontFamily="Inter,sans-serif">
                {fmtShort(v)}
              </text>
            </g>
          );
        })}

        {/* Ligne moyenne */}
        <line x1={ML} x2={W - MR} y1={py(avg)} y2={py(avg)}
          stroke="#52b083" strokeWidth="1.2" strokeDasharray="5 3" strokeOpacity="0.55" />
        <text x={W - MR + 4} y={py(avg) + 4} fontSize="8" fill="#52b083" fontFamily="Inter,sans-serif">
          moy.
        </text>

        {/* Aire */}
        <path d={areaPath} fill="url(#finGrad)" />

        {/* Courbe */}
        <path d={linePath} fill="none" stroke="#c9a227" strokeWidth="2.8"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Points + étiquettes */}
        {pts.map(([cx, cy], i) => {
          const d = data[i];
          const isLast = i === data.length - 1;
          const isMax  = d.amount === max;
          const showLabel = isLast || isMax || i === 0;
          return (
            <g key={i}>
              {showLabel && (
                <text x={cx} y={cy - 9} textAnchor="middle"
                  fontSize="8.5" fontWeight={isLast ? "700" : "500"}
                  fill={isLast ? "#c9a227" : "#6b5c42"} fontFamily="Inter,sans-serif">
                  {fmtShort(d.amount)}
                </text>
              )}
              <circle cx={cx} cy={cy}
                r={isLast || isMax ? 5 : 3.5}
                fill={isLast ? "#c9a227" : "#fefcf4"}
                stroke="#c9a227" strokeWidth={isLast ? 0 : 2} />
              <text x={cx} y={H - 4} textAnchor="middle"
                fontSize="9" fontWeight={isLast ? "700" : "400"}
                fill={isLast ? "#c9a227" : "#9e8e74"} fontFamily="Inter,sans-serif">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}

// ── Diagramme donut répartition (SVG) ────────────────────────────────────────

function DonutChart({ data }: { data: PaymentBreakdown[] }) {
  const total = data ? data.reduce((s, d) => s + d.amount, 0) : 0;
  if (!data || data.length === 0 || total === 0) {
    return (
      <div style={{ height: 168, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", border: "1px dashed var(--line-soft)", borderRadius: "var(--radius)" }}>
        Aucune donnée de répartition disponible ce mois
      </div>
    );
  }

  const R = 64, CX = 100, CY = 100;
  const C = 2 * Math.PI * R;

  let cumDash = 0;
  const segs = data.map((d) => {
    const dash   = (d.amount / total) * C;
    const offset = cumDash;
    cumDash += dash;
    return { ...d, dash, offset, pct: d.amount / total };
  });

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "1rem" }}>Répartition ce mois</h2>
      <div style={{ display: "flex", gap: "1.2rem", alignItems: "center" }}>
        {/* Donut SVG */}
        <div style={{ flexShrink: 0, width: 168 }}>
          <svg viewBox="0 0 200 200" style={{ width: "100%", display: "block" }}>
            {/* Fond */}
            <circle cx={CX} cy={CY} r={R} fill="none"
              stroke="rgba(160,130,70,0.11)" strokeWidth="26" />
            <g transform={`rotate(-90, ${CX}, ${CY})`}>
              {segs.map((s, i) => (
                <circle key={i} cx={CX} cy={CY} r={R}
                  fill="none" stroke={s.color} strokeWidth="25"
                  strokeDasharray={`${s.dash} ${C - s.dash}`}
                  strokeDashoffset={-s.offset} />
              ))}
            </g>
            {/* Centre */}
            <text x="100" y="95" textAnchor="middle"
              fontSize="15" fontWeight="800" fill="#2d2010" fontFamily="Inter,sans-serif">
              {fmtShort(total)}
            </text>
            <text x="100" y="112" textAnchor="middle"
              fontSize="8" fill="#9e8e74" fontFamily="Inter,sans-serif">
              FCFA ce mois
            </text>
          </svg>
        </div>

        {/* Légende + barres */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {segs.map((s) => (
            <div key={s.kind}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.24rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: "inline-block", flexShrink: 0 }} />
                  <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 500 }}>{s.label}</span>
                </div>
                <div style={{ display: "flex", gap: "0.55rem", alignItems: "baseline" }}>
                  <span style={{ fontSize: "0.68rem", color: "var(--muted-2)" }}>{s.count} pmt.</span>
                  <span style={{ fontSize: "0.80rem", fontWeight: 700, color: "var(--ink)", minWidth: 68, textAlign: "right" }}>
                    {s.amount.toLocaleString("fr-FR")} F
                  </span>
                </div>
              </div>
              <div style={{ height: 4, background: "var(--bg-3)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${s.pct * 100}%`, background: s.color, borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Graphique barres comparaison (SVG) ────────────────────────────────────────

function BarCompareChart({ data }: { data: MonthlyRevenue[] }) {
  if (data.length < 2) return null;

  // 6 derniers mois comparés 2 à 2 (M-1 vs M)
  const recent = data.slice(-6);
  const W = 340, H = 140;
  const ML = 44, MR = 12, MT = 16, MB = 28;
  const PW = W - ML - MR;
  const PH = H - MT - MB;
  const max = Math.max(...recent.map((d) => d.amount), 1);
  const barW = (PW / recent.length) * 0.62;
  const gap  = (PW / recent.length) * 0.38 / 2;

  const gridLevels = [0.5, 1.0];

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>Progression — 6 derniers mois</h2>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        {/* Grille */}
        {gridLevels.map((r, i) => {
          const y = MT + PH * (1 - r);
          return (
            <g key={i}>
              <line x1={ML} x2={W - MR} y1={y} y2={y}
                stroke="rgba(160,130,70,0.13)" strokeWidth="1" strokeDasharray="3 3" />
              <text x={ML - 5} y={y + 4} textAnchor="end"
                fontSize="8" fill="#9e8e74" fontFamily="Inter,sans-serif">
                {fmtShort(max * r)}
              </text>
            </g>
          );
        })}

        {/* Barres */}
        {recent.map((d, i) => {
          const h   = ((d.amount / max) * PH);
          const x   = ML + i * (PW / recent.length) + gap;
          const y   = MT + PH - h;
          const prev = recent[i - 1];
          const up   = !prev || d.amount >= prev.amount;
          const isLast = i === recent.length - 1;
          const color  = isLast ? "#c9a227" : up ? "#52b083" : "#9e8e74";

          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h}
                rx="3" fill={color} opacity={isLast ? 1 : 0.75} />
              {/* Valeur */}
              {isLast && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle"
                  fontSize="8" fontWeight="700" fill="#c9a227" fontFamily="Inter,sans-serif">
                  {fmtShort(d.amount)}
                </text>
              )}
              {/* Label mois */}
              <text x={x + barW / 2} y={H - 4} textAnchor="middle"
                fontSize="9" fontWeight={isLast ? "700" : "400"}
                fill={isLast ? "#c9a227" : "#9e8e74"} fontFamily="Inter,sans-serif">
                {d.label}
              </text>
              {/* Flèche tendance */}
              {prev && (
                <text x={x + barW / 2} y={y - 14} textAnchor="middle"
                  fontSize="9" fill={up ? "#2e9460" : "#c0402c"} fontFamily="Inter,sans-serif">
                  {up ? "↑" : "↓"}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </>
  );
}

// ── Cotisations en retard ─────────────────────────────────────────────────────

const STATUS_LABEL_FIN: Record<string, string> = {
  ACTIF: "Actif", RESTREINT: "Restreint", BLOQUE: "Bloqué",
};

function LateCotisations({ items, onReminder, onReminderOne }: {
  items: LateMember[]; onReminder: () => void; onReminderOne: (id: number) => void;
}) {
  const totalDue = items.reduce((s, m) => s + m.amount_due, 0);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.1rem" }}>
            Cotisations en retard
            {items.length > 0 && (
              <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid rgba(154,110,16,0.25)", padding: "0.06rem 0.45rem", borderRadius: 99 }}>
                {items.length}
              </span>
            )}
          </h2>
          <p style={{ fontSize: "0.76rem", color: "var(--muted-2)", margin: 0 }}>
            Cotisation mensuelle : <strong style={{ color: "var(--warn)" }}>10 000 FCFA / mois</strong>
            {" · "}Un compte actif peut avoir des cotisations impayées.
          </p>
        </div>
        <Button variant="ghost" onClick={onReminder} style={{ fontSize: "0.78rem", padding: "0.32rem 0.7rem", flexShrink: 0, marginLeft: "1rem" }}>
          Envoyer relances
        </Button>
      </div>

      {items.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.88rem", padding: "0.5rem 0", marginTop: "0.75rem" }}>
          ✓ Aucun retard — tout est à jour !
        </p>
      ) : (
        <>
          <table className="tbl" style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th>Membre</th>
                <th style={{ textAlign: "center" }}>Statut compte</th>
                <th style={{ textAlign: "center" }}>Retard</th>
                <th style={{ textAlign: "right" }}>Montant dû</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((m) => {
                const unitPrice = m.months_late > 0 ? Math.round(m.amount_due / m.months_late) : m.amount_due;
                const statusColor = STATUS_COLOR[m.status] ?? "var(--muted)";
                return (
                  <tr key={m.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: "0.855rem", color: "var(--gold-2)" }}>{m.full_name}</div>
                      <div style={{ color: "var(--muted-2)", fontSize: "0.76rem" }}>{m.email}</div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{
                        fontSize: "0.64rem", fontWeight: 700, borderRadius: 99,
                        color: statusColor, background: `${statusColor}12`,
                        border: `1px solid ${statusColor}28`,
                        padding: "0.05rem 0.42rem", whiteSpace: "nowrap",
                      }}>
                        {m.status === "ACTIF" ? "●" : "○"} {STATUS_LABEL_FIN[m.status] ?? m.status}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{
                        fontSize: "0.68rem", fontWeight: 700, borderRadius: 99,
                        color: m.months_late >= 3 ? "var(--bad)" : "var(--warn)",
                        background: m.months_late >= 3 ? "var(--bad-bg)" : "var(--warn-bg)",
                        border: `1px solid ${m.months_late >= 3 ? "rgba(192,64,44,0.28)" : "rgba(154,110,16,0.25)"}`,
                        padding: "0.05rem 0.45rem",
                      }}>
                        {m.months_late} mois
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--cream)" }}>
                        {m.amount_due.toLocaleString("fr-FR")} F
                      </div>
                      {m.months_late > 0 && (
                        <div style={{ fontSize: "0.70rem", color: "var(--muted-2)", marginTop: "0.1rem" }}>
                          {m.months_late} × {unitPrice.toLocaleString("fr-FR")} F
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button variant="ghost" onClick={() => onReminderOne(m.id)} style={{ fontSize: "0.74rem", padding: "0.26rem 0.58rem" }}>
                          Relancer
                        </Button>
                        <Link href={`/membres/${m.id}`}>
                          <Button variant="ghost" style={{ fontSize: "0.74rem", padding: "0.26rem 0.58rem" }}>
                            Fiche
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{
            marginTop: "0.65rem", padding: "0.5rem 0.75rem",
            background: "var(--bad-bg)", border: "1px solid rgba(192,64,44,0.22)",
            borderRadius: "var(--radius-sm)", display: "flex", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: "0.78rem", color: "var(--bad)" }}>Total dû</span>
            <span style={{ fontSize: "0.88rem", fontWeight: 800, color: "var(--bad)" }}>
              {totalDue.toLocaleString("fr-FR")} FCFA
            </span>
          </div>
        </>
      )}
    </>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function FinancePage() {
  const { toast } = useToast();
  const [revenue,   setRevenue]   = useState<MonthlyRevenue[]>([]);
  const [late,      setLate]      = useState<LateMember[]>([]);
  const [breakdown, setBreakdown] = useState<PaymentBreakdown[]>([]);
  const [dashboard, setDashboard] = useState<DashboardKPIs | null>(null);
  const [kpis,      setKpis]      = useState<TransactionKPIs | null>(null);
  const [payments,  setPayments]  = useState<Transaction[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage,  setPaymentsPage]  = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState(10);

  const [period, setPeriod] = useState<DateRange>({ date_from: "", date_to: "" });
  const [paymentFilters, setPaymentFilters] = useState({
    kind: "ALL", status: "ALL", date_from: "", date_to: "",
  });
  const [exportPeriod, setExportPeriod] = useState({ date_from: "", date_to: "" });
  const [activeTab, setActiveTab] = useState<"manual" | "refund" | "exonerate">("manual");
  const [manual, setManual] = useState({ user_id: "", kind: "COTISATION", amount: "", reason: "" });
  const [refund, setRefund] = useState({ user_id: "", amount: "", reason: "" });
  const [exonerate, setExonerate] = useState({ user_id: "", reason: "" });

  const load = useCallback(async () => {
    const periodParams = period.date_from || period.date_to ? {
      date_from: period.date_from || undefined,
      date_to: period.date_to || undefined,
    } : undefined;

    const [dashboardRes, revRes, membersRes, lateRes, bdRes, kpisRes] = await Promise.allSettled([
      dashboardApi.kpis(periodParams),
      financeApi2.monthlyRevenue(periodParams),
      membersApi.list(),
      financeApi2.lateCotisations(),
      financeApi2.paymentBreakdown(periodParams),
      transactionsApi.kpis(),
    ]);
    if (dashboardRes.status === "fulfilled") {
      const data = dashboardRes.value.data;
      setDashboard(data);
      if (data.monthly_revenue?.length) setRevenue(data.monthly_revenue);
      if (data.payment_breakdown?.length) setBreakdown(data.payment_breakdown);
    }
    if (
      revRes.status === "fulfilled"
      && revRes.value.data.length > 0
      && (dashboardRes.status !== "fulfilled" || !dashboardRes.value.data.monthly_revenue?.length)
    ) setRevenue(revRes.value.data);
    if (membersRes.status === "fulfilled") {
      const list = extractLateMembers(membersRes.value.data);
      if (list.length > 0) setLate(list);
    } else if (lateRes.status === "fulfilled") {
      const list = asList(lateRes.value.data);
      if (list.length > 0) setLate(list);
    }
    if (
      bdRes.status === "fulfilled"
      && bdRes.value.data.length > 0
      && (dashboardRes.status !== "fulfilled" || !dashboardRes.value.data.payment_breakdown?.length)
    ) setBreakdown(bdRes.value.data);
    if (kpisRes.status === "fulfilled")
      setKpis(kpisRes.value.data);
  }, [period]);

  const loadPayments = useCallback(async () => {
    const params: Record<string, string | number> = {
      page: paymentsPage,
      page_size: paymentsPageSize,
    };
    if (paymentFilters.kind !== "ALL") params.kind = paymentFilters.kind;
    if (paymentFilters.status !== "ALL") params.status = paymentFilters.status;
    if (paymentFilters.date_from) params.date_from = paymentFilters.date_from;
    if (paymentFilters.date_to) params.date_to = paymentFilters.date_to;

    try {
      const { data } = await transactionsApi.list(params);
      if (Array.isArray(data)) {
        setPayments(data);
        setPaymentsTotal(data.length);
      } else {
        const paginated = data as Paginated<Transaction>;
        setPayments(paginated.results);
        setPaymentsTotal(paginated.count);
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [paymentFilters, paymentsPage, paymentsPageSize]);

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "success");
      load();
      loadPayments();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const sendReminders = async (userId?: number) => {
    try {
      const { data } = await financeApi.sendReminders(userId ? { user_id: userId } : undefined);
      const n = data.reminded ?? 0;
      toast(
        n === 0
          ? "Aucun membre en retard à relancer."
          : `${n} relance${n > 1 ? "s" : ""} envoyée${n > 1 ? "s" : ""} avec succès.`,
        "success"
      );
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadPayments(); }, [loadPayments]);

  // Métriques dérivées
  const revenueMonth  = dashboard?.revenue_month ?? revenue.at(-1)?.amount ?? 0;
  const revenuePrev   = revenue.at(-2)?.amount ?? 0;
  const revenueTotal  = dashboard?.revenue_total ?? kpis?.revenue_total ?? 0;
  const collectionRate = dashboard?.collection_rate;
  const unpaidAmount  = dashboard?.unpaid_amount;
  const growthPct     = revenuePrev > 0 ? ((revenueMonth - revenuePrev) / revenuePrev) * 100 : 0;
  const lateAmount    = unpaidAmount ?? late.reduce((s, m) => s + m.amount_due, 0);
  const lateCount     = dashboard?.cotisations_late ?? late.length;
  const exportParams  = {
    date_from: exportPeriod.date_from || undefined,
    date_to: exportPeriod.date_to || undefined,
  };

  const updatePaymentFilter = (key: keyof typeof paymentFilters, value: string) => {
    setPaymentFilters((prev) => ({ ...prev, [key]: value }));
    setPaymentsPage(1);
  };

  return (
    <div className="fade-up">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div className="eyebrow">Administration financière</div>
          <h1>Finance</h1>
          <p>Tableau de bord — revenus, cotisations et paiements manuels.</p>
        </div>
        <DateRangePicker value={period} onChange={(newRange) => setPeriod(newRange)} />
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <KpiTile
          label="Revenus ce mois"
          value={fmtShort(revenueMonth)}
          unit="FCFA"
          trendPct={growthPct}
          trendLabel="vs mois préc."
          accent="#c9a227"
        />
        <KpiTile
          label="Revenus cumulés"
          value={fmtShort(revenueTotal)}
          unit="FCFA"
          sub={dashboard?.revenue_total == null ? "Total transactions" : "Depuis le lancement"}
          accent="#5b8fd4"
        />
        <KpiTile
          label="Taux de recouvrement"
          value={collectionRate != null ? collectionRate.toFixed(1).replace(".", ",") : "—"}
          unit={collectionRate != null ? "%" : undefined}
          sub={collectionRate == null ? "En attente backend" : "Cotisations encaissées"}
          accent="#52b083"
        />
        <KpiTile
          label="Montant impayé"
          value={unpaidAmount != null ? fmtShort(unpaidAmount) : "—"}
          unit={unpaidAmount != null ? "FCFA" : undefined}
          sub={unpaidAmount == null ? "En attente backend" : `${lateCount} membre${lateCount !== 1 ? "s" : ""} en retard`}
          accent="#9a6e10"
        />
        <KpiTile
          label="Retards"
          value={String(lateCount)}
          sub={lateCount > 0 ? `${lateAmount.toLocaleString("fr-FR")} FCFA dûs` : "Tout à jour ✓"}
          accent={lateCount > 0 ? "#c0402c" : "#2e9460"}
        />
      </div>

      {/* ── Courbe revenus 12 mois ────────────────────────────────────────── */}
      <Card style={{ marginBottom: "1.25rem" }}>
        <LineAreaChart data={revenue} />
      </Card>

      {/* ── Donut + Barres ───────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.25rem" }}>
        <Card>
          <DonutChart data={breakdown} />
        </Card>
        <Card>
          <BarCompareChart data={revenue} />
        </Card>
      </div>

      {/* ── Cotisations en retard ─────────────────────────────────────────── */}
      <Card style={{ marginBottom: "1.25rem" }}>
        <LateCotisations
          items={late}
          onReminder={() => sendReminders()}
          onReminderOne={(id) => sendReminders(id)}
        />
      </Card>

      {/* ── Historique complet des paiements ─────────────────────────────── */}
      <Card style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>Historique complet des paiements</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.82rem" }}>Données réelles via GET /api/billing/payments/.</p>
          </div>
          <Button variant="ghost" onClick={loadPayments}>Actualiser</Button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          <Input type="date" label="Du" value={paymentFilters.date_from}
            onChange={(e) => updatePaymentFilter("date_from", e.target.value)} />
          <Input type="date" label="Au" value={paymentFilters.date_to}
            onChange={(e) => updatePaymentFilter("date_to", e.target.value)} />
          <Select label="Type" value={paymentFilters.kind}
            onChange={(e) => updatePaymentFilter("kind", e.target.value)}>
            <option value="ALL">Tous</option>
            <option value="COTISATION">Cotisation</option>
            <option value="INSCRIPTION">Inscription</option>
            <option value="DON">Don</option>
            <option value="CADEAU">Cadeau</option>
            <option value="REMBOURSEMENT">Remboursement</option>
            <option value="EXONERATION">Exonération</option>
          </Select>
          <Select label="Statut" value={paymentFilters.status}
            onChange={(e) => updatePaymentFilter("status", e.target.value)}>
            <option value="ALL">Tous</option>
            <option value="REUSSI">Réussi</option>
            <option value="EN_ATTENTE">En attente</option>
            <option value="ECHOUE">Échoué</option>
            <option value="REMBOURSE">Remboursé</option>
            <option value="EXONERE">Exonéré</option>
          </Select>
        </div>

        <table className="tbl">
          <thead>
            <tr>
              <th>Membre</th>
              <th>Type</th>
              <th>Statut</th>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Montant</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>
                  <div style={{ fontWeight: 700 }}>{p.user_name}</div>
                  <div style={{ color: "var(--muted-2)", fontSize: "0.76rem" }}>{p.user_email}</div>
                </td>
                <td>{PAYMENT_KIND_LABEL[p.kind] ?? p.kind}</td>
                <td><Badge color={PAYMENT_STATUS_COLOR[p.status]}>{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</Badge></td>
                <td>{fmtDate(p.paid_at ?? p.created_at)}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{p.amount.toLocaleString("fr-FR")} {p.currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: "0.88rem", padding: "0.75rem 0" }}>Aucun paiement pour ces filtres.</p>
        )}
        <Pagination
          page={paymentsPage}
          totalPages={Math.max(1, Math.ceil(paymentsTotal / paymentsPageSize))}
          total={paymentsTotal}
          pageSize={paymentsPageSize}
          onPage={setPaymentsPage}
          onPageSize={(size) => { setPaymentsPageSize(size); setPaymentsPage(1); }}
        />
      </Card>

      {/* ── Opérations administratives + Exports ─────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
        <Card>
          <div style={{ display: "flex", borderBottom: "1px solid var(--line-soft)", marginBottom: "1rem", gap: "1rem" }}>
            <button
              onClick={() => setActiveTab("manual")}
              style={{
                background: "none", border: "none", paddingBottom: "0.5rem", cursor: "pointer",
                color: activeTab === "manual" ? "var(--gold)" : "var(--muted)",
                borderBottom: activeTab === "manual" ? "2px solid var(--gold)" : "none",
                fontWeight: activeTab === "manual" ? 700 : 400,
                fontSize: "0.85rem",
              }}
            >
              Paiement manuel
            </button>
            <button
              onClick={() => setActiveTab("refund")}
              style={{
                background: "none", border: "none", paddingBottom: "0.5rem", cursor: "pointer",
                color: activeTab === "refund" ? "var(--gold)" : "var(--muted)",
                borderBottom: activeTab === "refund" ? "2px solid var(--gold)" : "none",
                fontWeight: activeTab === "refund" ? 700 : 400,
                fontSize: "0.85rem",
              }}
            >
              Remboursement
            </button>
            <button
              onClick={() => setActiveTab("exonerate")}
              style={{
                background: "none", border: "none", paddingBottom: "0.5rem", cursor: "pointer",
                color: activeTab === "exonerate" ? "var(--gold)" : "var(--muted)",
                borderBottom: activeTab === "exonerate" ? "2px solid var(--gold)" : "none",
                fontWeight: activeTab === "exonerate" ? 700 : 400,
                fontSize: "0.85rem",
              }}
            >
              Exonération
            </button>
          </div>

          {activeTab === "manual" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <Input label="ID membre" value={manual.user_id}
                onChange={(e) => setManual({ ...manual, user_id: e.target.value })} />
              <Select label="Type" value={manual.kind}
                onChange={(e) => setManual({ ...manual, kind: e.target.value })}>
                <option value="INSCRIPTION">Droit d&apos;inscription</option>
                <option value="COTISATION">Cotisation mensuelle</option>
                <option value="DON">Don volontaire</option>
              </Select>
              <Input type="number" label="Montant (FCFA, optionnel)" value={manual.amount}
                placeholder="Montant par défaut si vide"
                onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
              <Input label="Motif" value={manual.reason}
                onChange={(e) => setManual({ ...manual, reason: e.target.value })} />
              <Button
                onClick={() => wrap(
                  () => financeApi.manual({
                    user_id: Number(manual.user_id),
                    kind: manual.kind,
                    amount: manual.amount ? Number(manual.amount) : undefined,
                    reason: manual.reason
                  }),
                  "Paiement manuel enregistré.",
                )}
              >
                Valider le paiement
              </Button>
            </div>
          )}

          {activeTab === "refund" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <Input label="ID membre" value={refund.user_id}
                onChange={(e) => setRefund({ ...refund, user_id: e.target.value })} />
              <Input type="number" label="Montant (FCFA)" value={refund.amount}
                placeholder="Montant à rembourser"
                onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
              <Input label="Motif" value={refund.reason}
                onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
              <Button
                onClick={() => wrap(
                  () => financeApi.refund({
                    user_id: Number(refund.user_id),
                    amount: Number(refund.amount),
                    reason: refund.reason
                  }),
                  "Remboursement enregistré.",
                )}
              >
                Enregistrer le remboursement
              </Button>
            </div>
          )}

          {activeTab === "exonerate" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <Input label="ID membre" value={exonerate.user_id}
                onChange={(e) => setExonerate({ ...exonerate, user_id: e.target.value })} />
              <Input label="Motif" value={exonerate.reason}
                onChange={(e) => setExonerate({ ...exonerate, reason: e.target.value })} />
              <Button
                onClick={() => wrap(
                  () => financeApi.exonerate({
                    user_id: Number(exonerate.user_id),
                    reason: exonerate.reason
                  }),
                  "Exonération accordée.",
                )}
              >
                Accorder l&apos;exonération
              </Button>
            </div>
          )}
        </Card>

        <Card>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.85rem" }}>Exports</h2>
          <p style={{ fontSize: "0.83rem", color: "var(--muted)", marginBottom: "0.85rem", lineHeight: 1.6 }}>
            Téléchargez les données membres et paiements au format CSV avec une période optionnelle.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.65rem" }}>
            <Input type="date" label="Du" value={exportPeriod.date_from}
              onChange={(e) => setExportPeriod({ ...exportPeriod, date_from: e.target.value })} />
            <Input type="date" label="Au" value={exportPeriod.date_to}
              onChange={(e) => setExportPeriod({ ...exportPeriod, date_to: e.target.value })} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", alignItems: "flex-start" }}>
            <Button variant="ghost" onClick={() => wrap(
              async () => downloadBlob((await financeApi.exportMembers(exportParams)).data as Blob, "membres.csv"),
              "Export membres téléchargé.",
            )}>
              ⬇ Export membres (CSV)
            </Button>
            <Button variant="ghost" onClick={() => wrap(
              async () => downloadBlob((await financeApi.exportPayments(exportParams)).data as Blob, "paiements.csv"),
              "Export paiements téléchargé.",
            )}>
              ⬇ Export paiements (CSV)
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
