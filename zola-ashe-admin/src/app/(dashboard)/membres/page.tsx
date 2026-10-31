"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { downloadBlob, financeApi, membersApi } from "@/lib/endpoints";
import type { User } from "@/lib/types";
import {
  Alert, Button, Card, Input, Pagination, Select,
  STATUS_COLOR, errorMessage, usePagination,
} from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/components/Toast";
import ManualPaymentModal from "@/components/ManualPaymentModal";

// ── Constantes branches ───────────────────────────────────────────────────────

const BRANCH_CFG: Record<string, { color: string; label: string; icon: string }> = {
  MEMBRE: { color: "#c9a227", label: "Membre",  icon: "◉" },
  FEMME:  { color: "#b5532a", label: "Femme",   icon: "♀" },
  ENFANT: { color: "#52b083", label: "Enfant",  icon: "◈" },
};

const STATUS_LABEL: Record<string, string> = {
  ACTIF: "Actif", RESTREINT: "Restreint", BLOQUE: "Bloqué",
};

// ── Sous-composants ───────────────────────────────────────────────────────────

function UserAvatar({ name, size = 34 }: { name: string; size?: number }) {
  const parts = name.trim().split(" ");
  const ini = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, #c9a227, #b5532a)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: Math.round(size * 0.36) + "px", fontWeight: 700, color: "#fff",
    }}>
      {ini}
    </div>
  );
}

function BranchBadges({ levels }: { levels?: string[] }) {
  if (!levels?.length)
    return <span style={{ color: "var(--muted-2)", fontSize: "0.72rem" }}>—</span>;
  return (
    <div style={{ display: "flex", gap: "0.22rem", flexWrap: "wrap" }}>
      {levels.map((l) => {
        const cfg = BRANCH_CFG[l];
        if (!cfg) return null;
        return (
          <span key={l} style={{
            fontSize: "0.60rem", fontWeight: 700,
            color: cfg.color, background: `${cfg.color}12`,
            border: `1px solid ${cfg.color}28`,
            padding: "0.04rem 0.38rem", borderRadius: 99,
          }}>
            {cfg.icon} {cfg.label}
          </span>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status as keyof typeof STATUS_COLOR] ?? "var(--muted)";
  return (
    <span style={{
      fontSize: "0.65rem", fontWeight: 700, borderRadius: 99,
      color, background: `${color}12`, border: `1px solid ${color}28`,
      padding: "0.08rem 0.5rem", whiteSpace: "nowrap",
    }}>
      {status === "ACTIF" ? "●" : "○"} {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── Modal — Créer un membre ───────────────────────────────────────────────────

function CreateMemberModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: () => void;
}) {
  const [form, setForm] = useState({
    full_name: "", email: "", password: "",
    access_levels: ["MEMBRE"] as string[],
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const toggle = (l: string) =>
    setForm((prev) => ({
      ...prev,
      access_levels: prev.access_levels.includes(l)
        ? prev.access_levels.filter((x) => x !== l)
        : [...prev.access_levels, l],
    }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      await membersApi.create(form);
      onCreated(); onClose();
    } catch (err) { toast(errorMessage(err), "error"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="Créer un membre" onClose={onClose} maxWidth={460}>
      <form onSubmit={submit}>
        <Input label="Nom complet" value={form.full_name} required
          placeholder="Marie-Claire Ahouandjinou"
          onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        <Input label="Adresse email" type="email" value={form.email} required
          placeholder="membre@email.com"
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Mot de passe provisoire" type="password" value={form.password} required
          placeholder="Minimum 8 caractères"
          onChange={(e) => setForm({ ...form, password: e.target.value })} />

        <div style={{ marginBottom: "1.1rem" }}>
          <span className="field-label">Branches d&apos;accès</span>
          <div style={{ display: "flex", gap: "1.1rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
            {Object.entries(BRANCH_CFG).map(([key, cfg]) => (
              <label key={key} style={{
                display: "flex", gap: "0.45rem", alignItems: "center",
                cursor: "pointer", fontSize: "0.85rem",
                color: form.access_levels.includes(key) ? cfg.color : "var(--muted)",
                fontWeight: form.access_levels.includes(key) ? 700 : 400,
              }}>
                <input type="checkbox" checked={form.access_levels.includes(key)}
                  onChange={() => toggle(key)} />
                {cfg.icon} {cfg.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={loading}>Créer le membre</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal — Paiement manuel ───────────────────────────────────────────────────



// ── Modal — Remboursement ─────────────────────────────────────────────────────

function RefundModal({ user, onClose, onDone }: {
  user: User; onClose: () => void; onDone: () => void;
}) {
  const [amount,  setAmount]  = useState("");
  const [reason,  setReason]  = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) { toast("Montant invalide.", "error"); return; }
    setLoading(true);
    try {
      await financeApi.refund({
        user_id: user.id,
        amount:  Number(amount),
        reason:  reason.trim() || `Remboursement — ${user.full_name}`,
      });
      onDone(); onClose();
    } catch (err) { toast(errorMessage(err), "error"); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="Rembourser / annuler un paiement" onClose={onClose} maxWidth={440}>
      <div style={{ marginBottom: "1rem", padding: "0.6rem 0.75rem", background: "rgba(185,28,28,0.06)", borderRadius: "var(--radius-sm)", border: "1px solid rgba(185,28,28,0.18)", fontSize: "0.83rem", color: "var(--bad)" }}>
        ⚠ Un remboursement crée une écriture négative dans l&apos;historique financier.
      </div>
      <div style={{ marginBottom: "1rem", padding: "0.6rem 0.75rem", background: "var(--bg-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-soft)", fontSize: "0.84rem", color: "var(--muted)" }}>
        Membre : <strong style={{ color: "var(--ink)" }}>{user.full_name}</strong>
      </div>
      <form onSubmit={submit}>
        <Input label="Montant à rembourser (FCFA)" type="number" min={1}
          value={amount} placeholder="Ex : 5000"
          onChange={(e) => setAmount(e.target.value)} required />
        <Input label="Motif (optionnel)" value={reason}
          placeholder="Ex : doublon, erreur de saisie…"
          onChange={(e) => setReason(e.target.value)} />
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <Button variant="ghost" type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="danger" loading={loading}>Confirmer le remboursement</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MembresPage() {
  const { toast } = useToast();
  const [members,      setMembers]      = useState<User[]>([]);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [showCreate,   setShowCreate]   = useState(false);
  const [payTarget,    setPayTarget]    = useState<User | null>(null);
  const [refundTarget, setRefundTarget] = useState<User | null>(null);
  const [exporting,    setExporting]    = useState(false);
  const [blockTarget,  setBlockTarget]  = useState<User | null>(null);
  const [warnTarget,   setWarnTarget]   = useState<User | null>(null);

  const debouncedSearch = useDebounce(filterSearch, 350);

  const load = useCallback(async () => {
    try {
      const { data } = await membersApi.list({
        search: debouncedSearch || undefined,
        status: filterStatus || undefined,
        page_size: 500,
      });
      setMembers(data.results);
    } catch (e) { toast(errorMessage(e), "error"); }
  }, [debouncedSearch, filterStatus, toast]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); await load(); toast(ok, "success"); } catch (e) { toast(errorMessage(e), "error"); }
  };

  const exportCsv = async () => {
    setExporting(true);
    try { const { data } = await financeApi.exportMembers(); downloadBlob(data as Blob, "membres.csv"); }
    catch (e) { toast(errorMessage(e), "error"); }
    finally { setExporting(false); }
  };

  // Filtrage local (branche + recherche si API ne filtre pas)
  const filtered = members.filter((m) => {
    const q = debouncedSearch.toLowerCase();
    if (q && !m.full_name.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q))
      return false;
    if (filterStatus && m.status !== filterStatus) return false;
    if (filterBranch && !m.access_levels?.includes(filterBranch)) return false;
    return true;
  });

  const filterKey = `${debouncedSearch}|${filterStatus}|${filterBranch}`;
  const { page, totalPages, paged, total, pageSize, setPageSize, go } =
    usePagination(filtered, 10, filterKey);

  const actifCount  = members.filter((m) => m.status === "ACTIF").length;
  const bloqueCount = members.filter((m) => m.status === "BLOQUE").length;

  return (
    <div className="fade-up">
      <div className="page-header">
        <div className="eyebrow">Gestion</div>
        <h1>Membres</h1>
        <p>
          {members.length} membre{members.length !== 1 ? "s" : ""}
          {" · "}<span style={{ color: "var(--ok)" }}>{actifCount} actif{actifCount !== 1 ? "s" : ""}</span>
          {bloqueCount > 0 && <> · <span style={{ color: "var(--bad)" }}>{bloqueCount} bloqué{bloqueCount !== 1 ? "s" : ""}</span></>}
        </p>
      </div>

      {/* Filtres + actions */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", marginBottom: "1.1rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Input label="Rechercher (nom / email)" value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)} />
        </div>
        <div style={{ width: 170 }}>
          <Select label="Statut" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            <option value="ACTIF">Actif</option>
            <option value="RESTREINT">Restreint</option>
            <option value="BLOQUE">Bloqué</option>
          </Select>
        </div>
        <div style={{ width: 170 }}>
          <Select label="Branche" value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
            <option value="">Toutes les branches</option>
            <option value="MEMBRE">◉ Espace Membre</option>
            <option value="FEMME">♀ Branche Femme</option>
            <option value="ENFANT">◈ Branche Enfant</option>
          </Select>
        </div>
        <Button style={{ marginBottom: "0.85rem" }} onClick={() => setShowCreate(true)}>
          + Créer un membre
        </Button>
        <Button variant="ghost" style={{ marginBottom: "0.85rem" }} loading={exporting} onClick={exportCsv}>
          ⬇ CSV
        </Button>
      </div>

      {/* Tableau */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>Membre</th>
              <th>Téléphone · Pays</th>
              <th>Statut</th>
              <th>Branches actives</th>
              <th>Inscription</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <UserAvatar name={m.full_name} />
                    <div>
                      <Link href={`/membres/${m.id}`} style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--gold-2)", textDecoration: "none" }}>
                        {m.full_name}
                      </Link>
                      <div style={{ fontSize: "0.76rem", color: "var(--muted-2)" }}>
                        {m.email}
                        {!m.email_verified && (
                          <span style={{ marginLeft: "0.4rem", fontSize: "0.60rem", color: "var(--warn)", fontWeight: 700 }}>✗ non vérifié</span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {m.phone ? (
                    <div style={{ fontSize: "0.81rem", color: "var(--cream)", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                      {m.phone}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.74rem", color: "var(--muted-2)", fontStyle: "italic" }}>—</div>
                  )}
                  {m.country ? (
                    <div style={{ fontSize: "0.73rem", color: "var(--muted)", marginTop: "0.15rem" }}>
                      {m.country}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.22rem", alignItems: "flex-start" }}>
                    <StatusBadge status={m.status} />
                    {m.nb_warnings > 0 && (
                      <span style={{ fontSize: "0.60rem", fontWeight: 700, color: m.nb_warnings >= 3 ? "var(--bad)" : "var(--warn)" }}>
                        ⚠ {m.nb_warnings} avert.
                      </span>
                    )}
                  </div>
                </td>
                <td><BranchBadges levels={m.access_levels} /></td>
                <td style={{ color: "var(--muted)", fontSize: "0.80rem", whiteSpace: "nowrap" }}>
                  {new Date(m.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.3rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <Link href={`/membres/${m.id}`}>
                      <Button style={{ fontSize: "0.76rem", padding: "0.30rem 0.6rem" }} variant="ghost">Voir</Button>
                    </Link>
                    <Button style={{ fontSize: "0.76rem", padding: "0.30rem 0.6rem" }} variant="ghost"
                      onClick={() => setPayTarget(m)}>
                      + Paiement
                    </Button>
                    <Button style={{ fontSize: "0.76rem", padding: "0.30rem 0.6rem" }} variant="ghost"
                      onClick={() => setRefundTarget(m)}>
                      − Rembourser
                    </Button>
                    <Button style={{ fontSize: "0.76rem", padding: "0.30rem 0.6rem" }} variant="ghost"
                      onClick={() => setWarnTarget(m)}>
                      Avertir
                    </Button>
                    {m.status === "BLOQUE" ? (
                      <Button style={{ fontSize: "0.76rem", padding: "0.30rem 0.6rem" }}
                        onClick={() => act(() => membersApi.unblock(m.id), `${m.full_name} débloqué.`)}>
                        Débloquer
                      </Button>
                    ) : (
                      <Button style={{ fontSize: "0.76rem", padding: "0.30rem 0.6rem" }} variant="danger"
                        onClick={() => setBlockTarget(m)}>
                        Bloquer
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                  Aucun membre trouvé.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={total}
          pageSize={pageSize} onPage={go} onPageSize={setPageSize} />
      </Card>

      {/* Modales */}
      {showCreate && (
        <CreateMemberModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { toast("Membre créé avec succès.", "success"); load(); }}
        />
      )}
      {payTarget && (
        <ManualPaymentModal
          userId={payTarget.id} userName={payTarget.full_name}
          onClose={() => setPayTarget(null)}
          onDone={() => { toast("Paiement enregistré.", "success"); setPayTarget(null); }}
        />
      )}
      {refundTarget && (
        <RefundModal
          user={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={() => { toast("Remboursement enregistré.", "success"); setRefundTarget(null); }}
        />
      )}
      {blockTarget && (
        <ConfirmModal
          title={`Bloquer ${blockTarget.full_name}`}
          message="Le membre ne pourra plus se connecter ni accéder au contenu."
          withReason reasonLabel="Motif du blocage" confirmLabel="Bloquer"
          onClose={() => setBlockTarget(null)}
          onConfirm={async (reason) => {
            await membersApi.block(blockTarget.id, reason);
            toast(`${blockTarget.full_name} bloqué.`, "success");
            setBlockTarget(null);
            await load();
          }}
        />
      )}
      {warnTarget && (
        <ConfirmModal
          title={`Avertir ${warnTarget.full_name}`}
          message="Un avertissement officiel sera enregistré sur son profil."
          withReason reasonLabel="Motif de l'avertissement" confirmLabel="Avertir"
          variant="primary"
          onClose={() => setWarnTarget(null)}
          onConfirm={async (reason) => {
            await membersApi.warn(warnTarget.id, reason);
            toast(`Avertissement envoyé à ${warnTarget.full_name}.`, "success");
            setWarnTarget(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
