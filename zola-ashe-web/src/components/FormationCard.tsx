"use client";

import Link from "next/link";
import { useState } from "react";

import type { FormationListItem } from "@/lib/types";
import { IconLock, IconLibrary } from "@/components/icons";

const CATEGORY_LABEL: Record<string, string> = {
  LIVRE: "Bibliothèque",
  FORMATION: "Formation",
  LIBRE: "Accès libre",
};
const TINT: Record<string, string> = {
  FORMATION: "linear-gradient(150deg, rgba(181,83,42,.5), rgba(110,31,31,.35))",
  LIVRE: "linear-gradient(150deg, rgba(201,162,39,.45), rgba(181,83,42,.3))",
  LIBRE: "linear-gradient(150deg, rgba(110,31,31,.4), rgba(201,162,39,.3))",
};

export function FormationCard({ formation }: { formation: FormationListItem }) {
  const [broken, setBroken] = useState(false);
  const hasImg = formation.cover && !broken;

  return (
    <Link href={`/formation/${formation.id}`} className="card card-hover media-card press"
          style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      <div className="media-card__cover">
        {hasImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={formation.cover} alt="" onError={() => setBroken(true)} />
        ) : (
          <div className="ph" style={{ background: TINT[formation.category] ?? "var(--bg-2)" }}>
            <IconLibrary className="" />
          </div>
        )}

        <div className="media-card__top">
          <span className="chip-mini">{CATEGORY_LABEL[formation.category] ?? formation.category}</span>
          <span className="chip-mini">
            {formation.module_count} module{formation.module_count > 1 ? "s" : ""}
          </span>
        </div>

        {formation.locked && (
          <div className="media-card__lock">
            <IconLock className="" />
            <span style={{ fontSize: ".82rem", fontWeight: 600 }}>Réservé aux membres</span>
          </div>
        )}
      </div>

      <div className="media-card__body">
        <h3 style={{ fontSize: "1.05rem", lineHeight: 1.25 }}>{formation.title}</h3>
        {formation.description && (
          <p className="line-clamp-2" style={{ fontSize: ".86rem", color: "var(--muted)" }}>
            {formation.description}
          </p>
        )}
      </div>
    </Link>
  );
}
