"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authApi } from "@/lib/endpoints";
import { Alert, Button, Card, Input, errorMessage } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", full_name: "", password: "", password2: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await authApi.register(form);
      const codeParam = data.dev_code ? `&code=${data.dev_code}` : "";
      router.push(`/verify-otp?email=${encodeURIComponent(form.email)}${codeParam}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>Devenir membre</h1>
      <Alert>{error}</Alert>
      <form onSubmit={onSubmit}>
        <Input label="Nom complet" value={form.full_name} required onChange={set("full_name")} />
        <Input label="Email" type="email" value={form.email} required onChange={set("email")} />
        <Input label="Mot de passe" type="password" value={form.password} required onChange={set("password")} />
        <Input label="Confirmer le mot de passe" type="password" value={form.password2} required onChange={set("password2")} />
        <Button type="submit" loading={loading} block>Créer mon compte</Button>
      </form>
      <div style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
        Déjà membre ? <Link href="/login" className="link">Se connecter</Link>
      </div>
    </Card>
  );
}
