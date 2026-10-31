"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { progressionApi } from "@/lib/endpoints";
import type {
  FormationProgressStat,
  MemberProgressEntry,
  Paginated,
  ProgressionKPIs,
} from "@/lib/types";
import { Alert, Badge, Button, Card, Pagination, errorMessage, usePagination } from "@/components/ui";
import { ConfirmModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

// ── Barre de progression ──────────────────────────────────────────────────────

function ProgressBar({ value, max = 100, color = "var(--gold)" }: {
  value: number;
  max?: number;
  color?: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div style={{ height: 6, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          borderRadius: 999,
          background: color,
          transition: "width .4s ease",
        }}
      />
    </div>
  );
}

// ── Tuile KPI ─────────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--cream)",
                    fontFamily: "var(--serif)", lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "0.75rem", color: "var(--muted-2)", marginTop: "0.25rem" }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────

import { BrandLoader } from "@/components/BrandLoader";

export default function ProgressionPage() {
  const { toast } = useToast();
  const [kpis,       setKpis]       = useState<ProgressionKPIs | null>(null);
  const [formations, setFormations] = useState<FormationProgressStat[]>([]);
  const [members,    setMembers]    = useState<MemberProgressEntry[]>([]);

  const [filterFormation, setFilterFormation] = useState<number | "ALL">("ALL");
  const [filterCompleted, setFilterCompleted] = useState<"ALL" | "true" | "false">("ALL");
  const [filterSearch,    setFilterSearch]    = useState("");

  const [resetting,   setResetting]   = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<MemberProgressEntry | null>(null);
  const [loading,     setLoading]     = useState(true);

  // ── Chargements ──────────────────────────────────────────────────────────

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        const [kData, fData] = await Promise.all([
          progressionApi.kpis(),
          progressionApi.formationStats(),
        ]);
        setKpis(kData.data);
        setFormations(Array.isArray(fData.data) ? fData.data : (fData.data as Paginated<FormationProgressStat>).results);
      } catch (e) {
        toast("Impossible de charger les KPIs et statistiques de progression.", "error");
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const params: Record<string, unknown> = {};
      if (filterFormation !== "ALL") params.formation_id = filterFormation;
      if (filterCompleted !== "ALL") params.completed    = filterCompleted === "true";
      if (filterSearch)              params.search       = filterSearch;
      const { data } = await progressionApi.memberProgress(params);
      setMembers(Array.isArray(data) ? data : (data as Paginated<MemberProgressEntry>).results);
    } catch (e) {
      toast("Impossible de charger l'avancement des membres.", "error");
    }
  }, [filterFormation, filterCompleted, filterSearch, toast]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // ── Reset progression ────────────────────────────────────────────────────

  const doResetProgress = async (entry: MemberProgressEntry, reason: string) => {
    const key = `${entry.user_id}-${entry.formation_id}`;
    setResetting(key);
    try {
      await progressionApi.resetProgress({ user_id: entry.user_id, formation_id: entry.formation_id, reason });
      toast(`Progression de ${entry.user_name} réinitialisée.`, "success");
      await loadMembers();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setResetting(null); }
  };

  // ── Pagination table membres ─────────────────────────────────────────────

  const membersFilterKey = `${filterFormation}|${filterCompleted}|${filterSearch}`;
  const { page, totalPages, paged: pagedMembers, total: membersTotal, pageSize, setPageSize, go } =
    usePagination(members, 15, membersFilterKey);

  // ── Couleur selon taux ───────────────────────────────────────────────────

  const rateColor = (rate: number) => {
    if (rate >= 80) return "#5fb98a";
    if (rate >= 40) return "#d9a441";
    return "#cf5a3c";
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return <BrandLoader label="Chargement de la progression..." />;
  }

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="eyebrow">Apprentissage</div>
      <h1 style={{ marginBottom: "0.35rem" }}>Suivi de progression</h1>
      <p style={{ color: "var(--muted)", fontSize: "0.88rem", marginBottom: "1.75rem" }}>
        Vue globale de l&apos;avancement des membres dans les formations Zola Ashé.
      </p>

      {/* ── KPIs ── */}
      {kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))",
                      gap: "0.85rem", marginBottom: "2rem" }}>
          <KpiTile
            label="Inscriptions totales"
            value={kpis.total_enrollments.toLocaleString("fr-FR")}
            sub="tous membres confondus"
          />
          <KpiTile
            label="Formations complétées"
            value={kpis.total_completions.toLocaleString("fr-FR")}
            sub={kpis.total_enrollments > 0
              ? `${Math.round((kpis.total_completions / kpis.total_enrollments) * 100)} % du total`
              : undefined}
          />
          <KpiTile
            label="Taux de complétion moyen"
            value={`${Math.round(kpis.avg_completion_rate)} %`}
            sub="moyenne toutes formations"
          />
          <KpiTile
            label="Score quiz moyen"
            value={kpis.avg_quiz_score !== null
              ? `${Math.round(kpis.avg_quiz_score)} %`
              : "—"}
            sub="sur l'ensemble des quiz"
          />
        </div>
      )}

      {/* ── Statistiques par formation ── */}
      <h2 style={{ fontSize: "1.05rem", fontFamily: "var(--serif)", marginBottom: "1rem",
                   color: "var(--cream)" }}>
        Par formation
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px,1fr))",
                    gap: "0.85rem", marginBottom: "2.25rem" }}>
        {formations.map((f) => (
          <Card key={f.formation_id}>
            {/* Couverture */}
            {f.cover_url && (
              <div style={{ width: "100%", height: 80, borderRadius: 8, marginBottom: "0.75rem",
                            background: `center/cover no-repeat url(${f.cover_url})`,
                            border: "1px solid var(--line-soft)" }} />
            )}

            {/* Titre + taux */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                          marginBottom: "0.65rem", gap: "0.5rem" }}>
              <strong style={{ fontSize: "0.9rem", lineHeight: 1.35 }}>{f.formation_title}</strong>
              <span style={{ fontSize: "1.4rem", fontWeight: 700, color: rateColor(f.completion_rate),
                             fontFamily: "var(--serif)", flexShrink: 0 }}>
                {Math.round(f.completion_rate)} %
              </span>
            </div>

            {/* Barre de complétion */}
            <div style={{ marginBottom: "0.65rem" }}>
              <ProgressBar value={f.completion_rate} color={rateColor(f.completion_rate)} />
            </div>

            {/* Métriques */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                          gap: "0.4rem", fontSize: "0.78rem" }}>
              <div style={{ textAlign: "center", padding: "0.4rem",
                            background: "var(--bg-2)", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, color: "var(--cream)" }}>{f.enrolled_count}</div>
                <div style={{ color: "var(--muted-2)" }}>inscrits</div>
              </div>
              <div style={{ textAlign: "center", padding: "0.4rem",
                            background: "var(--bg-2)", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, color: "#5fb98a" }}>{f.completed_count}</div>
                <div style={{ color: "var(--muted-2)" }}>terminés</div>
              </div>
              <div style={{ textAlign: "center", padding: "0.4rem",
                            background: "var(--bg-2)", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, color: "var(--gold-2)" }}>
                  {f.avg_quiz_score !== null ? `${Math.round(f.avg_quiz_score)} %` : "—"}
                </div>
                <div style={{ color: "var(--muted-2)" }}>moy. quiz</div>
              </div>
            </div>

            {/* Barre avancement moyen */}
            <div style={{ marginTop: "0.65rem", fontSize: "0.75rem", color: "var(--muted)" }}>
              Avancement moyen : {Math.round(f.avg_progress_pct)} %
              <div style={{ marginTop: "0.25rem" }}>
                <ProgressBar value={f.avg_progress_pct} color="var(--gold)" />
              </div>
            </div>
          </Card>
        ))}
        {formations.length === 0 && (
          <Card style={{ gridColumn: "1/-1" }}>
            <p style={{ color: "var(--muted)", textAlign: "center", padding: "1rem 0" }}>
              Aucune donnée de progression disponible.
            </p>
          </Card>
        )}
      </div>

      {/* ── Table membres ── */}
      <h2 style={{ fontSize: "1.05rem", fontFamily: "var(--serif)", marginBottom: "1rem",
                   color: "var(--cream)" }}>
        Détail par membre
      </h2>

      {/* Filtres */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem",
                    flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          placeholder="Rechercher un membre…"
          value={filterSearch}
          style={{ flex: 1, minWidth: 180, maxWidth: 280 }}
          onChange={(e) => setFilterSearch(e.target.value)}
        />
        <select
          className="select"
          value={filterFormation}
          style={{ minWidth: 200 }}
          onChange={(e) => setFilterFormation(e.target.value === "ALL" ? "ALL" : +e.target.value)}
        >
          <option value="ALL">Toutes les formations</option>
          {formations.map((f) => (
            <option key={f.formation_id} value={f.formation_id}>
              {f.formation_title}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={filterCompleted}
          style={{ width: 160 }}
          onChange={(e) => setFilterCompleted(e.target.value as typeof filterCompleted)}
        >
          <option value="ALL">Tous</option>
          <option value="true">Complétés</option>
          <option value="false">En cours</option>
        </select>
        <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          {membersTotal} entrée{membersTotal !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <Card>
        <table className="tbl" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Membre</th>
              <th>Formation</th>
              <th style={{ minWidth: 140 }}>Avancement</th>
              <th>Modules</th>
              <th>Quiz</th>
              <th>Dernière activité</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedMembers.map((m) => {
              const key = `${m.user_id}-${m.formation_id}`;
              return (
                <tr key={key}>
                  {/* Membre */}
                  <td>
                    <Link href={`/membres/${m.user_id}`} style={{ textDecoration: "none" }}>
                      <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--gold-2)" }}>{m.user_name}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted-2)" }}>{m.user_email}</div>
                    </Link>
                  </td>

                  {/* Formation */}
                  <td style={{ fontSize: "0.83rem", color: "var(--muted)", maxWidth: 180 }}>
                    {m.formation_title}
                  </td>

                  {/* Avancement */}
                  <td style={{ minWidth: 140 }}>
                    <div style={{ display: "flex", justifyContent: "space-between",
                                  fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                      <span>{m.progress_pct} %</span>
                      {m.completed && (
                        <Badge color="#5fb98a">Terminé</Badge>
                      )}
                    </div>
                    <ProgressBar value={m.progress_pct} color={rateColor(m.progress_pct)} />
                  </td>

                  {/* Modules */}
                  <td style={{ fontSize: "0.83rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {m.modules_completed} / {m.modules_total}
                  </td>

                  {/* Score quiz */}
                  <td>
                    {m.quiz_score !== null ? (
                      <span style={{ fontWeight: 600, fontSize: "0.88rem",
                                     color: rateColor(m.quiz_score) }}>
                        {Math.round(m.quiz_score)} %
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted-2)", fontSize: "0.78rem" }}>—</span>
                    )}
                  </td>

                  {/* Activité */}
                  <td style={{ fontSize: "0.78rem", color: "var(--muted-2)", whiteSpace: "nowrap" }}>
                    {m.last_activity
                      ? new Date(m.last_activity).toLocaleDateString("fr-FR")
                      : "—"}
                  </td>

                  {/* Actions */}
                  <td>
                    <Button
                      variant="danger"
                      loading={resetting === `${m.user_id}-${m.formation_id}`}
                      onClick={() => setResetTarget(m)}
                    >
                      Réinitialiser
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {pagedMembers.length === 0 && (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.25rem 0" }}>
            Aucune progression trouvée.
          </p>
        )}
        <Pagination page={page} totalPages={totalPages} total={membersTotal}
          pageSize={pageSize} onPage={go} onPageSize={setPageSize} />
      </Card>

      {resetTarget && (
        <ConfirmModal
          title="Réinitialiser la progression"
          message={`Remettre à zéro la progression de ${resetTarget.user_name} dans « ${resetTarget.formation_title} » ?`}
          withReason
          reasonLabel="Motif de la réinitialisation"
          confirmLabel="Réinitialiser"
          onClose={() => setResetTarget(null)}
          onConfirm={async (reason) => {
            await doResetProgress(resetTarget, reason);
            setResetTarget(null);
          }}
        />
      )}
    </div>
  );
}
