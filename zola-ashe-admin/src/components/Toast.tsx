"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  leaving: boolean;
}

interface ToastCtx {
  toast: (message: string, kind?: ToastKind) => void;
}

const TIMEOUT: Record<ToastKind, number> = {
  success: 3500,
  error:   6000,
  info:    4000,
};

const MAX_STACK = 5;

const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    // Mark as leaving (triggers exit animation)
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    // Remove from DOM after animation
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 280);
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "success") => {
    if (!message) return;
    const id = ++counter.current;
    setItems((prev) => {
      const next = [...prev, { id, message, kind, leaving: false }];
      // Keep only the last MAX_STACK items (discard oldest)
      return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next;
    });
    setTimeout(() => dismiss(id), TIMEOUT[kind]);
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: ".5rem",
          zIndex: 9999,
          pointerEvents: "none",
          maxWidth: 440,
        }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="toast-item"
            data-kind={t.kind}
            data-leaving={t.leaving ? "true" : undefined}
            role="alert"
            style={{ pointerEvents: "all" }}
          >
            <span className="toast-icon" aria-hidden="true">
              {t.kind === "success" ? "✓" : t.kind === "error" ? "✕" : "ℹ"}
            </span>
            <span className="toast-msg">{t.message}</span>
            <button
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Fermer la notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
