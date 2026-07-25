"use client";

import { useEffect } from "react";

import type { ResourceItem } from "@/lib/types";

/** Convertit une URL YouTube (watch / youtu.be / shorts) en URL d'intégration. */
function youtubeEmbed(url: string): string {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
}

export type Playback = { kind: "youtube" | "file"; url: string };

/** Lecteur média en modale : vidéo YouTube intégrée, ou fichier signé (vidéo/audio/PDF). */
export function MediaModal({
  resource,
  playback,
  onClose,
}: {
  resource: ResourceItem;
  playback: Playback;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const isYoutube = playback.kind === "youtube";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(8, 6, 5, 0.78)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem",
        animation: "fadeUp .25s ease both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 880, padding: "1.1rem", borderColor: "var(--line)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.9rem" }}>
          <h3 style={{ fontSize: "1.3rem", margin: 0 }}>{resource.title}</h3>
          <button
            onClick={onClose}
            aria-label="Fermer"
            style={{
              background: "transparent", border: "1px solid var(--line)", color: "var(--cream)",
              width: 34, height: 34, borderRadius: 999, cursor: "pointer", fontSize: "1rem", lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {isYoutube && (
          <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 10, overflow: "hidden", background: "#000" }}>
            <iframe
              src={youtubeEmbed(playback.url)}
              title={resource.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            />
          </div>
        )}

        {!isYoutube && resource.resource_type === "VIDEO" && (
          <video src={playback.url} controls autoPlay style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: "70vh" }} />
        )}

        {!isYoutube && resource.resource_type === "AUDIO" && (
          <div style={{ padding: "1.5rem 0" }}>
            <audio src={playback.url} controls autoPlay style={{ width: "100%" }} />
          </div>
        )}

        {!isYoutube && resource.resource_type === "PDF" && (
          <iframe src={playback.url} title={resource.title} style={{ width: "100%", height: "70vh", border: "none", borderRadius: 10, background: "#fff" }} />
        )}

        {resource.description && (
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.9rem" }}>{resource.description}</p>
        )}
      </div>
    </div>
  );
}
