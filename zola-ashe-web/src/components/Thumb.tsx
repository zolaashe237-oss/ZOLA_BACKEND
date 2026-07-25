"use client";

import { useState } from "react";

const ICON: Record<string, string> = { VIDEO: "▶", PDF: "❑", AUDIO: "♪" };
const TINT: Record<string, string> = {
  VIDEO: "linear-gradient(135deg, rgba(181,83,42,0.4), rgba(201,162,39,0.2))",
  PDF: "linear-gradient(135deg, rgba(201,162,39,0.35), rgba(181,83,42,0.18))",
  AUDIO: "linear-gradient(135deg, rgba(127,212,163,0.3), rgba(201,162,39,0.18))",
};

/** Miniature d'un contenu : image si `url`, sinon placeholder doré par type. */
export function Thumb({ url, type, locked, size = 72 }: { url?: string; type: string; locked?: boolean; size?: number }) {
  const [broken, setBroken] = useState(false);
  const box: React.CSSProperties = {
    width: size, height: size, borderRadius: 12, flexShrink: 0, overflow: "hidden",
    border: "1px solid var(--line-soft)", position: "relative",
  };

  return (
    <div style={box}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" onError={() => setBroken(true)}
             style={{ width: "100%", height: "100%", objectFit: "cover", display: "block",
                      filter: locked ? "grayscale(0.5) brightness(0.7)" : "none" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center",
                      justifyContent: "center", background: TINT[type] ?? "var(--bg-2)",
                      color: "var(--gold-2)", fontSize: size * 0.36 }}>
          {ICON[type] ?? "•"}
        </div>
      )}
      {locked && (
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
                       justifyContent: "center", fontSize: size * 0.28, color: "var(--cream)",
                       textShadow: "0 1px 4px rgba(0,0,0,.6)" }}>🔒</span>
      )}
    </div>
  );
}
