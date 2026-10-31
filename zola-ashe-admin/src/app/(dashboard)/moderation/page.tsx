"use client";

import { useCallback, useEffect, useState } from "react";

import { asList, moderationApi } from "@/lib/endpoints";
import type { ReportItem } from "@/lib/types";
import { Button, Card, Pagination, errorMessage, usePagination } from "@/components/ui";
import { ConfirmModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

// ── Tuile KPI mini ────────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "0.6rem 1.1rem", borderRadius: "var(--radius-sm)",
      background: `${color}0f`, border: `1px solid ${color}28`,
    }}>
      <span style={{ fontSize: "1.5rem", fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: "0.70rem", color: "var(--muted)", marginTop: "0.2rem", fontWeight: 600,
                     textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
    </div>
  );
}

// ── Carte signalement ─────────────────────────────────────────────────────────

function ReportCard({
  report, onIgnore, onDelete, busy,
}: {
  report: ReportItem;
  onIgnore: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const isPost = report.target_type === "POST";
  const typeColor = isPost ? "#6366f1" : "#0ea5e9";

  return (
    <div style={{
      background: "var(--bg-1)",
      border: `1px solid ${report.signal_count >= 3 ? "rgba(207,90,60,0.35)" : "var(--line-soft)"}`,
      borderLeft: `3px solid ${report.signal_count >= 3 ? "var(--danger)" : typeColor}`,
      borderRadius: "var(--radius)",
      padding: "1rem 1.2rem",
    }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem",
                    justifyContent: "space-between", flexWrap: "wrap", marginBottom: "0.65rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {/* Type badge */}
          <span style={{
            fontSize: "0.66rem", fontWeight: 800, borderRadius: 99, padding: "0.12rem 0.55rem",
            color: typeColor, background: `${typeColor}12`, border: `1px solid ${typeColor}28`,
            textTransform: "uppercase", letterSpacing: "0.08em",
          }}>
            {isPost ? "◧ Post" : "◌ Commentaire"}
          </span>

          {/* ID cible */}
          <span style={{
            fontFamily: "monospace", fontSize: "0.78rem", color: "var(--muted-2)",
            background: "var(--bg-2)", padding: "0.1rem 0.4rem",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--line-soft)",
          }}>
            #{report.target_id}
          </span>

          {/* Urgence si multi-signalement */}
          {report.signal_count >= 2 && (
            <span style={{
              fontSize: "0.66rem", fontWeight: 800, borderRadius: 99, padding: "0.12rem 0.55rem",
              color: report.signal_count >= 3 ? "var(--danger)" : "var(--warn)",
              background: report.signal_count >= 3 ? "rgba(207,90,60,0.08)" : "rgba(217,164,65,0.08)",
              border: `1px solid ${report.signal_count >= 3 ? "rgba(207,90,60,0.28)" : "rgba(217,164,65,0.28)"}`,
            }}>
              ⚑ {report.signal_count} signalements
            </span>
          )}
        </div>

        {/* Date */}
        <span style={{ fontSize: "0.76rem", color: "var(--muted-2)", whiteSpace: "nowrap" }}>
          {fmtDate(report.created_at)}
        </span>
      </div>

      {/* Motif */}
      <div style={{
        padding: "0.55rem 0.75rem", background: "var(--bg-2)",
        borderRadius: "var(--radius-sm)", border: "1px solid var(--line-soft)",
        fontSize: "0.87rem", color: "var(--cream)", marginBottom: "0.65rem",
        lineHeight: 1.5,
      }}>
        {report.reason || <span style={{ color: "var(--muted-2)", fontStyle: "italic" }}>Aucun motif fourni</span>}
      </div>

      {/* Rapporteur + actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexWrap: "wrap", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          Signalé par <strong style={{ color: "var(--muted-2)" }}>{report.reporter}</strong>
        </span>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <Button variant="ghost" style={{ fontSize: "0.78rem", padding: "0.28rem 0.65rem" }}
            loading={busy} onClick={onIgnore}>
            Ignorer
          </Button>
          <Button variant="danger" style={{ fontSize: "0.78rem", padding: "0.28rem 0.65rem" }}
            loading={busy} onClick={onDelete}>
            Supprimer le contenu
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Formulaire annonce admin ─────────────────────────────────────────────────

function AdminAnnouncementForm({ onPublished }: { onPublished: (message: string) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await moderationApi.createAdminPost({
        title: title.trim(),
        text: body.trim(),
        is_announcement: true,
        is_pinned: isPinned,
      });
      setTitle("");
      setBody("");
      setIsPinned(false);
      onPublished("Annonce admin publiée dans la communauté.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ marginBottom: "1.4rem" }}>
      <h2 style={{ margin: "0 0 .35rem", color: "var(--cream)", fontSize: "1rem" }}>
        Créer une annonce admin
      </h2>
      <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: ".86rem" }}>
        Publie une annonce officielle dans le fil communautaire.
      </p>
      <form onSubmit={submit}>
        <label style={{ display: "block", marginBottom: ".75rem" }}>
          <span className="field-label">Titre</span>
          <input
            className="input"
            value={title}
            required
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Nouveau module disponible"
          />
        </label>
        <label style={{ display: "block", marginBottom: ".75rem" }}>
          <span className="field-label">Message</span>
          <textarea
            className="input"
            value={body}
            rows={4}
            required
            style={{ resize: "vertical", fontFamily: "var(--sans)" }}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Contenu de l'annonce…"
          />
        </label>
        <div style={{ display: "flex", justifyContent: "space-between", gap: ".75rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: ".45rem", color: "var(--muted)", fontSize: ".86rem" }}>
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
            />
            Épingler l'annonce
          </label>
          <Button type="submit" loading={loading} disabled={!title.trim() || !body.trim()}>
            Publier l'annonce
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ModerationPage() {
  const { toast } = useToast();
  const [reports,      setReports]      = useState<ReportItem[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [filterType,   setFilterType]   = useState<"ALL" | "POST" | "COMMENT">("ALL");
  const [filterUrgent, setFilterUrgent] = useState(false);
  const [busyId,       setBusyId]       = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await moderationApi.reports();
      setReports(asList(data));
    } catch (e) {
      setReports([]);
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ignore = async (r: ReportItem) => {
    setBusyId(r.id);
    try {
      await moderationApi.handle(r.id);
      toast(`Signalement #${r.id} ignoré.`, "success");
      await load();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setBusyId(null); }
  };

  const doDelete = async (r: ReportItem, reason: string) => {
    setBusyId(r.id);
    try {
      if (r.target_type === "POST") await moderationApi.deletePost(r.target_id, reason);
      else                          await moderationApi.deleteComment(r.target_id, reason);
      await moderationApi.handle(r.id);
      toast(`Contenu supprimé et signalement #${r.id} clôturé.`, "success");
      await load();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setBusyId(null); }
  };

  // ── Filtrage ─────────────────────────────────────────────────────────────

  const filtered = reports.filter((r) => {
    if (filterType !== "ALL" && r.target_type !== filterType) return false;
    if (filterUrgent && r.signal_count < 2) return false;
    return true;
  });

  const filterKey = `${filterType}|${filterUrgent}`;
  const { page, totalPages, paged, total, pageSize, setPageSize, go } =
    usePagination(filtered, 15, filterKey);

  // ── Stats ─────────────────────────────────────────────────────────────────

  const postCount    = reports.filter((r) => r.target_type === "POST").length;
  const commentCount = reports.filter((r) => r.target_type === "COMMENT").length;
  const urgentCount  = reports.filter((r) => r.signal_count >= 2).length;

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <div className="eyebrow">Sécurité</div>
        <h1>Modération</h1>
        <p>Signalements communautaires en attente de traitement.</p>
      </div>

      {/* Stats rapides */}
      <div style={{ display: "flex", gap: "0.65rem", marginBottom: "1.4rem", flexWrap: "wrap" }}>
        <StatChip label="Total" value={reports.length} color="var(--muted)" />
        <StatChip label="Posts" value={postCount} color="#6366f1" />
        <StatChip label="Commentaires" value={commentCount} color="#0ea5e9" />
        <StatChip label="Urgents (≥2)" value={urgentCount} color="var(--danger)" />
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: "0.65rem", alignItems: "center",
                    marginBottom: "1.1rem", flexWrap: "wrap" }}>
        {/* Boutons type */}
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {(["ALL", "POST", "COMMENT"] as const).map((t) => (
            <button key={t} onClick={() => setFilterType(t)} style={{
              fontSize: "0.78rem", fontWeight: 700, padding: "0.3rem 0.75rem",
              borderRadius: 99, border: "1px solid",
              cursor: "pointer", transition: "all .12s",
              background: filterType === t ? "var(--gold-bg)" : "var(--bg-1)",
              borderColor: filterType === t ? "var(--gold-2)" : "var(--line-soft)",
              color: filterType === t ? "var(--gold-2)" : "var(--muted)",
            }}>
              {t === "ALL" ? "Tous" : t === "POST" ? "◧ Posts" : "◌ Commentaires"}
            </button>
          ))}
        </div>

        {/* Toggle urgent */}
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem",
                        cursor: "pointer", fontSize: "0.80rem", color: filterUrgent ? "var(--danger)" : "var(--muted)" }}>
          <input type="checkbox" checked={filterUrgent}
            onChange={(e) => setFilterUrgent(e.target.checked)}
            style={{ accentColor: "var(--danger)" }} />
          <span style={{ fontWeight: filterUrgent ? 700 : 400 }}>Urgents uniquement (≥ 2 signalements)</span>
        </label>

        <span style={{ marginLeft: "auto", fontSize: "0.76rem", color: "var(--muted)" }}>
          {total} résultat{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Liste */}
      {loading ? (
        <Card>
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.5rem 0", fontWeight: 600 }}>
            Chargement des signalements…
          </p>
        </Card>
      ) : paged.length === 0 ? (
        <Card>
          <p style={{ color: "var(--ok)", textAlign: "center", padding: "1.5rem 0", fontWeight: 600 }}>
            ✓ Aucun signalement à traiter.
          </p>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", marginBottom: "1rem" }}>
          {paged.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              busy={busyId === r.id}
              onIgnore={() => ignore(r)}
              onDelete={() => setDeleteTarget(r)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <Pagination page={page} totalPages={totalPages} total={total}
            pageSize={pageSize} onPage={go} onPageSize={setPageSize} />
        </Card>
     
      )}
      
      <div style={{ marginTop: "1.4rem" }}>
      <AdminAnnouncementForm onPublished={(msg) => toast(msg, "success")} />
      </div>

      {/* Confirmation suppression */}
      {deleteTarget && (
        <ConfirmModal
          title={`Supprimer le ${deleteTarget.target_type === "POST" ? "post" : "commentaire"} #${deleteTarget.target_id}`}
          message={
            <span>
              Motif du signalement :{" "}
              <strong>{deleteTarget.reason || "—"}</strong>
              <br />
              <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                Cette action est irréversible. Saisissez un motif de modération.
              </span>
            </span>
          }
          withReason
          reasonLabel="Motif de la suppression"
          confirmLabel="Supprimer définitivement"
          onClose={() => setDeleteTarget(null)}
          onConfirm={async (reason) => {
            await doDelete(deleteTarget, reason);
          }}
        />
      )}
    </div>
  );
}