import Link from "next/link";

/** Logo ZOLA ASHÉ (back-office) : emblème + mot-symbole. */
export function Logo({
  size = 34, withWord = true, href, wordSize = "1.3rem", className = "",
}: {
  size?: number; withWord?: boolean; href?: string; wordSize?: string; className?: string;
}) {
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/img/emblem-zola-ashe.png" alt="ZOLA ASHÉ"
           width={size} height={Math.round(size * 1.12)}
           style={{ objectFit: "contain", flexShrink: 0 }} />
      {withWord && (
        <span className="brand-word" style={{ fontSize: wordSize }}>
          ZOLA <span className="text-gold">ASHÉ</span>
        </span>
      )}
    </>
  );
  return href
    ? <Link href={href} className={`brand ${className}`}>{inner}</Link>
    : <span className={`brand ${className}`}>{inner}</span>;
}
