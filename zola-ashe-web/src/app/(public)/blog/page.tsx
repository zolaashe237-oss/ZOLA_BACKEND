"use client";

import { useEffect, useState } from "react";

import { blogApi } from "@/lib/endpoints";
import type { Article } from "@/lib/types";
import { ArticleCard } from "@/components/landing/BlogTeaser";

export default function BlogListPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    blogApi.list()
      .then((r) => setArticles(Array.isArray(r.data) ? r.data : r.data.results))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container" style={{ padding: "3.5rem 1.5rem" }}>
      <div className="eyebrow">Le journal</div>
      <h1 style={{ margin: ".5rem 0 .6rem" }}>Inspirations & enseignements</h1>
      <p className="lead" style={{ maxWidth: 620, marginBottom: "2.5rem" }}>
        Articles, réflexions et nouvelles de la communauté ZOLA ASHÉ.
      </p>

      {loading ? (
        <p style={{ color: "var(--muted)" }}>Chargement…</p>
      ) : articles.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Aucun article pour le moment.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: "1.3rem" }}>
          {articles.map((a) => <ArticleCard key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}
