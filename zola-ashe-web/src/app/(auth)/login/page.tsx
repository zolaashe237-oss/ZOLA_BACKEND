"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { Alert, Button, Card, Input, errorMessage } from "@/components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Connexion</h1>
      <Alert>{error}</Alert>
      <form onSubmit={onSubmit}>
        <Input label="Email" type="email" value={email} required
               onChange={(e) => setEmail(e.target.value)} />
        <Input label="Mot de passe" type="password" value={password} required
               onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={loading} block>Se connecter</Button>
      </form>
      <div style={{ marginTop: "1rem", fontSize: "0.85rem", display: "flex", justifyContent: "space-between" }}>
        <Link href="/register" className="link">Créer un compte</Link>
        <Link href="/reset-password" className="link">Mot de passe oublié ?</Link>
      </div>
    </Card>
  );
}
