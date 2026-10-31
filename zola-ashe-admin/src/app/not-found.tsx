import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--cream)",
        fontFamily: "var(--sans)",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          className="eyebrow"
          style={{ marginBottom: ".75rem", letterSpacing: ".22em" }}
        >
          Zola Ashé · Back-office
        </div>

        <div
          style={{
            fontSize: "clamp(5rem, 16vw, 9.5rem)",
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-4px",
            background:
              "linear-gradient(135deg, var(--gold-2) 30%, var(--terra-2) 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: "1rem",
            userSelect: "none",
          }}
        >
          404
        </div>

        <h1
          style={{
            fontSize: "1.4rem",
            marginBottom: ".5rem",
            color: "var(--ink)",
          }}
        >
          Page introuvable
        </h1>
        <p
          style={{
            color: "var(--muted)",
            maxWidth: 380,
            margin: "0 auto 2rem",
            fontSize: ".9rem",
            lineHeight: 1.6,
          }}
        >
          Cette page n&apos;existe pas ou a été déplacée. Vérifiez l&apos;URL ou
          retournez au tableau de bord.
        </p>

        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: ".5rem",
            padding: ".62rem 1.4rem",
            borderRadius: "var(--radius-sm)",
            background: "var(--gold-bg)",
            border: "1px solid rgba(201,162,39,0.3)",
            color: "var(--gold-2)",
            fontWeight: 600,
            fontSize: ".88rem",
            textDecoration: "none",
            transition: "all .16s",
          }}
        >
          ← Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
