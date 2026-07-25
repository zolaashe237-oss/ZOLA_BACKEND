"use client";

import { useState } from "react";

const ICON: Record<string, string> = { VIDEO: "▶", PDF: "❑", AUDIO: "♪" };
const TINT: Record<string, string> = {
  VIDEO: "linear-gradient(135deg, rgba(181,83,42,0.35), rgba(201,162,39,0.18))",
  PDF: "linear-gradient(135deg, rgba(201,162,39,0.30), rgba(181,83,42,0.15))",
  AUDIO: "linear-gradient(135deg, rgba(95,185,138,0.28), rgba(201,162,39,0.15))",
};

/** Miniature d'un contenu : image si `url`, sinon placeholder doré par type. */
export function Thumb({ url, type, size = 56 }: { url?: string; type: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const box: React.CSSProperties = {
    width: size, height: size, borderRadius: 10, flexShrink: 0, overflow: "hidden",
    border: "1px solid var(--line-soft)",
  };

  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img src={url} alt="" onError={() => setBroken(true)}
           style={{ ...box, objectFit: "cover", display: "block" }} />
    );
  }
  return (
    <div style={{
      ...box, display: "flex", alignItems: "center", justifyContent: "center",
      background: TINT[type] ?? "var(--bg-2)", color: "var(--gold-2)", fontSize: size * 0.4,
    }}>
      {ICON[type] ?? "•"}
    </div>
  );
}
