/** Loader de marque : emblème pulsé entouré d'un anneau doré tournant. */
export function BrandLoader({ label = "Chargement", full = true }: { label?: string; full?: boolean }) {
  return (
    <div className={full ? "brand-loader brand-loader--full" : "brand-loader"}>
      <div className="brand-loader__mark">
        <span className="brand-loader__ring" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/emblem-zola-ashe.png" alt="" className="brand-loader__emblem" />
      </div>
      {label && <span className="brand-loader__label">{label}</span>}
    </div>
  );
}
