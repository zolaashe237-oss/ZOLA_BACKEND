"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { authApi } from "@/lib/endpoints";
import { Alert, Button, Card, Input, errorMessage } from "@/components/ui";

function VerifyOtpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const devCode = params.get("code") ?? "";
  const [code, setCode] = useState(devCode);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.verifyOtp({ email, code });
      router.push("/login");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError("");
    setInfo("");
    try {
      await authApi.resendOtp(email);
      setInfo("Un nouveau code a été envoyé.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Vérification</h1>
      <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.85rem" }}>
        Saisissez le code à 6 chiffres reçu par email.
      </p>
      <Alert>{error}</Alert>
      <Alert kind="success">{info}</Alert>
      {devCode && (
        <p style={{ fontSize: ".82rem", background: "rgba(184,144,31,.12)", border: "1px solid var(--line)",
                    borderRadius: 10, padding: ".6rem .8rem", marginBottom: ".85rem", color: "var(--muted)" }}>
          Mode démo (sans email réel) — code pré-rempli : <strong className="text-gold">{devCode}</strong>
        </p>
      )}
      <form onSubmit={onSubmit}>
        <Input label="Email" type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        <Input label="Code" inputMode="numeric" maxLength={6} value={code} required
               onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" loading={loading} block>Valider</Button>
      </form>
      <button onClick={resend} style={{ marginTop: "1rem", background: "none", border: "none",
               color: "var(--gold-2)", cursor: "pointer", fontSize: "0.85rem", padding: 0 }}>
        Renvoyer le code
      </button>
    </Card>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={null}>
      <VerifyOtpForm />
    </Suspense>
  );
}
