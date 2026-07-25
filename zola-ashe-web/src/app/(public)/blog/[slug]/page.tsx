"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { blogApi } from "@/lib/endpoints";
import type { Article } from "@/lib/types";

export default function ArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    blogApi.detail(slug)
      .then((r) => setArticle(r.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="container" style={{ padding: "3.5rem 1.5rem", color: "var(--muted)" }}>Chargement…</div>;
  if (notFound || !article) {
    return (
      <div className="container" style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1>Article introuvable</h1>
        <p className="lead" style={{ margin: "1rem 0 2rem" }}>Cet article n&apos;existe pas ou n&apos;est plus publié.</p>
        <Link href="/blog" className="btn btn-primary">Retour au journal</Link>
      </div>
    );
  }

  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <div className="container-sm" style={{ padding: "3rem 1.5rem 1rem" }}>
      <Link href="/blog" className="link" style={{ fontSize: ".88rem" }}>← Tout le journal</Link>

      <div style={{ margin: "1.4rem 0 .4rem", display: "flex", gap: ".7rem", alignItems: "center" }}>
        {article.category && <span className="badge">{article.category}</span>}
        <span style={{ color: "var(--muted-2)", fontSize: ".82rem" }}>{date}</span>
      </div>
      <h1 style={{ margin: "0 0 1rem" }}>{article.title}</h1>
      {article.author_name && (
        <p style={{ color: "var(--muted)", marginBottom: "1.6rem" }}>Par {article.author_name}</p>
      )}

      {article.cover_url && (
        <div style={{ height: 340, borderRadius: 16, margin: "0 0 2rem", border: "1px solid var(--line-soft)",
                      background: `center/cover no-repeat url(${article.cover_url})`, backgroundColor: "var(--bg-2)" }} />
      )}

      {article.excerpt && (
        <p className="lead" style={{ marginBottom: "1.6rem", fontStyle: "italic" }}>{article.excerpt}</p>
      )}

      <article style={{ fontSize: "1.05rem", lineHeight: 1.8 }}>
        {(article.body ?? "").split("\n").filter(Boolean).map((p, idx) => (
          <p key={idx} style={{ marginBottom: "1.1rem", color: "var(--cream)" }}>{p}</p>
        ))}
      </article>
    </div>
  );
}
