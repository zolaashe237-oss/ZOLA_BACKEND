"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { audioApi } from "@/lib/endpoints";
import { getMediaUrl } from "@/lib/api";
import type { AudioItem, Branche, PdfAccess } from "@/lib/types";
import { Alert, Button, Input, Select, Textarea, errorMessage } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

// ── Constantes ────────────────────────────────────────────────────────────────

const ACCESS_COLOR: Record<PdfAccess, string> = {
  PUBLIC: "#2e9460", MEMBRE: "#c9a227", FEMME: "#b5532a", ENFANT: "#3a8a5e",
};
const ACCESS_LABEL: Record<PdfAccess, string> = {
  PUBLIC: "Public", MEMBRE: "Membres", FEMME: "Femmes", ENFANT: "Enfants",
};
const ACCESS_ICON: Record<PdfAccess, string> = {
  PUBLIC: "🌐", MEMBRE: "🔑", FEMME: "♀", ENFANT: "◈",
};

const BRANCH_COLS: { key: Branche; label: string; color: string; emoji: string }[] = [
  { key: "MEMBRE",  label: "Espace Membres",  color: "#5b8fd4", emoji: "◉" },
  { key: "FEMME",   label: "Espace Femmes",   color: "#b5532a", emoji: "♀" },
  { key: "ENFANT",  label: "Espace Enfants",  color: "#52b083", emoji: "◈" },
];

const AUDIO_ACCENT: Record<string, { bg: string; line: string; text: string; wave: string }> = {
  MEMBRE:   { bg: "#1a1400", line: "#c9a227", text: "#c9a227", wave: "#c9a22740" },
  GENERALE: { bg: "#1a1400", line: "#c9a227", text: "#c9a227", wave: "#c9a22740" },
  FEMME:    { bg: "#1a0c08", line: "#b5532a", text: "#b5532a", wave: "#b5532a40" },
  ENFANT:   { bg: "#081510", line: "#52b083", text: "#52b083", wave: "#52b08340" },
};

const FORMAT_LABEL: Record<string, string> = {
  mp3: "MP3", wav: "WAV", ogg: "OGG", m4a: "M4A", aac: "AAC",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Visuel audio ──────────────────────────────────────────────────────────────

function AudioThumb({ item, size = 54 }: { item: AudioItem; size?: number }) {
  const { bg, line, text, wave } = AUDIO_ACCENT[item.branche];
  const bars = [0.4, 0.75, 1, 0.6, 0.85, 0.5, 0.9, 0.65, 0.45, 0.8];
  return (
    <div style={{
      width: size, height: size, borderRadius: 8, flexShrink: 0,
      background: bg, border: `1px solid ${line}50`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 4,
      overflow: "hidden", position: "relative",
    }}>
      {item.cover_url ? (
        <img src={getMediaUrl(item.cover_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <>
          <span style={{ fontSize: size > 60 ? "1.4rem" : "0.9rem", color: text, lineHeight: 1, zIndex: 1 }}>♪</span>
          {/* Waveform bars */}
          <div style={{ display: "flex", gap: 2, alignItems: "center", zIndex: 1 }}>
            {bars.slice(0, size > 60 ? 10 : 5).map((h, i) => (
              <div key={i} style={{
                width: size > 60 ? 2.5 : 2,
                height: Math.round(h * (size > 60 ? 14 : 8)),
                background: wave,
                borderRadius: 2,
              }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Ligne liste ───────────────────────────────────────────────────────────────

function AudioRow({ item, onEdit, onToggle, onToggleGratuit, onDelete, onPreview }: {
  item: AudioItem; onEdit: () => void; onToggle: () => void;
  onToggleGratuit: () => void; onDelete: () => void; onPreview: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "1rem",
      padding: "0.75rem 1rem", background: "var(--bg-1)",
      border: "1px solid var(--line-soft)", borderRadius: "var(--radius)",
      opacity: item.is_active ? 1 : 0.58, transition: "box-shadow .15s, border-color .15s",
    }}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = "0 4px 18px rgba(0,0,0,0.18)"; el.style.borderColor = "var(--line-soft)"; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = ""; el.style.borderColor = "var(--line-soft)"; }}
    >
      <button onClick={onPreview} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
        <AudioThumb item={item} size={54} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
          <span onClick={onPreview} style={{ fontSize: "0.90rem", fontWeight: 700, color: "var(--cream)", cursor: "pointer", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.title}
          </span>
          <span style={{
            fontSize: "0.62rem", fontWeight: 700, flexShrink: 0,
            color: item.is_active ? "#2e9460" : "var(--muted)",
            background: item.is_active ? "rgba(46,148,96,0.12)" : "rgba(154,146,132,0.12)",
            border: `1px solid ${item.is_active ? "rgba(46,148,96,0.28)" : "rgba(154,146,132,0.22)"}`,
            padding: "0.05rem 0.38rem", borderRadius: 99,
          }}>
            {item.is_active ? "● Publié" : "○ Masqué"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginTop: "0.18rem" }}>
          {item.category && (
            <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "#c9a227", background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.22)", padding: "0.04rem 0.35rem", borderRadius: 99 }}>
              {item.category}
            </span>
          )}
          {item.description && (
            <span style={{ fontSize: "0.78rem", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>
              {item.description}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginTop: "0.28rem" }}>
          {item.duration_sec !== null && (
            <span style={{ fontSize: "0.72rem", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              ♪ {fmtDuration(item.duration_sec)}
            </span>
          )}
          {item.size_mo !== null && (
            <span style={{ fontSize: "0.72rem", color: "var(--muted-2)" }}>
              {item.size_mo.toFixed(1)} Mo
            </span>
          )}
          {item.audio_format && (
            <span style={{ fontSize: "0.62rem", fontWeight: 700, color: "var(--muted)", background: "var(--bg-2)", border: "1px solid var(--line-soft)", padding: "0.04rem 0.35rem", borderRadius: 99, textTransform: "uppercase" }}>
              {FORMAT_LABEL[item.audio_format] ?? item.audio_format.toUpperCase()}
            </span>
          )}
          <span style={{ fontSize: "0.63rem", fontWeight: 700, color: ACCESS_COLOR[item.access_level], background: `${ACCESS_COLOR[item.access_level]}12`, border: `1px solid ${ACCESS_COLOR[item.access_level]}30`, padding: "0.04rem 0.38rem", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
            {ACCESS_ICON[item.access_level]} {ACCESS_LABEL[item.access_level]}
          </span>
          {item.access_level !== "PUBLIC" && (
            <button onClick={onToggleGratuit} style={{
              fontSize: "0.63rem", fontWeight: 700,
              color: item.is_gratuit ? "#2e9460" : "var(--muted-2)",
              background: item.is_gratuit ? "rgba(46,148,96,0.10)" : "transparent",
              border: `1px solid ${item.is_gratuit ? "rgba(46,148,96,0.28)" : "var(--line-soft)"}`,
              padding: "0.04rem 0.38rem", borderRadius: 99, cursor: "pointer",
            }}>
              {item.is_gratuit ? "✓ GRATUIT" : "Gratuit ?"}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
        <button onClick={onPreview} title="Écouter" style={{ width: 30, height: 30, borderRadius: 5, background: "rgba(201,162,39,0.10)", color: "#c9a227", border: "1px solid rgba(201,162,39,0.25)", cursor: "pointer", fontSize: "0.80rem", display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
        <button onClick={onEdit} title="Modifier" style={{ width: 30, height: 30, borderRadius: 5, background: "var(--bg-2)", color: "var(--muted)", border: "1px solid var(--line-soft)", cursor: "pointer", fontSize: "0.80rem", display: "flex", alignItems: "center", justifyContent: "center" }}>✎</button>
        <button onClick={onToggle} style={{
          fontSize: "0.72rem", fontWeight: 600, height: 30, padding: "0 0.55rem", borderRadius: 5,
          color: item.is_active ? "#8b6a1a" : "#2b8a5e",
          background: item.is_active ? "rgba(201,162,39,0.08)" : "rgba(46,148,96,0.08)",
          border: `1px solid ${item.is_active ? "rgba(201,162,39,0.25)" : "rgba(46,148,96,0.25)"}`,
          cursor: "pointer",
        }}>
          {item.is_active ? "Dépublier" : "Publier"}
        </button>
        <button onClick={onDelete} style={{ width: 30, height: 30, borderRadius: 5, background: "rgba(192,64,44,0.07)", color: "#b53a2a", border: "1px solid rgba(192,64,44,0.20)", cursor: "pointer", fontSize: "0.72rem", display: "flex", alignItems: "center", justifyContent: "center" }}>🗑</button>
      </div>
    </div>
  );
}

// ── Carte grille ──────────────────────────────────────────────────────────────

function AudioCard({ item, onEdit, onToggle, onToggleGratuit, onDelete, onPreview }: {
  item: AudioItem; onEdit: () => void; onToggle: () => void;
  onToggleGratuit: () => void; onDelete: () => void; onPreview: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { bg, line, text, wave } = AUDIO_ACCENT[item.branche];
  const bars = [0.4, 0.75, 1, 0.6, 0.85, 0.5, 0.9, 0.65, 0.45, 0.8, 0.55, 0.7];

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius)", overflow: "hidden", display: "flex", flexDirection: "column", opacity: item.is_active ? 1 : 0.60, transition: "box-shadow .18s, border-color .18s" }}
      onMouseEnter={(e) => { setHovered(true); const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = "0 6px 24px rgba(0,0,0,0.22)"; el.style.borderColor = line + "70"; }}
      onMouseLeave={(e) => { setHovered(false); const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = ""; el.style.borderColor = "var(--line-soft)"; }}
    >
      {/* Zone visuelle */}
      <div style={{ position: "relative", cursor: "pointer", aspectRatio: "1", background: bg, borderBottom: `1px solid ${line}30`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={onPreview}>
        {item.cover_url ? (
          <img src={item.cover_url} alt={item.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <>
            <span style={{ fontSize: "2.2rem", color: text, lineHeight: 1 }}>♪</span>
            <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
              {bars.map((h, i) => (
                <div key={i} style={{ width: 3, height: Math.round(h * 20), background: wave, borderRadius: 2 }} />
              ))}
            </div>
          </>
        )}

        {/* Badges overlay */}
        <span style={{ position: "absolute", top: 7, right: 7, fontSize: "0.60rem", fontWeight: 700, color: item.is_active ? "#2e9460" : "var(--muted)", background: "rgba(0,0,0,0.70)", border: `1px solid ${item.is_active ? "rgba(46,148,96,0.40)" : "rgba(154,146,132,0.30)"}`, padding: "0.05rem 0.38rem", borderRadius: 99 }}>
          {item.is_active ? "● Publié" : "○ Masqué"}
        </span>
        {item.is_gratuit && (
          <span style={{ position: "absolute", bottom: 7, left: 7, fontSize: "0.60rem", fontWeight: 700, color: "#2e9460", background: "rgba(0,0,0,0.70)", border: "1px solid rgba(46,148,96,0.40)", padding: "0.05rem 0.38rem", borderRadius: 99 }}>✓ GRATUIT</span>
        )}
        {item.duration_sec !== null && (
          <span style={{ position: "absolute", bottom: 7, right: 7, fontSize: "0.65rem", fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.65)", padding: "0.05rem 0.38rem", borderRadius: 5, fontVariantNumeric: "tabular-nums" }}>
            {fmtDuration(item.duration_sec)}
          </span>
        )}

        {/* Hover play overlay */}
        {hovered && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(1px)" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", paddingLeft: 4 }}>▶</div>
          </div>
        )}
      </div>

      {/* Corps */}
      <div style={{ padding: "0.65rem 0.70rem 0.50rem", flex: 1, display: "flex", flexDirection: "column", gap: "0.28rem" }}>
        <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--cream)", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as React.CSSProperties}>
          {item.title}
        </div>
        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
          {item.category && (
            <span style={{ fontSize: "0.60rem", fontWeight: 700, color: "#c9a227", background: "rgba(201,162,39,0.12)", border: "1px solid rgba(201,162,39,0.25)", padding: "0.02rem 0.30rem", borderRadius: 99 }}>{item.category}</span>
          )}
          <span style={{ fontSize: "0.60rem", fontWeight: 700, color: ACCESS_COLOR[item.access_level], background: `${ACCESS_COLOR[item.access_level]}10`, border: `1px solid ${ACCESS_COLOR[item.access_level]}28`, padding: "0.02rem 0.30rem", borderRadius: 99 }}>
            {ACCESS_ICON[item.access_level]} {ACCESS_LABEL[item.access_level]}
          </span>
        </div>
        {item.size_mo !== null && (
          <div style={{ fontSize: "0.70rem", color: "var(--muted-2)" }}>
            {item.size_mo.toFixed(1)} Mo{item.audio_format ? ` · ${(FORMAT_LABEL[item.audio_format] ?? item.audio_format).toUpperCase()}` : ""}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "0.40rem 0.60rem", borderTop: "1px solid var(--line-soft)", display: "flex", gap: "0.28rem", alignItems: "center" }}>
        {item.access_level !== "PUBLIC" && (
          <button onClick={onToggleGratuit} style={{ fontSize: "0.62rem", fontWeight: 700, color: item.is_gratuit ? "#2e9460" : "var(--muted-2)", background: item.is_gratuit ? "rgba(46,148,96,0.10)" : "transparent", border: `1px solid ${item.is_gratuit ? "rgba(46,148,96,0.28)" : "var(--line-soft)"}`, padding: "0.14rem 0.35rem", borderRadius: 99, cursor: "pointer", flex: 1, textAlign: "left" as const }}>
            {item.is_gratuit ? "✓ Gratuit" : "Gratuit ?"}
          </button>
        )}
        <button onClick={onToggle} style={{ fontSize: "0.62rem", fontWeight: 700, color: item.is_active ? "#8b6a1a" : "#2b8a5e", background: item.is_active ? "rgba(201,162,39,0.08)" : "rgba(46,148,96,0.08)", border: `1px solid ${item.is_active ? "rgba(201,162,39,0.25)" : "rgba(46,148,96,0.25)"}`, padding: "0.14rem 0.42rem", borderRadius: 5, cursor: "pointer" }}>
          {item.is_active ? "↓" : "↑"}
        </button>
        <button onClick={onDelete} style={{ width: 24, height: 24, borderRadius: 5, background: "rgba(192,64,44,0.07)", color: "#b53a2a", border: "1px solid rgba(192,64,44,0.20)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "0.68rem" }}>🗑</button>
      </div>
    </div>
  );
}

// ── Ligne compacte ────────────────────────────────────────────────────────────

function AudioCompact({ item, onEdit, onToggle, onToggleGratuit, onDelete, onPreview }: {
  item: AudioItem; onEdit: () => void; onToggle: () => void;
  onToggleGratuit: () => void; onDelete: () => void; onPreview: () => void;
}) {
  const { line } = AUDIO_ACCENT[item.branche];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "8px 1fr auto auto auto auto auto auto", alignItems: "center", gap: "0.65rem", padding: "0.38rem 0.75rem", background: "var(--bg-1)", borderRadius: 5, border: "1px solid var(--line-soft)", opacity: item.is_active ? 1 : 0.58, transition: "background .12s" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-2)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-1)"; }}
    >
      <span style={{ width: 3, height: 20, background: line, borderRadius: 2, display: "block" }} />
      <span onClick={onPreview} style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--cream)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{item.title}</span>
      {item.category
        ? <span style={{ fontSize: "0.63rem", fontWeight: 700, color: "#c9a227", background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.20)", padding: "0.04rem 0.38rem", borderRadius: 99, whiteSpace: "nowrap" }}>{item.category}</span>
        : <span />}
      <span style={{ fontSize: "0.63rem", fontWeight: 700, color: ACCESS_COLOR[item.access_level], background: `${ACCESS_COLOR[item.access_level]}10`, border: `1px solid ${ACCESS_COLOR[item.access_level]}28`, padding: "0.04rem 0.38rem", borderRadius: 99, whiteSpace: "nowrap" }}>
        {ACCESS_ICON[item.access_level]} {ACCESS_LABEL[item.access_level]}
      </span>
      <span style={{ fontSize: "0.72rem", color: "var(--muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {item.duration_sec !== null ? `♪ ${fmtDuration(item.duration_sec)}` : ""}
      </span>
      {item.access_level !== "PUBLIC"
        ? <button onClick={onToggleGratuit} style={{ fontSize: "0.63rem", fontWeight: 700, color: item.is_gratuit ? "#2e9460" : "var(--muted-2)", background: item.is_gratuit ? "rgba(46,148,96,0.10)" : "transparent", border: `1px solid ${item.is_gratuit ? "rgba(46,148,96,0.28)" : "var(--line-soft)"}`, padding: "0.04rem 0.38rem", borderRadius: 99, cursor: "pointer", whiteSpace: "nowrap" }}>
            {item.is_gratuit ? "✓ Gratuit" : "Gratuit ?"}
          </button>
        : <span />}
      <span style={{ fontSize: "0.63rem", fontWeight: 700, color: item.is_active ? "#2e9460" : "var(--muted)", whiteSpace: "nowrap" }}>
        {item.is_active ? "● Publié" : "○ Masqué"}
      </span>
      <div style={{ display: "flex", gap: "0.25rem" }}>
        <button onClick={onPreview} style={{ width: 24, height: 24, borderRadius: 4, background: "rgba(201,162,39,0.10)", color: "#c9a227", border: "1px solid rgba(201,162,39,0.25)", cursor: "pointer", fontSize: "0.68rem", display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
        <button onClick={onEdit} style={{ width: 24, height: 24, borderRadius: 4, background: "var(--bg-2)", color: "var(--muted)", border: "1px solid var(--line-soft)", cursor: "pointer", fontSize: "0.72rem", display: "flex", alignItems: "center", justifyContent: "center" }}>✎</button>
        <button onClick={onToggle} style={{ width: 24, height: 24, borderRadius: 4, background: item.is_active ? "rgba(201,162,39,0.08)" : "rgba(46,148,96,0.08)", color: item.is_active ? "#8b6a1a" : "#2b8a5e", border: `1px solid ${item.is_active ? "rgba(201,162,39,0.25)" : "rgba(46,148,96,0.25)"}`, cursor: "pointer", fontSize: "0.78rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {item.is_active ? "↓" : "↑"}
        </button>
        <button onClick={onDelete} style={{ width: 24, height: 24, borderRadius: 4, background: "rgba(192,64,44,0.07)", color: "#b53a2a", border: "1px solid rgba(192,64,44,0.20)", cursor: "pointer", fontSize: "0.68rem", display: "flex", alignItems: "center", justifyContent: "center" }}>🗑</button>
      </div>
    </div>
  );
}

// ── Modal aperçu / lecteur ────────────────────────────────────────────────────

function AudioPreviewModal({ item, previewUrl, onClose, onEdit, onToggle }: {
  item: AudioItem; previewUrl?: string | null;
  onClose: () => void; onEdit: () => void; onToggle: () => void;
}) {
  const src = getMediaUrl(previewUrl || item.file_url);
  const { bg, line, text, wave } = AUDIO_ACCENT[item.branche];
  const bars = [0.35, 0.7, 0.9, 1, 0.6, 0.8, 0.45, 0.75, 0.55, 0.85, 0.5, 0.65, 0.9, 0.4, 0.7];

  return (
    <Modal title={item.title} onClose={onClose} maxWidth={560}>
      {/* Visuel haut */}
      <div style={{ background: bg, borderRadius: "var(--radius)", padding: "1.5rem", marginBottom: "1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "2.5rem", color: text }}>♪</span>
        {/* Waveform décoratif */}
        <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
          {bars.map((h, i) => (
            <div key={i} style={{ width: 4, height: Math.round(h * 28), background: wave, borderRadius: 2, flexShrink: 0 }} />
          ))}
        </div>
        {/* Lecteur audio */}
        {src ? (
          <audio controls src={src} style={{ width: "100%", marginTop: "0.25rem", borderRadius: 6 }} />
        ) : (
          <div style={{ fontSize: "0.78rem", color: "var(--muted)", textAlign: "center" }}>
            Fichier non disponible en prévisualisation
          </div>
        )}
      </div>

      {/* Badges */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
        {item.category && (
          <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "#c9a227", background: "rgba(201,162,39,0.12)", border: "1px solid rgba(201,162,39,0.25)", padding: "0.06rem 0.38rem", borderRadius: 99 }}>{item.category}</span>
        )}
        <span style={{ fontSize: "0.67rem", fontWeight: 700, color: ACCESS_COLOR[item.access_level], background: `${ACCESS_COLOR[item.access_level]}12`, border: `1px solid ${ACCESS_COLOR[item.access_level]}30`, padding: "0.06rem 0.38rem", borderRadius: 99 }}>
          {ACCESS_ICON[item.access_level]} {ACCESS_LABEL[item.access_level]}
        </span>
        <span style={{ fontSize: "0.67rem", fontWeight: 700, color: item.is_active ? "#2e9460" : "var(--muted)", background: item.is_active ? "rgba(46,148,96,0.12)" : "rgba(154,146,132,0.12)", border: `1px solid ${item.is_active ? "rgba(46,148,96,0.28)" : "rgba(154,146,132,0.22)"}`, padding: "0.06rem 0.38rem", borderRadius: 99 }}>
          {item.is_active ? "● Publié" : "○ Masqué"}
        </span>
        {item.is_gratuit && (
          <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "#2e9460", background: "rgba(46,148,96,0.12)", border: "1px solid rgba(46,148,96,0.28)", padding: "0.06rem 0.38rem", borderRadius: 99 }}>✓ Gratuit</span>
        )}
      </div>

      {item.description && (
        <p style={{ fontSize: "0.84rem", color: "var(--muted)", lineHeight: 1.6, marginBottom: "0.8rem" }}>{item.description}</p>
      )}

      <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", fontSize: "0.80rem", color: "var(--muted-2)", paddingTop: "0.7rem", borderTop: "1px solid var(--line-soft)", marginBottom: "1rem" }}>
        {item.duration_sec !== null && <span>♪ {fmtDuration(item.duration_sec)}</span>}
        {item.size_mo !== null && <span>{item.size_mo.toFixed(1)} Mo</span>}
        {item.audio_format && <span>{(FORMAT_LABEL[item.audio_format] ?? item.audio_format).toUpperCase()}</span>}
        <span>🗓 {new Date(item.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</span>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={() => { onClose(); onEdit(); }}>✎ Modifier</Button>
        <Button variant={item.is_active ? "danger" : "ghost"} onClick={onToggle}>
          {item.is_active ? "Dépublier" : "Republier"}
        </Button>
      </div>
    </Modal>
  );
}

// ── Formulaire ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  title: "", description: "", category: "", branche: "MEMBRE" as Branche,
  access_level: "MEMBRE" as PdfAccess, bucket_key: "", cover_url: "",
  duration_sec: null as number | null, size_mo: null as number | null,
  audio_format: null as string | null, is_active: true, is_gratuit: false,
};

function AudioFormModal({ initial, editing, onClose, onSaved, onError }: {
  initial: typeof EMPTY_FORM; editing: number | null;
  onClose: () => void; onSaved: () => void; onError: (s: string) => void;
}) {
  const [form,       setForm]       = useState(initial);
  const [uploading,  setUploading]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [dragOver,   setDragOver]   = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const handleUpload = async (file: File) => {
    const valid = ["audio/mpeg","audio/wav","audio/ogg","audio/mp4","audio/aac","audio/x-m4a"].some((t) => file.type.startsWith("audio") || file.name.match(/\.(mp3|wav|ogg|m4a|aac)$/i));
    if (!valid) { onError("Format non supporté. Utilisez MP3, WAV, OGG, M4A ou AAC."); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    const ext = file.name.split(".").pop()?.toLowerCase() ?? null;
    setUploading(true);
    try {
      const { data } = await audioApi.upload(file);
      setForm((prev) => ({
        ...prev,
        bucket_key:   data.bucket_key,
        size_mo:      data.size_mo ?? null,
        duration_sec: data.duration_sec ?? null,
        audio_format: ext,
        title:        prev.title || file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
      }));
    } catch (e) { onError(errorMessage(e)); }
    finally { setUploading(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) await audioApi.update(editing, form);
      else         await audioApi.create(form);
      onSaved();
    } catch (e) { onError(errorMessage(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={editing ? "Modifier l'audio" : "Nouvel audio"} onClose={onClose} maxWidth={620}>
      {/* Zone upload */}
      {!editing && (
        <>
          {previewUrl ? (
            <div style={{ marginBottom: "1rem", padding: "0.85rem", borderRadius: "var(--radius)", background: "var(--bg-2)", border: "1px solid var(--line-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.55rem" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: uploading ? "#c9a227" : "#2e9460" }}>
                  {uploading ? "Upload en cours…" : "✓ Audio prêt"}
                </span>
                <div style={{ display: "flex", gap: "0.6rem", fontSize: "0.72rem", color: "var(--muted-2)", fontVariantNumeric: "tabular-nums" }}>
                  {form.duration_sec !== null && <span>♪ {fmtDuration(form.duration_sec)}</span>}
                  {form.size_mo !== null && <span>{form.size_mo.toFixed(1)} Mo</span>}
                  {form.audio_format && <span>{(FORMAT_LABEL[form.audio_format] ?? form.audio_format).toUpperCase()}</span>}
                </div>
              </div>
              <audio controls src={previewUrl} style={{ width: "100%", borderRadius: 5 }} />
              <button type="button" onClick={() => fileRef.current?.click()} style={{ marginTop: "0.55rem", fontSize: "0.74rem", fontWeight: 600, color: "var(--muted)", background: "transparent", border: "1px solid var(--line-soft)", borderRadius: 5, padding: "0.24rem 0.65rem", cursor: "pointer" }}>
                ↺ Changer de fichier
              </button>
            </div>
          ) : (
            <div
              role="button" tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
              style={{ border: `2px dashed ${dragOver ? "#c9a227" : "var(--line-soft)"}`, borderRadius: "var(--radius)", padding: "2rem", textAlign: "center", cursor: "pointer", marginBottom: "1rem", background: dragOver ? "rgba(201,162,39,0.06)" : "transparent", transition: "all .18s" }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "0.4rem", opacity: 0.3 }}>♪</div>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                Glissez un fichier audio ici ou{" "}
                <span style={{ color: "#c9a227", fontWeight: 600 }}>cliquez pour choisir</span>
              </span>
              <div style={{ fontSize: "0.72rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
                MP3, WAV, OGG, M4A, AAC
              </div>
            </div>
          )}
          <input type="file" accept=".mp3,.wav,.ogg,.m4a,.aac,audio/*" ref={fileRef} style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
        </>
      )}

      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 0.85rem" }}>
          <Input label="Titre" value={form.title} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="Catégorie" value={form.category} placeholder="ex: Méditation" onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </div>
        <Textarea label="Description" value={form.description} minRows={2} maxLength={300} placeholder="Contenu de cet audio…" onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 0.85rem" }}>
          <Select label="Branche" value={form.branche} onChange={(e) => setForm({ ...form, branche: e.target.value as Branche })}>
            <option value="MEMBRE">Membres</option>
            <option value="FEMME">Femmes</option>
            <option value="ENFANT">Enfants</option>
          </Select>
          <Select label="Accès" value={form.access_level} onChange={(e) => setForm({ ...form, access_level: e.target.value as PdfAccess })}>
            <option value="PUBLIC">🌐 Public</option>
            <option value="MEMBRE">🔑 Membres</option>
            <option value="FEMME">♀ Branche Femmes</option>
            <option value="ENFANT">◈ Branche Enfants</option>
          </Select>
        </div>
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.1rem" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.86rem", color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Visible dans l'audiothèque
          </label>
          {form.access_level !== "PUBLIC" && (
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.86rem", color: form.is_gratuit ? "#2e9460" : "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={!!form.is_gratuit} onChange={(e) => setForm({ ...form, is_gratuit: e.target.checked })} />
              Accès gratuit
            </label>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.55rem" }}>
          <Button type="submit" loading={saving} disabled={!form.bucket_key && !editing}>
            {editing ? "Enregistrer" : "Ajouter"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modes d'affichage ─────────────────────────────────────────────────────────

type ViewMode = "liste" | "grille" | "compact";
const VIEW_MODES: { key: ViewMode; icon: string; label: string }[] = [
  { key: "liste",   icon: "≡", label: "Liste"   },
  { key: "grille",  icon: "⊞", label: "Grille"  },
  { key: "compact", icon: "≔", label: "Compact" },
];

// ── Page principale ───────────────────────────────────────────────────────────

export default function AudioPage() {
  const { toast } = useToast();
  const [items,        setItems]        = useState<AudioItem[]>([]);
  const [editTarget,   setEditTarget]   = useState<AudioItem | null>(null);
  const [showForm,     setShowForm]     = useState(false);
  const [preview,      setPreview]      = useState<AudioItem | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterAccess, setFilterAccess] = useState("ALL");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [viewMode,     setViewMode]     = useState<ViewMode>(() =>
    (typeof window !== "undefined" ? (localStorage.getItem("audio_view") as ViewMode) : null) ?? "liste"
  );

  const changeView = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("audio_view", mode);
  };

  const load = useCallback(async () => {
    try {
      const { data } = await audioApi.list();
      const result = Array.isArray(data) ? data : data.results;
      setItems(result);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (p: AudioItem) => {
    const next = !p.is_active;
    setItems((prev) => prev.map((i) => i.id === p.id ? { ...i, is_active: next } : i));
    if (preview?.id === p.id) setPreview({ ...p, is_active: next });
    try { await audioApi.update(p.id, { is_active: next }); }
    catch { setItems((prev) => prev.map((i) => i.id === p.id ? { ...i, is_active: p.is_active } : i)); }
  };

  const toggleGratuit = async (p: AudioItem) => {
    const next = !p.is_gratuit;
    setItems((prev) => prev.map((i) => i.id === p.id ? { ...i, is_gratuit: next } : i));
    if (preview?.id === p.id) setPreview({ ...p, is_gratuit: next });
    try { await audioApi.update(p.id, { is_gratuit: next }); }
    catch { setItems((prev) => prev.map((i) => i.id === p.id ? { ...i, is_gratuit: p.is_gratuit } : i)); }
  };

  const doRemove = async (id: number) => {
    try { await audioApi.remove(id); setItems((prev) => prev.filter((i) => i.id !== id)); toast("Audio supprimé.", "success"); }
    catch (e) { toast(errorMessage(e), "error"); }
  };

  const filtered = items.filter((p) =>
    (filterAccess === "ALL" || p.access_level === filterAccess) &&
    (!filterSearch || p.title.toLowerCase().includes(filterSearch.toLowerCase()) ||
     p.category.toLowerCase().includes(filterSearch.toLowerCase()) ||
     p.description.toLowerCase().includes(filterSearch.toLowerCase()))
  );

  const pubCount = items.filter((p) => p.is_active).length;
  const totalDurationSec = items.reduce((acc, i) => acc + (i.duration_sec ?? 0), 0);
  const totalHours = Math.floor(totalDurationSec / 3600);
  const totalMin   = Math.floor((totalDurationSec % 3600) / 60);

  const initialForEdit = editTarget ? {
    title: editTarget.title, description: editTarget.description,
    category: editTarget.category, branche: editTarget.branche,
    access_level: editTarget.access_level, bucket_key: editTarget.bucket_key,
    cover_url: editTarget.cover_url ?? "",
    duration_sec: editTarget.duration_sec, size_mo: editTarget.size_mo,
    audio_format: editTarget.audio_format,
    is_active: editTarget.is_active, is_gratuit: editTarget.is_gratuit ?? false,
  } : { ...EMPTY_FORM };

  const sharedProps = (p: AudioItem) => ({
    item: p,
    onPreview:       () => setPreview(p),
    onEdit:          () => { setEditTarget(p); setShowForm(true); },
    onToggle:        () => toggleActive(p),
    onToggleGratuit: () => toggleGratuit(p),
    onDelete:        () => setDeleteTarget(p.id),
  });

  return (
    <div className="fade-up">

      {/* ── Header ── */}
      <div className="page-header">
        <div className="eyebrow">Ressources</div>
        <h1>Audiothèque</h1>
        <p>
          {items.length} audio{items.length !== 1 ? "s" : ""}
          {" · "}{pubCount} publié{pubCount !== 1 ? "s" : ""}
          {totalDurationSec > 0 && ` · ${totalHours > 0 ? `${totalHours}h ` : ""}${totalMin}min de contenu`}
        </p>
      </div>

      {/* ── Barre filtres ── */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", marginBottom: "1.4rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Input label="Rechercher" value={filterSearch} placeholder="Titre, catégorie…" onChange={(e) => setFilterSearch(e.target.value)} />
        </div>
        <div style={{ width: 180 }}>
          <Select label="Accès" value={filterAccess} onChange={(e) => setFilterAccess(e.target.value)}>
            <option value="ALL">Tous les accès</option>
            <option value="PUBLIC">🌐 Public</option>
            <option value="MEMBRE">🔑 Membres</option>
            <option value="FEMME">♀ Femmes</option>
            <option value="ENFANT">◈ Enfants</option>
          </Select>
        </div>

        {/* Toggle vue */}
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--line-soft)", borderRadius: 6, overflow: "hidden", flexShrink: 0, marginBottom: "0.85rem" }}>
          {VIEW_MODES.map((m) => (
            <button key={m.key} title={m.label} onClick={() => changeView(m.key)}
              style={{ width: 34, height: 34, border: "none", cursor: "pointer", fontSize: "0.95rem", background: viewMode === m.key ? "#c9a227" : "transparent", color: viewMode === m.key ? "#fff" : "var(--muted)", transition: "background .14s", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {m.icon}
            </button>
          ))}
        </div>

        <Button style={{ marginBottom: "0.85rem" }} onClick={() => { setEditTarget(null); setShowForm(true); }}>
          + Nouvel audio
        </Button>
      </div>

      {/* ── Sections par branche ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {BRANCH_COLS.map((col) => {
          const colItems = filtered.filter((p) => p.branche === col.key);
          return (
            <section key={col.key}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.6rem 1rem", background: `${col.color}0e`, border: `1px solid ${col.color}28`, borderLeft: `4px solid ${col.color}`, borderRadius: "var(--radius)", marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{col.emoji}</span>
                <span style={{ fontSize: "0.90rem", fontWeight: 800, color: col.color, flex: 1 }}>{col.label}</span>
                <span style={{ fontSize: "0.70rem", fontWeight: 700, background: `${col.color}1a`, color: col.color, border: `1px solid ${col.color}38`, padding: "0.10rem 0.52rem", borderRadius: 99 }}>
                  {colItems.length} audio{colItems.length !== 1 ? "s" : ""}
                </span>
              </div>

              {colItems.length === 0 ? (
                <div style={{ padding: "1.4rem", textAlign: "center", color: "var(--muted)", fontSize: "0.82rem", border: "1px dashed var(--line-soft)", borderRadius: "var(--radius)" }}>
                  Aucun audio dans cette section.
                </div>
              ) : viewMode === "grille" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: "0.75rem" }}>
                  {colItems.map((p) => <AudioCard key={p.id} {...sharedProps(p)} />)}
                </div>
              ) : viewMode === "compact" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.22rem" }}>
                  {colItems.map((p) => <AudioCompact key={p.id} {...sharedProps(p)} />)}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {colItems.map((p) => <AudioRow key={p.id} {...sharedProps(p)} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ── Modals ── */}
      {showForm && (
        <AudioFormModal
          initial={initialForEdit} editing={editTarget?.id ?? null}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onSaved={() => { toast(editTarget ? "Audio mis à jour." : "Audio ajouté.", "success"); setShowForm(false); setEditTarget(null); load(); }}
          onError={(s) => toast(s, "error")}
        />
      )}
      {preview && (
        <AudioPreviewModal
          item={preview} previewUrl={null}
          onClose={() => setPreview(null)}
          onEdit={() => { setPreview(null); setEditTarget(preview); setShowForm(true); }}
          onToggle={() => toggleActive(preview)}
        />
      )}
      {deleteTarget !== null && (
        <ConfirmModal
          title="Supprimer l'audio ?"
          message="Ce fichier audio sera définitivement supprimé de l'audiothèque."
          confirmLabel="Supprimer"
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await doRemove(deleteTarget);
            setDeleteTarget(null);
            if (preview?.id === deleteTarget) setPreview(null);
          }}
        />
      )}
    </div>
  );
}
