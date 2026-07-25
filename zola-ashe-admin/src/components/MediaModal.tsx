"use client";

import { useEffect } from "react";

/** Prévisualisation média en modale (vidéo / audio / PDF) via URL signée. */
export function MediaModal({
  title,
  url,
  contentType,
  onClose,
}: {
  title: string;
  url: string;
  contentType: string;
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

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(8, 6, 5, 0.8)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem",
        animation: "fadeUp .22s ease both",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className="card"
           style={{ width: "100%", maxWidth: 860, padding: "1.1rem", borderColor: "var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.9rem" }}>
          <h3 style={{ fontSize: "1.25rem", margin: 0 }}>{title}</h3>
          <button onClick={onClose} aria-label="Fermer"
                  style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--cream)",
                           width: 32, height: 32, borderRadius: 999, cursor: "pointer" }}>✕</button>
        </div>

        {contentType === "VIDEO" && (
          <video src={url} controls autoPlay style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: "70vh" }} />
        )}
        {contentType === "AUDIO" && (
          <div style={{ padding: "1.4rem 0" }}><audio src={url} controls autoPlay style={{ width: "100%" }} /></div>
        )}
        {contentType === "PDF" && (
          <iframe src={url} title={title} style={{ width: "100%", height: "70vh", border: "none", borderRadius: 10, background: "#fff" }} />
        )}
      </div>
    </div>
  );
}
