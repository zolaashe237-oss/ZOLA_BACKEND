"use client";

import { useCallback, useEffect, useState } from "react";

import { communityApi, notificationsAdminApi } from "@/lib/endpoints";
import type { Branche, CommunityChannel, CommunityPost, Paginated, PostStatus, PostType } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Select, Textarea, errorMessage } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

const POST_TYPE_COLOR: Record<PostType, string>   = { ANNONCE: "#c9a227", DISCUSSION: "#5fb98a", QUESTION: "#243a85" };
const POST_TYPE_LABEL: Record<PostType, string>   = { ANNONCE: "Annonce", DISCUSSION: "Discussion", QUESTION: "Question" };
const POST_STATUS_COLOR: Record<PostStatus, string> = { PUBLIE: "#5fb98a", MODERE: "#d9a441", ARCHIVE: "#7d7264" };
const BRANCHE_COLOR: Record<string, string>      = { MEMBRE: "#c9a227", GENERALE: "#c9a227", FEMME: "#b5532a", ENFANT: "#5fb98a" };
const CHANNEL_COLORS = ["#c9a227", "#b5532a", "#5fb98a", "#243a85", "#d9a441", "#a89b86"];

const emptyPost    = { title: "", body: "", type: "ANNONCE" as PostType, channel: null as number | null, is_pinned: false };
const emptyChannel = { name: "", description: "", branche: "MEMBRE" as Branche, color: "#c9a227", is_active: true };

type Tab = "annonces" | "canaux" | "posts" | "notifications";

// ── Modal formulaire Post ─────────────────────────────────────────────────────

function PostFormModal({
  initial, editing, channels, onClose, onSaved,
}: {
  initial: typeof emptyPost;
  editing: number | null;
  channels: CommunityChannel[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [form,    setForm]    = useState(initial);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const payload = { ...form, is_admin_post: true };
      if (editing) { await communityApi.updatePost(editing, payload); onSaved("Post mis à jour."); }
      else         { await communityApi.createPost(payload);          onSaved("Annonce publiée."); }
      onClose();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title={editing ? "Modifier l'annonce" : "Nouvelle annonce / post admin"} onClose={onClose} maxWidth={620}>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0 1rem" }}>
          <Input label="Titre" value={form.title} required
                 onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Select label="Type" value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as PostType })}>
            <option value="ANNONCE">Annonce</option>
            <option value="DISCUSSION">Discussion</option>
            <option value="QUESTION">Question</option>
          </Select>
          <Select label="Canal" value={form.channel ?? ""}
                  onChange={(e) => setForm({ ...form, channel: e.target.value ? +e.target.value : null })}>
            <option value="">— Aucun canal —</option>
            {channels.filter((c) => c.is_active).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <label style={{ display: "block", marginBottom: "0.85rem" }}>
          <span className="field-label">Contenu</span>
          <textarea value={form.body} rows={5} required className="input"
                    style={{ resize: "vertical", fontFamily: "var(--sans)" }}
                    onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
        <label style={{ display: "flex", gap: ".5rem", alignItems: "center",
                        marginBottom: "1.25rem", fontSize: ".88rem", color: "var(--muted)" }}>
          <input type="checkbox" checked={form.is_pinned}
                 onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })} />
          Épingler ce post (visible en tête de la communauté)
        </label>
        <div style={{ display: "flex", gap: ".6rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>Annuler</Button>
          <Button type="submit" loading={loading}>{editing ? "Enregistrer" : "Publier"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal formulaire Canal ────────────────────────────────────────────────────

function ChannelFormModal({
  initial, editing, onClose, onSaved,
}: {
  initial: typeof emptyChannel;
  editing: number | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [form,    setForm]    = useState(initial);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      if (editing) { await communityApi.updateChannel(editing, form); onSaved("Canal mis à jour."); }
      else         { await communityApi.createChannel(form);          onSaved("Canal créé."); }
      onClose();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title={editing ? "Modifier le canal" : "Nouveau canal"} onClose={onClose} maxWidth={520}>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 1rem" }}>
          <Input label="Nom du canal" value={form.name} required
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select label="Branche" value={form.branche}
                  onChange={(e) => setForm({ ...form, branche: e.target.value as Branche })}>
            <option value="MEMBRE">Membres</option>
            <option value="FEMME">Femme</option>
            <option value="ENFANT">Enfant</option>
          </Select>
        </div>
        <Textarea
          label="Description" value={form.description} maxLength={300} minRows={2}
          placeholder="À quoi sert ce canal ? Décrivez son rôle dans la communauté…"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <div style={{ marginBottom: "0.85rem" }}>
          <span className="field-label">Couleur du canal</span>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
            {CHANNEL_COLORS.map((c) => (
              <button key={c} type="button"
                      onClick={() => setForm({ ...form, color: c })}
                      style={{ width: 28, height: 28, borderRadius: "50%", background: c, cursor: "pointer", flexShrink: 0,
                               border: form.color === c ? "3px solid var(--cream)" : "3px solid transparent" }} />
            ))}
            <input type="color" value={form.color}
                   style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: "none", cursor: "pointer", padding: 0 }}
                   onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </div>
        </div>
        <label style={{ display: "flex", gap: ".5rem", alignItems: "center",
                        marginBottom: "1.25rem", fontSize: ".88rem", color: "var(--muted)" }}>
          <input type="checkbox" checked={form.is_active}
                 onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Canal actif (visible aux membres)
        </label>
        <div style={{ display: "flex", gap: ".6rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>Annuler</Button>
          <Button type="submit" loading={loading}>{editing ? "Enregistrer" : "Créer le canal"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Panneau broadcast notifications système ───────────────────────────────────

function BroadcastPanel({ onDone }: { onDone: (msg: string) => void }) {
  const [title,      setTitle]      = useState("");
  const [body,       setBody]       = useState("");
  const [target,     setTarget]     = useState<"all" | "one">("all");
  const [userId,     setUserId]     = useState("");
  const [loading,    setLoading]    = useState(false);
  const { toast } = useToast();

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const payload: { title: string; body?: string; user_id?: number } = { title };
      if (body.trim())           payload.body    = body.trim();
      if (target === "one" && userId) payload.user_id = parseInt(userId, 10);
      const { data } = await notificationsAdminApi.broadcast(payload);
      const n = data.sent;
      const msg = n === 0
        ? "Aucun membre actif trouvé pour cette cible."
        : `${n} notification${n > 1 ? "s" : ""} envoyée${n > 1 ? "s" : ""}.`;
      toast(msg, "success");
      onDone(msg);
      setTitle(""); setBody(""); setTarget("all"); setUserId("");
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setLoading(false); }
  };

  return (
    <Card style={{ maxWidth: 640 }}>
      <h3 style={{ marginTop: 0, marginBottom: "1.25rem", fontSize: "1rem", fontWeight: 700 }}>
        Envoyer une notification système
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.83rem", marginBottom: "1.25rem" }}>
        La notification apparaît dans la cloche de chaque membre ciblé en temps réel.
      </p>
      <form onSubmit={send}>
        <Input
          label="Titre *"
          value={title}
          required
          placeholder="Ex : Maintenance prévue ce soir à 21h"
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label="Message (optionnel)"
          value={body}
          minRows={3}
          placeholder="Détails supplémentaires…"
          onChange={(e) => setBody(e.target.value)}
        />

        <div style={{ marginBottom: "1.25rem" }}>
          <span className="field-label">Destinataires</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.4rem" }}>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
              <input type="radio" name="target" value="all" checked={target === "all"}
                     onChange={() => { setTarget("all"); setUserId(""); }} />
              Tous les membres actifs
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
              <input type="radio" name="target" value="one" checked={target === "one"}
                     onChange={() => setTarget("one")} />
              Membre spécifique (ID)
            </label>
          </div>
          {target === "one" && (
            <input
              className="input" type="number" min={1} placeholder="ID du membre"
              value={userId} required={target === "one"}
              style={{ marginTop: "0.5rem", maxWidth: 180 }}
              onChange={(e) => setUserId(e.target.value)}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="submit" loading={loading}>Envoyer la notification</Button>
        </div>
      </form>
    </Card>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function CommunautePage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("annonces");
  const [posts,    setPosts]    = useState<CommunityPost[]>([]);
  const [channels, setChannels] = useState<CommunityChannel[]>([]);

  // Modals
  const [postTarget,    setPostTarget]    = useState<{ post: CommunityPost | null } | null>(null);
  const [channelTarget, setChannelTarget] = useState<{ chan: CommunityChannel | null } | null>(null);
  const [deletePost,    setDeletePost]    = useState<number | null>(null);
  const [deleteChan,    setDeleteChan]    = useState<number | null>(null);
  const [moderatePost,  setModeratePost]  = useState<CommunityPost | null>(null);

  // Filtres posts
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterSearch, setFilterSearch] = useState("");

  const loadChannels = useCallback(async () => {
    try {
      const { data } = await communityApi.listChannels();
      setChannels(Array.isArray(data) ? data : (data as Paginated<CommunityChannel>).results);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [toast]);

  const loadPosts = useCallback(async () => {
    try {
      const { data } = await communityApi.listPosts();
      setPosts(Array.isArray(data) ? data : (data as Paginated<CommunityPost>).results);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [toast]);

  useEffect(() => { loadChannels(); loadPosts(); }, [loadChannels, loadPosts]);

  const pinPost = async (p: CommunityPost) => {
    try { await communityApi.pinPost(p.id); await loadPosts(); }
    catch (e) { toast(errorMessage(e), "error"); }
  };

  const filteredPosts = posts.filter(
    (p) =>
      (filterStatus === "ALL" || p.status === filterStatus) &&
      (!filterSearch ||
        p.title.toLowerCase().includes(filterSearch.toLowerCase()) ||
        (p.author_name ?? "").toLowerCase().includes(filterSearch.toLowerCase()))
  );

  const tabStyle = (key: Tab) => ({
    padding: "0.55rem 1.15rem", borderRadius: "var(--radius-sm)",
    fontSize: "0.85rem", fontWeight: 600 as const, border: "none", cursor: "pointer" as const,
    background:   activeTab === key ? "rgba(201,162,39,0.14)" : "transparent",
    color:        activeTab === key ? "var(--gold-2)" : "var(--muted)",
    borderBottom: activeTab === key ? "2px solid var(--gold)" : "2px solid transparent",
  });

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Espace membre</div>
        <h1>Communauté</h1>
        <p>Animez la communauté, gérez les canaux et modérez les posts des membres.</p>
      </div>

      {/* Onglets */}
      <div style={{ display: "flex", gap: "0.15rem", marginBottom: "1.75rem",
                    borderBottom: "1px solid var(--line-soft)" }}>
        {([
          { key: "annonces"      as Tab, label: "Annonces admin" },
          { key: "canaux"        as Tab, label: "Canaux" },
          { key: "posts"         as Tab, label: `Posts récents (${posts.length})` },
          { key: "notifications" as Tab, label: "Notifications système" },
        ]).map((t) => (
          <button key={t.key} style={tabStyle(t.key)}
                  onClick={() => { setActiveTab(t.key); }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ONGLET 1 : ANNONCES ADMIN ── */}
      {activeTab === "annonces" && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1.1rem" }}>
            <Button onClick={() => setPostTarget({ post: null })}>+ Nouvelle annonce</Button>
          </div>
          <div style={{ display: "grid", gap: "0.65rem" }}>
            {posts.filter((p) => p.is_admin_post).map((p) => (
              <Card key={p.id} style={{ borderLeft: `3px solid ${POST_TYPE_COLOR[p.type]}`, paddingLeft: "1.35rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: "0.45rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.35rem" }}>
                      {p.is_pinned && <span style={{ color: "var(--gold)", fontSize: "0.82rem" }}>📌 Épinglé</span>}
                      <Badge color={POST_TYPE_COLOR[p.type]}>{POST_TYPE_LABEL[p.type]}</Badge>
                      <Badge color={POST_STATUS_COLOR[p.status]}>
                        {p.status === "PUBLIE" ? "Publié" : p.status === "MODERE" ? "Modéré" : "Archivé"}
                      </Badge>
                      {channels.find((c) => c.id === p.channel) && (
                        <Badge color={channels.find((c) => c.id === p.channel)!.color}>
                          {channels.find((c) => c.id === p.channel)!.name}
                        </Badge>
                      )}
                    </div>
                    <strong style={{ fontSize: "1rem", display: "block", marginBottom: "0.25rem" }}>{p.title}</strong>
                    <p style={{ color: "var(--muted)", fontSize: "0.83rem", margin: "0 0 0.45rem",
                                overflow: "hidden", textOverflow: "ellipsis",
                                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {p.body}
                    </p>
                    <span style={{ fontSize: "0.75rem", color: "var(--muted-2)" }}>
                      {new Date(p.created_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                      {" · "}{p.comment_count} commentaire{p.comment_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                    <Button variant="ghost" onClick={() => pinPost(p)}>
                      {p.is_pinned ? "Désépingler" : "Épingler"}
                    </Button>
                    <Button variant="ghost" onClick={() => setPostTarget({ post: p })}>Éditer</Button>
                    <Button variant="danger" onClick={() => setDeletePost(p.id)}>Supprimer</Button>
                  </span>
                </div>
              </Card>
            ))}
            {posts.filter((p) => p.is_admin_post).length === 0 && (
              <Card>
                <p style={{ color: "var(--muted)", textAlign: "center", padding: "1rem 0" }}>
                  Aucune annonce publiée par l&apos;admin.
                </p>
              </Card>
            )}
          </div>
        </>
      )}

      {/* ── ONGLET 2 : CANAUX ── */}
      {activeTab === "canaux" && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1.1rem" }}>
            <Button onClick={() => setChannelTarget({ chan: null })}>+ Nouveau canal</Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))", gap: "0.75rem" }}>
            {channels.map((c) => (
              <Card key={c.id} style={{ borderLeft: `3px solid ${c.color}`, paddingLeft: "1.25rem", opacity: c.is_active ? 1 : 0.6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                  <strong style={{ fontSize: "0.95rem" }}>{c.name}</strong>
                  <Badge color={BRANCHE_COLOR[c.branche]}>{c.branche}</Badge>
                </div>
                {c.description && (
                  <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: "0.5rem" }}>{c.description}</p>
                )}
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center",
                              fontSize: "0.75rem", color: "var(--muted-2)", marginBottom: "0.75rem" }}>
                  <span>{c.post_count} post{c.post_count !== 1 ? "s" : ""}</span>
                  {!c.is_active && <Badge color="#7d7264">Masqué</Badge>}
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <Button variant="ghost" onClick={() => setChannelTarget({ chan: c })}>Éditer</Button>
                  <Button variant="danger" onClick={() => setDeleteChan(c.id)}>Supprimer</Button>
                </div>
              </Card>
            ))}
            {channels.length === 0 && (
              <Card style={{ gridColumn: "1/-1" }}>
                <p style={{ color: "var(--muted)", textAlign: "center", padding: "1rem 0" }}>Aucun canal créé.</p>
              </Card>
            )}
          </div>
        </>
      )}

      {/* ── ONGLET 3 : POSTS RÉCENTS ── */}
      {activeTab === "posts" && (
        <>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" placeholder="Rechercher titre ou auteur…"
                   value={filterSearch} style={{ flex: 1, minWidth: 180, maxWidth: 300 }}
                   onChange={(e) => setFilterSearch(e.target.value)} />
            <select className="select" value={filterStatus} style={{ width: 160 }}
                    onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="ALL">Tous les statuts</option>
              <option value="PUBLIE">Publiés</option>
              <option value="MODERE">Modérés</option>
              <option value="ARCHIVE">Archivés</option>
            </select>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
              {filteredPosts.length} post{filteredPosts.length !== 1 ? "s" : ""}
            </span>
          </div>

          <Card>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Auteur</th>
                  <th>Canal</th>
                  <th>Statut</th>
                  <th>Activité</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPosts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 280 }}>
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.2rem" }}>
                        {p.is_pinned && <span title="Épinglé" style={{ color: "var(--gold)", fontSize: "0.8rem" }}>📌</span>}
                        {p.is_admin_post && <Badge color="#c9a227">Admin</Badge>}
                        <Badge color={POST_TYPE_COLOR[p.type]}>{POST_TYPE_LABEL[p.type]}</Badge>
                      </div>
                      <strong style={{ fontSize: "0.88rem" }}>{p.title}</strong>
                    </td>
                    <td style={{ fontSize: "0.83rem", color: "var(--muted)" }}>
                      {p.author_name}
                      {p.author_email && <div style={{ fontSize: "0.75rem", color: "var(--muted-2)" }}>{p.author_email}</div>}
                    </td>
                    <td>
                      {p.channel_name
                        ? <Badge color={channels.find((c) => c.id === p.channel)?.color ?? "#a89b86"}>{p.channel_name}</Badge>
                        : <span style={{ color: "var(--muted-2)", fontSize: "0.78rem" }}>—</span>}
                    </td>
                    <td>
                      <Badge color={POST_STATUS_COLOR[p.status]}>
                        {p.status === "PUBLIE" ? "Publié" : p.status === "MODERE" ? "Modéré" : "Archivé"}
                      </Badge>
                    </td>
                    <td style={{ fontSize: "0.78rem", color: "var(--muted-2)", whiteSpace: "nowrap" }}>
                      <div>{p.comment_count} commentaire{p.comment_count !== 1 ? "s" : ""}</div>
                      {p.report_count > 0 && (
                        <div style={{ color: "#cf5a3c", fontWeight: 600 }}>⚠ {p.report_count} signalement{p.report_count !== 1 ? "s" : ""}</div>
                      )}
                      <div style={{ color: "var(--muted-2)" }}>{new Date(p.created_at).toLocaleDateString("fr-FR")}</div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                        <Button variant="ghost" onClick={() => pinPost(p)}>
                          {p.is_pinned ? "Désépingler" : "Épingler"}
                        </Button>
                        {p.status === "PUBLIE" && (
                          <Button variant="ghost" onClick={() => setModeratePost(p)}>Modérer</Button>
                        )}
                        {!p.is_admin_post && (
                          <Button variant="ghost" onClick={() => setPostTarget({ post: p })}>Éditer</Button>
                        )}
                        <Button variant="danger" onClick={() => setDeletePost(p.id)}>Suppr.</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredPosts.length === 0 && (
              <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.25rem 0" }}>
                Aucun post trouvé.
              </p>
            )}
          </Card>
        </>
      )}

      {/* ── ONGLET 4 : NOTIFICATIONS SYSTÈME ── */}
      {activeTab === "notifications" && (
        <BroadcastPanel onDone={(msg) => toast(msg, "success")} />
      )}

      {/* ── Modales ── */}

      {postTarget && (
        <PostFormModal
          initial={postTarget.post
            ? { title: postTarget.post.title, body: postTarget.post.body, type: postTarget.post.type,
                channel: postTarget.post.channel, is_pinned: postTarget.post.is_pinned }
            : { ...emptyPost }}
          editing={postTarget.post?.id ?? null}
          channels={channels}
          onClose={() => setPostTarget(null)}
          onSaved={(msg) => { toast(msg, "success"); setPostTarget(null); loadPosts(); }}
        />
      )}

      {channelTarget && (
        <ChannelFormModal
          initial={channelTarget.chan
            ? { name: channelTarget.chan.name, description: channelTarget.chan.description,
                branche: channelTarget.chan.branche, color: channelTarget.chan.color, is_active: channelTarget.chan.is_active }
            : { ...emptyChannel }}
          editing={channelTarget.chan?.id ?? null}
          onClose={() => setChannelTarget(null)}
          onSaved={(msg) => { toast(msg, "success"); setChannelTarget(null); loadChannels(); }}
        />
      )}

      {deletePost !== null && (
        <ConfirmModal
          title="Supprimer ce post"
          message="Le post sera définitivement supprimé pour tous les membres."
          confirmLabel="Supprimer"
          onClose={() => setDeletePost(null)}
          onConfirm={async () => {
            await communityApi.removePost(deletePost);
            toast("Post supprimé.", "success");
            setDeletePost(null);
            await loadPosts();
          }}
        />
      )}

      {deleteChan !== null && (
        <ConfirmModal
          title="Supprimer ce canal"
          message="Le canal et tous ses posts associés seront supprimés."
          confirmLabel="Supprimer"
          onClose={() => setDeleteChan(null)}
          onConfirm={async () => {
            await communityApi.removeChannel(deleteChan);
            toast("Canal supprimé.", "success");
            setDeleteChan(null);
            await loadChannels();
          }}
        />
      )}

      {moderatePost !== null && (
        <ConfirmModal
          title="Modérer ce post"
          message={`Post de ${moderatePost.author_name} — "${moderatePost.title}"`}
          withReason
          reasonLabel="Motif de modération"
          confirmLabel="Modérer"
          variant="primary"
          onClose={() => setModeratePost(null)}
          onConfirm={async (reason) => {
            await communityApi.moderatePost(moderatePost.id, reason);
            toast("Post modéré.", "success");
            setModeratePost(null);
            await loadPosts();
          }}
        />
      )}
    </div>
  );
}
