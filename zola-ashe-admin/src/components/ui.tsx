"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="card" style={style}>{children}</div>;
}

export function Button({
  children,
  loading,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`btn btn-${variant} ${className}`.trim()}
    >
      {loading ? "…" : children}
    </button>
  );
}

export function Input({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label style={{ display: "block", marginBottom: "0.85rem" }}>
      {label && <span className="field-label">{label}</span>}
      <input {...props} className="input" style={props.style} />
    </label>
  );
}

/**
 * Textarea auto-redimensionnable avec compteur de caractères optionnel.
 * Utilise la classe `.input` CSS existante — même visuel que les inputs.
 */
export function Textarea({
  label,
  showCount,
  minRows = 3,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  showCount?: boolean;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => { resize(); }, [props.value, resize]);

  const len   = typeof props.value === "string" ? props.value.length : 0;
  const max   = typeof props.maxLength === "number" ? props.maxLength : null;
  const pct   = max ? len / max : 0;
  const show  = showCount || max !== null;
  const color = pct > 0.9 ? "var(--bad)" : pct > 0.75 ? "var(--warn)" : "var(--muted-2)";

  return (
    <label style={{ display: "block", marginBottom: "0.85rem" }}>
      {label && (
        <span style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          marginBottom: "0.38rem",
        }}>
          <span className="field-label" style={{ marginBottom: 0 }}>{label}</span>
          {show && (
            <span style={{ fontSize: "0.68rem", color, fontVariantNumeric: "tabular-nums" }}>
              {len}{max !== null ? ` / ${max}` : ""}
            </span>
          )}
        </span>
      )}
      <textarea
        ref={ref}
        rows={minRows}
        {...props}
        className="input"
        onInput={(e) => { resize(); props.onInput?.(e); }}
        style={{
          resize: "none",
          overflowY: "hidden",
          lineHeight: 1.65,
          display: "block",
          ...props.style,
        }}
      />
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label style={{ display: "block", marginBottom: "0.85rem" }}>
      {label && <span className="field-label">{label}</span>}
      <select {...props} className="select" style={props.style}>
        {children}
      </select>
    </label>
  );
}

export function Alert({ children, kind = "error" }: { children: ReactNode; kind?: "error" | "success" }) {
  if (!children) return null;
  const ok = kind === "success";
  return (
    <div
      style={{
        background: ok ? "var(--ok-bg)"  : "var(--bad-bg)",
        color:      ok ? "var(--ok)"     : "var(--bad)",
        border:     ok
          ? "1px solid rgba(46,148,96,0.30)"
          : "1px solid rgba(192,64,44,0.30)",
        padding: "0.55rem 0.85rem",
        borderRadius: 9,
        fontSize: "0.85rem",
        marginBottom: "0.85rem",
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  );
}

/** Badge en pastille. `color` = couleur d'accent (hex — texte + fond 13 % opacité). */
export function Badge({ children, color = "#c9a227" }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="badge"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}4d` }}
    >
      {children}
    </span>
  );
}

export function ConfirmDialog({
  open, title, body, confirmLabel = "Confirmer", danger = false, loading = false,
  onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius-sm)",
          boxShadow: "var(--shadow-lg)",
          width: "100%", maxWidth: 420,
          padding: "1.5rem",
        }}
      >
        {/* Icône + titre */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "0.85rem" }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: danger ? "rgba(192,64,44,0.1)" : "rgba(201,162,39,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {danger ? (
              <svg width="18" height="18" fill="none" stroke={danger ? "var(--bad)" : "var(--gold-2)"} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            ) : (
              <svg width="18" height="18" fill="none" stroke="var(--gold-2)" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--ink)", marginBottom: "0.2rem" }}>
              {title}
            </div>
            <div style={{ fontSize: "0.83rem", color: "var(--muted)", lineHeight: 1.5 }}>
              {body}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1.25rem" }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: "0.45rem 1rem", fontSize: "0.82rem", fontWeight: 600,
              border: "1px solid var(--line-med)", borderRadius: "var(--radius-sm)",
              background: "var(--bg-1)", color: "var(--muted)", cursor: "pointer",
            }}
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: "0.45rem 1.1rem", fontSize: "0.82rem", fontWeight: 700,
              border: "none", borderRadius: "var(--radius-sm)", cursor: loading ? "default" : "pointer",
              background: danger ? "var(--bad)" : "var(--gold-2)",
              color: "#fff", opacity: loading ? 0.65 : 1,
              minWidth: 90, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
            }}
          >
            {loading && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                style={{ animation: "spin 0.8s linear infinite" }}>
                <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const STATUS_COLOR: Record<string, string> = {
  ACTIF:     "#2e9460",
  RESTREINT: "#9a6e10",
  BLOQUE:    "#c0402c",
};

export function errorMessage(e: unknown): string {
  const response = (e as { response?: { data?: unknown; status?: number } })?.response;
  const detail   = response?.data;
  const status   = response?.status;

  if ((e as Error)?.message === "Accès réservé aux administrateurs.") return (e as Error).message;

  if (!response) return "Impossible de contacter le serveur. Vérifiez votre connexion.";

  if (typeof detail === "string" || !detail) {
    if (status === 404) return "Cette fonctionnalité n'est pas encore disponible côté serveur.";
    if (status === 500) return "Erreur interne du serveur. Réessayez plus tard.";
    return `Une erreur est survenue (code ${status ?? "inconnu"}).`;
  }

  const obj = detail as Record<string, unknown>;
  if (typeof obj.detail === "string") return obj.detail;
  const first = Object.values(obj)[0];
  if (Array.isArray(first)) return String(first[0]);
  return typeof first === "string" ? first : "Une erreur est survenue.";
}

// ── Pagination ────────────────────────────────────────────────────────────────

/** Hook de pagination générique.
 *  `resetKey` — chaîne qui change quand les filtres actifs changent → revient à la page 1. */
export function usePagination<T>(items: T[], initialSize = 10, resetKey?: string) {
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);

  const total      = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage   = Math.min(page, totalPages);
  const from       = (safePage - 1) * pageSize;
  const paged      = items.slice(from, from + pageSize);

  useEffect(() => { setPage(1); }, [resetKey]);

  const go = useCallback((p: number) => {
    setPage(Math.max(1, Math.min(p, totalPages)));
  }, [totalPages]);

  const changeSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  return { page: safePage, totalPages, paged, total, pageSize, setPageSize: changeSize, go };
}

/** Barre de pagination à placer sous un tableau. */
export function Pagination({
  page, totalPages, total, pageSize, onPage, onPageSize,
}: {
  page:        number;
  totalPages:  number;
  total:       number;
  pageSize:    number;
  onPage:      (p: number) => void;
  onPageSize?: (size: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  // Numéros de pages à afficher (max 7 éléments avec "…")
  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else if (page <= 4) {
    pages.push(1, 2, 3, 4, 5, "…", totalPages);
  } else if (page >= totalPages - 3) {
    pages.push(1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
  } else {
    pages.push(1, "…", page - 1, page, page + 1, "…", totalPages);
  }

  const pgBtn = (label: string, disabled: boolean, onClick: () => void, active = false) => (
    <button
      key={label + (active ? "_a" : "")}
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: 30, height: 30, borderRadius: 5, padding: "0 6px",
        background: active ? "var(--gold)" : "transparent",
        color: active ? "#fff" : disabled ? "var(--muted-2)" : "var(--cream)",
        border: `1px solid ${active ? "var(--gold)" : "var(--line-soft)"}`,
        cursor: disabled ? "default" : "pointer",
        fontSize: "0.80rem", fontWeight: active ? 700 : 400,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transition: "background .12s, border-color .12s",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-2)";
      }}
      onMouseLeave={(e) => {
        if (!disabled && !active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0.6rem 1rem", borderTop: "1px solid var(--line-soft)",
      flexWrap: "wrap", gap: "0.5rem",
    }}>
      {/* Compteur */}
      <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        {total === 0 ? "Aucun résultat" : `${from}–${to} sur ${total}`}
      </span>

      {/* Boutons pages */}
      <div style={{ display: "flex", gap: "0.22rem", alignItems: "center" }}>
        {pgBtn("‹‹", page === 1, () => onPage(1))}
        {pgBtn("‹",  page === 1, () => onPage(page - 1))}
        {pages.map((p, i) =>
          p === "…"
            ? <span key={`e${i}`} style={{ width: 26, textAlign: "center", color: "var(--muted)", fontSize: "0.80rem", userSelect: "none" }}>…</span>
            : pgBtn(String(p), false, () => onPage(p as number), p === page)
        )}
        {pgBtn("›",  page === totalPages, () => onPage(page + 1))}
        {pgBtn("››", page === totalPages, () => onPage(totalPages))}
      </div>

      {/* Lignes par page */}
      {onPageSize && (
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          style={{
            background: "var(--bg-2)", border: "1px solid var(--line-soft)",
            borderRadius: 5, padding: "0.18rem 0.55rem",
            color: "var(--cream)", fontSize: "0.78rem", cursor: "pointer",
          }}
        >
          <option value={10}>10 / page</option>
          <option value={20}>20 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
      )}
    </div>
  );
}
