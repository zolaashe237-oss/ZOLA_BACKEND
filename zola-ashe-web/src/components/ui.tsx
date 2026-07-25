"use client";

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

type Variant = "primary" | "ghost" | "outline";

export function Card({
  children,
  style,
  hover,
  className = "",
}: {
  children: ReactNode;
  style?: CSSProperties;
  hover?: boolean;
  className?: string;
}) {
  return (
    <div className={`card ${hover ? "card-hover" : ""} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function Button({
  children,
  loading,
  variant = "primary",
  block,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: Variant;
  block?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`btn btn-${variant} ${block ? "btn-block" : ""} ${className}`.trim()}
    >
      {loading ? "…" : children}
    </button>
  );
}

export function Input({
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input {...props} className={`input ${className}`.trim()} />
    </label>
  );
}

export function Select({
  label,
  children,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <select {...props} className={`select ${className}`.trim()}>
        {children}
      </select>
    </label>
  );
}

export function Alert({ children, kind = "error" }: { children: ReactNode; kind?: "error" | "success" }) {
  if (!children) return null;
  return <div className={`alert alert-${kind === "error" ? "error" : "success"}`}>{children}</div>;
}

export function Badge({
  children,
  tone = "gold",
}: {
  children: ReactNode;
  tone?: "gold" | "locked" | "terra";
}) {
  const cls = tone === "locked" ? "badge badge-locked" : tone === "terra" ? "badge badge-terra" : "badge";
  return <span className={cls}>{children}</span>;
}

/** Petit en-tête de section : œillet doré + titre serif. */
export function SectionTitle({
  eyebrow,
  title,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  align?: "left" | "center";
}) {
  return (
    <div style={{ textAlign: align, marginBottom: "1.6rem" }}>
      {eyebrow && <div className="eyebrow" style={{ marginBottom: ".6rem" }}>{eyebrow}</div>}
      <h2 style={{ margin: 0 }}>{title}</h2>
    </div>
  );
}

/** Extrait un message d'erreur lisible depuis une erreur axios. */
export function errorMessage(e: unknown): string {
  const detail = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!detail) return "Une erreur est survenue.";
  if (typeof detail.detail === "string") return detail.detail;
  const first = Object.values(detail)[0];
  if (Array.isArray(first)) return String(first[0]);
  return typeof first === "string" ? first : "Une erreur est survenue.";
}
