"use client";

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
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
        background: ok ? "rgba(95, 185, 138, 0.14)" : "rgba(207, 90, 60, 0.16)",
        color: ok ? "#7fd4a3" : "#f0a896",
        border: `1px solid ${ok ? "rgba(95,185,138,0.4)" : "rgba(207,90,60,0.4)"}`,
        padding: "0.55rem 0.85rem", borderRadius: 9, fontSize: "0.85rem", marginBottom: "0.85rem",
      }}
    >
      {children}
    </div>
  );
}

/** Badge en pastille douce. `color` = couleur d'accent (texte + fond translucide). */
export function Badge({ children, color = "#c9a227" }: { children: ReactNode; color?: string }) {
  return (
    <span className="badge" style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}>
      {children}
    </span>
  );
}

export const STATUS_COLOR: Record<string, string> = {
  ACTIF: "#5fb98a", RESTREINT: "#d9a441", BLOQUE: "#cf5a3c",
};

export function errorMessage(e: unknown): string {
  const detail = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if ((e as Error)?.message === "Accès réservé aux administrateurs.") return (e as Error).message;
  if (!detail) return "Une erreur est survenue.";
  if (typeof detail.detail === "string") return detail.detail;
  const first = Object.values(detail)[0];
  if (Array.isArray(first)) return String(first[0]);
  return typeof first === "string" ? first : "Une erreur est survenue.";
}
