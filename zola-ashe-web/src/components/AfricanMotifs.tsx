/** Motifs africains stylisés (langage du logo) — décor discret, en `currentColor`. */
type M = { size?: number; className?: string; style?: React.CSSProperties };

/** Soleil rayonnant (éventail du logo) — anneaux + rayons + graine centrale. */
export function SunMark({ size = 280, className = "", style }: M) {
  const rays = Array.from({ length: 28 });
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden className={className}
         style={style} fill="none" stroke="currentColor">
      <circle cx="100" cy="100" r="34" strokeWidth="0.7" />
      <circle cx="100" cy="100" r="50" strokeWidth="0.5" strokeDasharray="1 5" />
      <circle cx="100" cy="100" r="13" strokeWidth="0.9" />
      <path d="M100 92 Q104 100 100 108 Q96 100 100 92 Z" strokeWidth="0.7" />
      {rays.map((_, i) => {
        const a = (i * (360 / 28) * Math.PI) / 180;
        const r1 = 56, r2 = i % 2 ? 78 : 70;
        // Arrondi → mêmes chaînes côté serveur et client (évite le mismatch d'hydratation).
        const round = (n: number) => Number(n.toFixed(2));
        return (
          <line key={i} x1={round(100 + r1 * Math.cos(a))} y1={round(100 + r1 * Math.sin(a))}
                x2={round(100 + r2 * Math.cos(a))} y2={round(100 + r2 * Math.sin(a))} strokeWidth="0.7" />
        );
      })}
    </svg>
  );
}

/** Étoile (Nsoromma — « enfant des cieux »). */
export function GlyphStar({ size = 60, className = "", style }: M) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={className} style={style}
         fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M24 4 L29 19 L44 24 L29 29 L24 44 L19 29 L4 24 L19 19 Z" />
      <circle cx="24" cy="24" r="3" />
    </svg>
  );
}

/** Spirale (Sankofa — « retour aux sources »). */
export function GlyphSpiral({ size = 60, className = "", style }: M) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={className} style={style}
         fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M24 40c-9 0-16-7-16-16S15 8 24 8s14 6 14 14-6 12-12 12-10-5-10-10 4-8 8-8 6 3 6 6" />
    </svg>
  );
}

/** Anneaux concentriques. */
export function GlyphRings({ size = 56, className = "", style }: M) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={className} style={style}
         fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="24" cy="24" r="20" /><circle cx="24" cy="24" r="12" /><circle cx="24" cy="24" r="4" />
    </svg>
  );
}

/** Trame mudcloth/adinkra géométrique très discrète (en fond de bande). */
export const MUDCLOTH =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' fill='none' stroke='%23b8901f' stroke-width='1.1' opacity='0.5'%3E%3Cpath d='M0 30h120M0 90h120'/%3E%3Cpath d='M20 18l10 12-10 12M50 18l10 12-10 12M80 18l10 12-10 12M110 18l10 12-10 12'/%3E%3Ccircle cx='30' cy='90' r='5'/%3E%3Ccircle cx='90' cy='90' r='5'/%3E%3Cpath d='M55 84l10 6-10 6zM0 84l10 6-10 6z'/%3E%3C/svg%3E\")";
