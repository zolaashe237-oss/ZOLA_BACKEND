"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { blogApi } from "@/lib/endpoints";
import type { Article } from "@/lib/types";

function normalize(data: Article[] | { results: Article[] }): Article[] {
  return Array.isArray(data) ? data : data.results;
}

export function ArticleCard({ a }: { a: Article }) {
  const date = a.published_at ? new Date(a.published_at).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  }) : "";
  return (
    <Link href={`/blog/${a.slug}`} className="card card-hover" style={{ padding: 0, overflow: "hidden", display: "block" }}>
      <div style={{ height: 170, background: `center/cover no-repeat url(${a.cover_url})`,
                    backgroundColor: "var(--bg-2)" }} />
      <div style={{ padding: "1.1rem 1.2rem 1.3rem" }}>
        {a.category && <span className="badge" style={{ marginBottom: ".7rem" }}>{a.category}</span>}
        <h3 style={{ fontSize: "1.25rem", margin: ".2rem 0 .5rem" }}>{a.title}</h3>
        <p style={{ color: "var(--muted)", fontSize: ".92rem", marginBottom: ".8rem" }}>{a.excerpt}</p>
        <span style={{ color: "var(--muted-2)", fontSize: ".8rem" }}>{date}</span>
      </div>
    </Link>
  );
}

export function BlogTeaser() {
  const [articles, setArticles] = useState<Article[]>([]);

  useEffect(() => {
    blogApi.list().then((r) => setArticles(normalize(r.data).slice(0, 3))).catch(() => {});
  }, []);

  if (articles.length === 0) return null;

  return (
    <section id="journal" className="container" style={{ padding: "4rem 1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
                    marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div className="eyebrow">Le journal</div>
          <h2 style={{ margin: ".5rem 0 0" }}>Inspirations & enseignements</h2>
        </div>
        <Link href="/blog" className="btn btn-ghost">Tout le journal →</Link>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.2rem" }}>
        {articles.map((a) => <ArticleCard key={a.id} a={a} />)}
      </div>
    </section>
  );
}
