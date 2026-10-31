"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { authApi } from "@/lib/endpoints";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = "credentials" | "otp";

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain || local.length < 3) return email;
  return `${local[0]}${"•".repeat(Math.min(local.length - 2, 4))}${local.at(-1)}@${domain}`;
}

// ── Composant OTP ─────────────────────────────────────────────────────────────

function OtpInputs({
  value, onChange, disabled, shake,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  shake: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, "").split("").slice(0, 6);

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i]) {
        const next = [...digits]; next[i] = ""; onChange(next.join(""));
      } else if (i > 0) {
        const next = [...digits]; next[i - 1] = ""; onChange(next.join(""));
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft"  && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  };

  const handleInput = (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) return;
    if (raw.length > 1) {
      // Coller plusieurs chiffres
      const pasted = raw.slice(0, 6);
      const next = [...digits];
      for (let j = 0; j < pasted.length; j++) {
        if (i + j < 6) next[i + j] = pasted[j];
      }
      onChange(next.join(""));
      const focus = Math.min(i + pasted.length, 5);
      setTimeout(() => refs.current[focus]?.focus(), 0);
      return;
    }
    const next = [...digits]; next[i] = raw[0];
    onChange(next.join(""));
    if (i < 5) setTimeout(() => refs.current[i + 1]?.focus(), 0);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const raw = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!raw) return;
    onChange(raw.padEnd(6, "").slice(0, 6));
    setTimeout(() => refs.current[Math.min(raw.length, 5)]?.focus(), 0);
  };

  return (
    <div style={{
      display: "flex", gap: "0.5rem", justifyContent: "center",
      animation: shake ? "otpShake .45s ease" : undefined,
    }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={digits[i] || ""}
          disabled={disabled}
          autoFocus={i === 0}
          onKeyDown={(e) => handleKey(i, e)}
          onChange={(e) => handleInput(i, e)}
          onPaste={handlePaste}
          onClick={() => refs.current[i]?.select()}
          style={{
            width: 46, height: 56, textAlign: "center",
            fontSize: "1.45rem", fontWeight: 700, fontFamily: "var(--serif)",
            letterSpacing: 0, caretColor: "transparent",
            border: `2px solid ${digits[i] ? "var(--gold)" : "var(--line-med)"}`,
            borderRadius: "var(--radius-sm)",
            background: digits[i] ? "var(--gold-bg)" : "var(--bg-1)",
            color: "var(--cream)",
            outline: "none",
            transition: "border-color .15s, background .15s",
            cursor: disabled ? "not-allowed" : "text",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--gold)";
            e.currentTarget.style.boxShadow   = "0 0 0 3px rgba(201,162,39,.15)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = digits[i] ? "var(--gold)" : "var(--line-med)";
            e.currentTarget.style.boxShadow   = "none";
          }}
        />
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminLoginPage() {
  const { login, finalizeLogin } = useAuth();
  const router = useRouter();

  // ── Step state ──────────────────────────────────────────────────────────
  const [step,     setStep]     = useState<Step>("credentials");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [otp,      setOtp]      = useState("");
  const [otpShake, setOtpShake] = useState(false);

  // ── Status ──────────────────────────────────────────────────────────────
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // ── Countdown "renvoyer" ─────────────────────────────────────────────────
  const OTP_TTL = 60;
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // ── Étape 1 — Identifiants ────────────────────────────────────────────

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await login(email, password);
      // Login direct sans OTP → redirection
      setSuccess(true);
      setTimeout(() => router.push("/"), 600);
    } catch (err: unknown) {
      const e = err as { otpRequired?: boolean; message?: string };
      if (e?.otpRequired) {
        // Backend demande l'OTP
        setStep("otp");
        setCountdown(OTP_TTL);
      } else if (
        // Mode dev / backend sans OTP → on simule le passage OTP quand même
        // Retirer ce bloc quand le backend gère requires_otp
        (e as { message?: string })?.message?.includes("Réponse inattendue") ||
        (e as { message?: string })?.message?.includes("Network")
      ) {
        setStep("otp");
        setCountdown(OTP_TTL);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Étape 2 — OTP ────────────────────────────────────────────────────

  const verifyOtp = useCallback(async (code: string) => {
    if (code.length < 6) return;
    setError(""); setLoading(true);
    try {
      const { data } = await authApi.verifyOtp({ email, code });
      finalizeLogin(data.access, data.user);
      setSuccess(true);
      setTimeout(() => router.push("/"), 600);
    } catch (err) {
      setOtp("");
      setOtpShake(true);
      setTimeout(() => setOtpShake(false), 500);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [email, finalizeLogin, router]);

  // Auto-submit quand 6 chiffres saisis
  useEffect(() => {
    if (step === "otp" && otp.length === 6) verifyOtp(otp);
  }, [otp, step, verifyOtp]);

  const resend = async () => {
    if (countdown > 0) return;
    setError("");
    try {
      await authApi.resendOtp({ email });
      setCountdown(OTP_TTL);
      setOtp("");
    } catch (err) { setError(errorMessage(err)); }
  };

  // ── Rendu commun ──────────────────────────────────────────────────────

  const cardStyle: React.CSSProperties = {
    background: "var(--bg-1)",
    border: "1px solid var(--line-soft)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "0 24px 64px rgba(80,40,0,0.14), 0 4px 16px rgba(0,0,0,.06)",
    overflow: "hidden",
    position: "relative",
  };

  return (
    <div className="fade-up" style={cardStyle}>

      {/* Barre accent dorée */}
      <div style={{
        height: 3,
        background: "linear-gradient(90deg, var(--terra) 0%, var(--gold) 50%, var(--gold-2) 100%)",
      }} />

      {/* Indicateur d'étapes */}
      <div style={{
        display: "flex", gap: "0.4rem", alignItems: "center", justifyContent: "center",
        padding: "1.1rem 2rem 0",
      }}>
        {(["credentials", "otp"] as Step[]).map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.70rem", fontWeight: 700,
              background: step === s || (i === 0 && step === "otp")
                ? "linear-gradient(135deg, var(--gold), var(--terra))"
                : "var(--bg-3)",
              color: step === s || (i === 0 && step === "otp") ? "#fff" : "var(--muted)",
              transition: "all .25s",
            }}>
              {i === 0 && step === "otp" ? "✓" : i + 1}
            </div>
            <span style={{
              fontSize: "0.68rem", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.07em",
              color: step === s ? "var(--gold-2)" : "var(--muted-2)",
              display: "block",
            }}>
              {s === "credentials" ? "Identifiants" : "Vérification"}
            </span>
            {i < 1 && (
              <div style={{
                width: 28, height: 2, background: step === "otp" ? "var(--gold)" : "var(--line-soft)",
                borderRadius: 2, transition: "background .3s",
              }} />
            )}
          </div>
        ))}
      </div>

      {/* Corps */}
      <div style={{ padding: "1.6rem 2rem 2rem" }}>

        {/* ── ÉTAPE 1 : Identifiants ── */}
        {step === "credentials" && (
          <div>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.25rem",
                         color: "var(--cream)", textAlign: "center" }}>
              Connexion administrateur
            </h2>
            <p style={{ fontSize: "0.78rem", color: "var(--muted)", textAlign: "center",
                        marginBottom: "1.6rem" }}>
              Un code de vérification vous sera envoyé par e-mail
            </p>

            {error && (
              <div style={{
                padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)",
                background: "rgba(192,64,44,0.07)", border: "1px solid rgba(192,64,44,0.22)",
                fontSize: "0.82rem", color: "var(--bad)", marginBottom: "1rem",
                display: "flex", alignItems: "center", gap: "0.4rem",
              }}>
                <span style={{ flexShrink: 0 }}>⊗</span> {error}
              </div>
            )}

            <form onSubmit={handleCredentials}>
              {/* Email */}
              <div style={{ marginBottom: "0.9rem" }}>
                <label className="field-label">Adresse e-mail</label>
                <div style={{ position: "relative", marginTop: "0.35rem" }}>
                  <span style={{
                    position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)",
                    color: "var(--muted-2)", fontSize: "0.95rem", pointerEvents: "none",
                  }}>◎</span>
                  <input
                    type="email" required autoComplete="email" autoFocus
                    value={email}
                    placeholder="admin@zolaashe.com"
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    style={{ paddingLeft: "2.25rem", margin: 0, width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {/* Mot de passe */}
              <div style={{ marginBottom: "1.4rem" }}>
                <label className="field-label">Mot de passe</label>
                <div style={{ position: "relative", marginTop: "0.35rem" }}>
                  <span style={{
                    position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)",
                    color: "var(--muted-2)", fontSize: "0.85rem", pointerEvents: "none",
                  }}>⊕</span>
                  <input
                    type={showPwd ? "text" : "password"} required autoComplete="current-password"
                    value={password}
                    placeholder="••••••••"
                    onChange={(e) => setPassword(e.target.value)}
                    className="input"
                    style={{ paddingLeft: "2.25rem", paddingRight: "2.5rem", margin: 0, width: "100%", boxSizing: "border-box" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    style={{
                      position: "absolute", right: "0.65rem", top: "50%",
                      transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--muted-2)", fontSize: "0.75rem", padding: "0.2rem",
                      transition: "color .15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--gold-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-2)")}
                  >
                    {showPwd ? "Masquer" : "Afficher"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || success}
                className="btn btn-primary"
                style={{
                  width: "100%", padding: "0.7rem",
                  fontSize: "0.9rem", fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                  opacity: success ? 0.75 : 1,
                }}
              >
                {success ? (
                  <><span style={{ color: "#fff" }}>✓</span> Connecté</>
                ) : loading ? (
                  <>Connexion en cours…</>
                ) : (
                  <>Continuer →</>
                )}
              </button>
            </form>
          </div>
        )}

        {/* ── ÉTAPE 2 : OTP ── */}
        {step === "otp" && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              {/* Icône */}
              <div style={{
                width: 54, height: 54, borderRadius: "50%", margin: "0 auto 0.85rem",
                background: "linear-gradient(135deg, rgba(201,162,39,.15), rgba(181,83,42,.12))",
                border: "1.5px solid rgba(201,162,39,0.30)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.4rem",
              }}>
                ✉
              </div>

              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.3rem", color: "var(--cream)" }}>
                Vérification en 2 étapes
              </h2>
              <p style={{ fontSize: "0.79rem", color: "var(--muted)", lineHeight: 1.55 }}>
                Un code à 6 chiffres a été envoyé à<br />
                <strong style={{ color: "var(--cream)" }}>{maskEmail(email)}</strong>
              </p>
            </div>

            {error && (
              <div style={{
                padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)",
                background: "rgba(192,64,44,0.07)", border: "1px solid rgba(192,64,44,0.22)",
                fontSize: "0.82rem", color: "var(--bad)", marginBottom: "1rem", textAlign: "center",
              }}>
                ⊗ {error}
              </div>
            )}

            {/* Saisie OTP */}
            <OtpInputs
              value={otp}
              onChange={setOtp}
              disabled={loading || success}
              shake={otpShake}
            />

            {/* Info auto-submit */}
            <p style={{ fontSize: "0.72rem", color: "var(--muted-2)", textAlign: "center",
                        marginTop: "0.65rem" }}>
              {loading ? "Vérification…"
               : success ? <span style={{ color: "var(--ok)" }}>✓ Code validé !</span>
               : "Renseignez le code pour confirmer automatiquement"}
            </p>

            {/* Bouton vérifier (fallback) */}
            {!success && (
              <button
                onClick={() => verifyOtp(otp)}
                disabled={loading || otp.length < 6}
                className="btn btn-primary"
                style={{
                  width: "100%", marginTop: "1.1rem", padding: "0.65rem",
                  fontSize: "0.88rem", fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                  opacity: otp.length < 6 ? 0.55 : 1,
                }}
              >
                {loading ? "Vérification…" : "Valider le code"}
              </button>
            )}

            {/* Renvoyer + retour */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                          marginTop: "1.1rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => { setStep("credentials"); setOtp(""); setError(""); }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "0.78rem", color: "var(--muted)", padding: 0,
                  transition: "color .15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--cream)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
              >
                ← Retour
              </button>

              <button
                type="button"
                disabled={countdown > 0}
                onClick={resend}
                style={{
                  background: "none", border: "none", cursor: countdown > 0 ? "default" : "pointer",
                  fontSize: "0.78rem", fontWeight: 600,
                  color: countdown > 0 ? "var(--muted-2)" : "var(--gold-2)",
                  padding: 0, transition: "color .15s",
                }}
              >
                {countdown > 0
                  ? `Renvoyer dans ${countdown}s`
                  : "Renvoyer le code"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Style @keyframes inline pour le shake */}
      <style>{`
        @keyframes otpShake {
          0%,100% { transform: translateX(0); }
          20%     { transform: translateX(-6px); }
          40%     { transform: translateX(6px); }
          60%     { transform: translateX(-4px); }
          80%     { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
