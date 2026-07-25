"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { asList, formationApi } from "@/lib/endpoints";
import type { Formation, FormationStatus } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Select, errorMessage } from "@/components/ui";

const CATEGORY_LABEL: Record<string, string> = {
  FORMATION: "Formation", LIVRE: "Bibliothèque", LIBRE: "Accès libre",
};
const STATUS_LABEL: Record<FormationStatus, string> = {
  DRAFT: "Brouillon", SCHEDULED: "Programmé", PUBLISHED: "Publié",
};
const STATUS_COLOR: Record<FormationStatus, string> = {
  DRAFT: "#a89b86", SCHEDULED: "#d9a441", PUBLISHED: "#5fb98a",
};

const empty = {
  title: "", description: "", category: "FORMATION" as Formation["category"],
  reserved: true, status: "DRAFT" as FormationStatus, publish_at: "",
};

export default function ContenuPage() {
  const [items, setItems] = useState<Formation[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(() => {
    formationApi.list()
      .then((r) => setItems(asList(r.data)))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setInfo(""); setSaving(true);
    try {
      const payload: Partial<Formation> = {
        title: form.title, description: form.description, category: form.category,
        access_subscription_types: form.reserved ? ["MEMBRE"] : [],
        status: form.status,
        publish_at: form.status === "SCHEDULED" && form.publish_at
          ? new Date(form.publish_at).toISOString() : null,
      };
      await formationApi.create(payload);
      setForm({ ...empty });
      setInfo("Formation créée. Ouvrez-la pour ajouter modules, cours et QCM.");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const publish = async (f: Formation) => {
    try { await formationApi.publish(f.id); load(); }
    catch (e) { setError(errorMessage(e)); }
  };

  const remove = async (f: Formation) => {
    if (!confirm(`Dépublier la formation « ${f.title} » ?`)) return;
    try { await formationApi.remove(f.id); load(); }
    catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div>
      <h1 style={{ marginBottom: ".3rem" }}>Formations</h1>
      <p style={{ color: "var(--muted)", fontSize: ".9rem", marginBottom: "1.4rem" }}>
        Créez vos formations, puis organisez modules, cours, ressources et QCM.
      </p>

      <Alert>{error}</Alert>
      <Alert kind="success">{info}</Alert>

      {/* Création */}
      <Card style={{ marginBottom: "1.4rem" }}>
        <h2 style={{ fontSize: "1.05rem", marginBottom: "0.9rem" }}>Nouvelle formation</h2>
        <form onSubmit={create}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.8rem" }}>
            <Input label="Titre" value={form.title} required
                   onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Select label="Catégorie" value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as Formation["category"] })}>
              <option value="FORMATION">Formation</option>
              <option value="LIVRE">Bibliothèque</option>
              <option value="LIBRE">Accès libre</option>
            </Select>
          </div>
          <Input label="Description" value={form.description}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <Select label="Publication" value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as FormationStatus })}>
              <option value="DRAFT">Brouillon</option>
              <option value="SCHEDULED">Programmé (mise en ligne différée)</option>
              <option value="PUBLISHED">Publier maintenant</option>
            </Select>
            {form.status === "SCHEDULED" && (
              <Input label="Date de mise en ligne" type="datetime-local" value={form.publish_at}
                     onChange={(e) => setForm({ ...form, publish_at: e.target.value })} />
            )}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: ".5rem", margin: ".2rem 0 1rem", cursor: "pointer" }}>
            <input type="checkbox" checked={form.reserved}
                   onChange={(e) => setForm({ ...form, reserved: e.target.checked })} />
            <span style={{ fontSize: ".9rem" }}>Réservé aux membres (sinon accès public)</span>
          </label>

          <Button type="submit" loading={saving}>Créer la formation</Button>
        </form>
      </Card>

      {/* Liste */}
      <div style={{ display: "grid", gap: "0.7rem" }}>
        {items.length === 0 && <Card><p style={{ color: "var(--muted)" }}>Aucune formation.</p></Card>}
        {items.map((f) => (
          <Card key={f.id}>
            <div style={{ display: "flex", alignItems: "center", gap: ".7rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: "1.02rem" }}>{f.title}</strong>
                  <Badge color={STATUS_COLOR[f.status]}>{STATUS_LABEL[f.status]}</Badge>
                  <Badge>{CATEGORY_LABEL[f.category] ?? f.category}</Badge>
                  <Badge color={f.access_subscription_types.length ? "#d4673a" : "#5fb98a"}>
                    {f.access_subscription_types.length ? "Réservé" : "Public"}
                  </Badge>
                </div>
                <div style={{ fontSize: ".82rem", color: "var(--muted)", marginTop: 4 }}>
                  {f.module_count} module{f.module_count > 1 ? "s" : ""}
                  {f.status === "SCHEDULED" && f.publish_at && ` — en ligne le ${new Date(f.publish_at).toLocaleString("fr-FR")}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                <Link href={`/contenu/${f.id}`} className="btn btn-primary">Gérer le contenu</Link>
                {f.status !== "PUBLISHED" && (
                  <Button variant="ghost" onClick={() => publish(f)}>Publier</Button>
                )}
                <Button variant="danger" onClick={() => remove(f)}>Dépublier</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
