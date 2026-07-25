"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authApi } from "@/lib/endpoints";
import { Alert, Button, Card, Input, errorMessage } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.passwordForgot(email);
      setInfo("Si un compte existe, un code a été envoyé.");
      setStep("reset");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.passwordReset({ email, code, new_password: newPassword });
      router.push("/login");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Mot de passe oublié</h1>
      <Alert>{error}</Alert>
      <Alert kind="success">{info}</Alert>
      {step === "request" ? (
        <form onSubmit={request}>
          <Input label="Email" type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" loading={loading} block>Recevoir un code</Button>
        </form>
      ) : (
        <form onSubmit={reset}>
          <Input label="Code reçu" inputMode="numeric" maxLength={6} value={code} required
                 onChange={(e) => setCode(e.target.value)} />
          <Input label="Nouveau mot de passe" type="password" value={newPassword} required
                 onChange={(e) => setNewPassword(e.target.value)} />
          <Button type="submit" loading={loading} block>Réinitialiser</Button>
        </form>
      )}
      <div style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
        <Link href="/login" className="link">Retour à la connexion</Link>
      </div>
    </Card>
  );
}
