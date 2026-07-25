"use client";

import { useCallback, useEffect, useState } from "react";

import { blogApi } from "@/lib/endpoints";
import type { Article, Paginated } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, errorMessage } from "@/components/ui";

const empty = { title: "", category: "", excerpt: "", cover_url: "", body: "", published: true };

export default function BlogPage() {
  const [items, setItems] = useState<Article[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await blogApi.list();
      setItems(Array.isArray(data) ? data : (data as Paginated<Article>).results);
    } catch (e) { setError(errorMessage(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reset = () => { setForm({ ...empty }); setEditing(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setInfo("");
    try {
      if (editing) {
        await blogApi.update(editing, form);
        setInfo("Article mis à jour.");
      } else {
        await blogApi.create(form);
        setInfo("Article créé.");
      }
      reset();
      await load();
    } catch (e) { setError(errorMessage(e)); }
  };

  const edit = (a: Article) => {
    setEditing(a.id);
    setForm({ title: a.title, category: a.category, excerpt: a.excerpt,
              cover_url: a.cover_url, body: a.body, published: a.published });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const togglePublish = async (a: Article) => {
    try { await blogApi.update(a.id, { published: !a.published }); await load(); }
    catch (e) { setError(errorMessage(e)); }
  };

  const remove = async (id: number) => {
    if (!window.confirm("Supprimer définitivement cet article ?")) return;
    try { await blogApi.remove(id); await load(); } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div className="fade-up">
      <div className="eyebrow">Journal</div>
      <h1 style={{ marginBottom: "1.4rem" }}>Gestion du blog</h1>

      <Card style={{ marginBottom: "1.75rem" }}>
        <h2 style={{ fontSize: "1.15rem", marginBottom: "1rem" }}>
          {editing ? "Modifier l'article" : "Nouvel article"}
        </h2>
        <Alert>{error}</Alert>
        <Alert kind="success">{info}</Alert>
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 1rem" }}>
            <Input label="Titre" value={form.title} required
                   onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input label="Catégorie" value={form.category}
                   onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <Input label="Image de couverture (URL)" value={form.cover_url} placeholder="https://…/cover.jpg"
                 onChange={(e) => setForm({ ...form, cover_url: e.target.value })} />
          <Input label="Chapeau / résumé" value={form.excerpt}
                 onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
          <label style={{ display: "block", marginBottom: "0.85rem" }}>
            <span className="field-label">Corps de l&apos;article</span>
            <textarea value={form.body} rows={8} className="input" style={{ resize: "vertical", fontFamily: "var(--sans)" }}
                      onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </label>
          <label style={{ display: "flex", gap: ".5rem", alignItems: "center", marginBottom: "1rem",
                          fontSize: ".88rem", color: "var(--muted)" }}>
            <input type="checkbox" checked={form.published}
                   onChange={(e) => setForm({ ...form, published: e.target.checked })} />
            Publié (visible sur la vitrine)
          </label>
          <div style={{ display: "flex", gap: ".6rem" }}>
            <Button type="submit">{editing ? "Enregistrer" : "Créer l'article"}</Button>
            {editing && <Button type="button" variant="ghost" onClick={reset}>Annuler</Button>}
          </div>
        </form>
      </Card>

      <div style={{ display: "grid", gap: "0.6rem" }}>
        {items.map((a) => (
          <Card key={a.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <div style={{ display: "flex", gap: "0.85rem", alignItems: "center", minWidth: 0 }}>
                <div style={{ width: 64, height: 44, borderRadius: 8, flexShrink: 0,
                              border: "1px solid var(--line-soft)",
                              background: a.cover_url ? `center/cover no-repeat url(${a.cover_url})` : "var(--bg-2)" }} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                  {a.category && <Badge color="#a89b86">{a.category}</Badge>}
                  <strong>{a.title}</strong>
                  <Badge color={a.published ? "#5fb98a" : "#7d7264"}>{a.published ? "publié" : "brouillon"}</Badge>
                </div>
              </div>
              <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                <Button variant="ghost" onClick={() => edit(a)}>Éditer</Button>
                <Button variant="ghost" onClick={() => togglePublish(a)}>
                  {a.published ? "Dépublier" : "Publier"}
                </Button>
                <Button variant="danger" onClick={() => remove(a.id)}>Supprimer</Button>
              </span>
            </div>
          </Card>
        ))}
        {items.length === 0 && <Card><p style={{ color: "var(--muted)" }}>Aucun article.</p></Card>}
      </div>
    </div>
  );
}
