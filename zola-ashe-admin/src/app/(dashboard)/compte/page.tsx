"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { adminAccountApi, socialLinksApi } from "@/lib/endpoints";
import type { Paginated, SocialLinksConfig, User } from "@/lib/types";
import { Badge, Button, Card, Input, errorMessage } from "@/components/ui";
import { ConfirmModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

// ── Helpers visuels ───────────────────────────────────────────────────────────

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function Avatar({ user, size = 64 }: { user: User; size?: number }) {
  const fontSize = size * 0.34;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: user.photo
          ? `center/cover no-repeat url(${user.photo})`
          : "rgba(201,162,39,0.18)",
        border: "2px solid rgba(201,162,39,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize,
        fontWeight: 700,
        color: "var(--gold-2)",
        flexShrink: 0,
      }}
    >
      {!user.photo && initials(user.full_name || user.email)}
    </div>
  );
}

type Tab = "profil" | "equipe" | "reseaux";

// ── Composant principal ───────────────────────────────────────────────────────

export default function ComptePage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("profil");

  // ── État onglet Profil ─────────────────────────────────────────────────────
  const [profileForm, setProfileForm] = useState({
    full_name: user?.full_name ?? "",
    email:     user?.email     ?? "",
  });
  const [pwdForm, setPwdForm] = useState({
    current_password: "",
    new_password:     "",
    confirm_password: "",
  });
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);

  // Sync quand user change (après refreshUser)
  useEffect(() => {
    if (user) setProfileForm({ full_name: user.full_name, email: user.email });
  }, [user]);

  // ── État onglet Équipe ─────────────────────────────────────────────────────
  const [admins,       setAdmins]       = useState<User[]>([]);
  const [createForm,   setCreateForm]   = useState({
    email:          "",
    full_name:      "",
    password:       "",
    is_super_admin: false,
  });
  const [editingAdmin, setEditingAdmin] = useState<User | null>(null);
  const [editForm,     setEditForm]     = useState({ full_name: "", email: "" });
  const [tempPwd,         setTempPwd]         = useState<{ id: number; pwd: string } | null>(null);
  const [tempPwdVisible,  setTempPwdVisible]  = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [resetPwdTarget,   setResetPwdTarget]   = useState<User | null>(null);
  const [deleteTarget,     setDeleteTarget]     = useState<User | null>(null);

  // ── État onglet Réseaux sociaux ───────────────────────────────────────────
  const [socialForm, setSocialForm] = useState<SocialLinksConfig>({
    facebook_url: "", instagram_url: "", youtube_url: "", tiktok_url: "",
  });
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialSaving,  setSocialSaving]  = useState(false);

  const loadAdmins = useCallback(async () => {
    try {
      const { data } = await adminAccountApi.listAdmins();
      setAdmins(Array.isArray(data) ? data : (data as Paginated<User>).results);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [toast]);

  useEffect(() => {
    if (activeTab === "equipe") loadAdmins();
  }, [activeTab, loadAdmins]);

  useEffect(() => {
    if (activeTab !== "reseaux") return;
    setSocialLoading(true);
    socialLinksApi.get()
      .then((r) => setSocialForm(r.data))
      .catch((e) => {})
      .finally(() => setSocialLoading(false));
  }, [activeTab]);

  // ── Actions Profil ─────────────────────────────────────────────────────────

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminAccountApi.updateMe(profileForm);
      await refreshUser();
      toast("Profil mis à jour.", "success");
    } catch (e) { toast(errorMessage(e), "error"); }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwdForm.new_password !== pwdForm.confirm_password) {
      toast("Les mots de passe ne correspondent pas.", "error");
      return;
    }
    if (pwdForm.new_password.length < 8) {
      toast("Le mot de passe doit contenir au moins 8 caractères.", "error");
      return;
    }
    try {
      await adminAccountApi.changePassword({
        current_password: pwdForm.current_password,
        new_password:     pwdForm.new_password,
      });
      setPwdForm({ current_password: "", new_password: "", confirm_password: "" });
      toast("Mot de passe mis à jour.", "success");
    } catch (e) { toast(errorMessage(e), "error"); }
  };

  const uploadAvatar = async (file: File) => {
    setAvatarUploading(true);
    try {
      await adminAccountApi.uploadAvatar(file);
      await refreshUser();
      toast("Photo mise à jour.", "success");
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setAvatarUploading(false); }
  };

  // ── Actions Équipe ─────────────────────────────────────────────────────────

  const createAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setTempPwd(null);
    try {
      await adminAccountApi.createAdmin(createForm);
      toast(`Compte admin créé pour ${createForm.email}.`, "success");
      setCreateForm({ email: "", full_name: "", password: "", is_super_admin: false });
      await loadAdmins();
    } catch (e) { toast(errorMessage(e), "error"); }
  };

  const saveEditAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdmin) return;
    try {
      await adminAccountApi.updateAdmin(editingAdmin.id, editForm);
      toast("Admin mis à jour.", "success");
      setEditingAdmin(null);
      await loadAdmins();
    } catch (e) { toast(errorMessage(e), "error"); }
  };

  const toggleAdmin = async (admin: User) => {
    if (admin.status === "ACTIF") {
      setDeactivateTarget(admin);
    } else {
      try {
        await adminAccountApi.activateAdmin(admin.id);
        toast(`${admin.full_name} réactivé.`, "success");
        await loadAdmins();
      } catch (e) { toast(errorMessage(e), "error"); }
    }
  };


  const saveSocialLinks = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = Object.values(socialForm)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .some((v) => !v.startsWith("http://") && !v.startsWith("https://"));
    if (invalid) {
      toast("Chaque lien renseigné doit commencer par http:// ou https://.", "error");
      return;
    }
    setSocialSaving(true);
    try {
      const { data } = await socialLinksApi.update(socialForm);
      setSocialForm(data);
      toast("Liens de réseaux sociaux mis à jour.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSocialSaving(false);
    }
  };

  // ── Style onglets ─────────────────────────────────────────────────────────

  const tabStyle = (key: Tab) => ({
    padding:      "0.55rem 1.15rem",
    borderRadius: "var(--radius-sm)",
    fontSize:     "0.85rem",
    fontWeight:   600 as const,
    border:       "none",
    cursor:       "pointer" as const,
    background:   activeTab === key ? "rgba(201,162,39,0.14)" : "transparent",
    color:        activeTab === key ? "var(--gold-2)" : "var(--muted)",
    borderBottom: activeTab === key ? "2px solid var(--gold)" : "2px solid transparent",
  });

  if (!user) return null;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="fade-up">
      {/* ── Header avec avatar proéminent ── */}
      <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", marginBottom: "1.75rem" }}>
        <div style={{ position: "relative" }}>
          <Avatar user={user} size={72} />
          <button
            title="Changer la photo"
            onClick={() => avatarRef.current?.click()}
            disabled={avatarUploading}
            style={{
              position: "absolute", bottom: 0, right: 0,
              width: 24, height: 24, borderRadius: "50%",
              background: "var(--gold)", border: "2px solid var(--bg)",
              cursor: "pointer", fontSize: "0.65rem", color: "#0a0806",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700,
            }}
          >
            {avatarUploading ? "…" : "✎"}
          </button>
          <input
            type="file"
            accept="image/*"
            ref={avatarRef}
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }}
          />
        </div>
        <div>
          <div className="eyebrow">Administrateur</div>
          <h1 style={{ margin: 0, fontFamily: "var(--serif)", fontSize: "1.6rem" }}>
            {user.full_name || user.email}
          </h1>
          <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: "0.2rem" }}>
            {user.email}
            {user.last_login && (
              <span style={{ marginLeft: "1rem", color: "var(--muted-2)" }}>
                Dernière connexion :{" "}
                {new Date(user.last_login).toLocaleString("fr-FR", {
                  dateStyle: "medium", timeStyle: "short",
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Onglets ── */}
      <div style={{ display: "flex", gap: "0.15rem", marginBottom: "1.75rem",
                    borderBottom: "1px solid var(--line-soft)" }}>
        <button style={tabStyle("profil")}
                onClick={() => { setActiveTab("profil"); }}>
          Mon profil
        </button>
        <button style={tabStyle("equipe")}
                onClick={() => { setActiveTab("equipe"); }}>
          Équipe admin
        </button>
        <button style={tabStyle("reseaux")}
                onClick={() => { setActiveTab("reseaux"); }}>
          Réseaux sociaux
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          ONGLET 1 — MON PROFIL
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "profil" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem",
                      alignItems: "start" }}>
          {/* Informations générales */}
          <Card>
            <h2 style={{ fontFamily: "var(--serif)", fontSize: "1.1rem", marginBottom: "1rem" }}>
              Informations générales
            </h2>
            <form onSubmit={saveProfile}>
              <Input
                label="Nom complet"
                value={profileForm.full_name}
                required
                onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
              />
              <Input
                label="Adresse e-mail"
                type="email"
                value={profileForm.email}
                required
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
              />
              {/* Infos en lecture seule */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem",
                            marginBottom: "1rem" }}>
                <div style={{ padding: "0.55rem 0.75rem", background: "var(--bg-2)",
                              borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--muted-2)",
                                textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Rôle
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--cream)", marginTop: "0.2rem" }}>
                    <Badge color="#c9a227">Administrateur</Badge>
                  </div>
                </div>
                <div style={{ padding: "0.55rem 0.75rem", background: "var(--bg-2)",
                              borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--muted-2)",
                                textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Statut
                  </div>
                  <div style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
                    <Badge color="#5fb98a">Actif</Badge>
                  </div>
                </div>
              </div>
              <Button type="submit">Enregistrer</Button>
            </form>
          </Card>

          {/* Changer le mot de passe */}
          <Card>
            <h2 style={{ fontFamily: "var(--serif)", fontSize: "1.1rem", marginBottom: "1rem" }}>
              Changer le mot de passe
            </h2>
            <form onSubmit={changePassword}>
              <Input
                label="Mot de passe actuel"
                type="password"
                value={pwdForm.current_password}
                required
                autoComplete="current-password"
                onChange={(e) => setPwdForm({ ...pwdForm, current_password: e.target.value })}
              />
              <Input
                label="Nouveau mot de passe"
                type="password"
                value={pwdForm.new_password}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Minimum 8 caractères"
                onChange={(e) => setPwdForm({ ...pwdForm, new_password: e.target.value })}
              />
              <Input
                label="Confirmer le nouveau mot de passe"
                type="password"
                value={pwdForm.confirm_password}
                required
                autoComplete="new-password"
                onChange={(e) => setPwdForm({ ...pwdForm, confirm_password: e.target.value })}
              />
              {/* Indicateur de force */}
              {pwdForm.new_password.length > 0 && (
                <div style={{ marginBottom: "0.85rem" }}>
                  <PasswordStrength password={pwdForm.new_password} />
                </div>
              )}
              <Button type="submit">Mettre à jour</Button>
            </form>
          </Card>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          ONGLET 2 — ÉQUIPE ADMIN
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "equipe" && (
        <>

          {/* Mot de passe temporaire généré */}
          {tempPwd && (
            <div style={{ background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.38)",
                          borderRadius: "var(--radius)", padding: "0.85rem 1.1rem",
                          marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                <strong style={{ fontSize: "0.82rem", color: "var(--gold-2)" }}>Mot de passe temporaire généré</strong>
                <button onClick={() => { setTempPwd(null); setTempPwdVisible(false); }} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--muted)", fontSize: "0.8rem", padding: "0 0.25rem",
                }}>✕</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  readOnly
                  type={tempPwdVisible ? "text" : "password"}
                  value={tempPwd.pwd}
                  style={{
                    fontFamily: "monospace", fontSize: "1rem", flex: 1,
                    background: "var(--bg-2)", border: "1px solid var(--line-soft)",
                    borderRadius: "var(--radius-sm)", padding: "0.4rem 0.6rem",
                    color: "var(--cream)", letterSpacing: tempPwdVisible ? "0.1em" : undefined,
                  }}
                />
                <button onClick={() => setTempPwdVisible(v => !v)} style={{
                  background: "var(--bg-2)", border: "1px solid var(--line-soft)",
                  borderRadius: "var(--radius-sm)", padding: "0.4rem 0.7rem",
                  cursor: "pointer", fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "nowrap",
                }}>
                  {tempPwdVisible ? "Masquer" : "Afficher"}
                </button>
                <button onClick={() => { navigator.clipboard.writeText(tempPwd.pwd); }} style={{
                  background: "var(--gold-bg)", border: "1px solid rgba(201,162,39,0.35)",
                  borderRadius: "var(--radius-sm)", padding: "0.4rem 0.7rem",
                  cursor: "pointer", fontSize: "0.78rem", color: "var(--gold-2)", whiteSpace: "nowrap",
                }}>
                  Copier
                </button>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.3rem" }}>
                Transmettez-le à l&apos;admin concerné en privé. Il disparaîtra dans 60 secondes.
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "1.25rem",
                        alignItems: "start" }}>
            {/* Formulaire création */}
            <Card>
              <h2 style={{ fontFamily: "var(--serif)", fontSize: "1.1rem", marginBottom: "1rem" }}>
                Créer un compte admin
              </h2>
              <form onSubmit={createAdmin}>
                <Input
                  label="Nom complet"
                  value={createForm.full_name}
                  required
                  onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                />
                <Input
                  label="Adresse e-mail"
                  type="email"
                  value={createForm.email}
                  required
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
                <Input
                  label="Mot de passe initial"
                  type="password"
                  value={createForm.password}
                  required
                  minLength={8}
                  placeholder="Minimum 8 caractères"
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                />
                <label style={{ display: "flex", gap: ".5rem", alignItems: "center",
                                marginBottom: "1rem", fontSize: ".88rem", color: "var(--muted)" }}>
                  <input
                    type="checkbox"
                    checked={createForm.is_super_admin}
                    onChange={(e) => setCreateForm({ ...createForm, is_super_admin: e.target.checked })}
                  />
                  Super admin (peut gérer les autres admins)
                </label>
                <Button type="submit">Créer le compte</Button>
              </form>
            </Card>

            {/* Liste des admins */}
            <div style={{ display: "grid", gap: "0.7rem" }}>
              {/* Formulaire d'édition inline */}
              {editingAdmin && (
                <Card style={{ borderLeft: "3px solid var(--gold)", paddingLeft: "1.25rem" }}>
                  <h3 style={{ fontFamily: "var(--serif)", fontSize: "1rem", marginBottom: "0.85rem" }}>
                    Modifier {editingAdmin.full_name}
                  </h3>
                  <form onSubmit={saveEditAdmin}>
                    <Input
                      label="Nom complet"
                      value={editForm.full_name}
                      required
                      onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                    />
                    <Input
                      label="Adresse e-mail"
                      type="email"
                      value={editForm.email}
                      required
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    />
                    <div style={{ display: "flex", gap: ".6rem" }}>
                      <Button type="submit">Enregistrer</Button>
                      <Button type="button" variant="ghost"
                              onClick={() => setEditingAdmin(null)}>
                        Annuler
                      </Button>
                    </div>
                  </form>
                </Card>
              )}

              {/* Cards admins */}
              {admins.map((admin) => {
                const isSelf   = admin.id === user.id;
                const isActive = admin.status === "ACTIF";
                return (
                  <Card key={admin.id}
                        style={{ opacity: isActive ? 1 : 0.65 }}>
                    <div style={{ display: "flex", alignItems: "center",
                                  justifyContent: "space-between", gap: "0.85rem" }}>
                      {/* Avatar + info */}
                      <div style={{ display: "flex", gap: "0.85rem", alignItems: "center", minWidth: 0 }}>
                        <Avatar user={admin} size={42} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center",
                                        flexWrap: "wrap", marginBottom: "0.15rem" }}>
                            <strong style={{ fontSize: "0.9rem" }}>{admin.full_name}</strong>
                            {isSelf && <Badge color="#c9a227">Vous</Badge>}
                            <Badge color={isActive ? "#5fb98a" : "#7d7264"}>
                              {isActive ? "Actif" : "Inactif"}
                            </Badge>
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--muted-2)" }}>
                            {admin.email}
                          </div>
                          {admin.last_login && (
                            <div style={{ fontSize: "0.72rem", color: "var(--muted-2)", marginTop: "0.1rem" }}>
                              Dernière connexion :{" "}
                              {new Date(admin.last_login).toLocaleDateString("fr-FR")}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      {!isSelf && (
                        <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0, flexWrap: "wrap" }}>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditingAdmin(admin);
                              setEditForm({ full_name: admin.full_name, email: admin.email });
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            Éditer
                          </Button>
                          <Button variant="ghost" onClick={() => toggleAdmin(admin)}>
                            {isActive ? "Désactiver" : "Activer"}
                          </Button>
                          <Button variant="ghost" onClick={() => setResetPwdTarget(admin)}>
                            Réinit. mdp
                          </Button>
                          <Button variant="danger" onClick={() => setDeleteTarget(admin)}>
                            Supprimer
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}

              {admins.length === 0 && (
                <Card>
                  <p style={{ color: "var(--muted)", textAlign: "center", padding: "1rem 0" }}>
                    Aucun compte admin.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </>
      )}


      {/* ════════════════════════════════════════════════════════════════════
          ONGLET 3 — RÉSEAUX SOCIAUX
      ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "reseaux" && (
        <Card>
          <h2 style={{ fontFamily: "var(--serif)", fontSize: "1.1rem", marginBottom: "1rem" }}>
            Liens de réseaux sociaux
          </h2>
          {socialLoading ? (
            <div style={{ color: "var(--muted)", fontSize: "0.88rem" }}>Chargement des liens…</div>
          ) : (
            <form onSubmit={saveSocialLinks} style={{ maxWidth: 620 }}>
              <Input label="Facebook" value={socialForm.facebook_url} placeholder="https://facebook.com/..." onChange={(e) => setSocialForm({ ...socialForm, facebook_url: e.target.value })} />
              <Input label="Instagram" value={socialForm.instagram_url} placeholder="https://instagram.com/..." onChange={(e) => setSocialForm({ ...socialForm, instagram_url: e.target.value })} />
              <Input label="YouTube" value={socialForm.youtube_url} placeholder="https://youtube.com/..." onChange={(e) => setSocialForm({ ...socialForm, youtube_url: e.target.value })} />
              <Input label="TikTok" value={socialForm.tiktok_url} placeholder="https://tiktok.com/..." onChange={(e) => setSocialForm({ ...socialForm, tiktok_url: e.target.value })} />
              <Button type="submit" loading={socialSaving}>Enregistrer</Button>
            </form>
          )}
        </Card>
      )}

      {/* ── Modales équipe ── */}
      {deactivateTarget && (
        <ConfirmModal
          title={`Désactiver ${deactivateTarget.full_name}`}
          message="Cet admin ne pourra plus se connecter au back-office."
          withReason
          reasonLabel="Motif de désactivation"
          confirmLabel="Désactiver"
          onClose={() => setDeactivateTarget(null)}
          onConfirm={async (reason) => {
            await adminAccountApi.deactivateAdmin(deactivateTarget.id, reason);
            toast(`${deactivateTarget.full_name} désactivé.`, "success");
            setDeactivateTarget(null);
            await loadAdmins();
          }}
        />
      )}

      {resetPwdTarget && (
        <ConfirmModal
          title="Réinitialiser le mot de passe"
          message={`Un mot de passe temporaire sera généré pour ${resetPwdTarget.full_name}.`}
          confirmLabel="Réinitialiser"
          variant="primary"
          onClose={() => setResetPwdTarget(null)}
          onConfirm={async () => {
            const { data } = await adminAccountApi.resetAdminPassword(resetPwdTarget.id);
            setTempPwd({ id: resetPwdTarget.id, pwd: data.temp_password });
            setTempPwdVisible(false);
            setTimeout(() => setTempPwd(null), 60_000);
            setResetPwdTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Supprimer le compte de ${deleteTarget.full_name}`}
          message="Cette action est irréversible. Le compte sera définitivement supprimé."
          confirmLabel="Supprimer définitivement"
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await adminAccountApi.removeAdmin(deleteTarget.id);
            toast("Compte supprimé.", "success");
            setDeleteTarget(null);
            await loadAdmins();
          }}
        />
      )}
    </div>
  );
}

// ── Indicateur de force du mot de passe ──────────────────────────────────────

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8 caractères min.",  pass: password.length >= 8 },
    { label: "Majuscule",          pass: /[A-Z]/.test(password) },
    { label: "Chiffre",            pass: /\d/.test(password) },
    { label: "Caractère spécial",  pass: /[^A-Za-z0-9]/.test(password) },
  ];
  const score  = checks.filter((c) => c.pass).length;
  const colors = ["#cf5a3c", "#d9a441", "#d9a441", "#5fb98a", "#5fb98a"];

  return (
    <div>
      {/* Barre de force */}
      <div style={{ display: "flex", gap: "3px", marginBottom: "0.45rem" }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 999,
              background: i < score ? colors[score] : "var(--bg-3)",
              transition: "background .2s",
            }}
          />
        ))}
      </div>
      {/* Checklist */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {checks.map(({ label, pass }) => (
          <span
            key={label}
            style={{
              fontSize: "0.72rem",
              color: pass ? "#5fb98a" : "var(--muted-2)",
            }}
          >
            {pass ? "✓" : "○"} {label}
          </span>
        ))}
      </div>
    </div>
  );
}