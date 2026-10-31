"use client";

import { useCallback, useEffect, useState } from "react";

import { blogApi } from "@/lib/endpoints";
import { getMediaUrl } from "@/lib/api";
import type { Article, Paginated } from "@/lib/types";
import { Badge, Button, Card, Input, Textarea, errorMessage } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

const empty = { title: "", category: "", excerpt: "", cover_url: "", body: "", published: true };

// ── Formulaire article (modal) ────────────────────────────────────────────────

function ArticleFormModal({
  initial,
  editing,
  onClose,
  onSaved,
}: {
  initial: typeof empty;
  editing: number | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { toast } = useToast();
  const [form,    setForm]    = useState(initial);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        await blogApi.update(editing, form);
        onSaved("Article mis à jour.");
      } else {
        await blogApi.create(form);
        onSaved("Article créé.");
      }
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={editing ? "Modifier l'article" : "Nouvel article"}
      onClose={onClose}
      maxWidth={680}
    >
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 1rem" }}>
          <Input
            label="Titre" value={form.title} required
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <Input
            label="Catégorie" value={form.category}
            placeholder="Formation, Bien-être…"
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </div>
        <Input
          label="Image de couverture (URL)" value={form.cover_url}
          placeholder="https://…/cover.jpg"
          onChange={(e) => setForm({ ...form, cover_url: e.target.value })}
        />
        <Textarea
          label="Chapeau / résumé" value={form.excerpt} maxLength={280} minRows={2}
          placeholder="Accroche courte affichée dans la liste des articles…"
          onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
        />
        <Textarea
          label="Corps de l'article" value={form.body} minRows={10} showCount
          placeholder="Rédigez le contenu complet de l'article…"
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
        <label style={{ display: "flex", gap: ".5rem", alignItems: "center",
                        marginBottom: "1.25rem", fontSize: ".88rem", color: "var(--muted)" }}>
          <input
            type="checkbox" checked={form.published}
            onChange={(e) => setForm({ ...form, published: e.target.checked })}
          />
          Publié (visible sur la vitrine)
        </label>
        <div style={{ display: "flex", gap: ".6rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>Annuler</Button>
          <Button type="submit" loading={loading}>
            {editing ? "Enregistrer" : "Créer l'article"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BlogPage() {
  const { toast } = useToast();
  const [items,      setItems]      = useState<Article[]>([]);
  const [formTarget, setFormTarget] = useState<{ article: Article | null } | null>(null);
  const [deleteId,   setDeleteId]   = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await blogApi.list();
      const list = Array.isArray(data) ? data : (data as Paginated<Article>).results;
      setItems(list);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const togglePublish = async (a: Article) => {
    try { await blogApi.update(a.id, { published: !a.published }); await load(); }
    catch (e) { toast(errorMessage(e), "error"); }
  };

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Journal</div>
        <h1>Gestion du blog</h1>
        <p>{items.filter((a) => a.published).length} article{items.filter((a) => a.published).length !== 1 ? "s" : ""} publié{items.filter((a) => a.published).length !== 1 ? "s" : ""} · {items.filter((a) => !a.published).length} brouillon{items.filter((a) => !a.published).length !== 1 ? "s" : ""}</p>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1.25rem" }}>
        <Button onClick={() => setFormTarget({ article: null })}>+ Nouvel article</Button>
      </div>

      <div style={{ display: "grid", gap: "0.6rem" }}>
        {items.map((a) => (
          <Card key={a.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <div style={{ display: "flex", gap: "0.85rem", alignItems: "center", minWidth: 0 }}>
                <div style={{
                  width: 64, height: 44, borderRadius: 8, flexShrink: 0,
                  border: "1px solid var(--line-soft)",
                  background: a.cover_url
                    ? `center/cover no-repeat url(${getMediaUrl(a.cover_url)})`
                    : "var(--bg-2)",
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: ".2rem" }}>
                    {a.category && <Badge color="#a89b86">{a.category}</Badge>}
                    <Badge color={a.published ? "#5fb98a" : "#7d7264"}>
                      {a.published ? "Publié" : "Brouillon"}
                    </Badge>
                  </div>
                  <strong style={{ fontSize: ".9rem" }}>{a.title}</strong>
                  {a.excerpt && (
                    <p style={{ color: "var(--muted)", fontSize: ".78rem", margin: ".15rem 0 0",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 500 }}>
                      {a.excerpt}
                    </p>
                  )}
                </div>
              </div>
              <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                <Button variant="ghost" onClick={() => setFormTarget({ article: a })}>Éditer</Button>
                <Button variant="ghost" onClick={() => togglePublish(a)}>
                  {a.published ? "Dépublier" : "Publier"}
                </Button>
                <Button variant="danger" onClick={() => setDeleteId(a.id)}>Supprimer</Button>
              </span>
            </div>
          </Card>
        ))}
        {items.length === 0 && (
          <Card><p style={{ color: "var(--muted)" }}>Aucun article.</p></Card>
        )}
      </div>

      {/* Modale formulaire */}
      {formTarget && (
        <ArticleFormModal
          initial={
            formTarget.article
              ? {
                  title:     formTarget.article.title,
                  category:  formTarget.article.category,
                  excerpt:   formTarget.article.excerpt,
                  cover_url: formTarget.article.cover_url,
                  body:      formTarget.article.body,
                  published: formTarget.article.published,
                }
              : { ...empty }
          }
          editing={formTarget.article?.id ?? null}
          onClose={() => setFormTarget(null)}
          onSaved={(msg) => { toast(msg, "success"); setFormTarget(null); load(); }}
        />
      )}

      {/* Modale confirmation suppression */}
      {deleteId !== null && (
        <ConfirmModal
          title="Supprimer l'article"
          message="Cet article sera définitivement supprimé du blog."
          confirmLabel="Supprimer"
          onClose={() => setDeleteId(null)}
          onConfirm={async () => {
            await blogApi.remove(deleteId);
            toast("Article supprimé.", "success");
            setDeleteId(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
