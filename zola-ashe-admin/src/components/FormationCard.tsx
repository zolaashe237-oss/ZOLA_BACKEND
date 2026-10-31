"use client";

import Link from "next/link";
import { getMediaUrl } from "@/lib/api";
import type { Branche, Formation, FormationAcces, FormationNiveau, FormationStatus } from "@/lib/types";

// ── Constantes ────────────────────────────────────────────────────────────────

export const CATEGORY_LABEL: Record<string, string> = {
  FORMATION: "Formation", LIVRE: "Bibliothèque", LIBRE: "Accès libre",
};
export const STATUS_LABEL: Record<FormationStatus, string> = {
  DRAFT: "Brouillon", SCHEDULED: "Programmé", PUBLISHED: "Publié",
};
export const STATUS_COLOR: Record<FormationStatus, string> = {
  DRAFT: "#a89b86", SCHEDULED: "#d9a441", PUBLISHED: "#5fb98a",
};
export const COVER_GRAD: Record<string, string> = {
  FORMATION: "linear-gradient(145deg, #fdf5e0 0%, #f0e3b0 100%)",
  LIVRE:     "linear-gradient(145deg, #f0faf4 0%, #cbebda 100%)",
  LIBRE:     "linear-gradient(145deg, #fef4ee 0%, #f8d9c0 100%)",
};
export const COVER_ICON: Record<string, string> = {
  FORMATION: "◫", LIVRE: "◈", LIBRE: "◎",
};
export const NIVEAU_LABEL: Record<FormationNiveau, string> = {
  DEBUTANT:      "Débutant",
  INTERMEDIAIRE: "Intermédiaire",
  AVANCE:        "Avancé",
};
export const NIVEAU_COLOR: Record<FormationNiveau, string> = {
  DEBUTANT:      "#52b083",
  INTERMEDIAIRE: "#d9a441",
  AVANCE:        "#c9674a",
};
export const BRANCHE_LABEL: Record<string, string> = {
  MEMBRE: "Membres", GENERALE: "Membres", FEMME: "Femme", ENFANT: "Enfant",
};
export const BRANCHE_COLOR: Record<string, string> = {
  MEMBRE: "#5b8fd4", GENERALE: "#5b8fd4", FEMME: "#b5532a", ENFANT: "#52b083",
};
export const ACCES_LABEL: Record<FormationAcces, string> = {
  PUBLIC: "Public", MEMBRES: "Membres", PAYANTE: "Payant",
};
export const ACCES_COLOR: Record<FormationAcces, string> = {
  PUBLIC: "#2e9460", MEMBRES: "#5b8fd4", PAYANTE: "#c9a227",
};

// ── Composant carte ───────────────────────────────────────────────────────────

export function FormationCard({
  formation: f,
  onPublish,
  onUnpublish,
  onRemove,
  preview = false,
  publishingId,
}: {
  formation:    Formation;
  onPublish:    (f: Formation) => void;
  onUnpublish?: (f: Formation) => void;
  onRemove:     (f: Formation) => void;
  preview?:     boolean;
  publishingId?: number | null;
}) {
  const modules       = f.modules_preview ?? [];
  const totalEpisodes = f.courses_count ?? f.nb_episodes ?? f.total_courses ?? 0;
  const PREVIEW_MAX   = 3;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8dfc8",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        transition: "box-shadow .18s, border-color .18s",
        opacity: preview ? 1 : 1,
      }}
      onMouseEnter={(e) => {
        if (preview) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow   = "0 6px 28px rgba(100,60,10,0.12)";
        el.style.borderColor = "#d4c4a0";
      }}
      onMouseLeave={(e) => {
        if (preview) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow   = "";
        el.style.borderColor = "#e8dfc8";
      }}
    >
      {/* ── Cover ── */}
      <div style={{
        height: 185,
        background: f.cover_url
          ? `center/cover no-repeat url(${getMediaUrl(f.cover_url)})`
          : (COVER_GRAD[f.category] ?? COVER_GRAD.FORMATION),
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {!f.cover_url && (
          <span style={{ fontSize: "3.5rem", opacity: 0.18, color: "#7a5e00" }}>
            {COVER_ICON[f.category] ?? "◫"}
          </span>
        )}

        {/* Niveau — haut gauche */}
        {f.niveau && (
          <span style={{
            position: "absolute", top: 10, left: 10,
            background: "rgba(100,30,30,0.82)", color: "#fff",
            fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "0.18rem 0.56rem", borderRadius: 4,
            backdropFilter: "blur(4px)",
          }}>
            {NIVEAU_LABEL[f.niveau]}
          </span>
        )}

        {/* Catégorie — haut centre */}
        <span style={{
          position: "absolute", top: 10, left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(60,35,10,0.62)", color: "rgba(255,255,255,0.90)",
          fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.10em",
          textTransform: "uppercase",
          padding: "0.18rem 0.56rem", borderRadius: 4,
          backdropFilter: "blur(4px)",
          whiteSpace: "nowrap",
        }}>
          {CATEGORY_LABEL[f.category]}
        </span>

        {/* Branche — haut droite */}
        {f.branche && (
          <span style={{
            position: "absolute", top: 10, right: 10,
            background: "#7a1a1a", color: "#fff",
            fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "0.18rem 0.56rem", borderRadius: 4,
          }}>
            {BRANCHE_LABEL[f.branche]}
          </span>
        )}

        {/* Statut (si non publié) */}
        {f.status !== "PUBLISHED" && (
          <span style={{
            position: "absolute", top: 38, right: 10,
            background: `${STATUS_COLOR[f.status]}cc`,
            color: "#fff",
            fontSize: "0.62rem", fontWeight: 700,
            padding: "0.14rem 0.46rem", borderRadius: 4,
            letterSpacing: "0.05em",
          }}>
            {STATUS_LABEL[f.status]}
          </span>
        )}

        {/* Bas: gradient + stats */}
        <span style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "linear-gradient(to top, rgba(20,10,0,0.68) 0%, transparent 100%)",
          padding: "1.2rem 0.75rem 0.5rem",
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        }}>
          <span style={{ color: "#fff", fontSize: "0.76rem", fontWeight: 600 }}>
            {f.module_count} chap. · {totalEpisodes} épisode{totalEpisodes !== 1 ? "s" : ""}
          </span>
          {f.nb_gratuits > 0 && (
            <span style={{
              background: "#c9a227", color: "#fff",
              fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.05em",
              padding: "0.20rem 0.60rem", borderRadius: 4,
            }}>
              {f.nb_gratuits} GRATUIT{f.nb_gratuits > 1 ? "S" : ""}
            </span>
          )}
        </span>
      </div>

      {/* ── Corps ── */}
      <div style={{
        padding: "1.1rem 1.15rem 0.7rem",
        flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem",
      }}>
        {/* Eyebrow + badges */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{
            fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.11em",
            textTransform: "uppercase", color: "#c9a227",
          }}>
            {CATEGORY_LABEL[f.category]}
          </div>
          <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
            {(() => {
              const acces: FormationAcces = f.is_public ? "PUBLIC"
                : (f.access_subscription_types?.length ?? 0) > 0 ? "PAYANTE" : "MEMBRES";
              const color = ACCES_COLOR[acces];
              return (
                <span style={{
                  fontSize: "0.62rem", fontWeight: 700,
                  color, background: `${color}14`,
                  border: `1px solid ${color}40`,
                  padding: "0.10rem 0.44rem", borderRadius: 99,
                  letterSpacing: "0.05em", textTransform: "uppercase",
                }}>
                  {ACCES_LABEL[acces]}
                  {acces === "PAYANTE" && f.price ? ` · ${f.price.toLocaleString("fr-FR")} F` : ""}
                </span>
              );
            })()}
            {f.branche && (
              <span style={{
                fontSize: "0.65rem", fontWeight: 700,
                color: BRANCHE_COLOR[f.branche],
                background: `${BRANCHE_COLOR[f.branche]}18`,
                border: `1px solid ${BRANCHE_COLOR[f.branche]}40`,
                padding: "0.10rem 0.44rem", borderRadius: 99,
                letterSpacing: "0.05em", textTransform: "uppercase",
              }}>
                {BRANCHE_LABEL[f.branche]}
              </span>
            )}
          </div>
        </div>

        {/* Titre */}
        <h3 style={{
          fontSize: "1.05rem", fontWeight: 700, color: "#2a1800",
          lineHeight: 1.35, margin: 0,
        }}>
          {f.title}
        </h3>

        {/* Description */}
        {f.description && (
          <p style={{
            fontSize: "0.82rem", color: "#7a6248", lineHeight: 1.55, margin: 0,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          } as React.CSSProperties}>
            {f.description}
          </p>
        )}

        {/* Stats: épisodes + gratuits */}
        <div style={{
          display: "flex", alignItems: "center", gap: "0.55rem",
          fontSize: "0.78rem", color: "#7a6248",
        }}>
          <span>
            <strong style={{ color: "#3a2510" }}>{f.module_count}</strong> chap.
            {" · "}
            <strong style={{ color: "#3a2510" }}>{totalEpisodes}</strong> épisode{totalEpisodes !== 1 ? "s" : ""}
          </span>
          {f.nb_gratuits > 0 && (
            <span style={{
              background: "rgba(82,176,131,0.14)", color: "#52b083",
              border: "1px solid rgba(82,176,131,0.32)",
              fontSize: "0.64rem", fontWeight: 700,
              padding: "0.10rem 0.44rem", borderRadius: 99,
              letterSpacing: "0.04em",
            }}>
              {f.nb_gratuits} GRATUIT{f.nb_gratuits > 1 ? "S" : ""}
            </span>
          )}
        </div>

        {/* Date programmée */}
        {f.status === "SCHEDULED" && f.publish_at && (
          <div style={{ fontSize: "0.73rem", color: "#b87c1a", fontWeight: 500 }}>
            ⏱ En ligne le {new Date(f.publish_at).toLocaleDateString("fr-FR")}
          </div>
        )}

        {/* Module list preview */}
        {modules.length > 0 && (
          <div style={{
            marginTop: "0.15rem",
            borderTop: "1px solid #f0e8d4", paddingTop: "0.55rem",
            display: "flex", flexDirection: "column", gap: "0.18rem",
          }}>
            {modules.slice(0, PREVIEW_MAX).map((m, idx) => (
              <div key={m.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "0.5rem", padding: "0.22rem 0",
                borderBottom: idx < Math.min(modules.length, PREVIEW_MAX) - 1
                  ? "1px solid #f5ede0" : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", overflow: "hidden" }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 3,
                    background: "#8b2c2c", color: "#fff",
                    fontSize: "0.60rem", fontWeight: 800,
                    display: "inline-flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>
                  <span style={{
                    fontSize: "0.80rem", color: "#3a2510",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {m.title}
                  </span>
                </div>
                <span style={{ fontSize: "0.72rem", color: "#a0907a", flexShrink: 0 }}>
                  {m.episode_count} ep.
                </span>
              </div>
            ))}
            {modules.length > PREVIEW_MAX && (
              <div style={{ fontSize: "0.72rem", color: "#a0907a", paddingTop: "0.18rem" }}>
                +{modules.length - PREVIEW_MAX} module{modules.length - PREVIEW_MAX > 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        padding: "0.75rem 1.15rem",
        borderTop: "1px solid #f0e8d4",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "0.5rem", flexShrink: 0,
      }}>
        {preview ? (
          <span style={{
            color: "#c8b89a", fontSize: "0.76rem", fontWeight: 700,
            letterSpacing: "0.07em", textTransform: "uppercase",
            display: "inline-flex", alignItems: "center", gap: "0.32rem",
            userSelect: "none",
          }}>
            Gérer le contenu <span>›</span>
          </span>
        ) : (
          <>
            <Link
              href={`/contenu/${f.id}`}
              style={{
                color: "#8b2c2c", fontSize: "0.76rem", fontWeight: 700,
                textDecoration: "none", letterSpacing: "0.07em",
                textTransform: "uppercase",
                display: "inline-flex", alignItems: "center", gap: "0.32rem",
                transition: "gap .15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.gap = "0.52rem"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.gap = "0.32rem"; }}
            >
              Gérer le contenu <span>›</span>
            </Link>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              {f.status === "PUBLISHED" ? (
                <button
                  onClick={() => onUnpublish?.(f)}
                  style={{
                    background: "rgba(201,162,39,0.08)", color: "#8b6a1a",
                    border: "1px solid rgba(201,162,39,0.28)", borderRadius: "var(--radius-sm)",
                    fontSize: "0.73rem", fontWeight: 600,
                    padding: "0.22rem 0.62rem", cursor: "pointer",
                    transition: "background .15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(201,162,39,0.16)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(201,162,39,0.08)"; }}
                >
                  Dépublier
                </button>
              ) : (
                <button
                  onClick={() => onPublish(f)}
                  disabled={publishingId === f.id}
                  style={{
                    background: "rgba(46,148,96,0.08)", color: "#2b8a5e",
                    border: "1px solid rgba(46,148,96,0.25)", borderRadius: "var(--radius-sm)",
                    fontSize: "0.73rem", fontWeight: 600,
                    padding: "0.22rem 0.62rem", cursor: publishingId === f.id ? "default" : "pointer",
                    transition: "background .15s",
                    opacity: publishingId === f.id ? 0.65 : 1,
                  }}
                  onMouseEnter={(e) => { if (publishingId !== f.id) (e.currentTarget as HTMLButtonElement).style.background = "rgba(46,148,96,0.16)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(46,148,96,0.08)"; }}
                >
                  {publishingId === f.id ? "…" : "Publier"}
                </button>
              )}
              <button
                onClick={() => onRemove(f)}
                title="Supprimer définitivement"
                style={{
                  background: "rgba(192,64,44,0.07)", color: "#b53a2a",
                  border: "1px solid rgba(192,64,44,0.20)", borderRadius: "var(--radius-sm)",
                  width: 28, height: 28,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", fontSize: "0.80rem",
                  transition: "background .15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(192,64,44,0.15)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(192,64,44,0.07)"; }}
              >
                🗑
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
