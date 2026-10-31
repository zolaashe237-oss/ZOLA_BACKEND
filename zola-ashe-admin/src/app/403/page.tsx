import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg)",
      color: "var(--cream)",
      fontFamily: "var(--sans)",
      textAlign: "center",
      padding: "2rem",
    }}>
      <div style={{
        fontSize: "5rem", fontWeight: 800, lineHeight: 1,
        color: "var(--terra)", marginBottom: ".5rem",
      }}>
        403
      </div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: ".5rem" }}>
        Accès refusé
      </h1>
      <p style={{ color: "var(--muted)", fontSize: ".95rem", marginBottom: "2rem", maxWidth: 360 }}>
        Vous n&apos;avez pas les permissions nécessaires pour accéder à cette page.
        Contactez un administrateur si vous pensez qu&apos;il s&apos;agit d&apos;une erreur.
      </p>
      <Link
        href="/"
        style={{
          padding: ".65rem 1.5rem",
          background: "var(--gold)",
          color: "#1a1209",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 700,
          fontSize: ".9rem",
        }}
      >
        Retour au tableau de bord
      </Link>
    </div>
  );
}
