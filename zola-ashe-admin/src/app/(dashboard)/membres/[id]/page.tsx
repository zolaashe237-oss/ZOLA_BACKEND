"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { financeApi, membersApi } from "@/lib/endpoints";
import type { MemberDetail } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Select, errorMessage } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import ManualPaymentModal from "@/components/ManualPaymentModal";

// ── Constantes ────────────────────────────────────────────────────────────────

const BRANCH_CFG: Record<string, { color: string; label: string; icon: string; desc: string }> = {
  MEMBRE: { color: "#c9a227", label: "Espace Membre",  icon: "◉", desc: "Accès général à la plateforme" },
  FEMME:  { color: "#b5532a", label: "Branche Femme",  icon: "♀", desc: "Contenus & cercle féminin" },
  ENFANT: { color: "#52b083", label: "Branche Enfant", icon: "◈", desc: "Ressources pour les enfants" },
};

const STATUS_COLOR: Record<string, string> = {
  ACTIF: "var(--ok)", RESTREINT: "var(--warn)", BLOQUE: "var(--danger)",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIF: "Actif", RESTREINT: "Restreint", BLOQUE: "Bloqué",
};

const PAY_COLOR: Record<string, string> = {
  VALIDE: "var(--ok)", REUSSI: "var(--ok)", EN_ATTENTE: "var(--warn)", ECHOUE: "var(--danger)",
  REMBOURSE: "var(--muted)", EXONERE: "var(--muted-2)",
};
const PAY_LABEL: Record<string, string> = {
  VALIDE: "Réussi", REUSSI: "Réussi", EN_ATTENTE: "En attente", ECHOUE: "Échoué",
  REMBOURSE: "Remboursé", EXONERE: "Exonéré",
};
const PAY_TYPE_LABEL: Record<string, string> = {
  INSCRIPTION: "Inscription", COTISATION: "Cotisation mensuelle", ANNUEL: "Cotisation annuelle",
  BRANCHE_FEMME: "Branche Femme", BRANCHE_ENFANT: "Branche Enfant", DON: "Don",
  FORMATION: "Formation", REMBOURSEMENT: "Remboursement",
};
const payTypeLabel = (p: { type: string; formation_title?: string | null }) =>
  p.formation_title ? `${PAY_TYPE_LABEL[p.type] ?? p.type} · ${p.formation_title}` : (PAY_TYPE_LABEL[p.type] ?? p.type);

const BILLING_LABEL: Record<string, string> = {
  ANNUEL: "Annuel", TRANCHES: "Par tranches", MENSUEL: "Mensuel",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtAmt(n: number) { return n.toLocaleString("fr-FR") + " FCFA"; }

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, size = 72 }: { name: string; size?: number }) {
  const p = name.trim().split(" ");
  const ini = ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, #c9a227, #b5532a)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: Math.round(size * 0.38) + "px", fontWeight: 800, color: "#fff",
    }}>
      {ini}
    </div>
  );
}

// ── Barre de progression ──────────────────────────────────────────────────────

function ProgressBar({ pct, color = "var(--gold)", height = 6 }: {
  pct: number; color?: string; height?: number;
}) {
  return (
    <div style={{ background: "var(--line-soft)", borderRadius: 99, height, overflow: "hidden", flex: 1 }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%",
        background: color, borderRadius: 99, transition: "width .5s",
      }} />
    </div>
  );
}

// ── Modal — Modifier le profil ────────────────────────────────────────────────

function EditProfileModal({ member, onClose, onSaved }: {
  member: MemberDetail; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: member.full_name,
    email:     member.email,
    phone:     member.phone ?? "",
    country:   member.country ?? "",
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      await membersApi.update(member.id, {
        full_name: form.full_name,
        email:     form.email,
        phone:     form.phone || null,
        country:   form.country || null,
      });
      onSaved(); onClose();
    } catch (err) { toast(errorMessage(err), "error"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="Modifier le profil" onClose={onClose} maxWidth={440}>
      <form onSubmit={submit}>
        <Input label="Nom complet" value={form.full_name} required
          onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        <Input label="Adresse email" type="email" value={form.email} required
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Téléphone" value={form.phone} placeholder="+229 97 12 34 56"
          onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Input label="Pays" value={form.country} placeholder="Bénin"
          onChange={(e) => setForm({ ...form, country: e.target.value })} />
        <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={loading}>Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal — Modifier les accès branches ──────────────────────────────────────

function EditBranchesModal({ member, onClose, onSaved }: {
  member: MemberDetail; onClose: () => void; onSaved: () => void;
}) {
  const [levels,  setLevels]  = useState<string[]>(member.access_levels ?? []);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const toggle = (l: string) =>
    setLevels((prev) =>
      prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      await membersApi.update(member.id, { access_levels: levels });
      onSaved(); onClose();
    } catch (err) { toast(errorMessage(err), "error"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="Modifier les accès" onClose={onClose} maxWidth={420}>
      <p style={{ fontSize: ".85rem", color: "var(--muted)", marginBottom: "1.2rem" }}>
        Cochez les branches auxquelles ce membre doit avoir accès.
      </p>
      <form onSubmit={submit}>
        <div style={{ display: "flex", flexDirection: "column", gap: ".85rem", marginBottom: "1.4rem" }}>
          {Object.entries(BRANCH_CFG).map(([key, cfg]) => (
            <label key={key} style={{
              display: "flex", gap: "0.75rem", alignItems: "flex-start", cursor: "pointer",
              padding: "0.7rem 0.85rem", borderRadius: "var(--radius-sm)",
              border: `1px solid ${levels.includes(key) ? cfg.color + "55" : "var(--line-soft)"}`,
              background: levels.includes(key) ? `${cfg.color}08` : "transparent",
              transition: "all .15s",
            }}>
              <input type="checkbox" checked={levels.includes(key)} onChange={() => toggle(key)}
                style={{ marginTop: "0.1rem", accentColor: cfg.color }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: ".9rem", color: levels.includes(key) ? cfg.color : "var(--cream)" }}>
                  {cfg.icon} {cfg.label}
                </div>
                <div style={{ fontSize: ".77rem", color: "var(--muted)", marginTop: "0.15rem" }}>
                  {cfg.desc}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={loading}>Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Constantes paiement ───────────────────────────────────────────────────────


// ── Modal — Paiement manuel ───────────────────────────────────────────────────


// ── Modal — Annuler / Rembourser un paiement ──────────────────────────────────

function RefundPaymentModal({ memberId, payment, onClose, onDone }: {
  memberId: number;
  payment: { id: number; type: string; amount: number; paid_at: string | null; formation_title?: string | null };
  onClose: () => void;
  onDone: (accessRevoked: boolean) => void;
}) {
  const isFormation = payment.type === "FORMATION";
  const [amount,  setAmount]  = useState(String(payment.amount));
  const [revoke,  setRevoke]  = useState(true);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const { data } = await financeApi.refund({
        user_id:    memberId,
        amount:     Number(amount),
        payment_id: payment.id,
        ...(isFormation ? { revoke_access: revoke } : {}),
        reason:     `Annulation / remboursement — paiement #${payment.id}`,
      });
      onDone(data.access_revoked); onClose();
    } catch (err) { toast(errorMessage(err), "error"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="Annuler / Rembourser un paiement" onClose={onClose} maxWidth={420}>
      <div style={{ marginBottom: "1rem", padding: "0.65rem 0.85rem", background: "rgba(192,64,44,0.07)", borderRadius: "var(--radius-sm)", border: "1px solid rgba(192,64,44,0.25)", fontSize: ".84rem" }}>
        <div style={{ fontWeight: 700, color: "var(--bad)", marginBottom: ".3rem" }}>⚠ Attention</div>
        <div style={{ color: "var(--muted)" }}>
          Cette opération crée un remboursement enregistré dans l&apos;historique.{" "}
          {isFormation
            ? "Pour un achat de formation, vous pouvez retirer l'accès ci-dessous."
            : "Elle n'affecte pas les accès branches du membre."}
        </div>
      </div>
      <div style={{ marginBottom: "1rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".5rem .75rem", fontSize: ".83rem" }}>
        <div><span style={{ color: "var(--muted-2)" }}>Référence</span><div style={{ fontWeight: 600 }}>#{payment.id}</div></div>
        <div><span style={{ color: "var(--muted-2)" }}>Type</span><div style={{ fontWeight: 600 }}>{payTypeLabel(payment)}</div></div>
        <div><span style={{ color: "var(--muted-2)" }}>Montant initial</span><div style={{ fontWeight: 600 }}>{payment.amount.toLocaleString("fr-FR")} FCFA</div></div>
        <div><span style={{ color: "var(--muted-2)" }}>Date</span><div style={{ fontWeight: 600 }}>{payment.paid_at ? new Date(payment.paid_at).toLocaleDateString("fr-FR") : "—"}</div></div>
      </div>
      <form onSubmit={submit}>
        <Input
          label="Montant à rembourser (FCFA)"
          type="number" min={1} value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        {isFormation && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: ".5rem", marginBottom: "1rem", fontSize: ".84rem", cursor: "pointer" }}>
            <input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)}
                   style={{ accentColor: "var(--bad)", marginTop: ".15rem" }} />
            <span>
              Retirer l&apos;accès à la formation{payment.formation_title ? ` « ${payment.formation_title} »` : ""}
              <span style={{ display: "block", fontSize: ".74rem", color: "var(--muted-2)" }}>
                Décochez pour un geste commercial : le membre garde la formation.
              </span>
            </span>
          </label>
        )}
        <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="danger" loading={loading}>Confirmer le remboursement</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function MemberDetailPage() {
  const { toast } = useToast();
  const params = useParams();
  const router = useRouter();
  const userId = Number(params.id);

  const [member,       setMember]       = useState<MemberDetail | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [busy,         setBusy]         = useState("");
  const [tempPwd,      setTempPwd]      = useState<string | null>(null);
  const [pwdVisible,   setPwdVisible]   = useState(false);

  const [showBlockDlg,    setShowBlockDlg]    = useState(false);
  const [showWarnDlg,     setShowWarnDlg]     = useState(false);
  const [showResetDlg,    setShowResetDlg]    = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showEditBranch,  setShowEditBranch]  = useState(false);
  const [showPayment,     setShowPayment]     = useState(false);
  const [refundTarget,    setRefundTarget]    = useState<MemberDetail["payments"][number] | null>(null);
  const [showDeleteDlg,   setShowDeleteDlg]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await membersApi.detail(userId);
      setMember(data);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally { setLoading(false); }
  }, [userId, toast]);

  useEffect(() => { load(); }, [load]);

  const unblock = async () => {
    setBusy("unblock");
    try { await membersApi.unblock(userId); toast("Membre débloqué.", "success"); await load(); }
    catch (e) { toast(errorMessage(e), "error"); }
    finally { setBusy(""); }
  };

  if (loading) return (
    <div style={{ padding: "3rem", textAlign: "center", color: "var(--muted)" }}>Chargement…</div>
  );
  if (!member) return (
    <div style={{ padding: "3rem", textAlign: "center", color: "var(--muted)" }}>Membre introuvable.</div>
  );

  const statusColor = STATUS_COLOR[member.status] ?? "var(--muted)";

  return (
    <div className="fade-up">
      {/* Retour */}
      <button onClick={() => router.back()} style={{
        background: "none", border: "none", color: "var(--muted)", cursor: "pointer",
        fontSize: ".83rem", padding: "0 0 1.1rem", display: "flex", alignItems: "center", gap: ".35rem",
      }}>
        ← Retour aux membres
      </button>

      {/* ── Mot de passe temporaire ── */}
      {tempPwd && (
        <div style={{
          background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.38)",
          borderRadius: "var(--radius)", padding: "0.85rem 1.1rem", marginBottom: "1rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
            <strong style={{ fontSize: "0.82rem", color: "var(--gold-2)" }}>Mot de passe temporaire</strong>
            <button onClick={() => setTempPwd(null)} style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--muted)", fontSize: "0.8rem", padding: "0 0.25rem",
            }}>✕</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              readOnly
              type={pwdVisible ? "text" : "password"}
              value={tempPwd}
              style={{
                fontFamily: "monospace", fontSize: "1rem", flex: 1,
                background: "var(--bg-2)", border: "1px solid var(--line-soft)",
                borderRadius: "var(--radius-sm)", padding: "0.4rem 0.6rem",
                color: "var(--cream)", letterSpacing: pwdVisible ? "0.1em" : undefined,
              }}
            />
            <button onClick={() => setPwdVisible(v => !v)} style={{
              background: "var(--bg-2)", border: "1px solid var(--line-soft)",
              borderRadius: "var(--radius-sm)", padding: "0.4rem 0.7rem",
              cursor: "pointer", fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "nowrap",
            }}>
              {pwdVisible ? "Masquer" : "Afficher"}
            </button>
            <button onClick={() => { navigator.clipboard.writeText(tempPwd); }} style={{
              background: "var(--gold-bg)", border: "1px solid rgba(201,162,39,0.35)",
              borderRadius: "var(--radius-sm)", padding: "0.4rem 0.7rem",
              cursor: "pointer", fontSize: "0.78rem", color: "var(--gold-2)", whiteSpace: "nowrap",
            }}>
              Copier
            </button>
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.3rem" }}>
            Transmettez-le en privé. Il disparaîtra dans 60 secondes.
          </div>
        </div>
      )}

      {/* ── En-tête membre ── */}
      <Card style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <Avatar name={member.full_name} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap", marginBottom: ".35rem" }}>
              <h1 style={{ fontSize: "1.25rem", margin: 0 }}>{member.full_name}</h1>
              <Badge color={statusColor}>{STATUS_LABEL[member.status] ?? member.status}</Badge>
              {member.nb_warnings > 0 && (
                <Badge color={member.nb_warnings >= 3 ? "var(--danger)" : "var(--warn)"}>
                  ⚠ {member.nb_warnings} avertissement{member.nb_warnings > 1 ? "s" : ""}
                </Badge>
              )}
              {!member.email_verified && (
                <Badge color="var(--muted)">Email non vérifié</Badge>
              )}
            </div>
            <div style={{ fontSize: ".88rem", color: "var(--muted-2)", marginBottom: ".7rem" }}>
              {member.email}
            </div>
            {/* Branches actives */}
            <div style={{ display: "flex", gap: ".45rem", flexWrap: "wrap" }}>
              {(member.access_levels ?? []).length === 0 ? (
                <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>Aucune branche active</span>
              ) : (member.access_levels ?? []).map((l) => {
                const cfg = BRANCH_CFG[l];
                if (!cfg) return null;
                return (
                  <span key={l} style={{
                    display: "inline-flex", alignItems: "center", gap: ".3rem",
                    fontSize: ".76rem", fontWeight: 700, borderRadius: 99, padding: ".18rem .6rem",
                    color: cfg.color, background: `${cfg.color}13`,
                    border: `1px solid ${cfg.color}30`,
                  }}>
                    {cfg.icon} {cfg.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap", alignSelf: "flex-start" }}>
            <Button style={{ fontSize: ".78rem", padding: ".3rem .65rem" }} variant="ghost"
              onClick={() => setShowEditProfile(true)}>
              ✎ Profil
            </Button>
            <Button style={{ fontSize: ".78rem", padding: ".3rem .65rem" }} variant="ghost"
              onClick={() => setShowEditBranch(true)}>
              ⊕ Branches
            </Button>
            <Button style={{ fontSize: ".78rem", padding: ".3rem .65rem" }} variant="ghost"
              onClick={() => setShowPayment(true)}>
              + Paiement
            </Button>
            <Button style={{ fontSize: ".78rem", padding: ".3rem .65rem" }} variant="ghost"
              onClick={() => setShowWarnDlg(true)}>
              ⚑ Avertir
            </Button>
            <Button style={{ fontSize: ".78rem", padding: ".3rem .65rem" }} variant="ghost"
              onClick={() => setShowResetDlg(true)}>
              🔑 MDP
            </Button>
            {member.status === "BLOQUE" ? (
              <Button style={{ fontSize: ".78rem", padding: ".3rem .65rem" }}
                loading={busy === "unblock"} onClick={unblock}>
                Débloquer
              </Button>
            ) : (
              <Button style={{ fontSize: ".78rem", padding: ".3rem .65rem" }} variant="danger"
                onClick={() => setShowBlockDlg(true)}>
                Bloquer
              </Button>
            )}
            <Button style={{ fontSize: ".78rem", padding: ".3rem .65rem" }} variant="danger"
              onClick={() => setShowDeleteDlg(true)}>
              🗑 RGPD
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Infos + Abonnements ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        {/* Informations personnelles */}
        <Card>
          <h2 style={{ fontSize: "1rem", marginBottom: ".9rem" }}>Informations</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
            <tbody>
              {([
                ["Rôle",               member.role],
                ["Pays",               member.country ?? "—"],
                ["Téléphone",          member.phone ?? "—"],
                ["Inscrit le",         fmt(member.created_at)],
                ["Dernière connexion",  fmt(member.last_login)],
                ["Statut changé le",   fmt(member.status_changed_at)],
              ] as [string, string][]).map(([label, value]) => (
                <tr key={label} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                  <td style={{ padding: ".45rem .2rem", color: "var(--muted)", width: "50%" }}>{label}</td>
                  <td style={{ padding: ".45rem .2rem", color: "var(--cream)" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Abonnements */}
        <Card>
          <h2 style={{ fontSize: "1rem", marginBottom: ".9rem" }}>Abonnements</h2>
          {member.subscriptions.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>Aucun abonnement.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
              {member.subscriptions.map((s) => (
                <div key={s.id} style={{
                  padding: ".6rem .75rem", borderRadius: "var(--radius-sm)",
                  border: `1px solid ${s.active ? "var(--gold-2)22" : "var(--line-soft)"}`,
                  background: s.active ? "var(--gold-bg)" : "transparent",
                  opacity: s.active ? 1 : 0.65,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".3rem" }}>
                    <span style={{ fontWeight: 700, fontSize: ".85rem", color: s.active ? "var(--gold-2)" : "var(--muted)" }}>
                      {s.type}
                    </span>
                    <div style={{ display: "flex", gap: ".35rem" }}>
                      {s.billing && (
                        <Badge color="var(--muted-2)">{BILLING_LABEL[s.billing] ?? s.billing}</Badge>
                      )}
                      <Badge color={s.active ? "var(--ok)" : "var(--muted)"}>
                        {s.active ? "Actif" : "Expiré"}
                      </Badge>
                    </div>
                  </div>
                  <div style={{ fontSize: ".77rem", color: "var(--muted)" }}>
                    {fmt(s.start)} → {s.end ? fmt(s.end) : "∞"}
                  </div>
                  {/* Barre de tranches */}
                  {s.billing === "TRANCHES" && s.tranches_total != null && (
                    <div style={{ marginTop: ".5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".72rem", color: "var(--muted)", marginBottom: ".3rem" }}>
                        <span>Tranches payées</span>
                        <strong style={{ color: "var(--gold-2)" }}>
                          {s.tranches_paid ?? 0} / {s.tranches_total}
                        </strong>
                      </div>
                      <ProgressBar pct={((s.tranches_paid ?? 0) / s.tranches_total) * 100} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Branches actives (cartes visuelles) ── */}
      {(member.access_levels ?? []).length > 0 && (
        <Card style={{ marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: ".9rem" }}>Accès actifs</h2>
          <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap" }}>
            {(member.access_levels ?? []).map((l) => {
              const cfg = BRANCH_CFG[l];
              if (!cfg) return null;
              return (
                <div key={l} style={{
                  flex: "1 1 160px", padding: "1rem 1.1rem", borderRadius: "var(--radius-sm)",
                  border: `1px solid ${cfg.color}30`, background: `${cfg.color}08`,
                  display: "flex", flexDirection: "column", gap: ".3rem",
                }}>
                  <span style={{ fontSize: "1.5rem" }}>{cfg.icon}</span>
                  <strong style={{ fontSize: ".9rem", color: cfg.color }}>{cfg.label}</strong>
                  <span style={{ fontSize: ".76rem", color: "var(--muted)" }}>{cfg.desc}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Progression formations ── */}
      {(member.formations_progress ?? []).length > 0 && (
        <Card style={{ marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: ".9rem" }}>
            Progression des formations
            <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".82rem", marginLeft: ".5rem" }}>
              ({member.formations_progress!.length} formation{member.formations_progress!.length > 1 ? "s" : ""})
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
            {member.formations_progress!.map((fp) => (
              <div key={fp.formation_id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".35rem" }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: ".88rem" }}>{fp.formation_title}</span>
                    {fp.completed && (
                      <span style={{ marginLeft: ".5rem" }}>
                        <Badge color="var(--ok)">Terminée</Badge>
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: ".75rem", alignItems: "center", fontSize: ".78rem", color: "var(--muted-2)" }}>
                    <span>{fp.modules_completed}/{fp.modules_total} modules</span>
                    {fp.quiz_score != null && (
                      <span>Quiz : <strong style={{ color: fp.quiz_score >= 14 ? "var(--ok)" : "var(--warn)" }}>
                        {fp.quiz_score}/20
                      </strong></span>
                    )}
                    <strong style={{ color: "var(--gold-2)" }}>{fp.progress_pct}%</strong>
                  </div>
                </div>
                <ProgressBar
                  pct={fp.progress_pct}
                  color={fp.completed ? "var(--ok)" : "var(--gold)"}
                  height={7}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Formations achetées à l'unité ── */}
      {(member.formation_purchases ?? []).length > 0 && (
        <Card style={{ marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: ".9rem" }}>
            Formations achetées
            <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".82rem", marginLeft: ".5rem" }}>
              (accès sans abonnement)
            </span>
          </h2>
          <table>
            <thead>
              <tr>
                <th>Formation</th>
                <th style={{ textAlign: "right" }}>Montant</th>
                <th>Date</th>
                <th>Paiement</th>
              </tr>
            </thead>
            <tbody>
              {member.formation_purchases!.map((fp) => (
                <tr key={fp.formation_id}>
                  <td style={{ fontWeight: 600, fontSize: ".86rem" }}>
                    <a href={`/contenu/${fp.formation_id}`}>{fp.formation_title}</a>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontSize: ".86rem" }}>
                    {fp.amount != null ? fmtAmt(fp.amount) : "—"}
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: ".83rem" }}>{fmt(fp.purchased_at)}</td>
                  <td>
                    {fp.payment_id
                      ? <Badge color={fp.manual ? "var(--warn)" : "var(--ok)"}>
                          {fp.manual ? "Validé manuellement" : "En ligne"} · #{fp.payment_id}
                        </Badge>
                      : <span style={{ color: "var(--muted-2)", fontSize: ".8rem" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: ".75rem 0 0", fontSize: ".76rem", color: "var(--muted-2)" }}>
            Pour retirer un accès, remboursez le paiement correspondant dans l&apos;historique ci-dessous.
          </p>
        </Card>
      )}

      {/* ── Historique des paiements ── */}
      <Card style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".9rem" }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>
            Historique des paiements
            <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".82rem", marginLeft: ".5rem" }}>
              ({member.payments.length} transaction{member.payments.length !== 1 ? "s" : ""})
            </span>
          </h2>
          <Button style={{ fontSize: ".76rem", padding: ".28rem .6rem" }} variant="ghost"
            onClick={() => setShowPayment(true)}>
            + Ajouter
          </Button>
        </div>
        {member.payments.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: ".85rem" }}>Aucun paiement enregistré.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Statut</th>
                <th style={{ textAlign: "right" }}>Montant</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {member.payments.map((p) => {
                const canRefund = (p.status === "VALIDE" || p.status === "REUSSI") && p.type !== "REMBOURSEMENT" && p.amount > 0;
                return (
                  <tr key={p.id}>
                    <td style={{ color: "var(--muted-2)", fontSize: ".78rem" }}>#{p.id}</td>
                    <td style={{ fontSize: ".83rem" }}>{payTypeLabel(p)}</td>
                    <td>
                      <Badge color={PAY_COLOR[p.status] ?? "var(--muted)"}>
                        {PAY_LABEL[p.status] ?? p.status}
                      </Badge>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, fontSize: ".88rem" }}>
                      {p.amount === 0 ? <span style={{ color: "var(--muted)" }}>—</span> : fmtAmt(p.amount)}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: ".83rem" }}>{fmt(p.paid_at)}</td>
                    <td>
                      {canRefund && (
                        <Button className="btn-sm" variant="ghost"
                          style={{ color: "var(--bad)", fontSize: ".72rem", padding: ".2rem .5rem" }}
                          onClick={() => setRefundTarget(p)}>
                          Rembourser
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Quiz résultats ── */}
      {member.quiz_results.length > 0 && (
        <Card>
          <h2 style={{ fontSize: "1rem", marginBottom: ".9rem" }}>
            Résultats quiz
            <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".82rem", marginLeft: ".5rem" }}>
              ({member.quiz_results.length} quiz passé{member.quiz_results.length !== 1 ? "s" : ""})
            </span>
          </h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Formation / Quiz</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th>Résultat</th>
              </tr>
            </thead>
            <tbody>
              {member.quiz_results.map((r) => (
                <tr key={r.quiz}>
                  <td style={{ fontSize: ".88rem" }}>{r.title}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>
                    <span style={{ color: r.score >= 14 ? "var(--ok)" : r.score >= 10 ? "var(--warn)" : "var(--danger)" }}>
                      {r.score}
                    </span>
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}>/20</span>
                  </td>
                  <td>
                    <Badge color={r.validated ? "var(--ok)" : "var(--danger)"}>
                      {r.validated ? "Validé" : "Non validé"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Modales ── */}

      {showEditProfile && (
        <EditProfileModal member={member}
          onClose={() => setShowEditProfile(false)}
          onSaved={() => { toast("Profil mis à jour.", "success"); load(); }} />
      )}

      {showEditBranch && (
        <EditBranchesModal member={member}
          onClose={() => setShowEditBranch(false)}
          onSaved={() => { toast("Accès branches mis à jour.", "success"); load(); }} />
      )}

      {showPayment && (
        <ManualPaymentModal userId={userId} userName={member.full_name}
          onClose={() => setShowPayment(false)}
          onDone={() => { toast("Paiement enregistré.", "success"); load(); }} />
      )}

      {refundTarget && (
        <RefundPaymentModal memberId={userId} payment={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={(revoked) => {
            toast(revoked ? "Remboursement enregistré · accès à la formation retiré." : "Remboursement enregistré.", "success");
            load();
          }} />
      )}

      {showBlockDlg && (
        <ConfirmModal
          title={`Bloquer ${member.full_name}`}
          message="Le membre ne pourra plus se connecter ni accéder au contenu."
          withReason reasonLabel="Motif du blocage" confirmLabel="Bloquer"
          onClose={() => setShowBlockDlg(false)}
          onConfirm={async (reason) => {
            await membersApi.block(userId, reason);
            toast("Membre bloqué.", "success"); setShowBlockDlg(false); await load();
          }}
        />
      )}

      {showWarnDlg && (
        <ConfirmModal
          title={`Avertir ${member.full_name}`}
          message="Un avertissement officiel sera enregistré sur son profil."
          withReason reasonLabel="Motif de l'avertissement" confirmLabel="Avertir"
          variant="primary"
          onClose={() => setShowWarnDlg(false)}
          onConfirm={async (reason) => {
            const { data } = await membersApi.warn(userId, reason);
            let msg = `Avertissement envoyé. Total : ${data.nb_warnings}.`;
            if (data.recidive_alert) {
              msg += " ⚠ Alerte récidive : ce membre a atteint 3 avertissements ou plus.";
            }
            toast(msg, "success");
            setShowWarnDlg(false); await load();
          }}
        />
      )}

      {showResetDlg && (
        <ConfirmModal
          title="Réinitialiser le mot de passe"
          message={`Un mot de passe temporaire sera généré pour ${member.full_name}. Communiquez-le lui en privé.`}
          confirmLabel="Réinitialiser" variant="primary"
          onClose={() => setShowResetDlg(false)}
          onConfirm={async () => {
            const { data } = await membersApi.resetPassword(userId);
            setTempPwd(data.temp_password);
            setPwdVisible(false);
            setTimeout(() => setTempPwd(null), 60_000);
            setShowResetDlg(false);
          }}
        />
      )}

      {showDeleteDlg && (
        <ConfirmModal
          title={`Purge RGPD - ${member.full_name}`}
          message="Cette action anonymisera définitivement les données personnelles du membre conformément au RGPD. Les paiements et résultats de quiz seront préservés de façon anonyme."
          confirmLabel="Anonymiser le compte" variant="danger"
          onClose={() => setShowDeleteDlg(false)}
          onConfirm={async () => {
            await membersApi.delete(userId);
            setShowDeleteDlg(false);
            router.push("/membres");
          }}
        />
      )}
    </div>
  );
}
